/**
 * Redis session store — typed HASH wrapper (§11)
 *
 * Each session lives at key `session:{session_id}` with TTL 1800s.
 * The hash fields match SessionState exactly so we can round-trip
 * with a single HGETALL + HSET per tick.
 *
 * All platform fields are stored in the same hash — the null/non-null
 * state of desktop vs mobile data tells the pipeline which source
 * the session belongs to.
 *
 * In tests, swap the Redis constructor for ioredis-mock.
 */
import { Redis } from 'ioredis';
import type { SessionState, SharedSessionData, DesktopSessionData, MobileSessionData, SalesIntentState, FittsPair } from '../types/index.js';
import { defaultSharedData, defaultDesktopData, defaultMobileData } from '../types/index.js';
import { redis as redisConfig } from '../config/index.js';

// ─── Internal serialisation helpers ─────────────────────────
// We store typed fields as JSON strings inside the Redis hash.
// ioredis's HGETALL returns string→string; we parse on read
// and stringify on write.

function key(sessionId: string): string {
  return `${redisConfig.keyPrefix}${sessionId}`;
}

function parseField<T>(raw: string | undefined, fallback: T): T {
  if (raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

// ─── RedisSession class ─────────────────────────────────────

export class RedisSession {
  constructor(private readonly redis: Redis) {}

  /**
   * Fetch the full session state for a given session_id.
   * Returns default state if the key doesn't exist yet.
   */
  async getAll(sessionId: string): Promise<SessionState> {
    const raw = await this.redis.hgetall(key(sessionId));

    if (!raw || Object.keys(raw).length === 0) {
      // Fresh session — return defaults
      return {
        ...defaultSharedData(),
        desktop: null,
        mobile: null,
      };
    }

    return {
      meta: parseField(raw.meta, null),
      session_start_t: parseField<number>(raw.session_start_t, 0),
      pricing_rect: parseField(raw.pricing_rect, null),
      viewport_height: parseField<number>(raw.viewport_height, 0),
      scroll_y: parseField<number>(raw.scroll_y, 0),
      scroll_y_history: parseField<number[]>(raw.scroll_y_history, []),
      hover_pricing_entered_at: parseField<number | null>(raw.hover_pricing_entered_at, null),
      pricing_section_entered_at: parseField<number | null>(raw.pricing_section_entered_at, null),
      pricing_cta_clicked: parseField<boolean>(raw.pricing_cta_clicked, false),
      pinch_zoom_triggered: parseField<boolean>(raw.pinch_zoom_triggered, false),
      last_interaction_t: parseField<number>(raw.last_interaction_t, Date.now()),
      last_pointer_pos: parseField(raw.last_pointer_pos, null),
      active_signals: parseField<string[]>(raw.active_signals, []),
      hysteresis: parseField(raw.hysteresis, null),
      mixed_input: parseField<boolean>(raw.mixed_input, false),
      dom_snapshot: parseField(raw.dom_snapshot, null),
      dom_mutations: parseField(raw.dom_mutations, undefined),
      last_element_info: parseField(raw.last_element_info, null),
      replay_buffer: parseField(raw.replay_buffer, undefined),
      sales_intent_state: parseField<SalesIntentState | null>(raw.sales_intent_state, null),
      fitts_pairs: parseField<FittsPair[]>(raw.fitts_pairs, []),
      desktop: parseField<DesktopSessionData | null>(raw.desktop, null),
      mobile: parseField<MobileSessionData | null>(raw.mobile, null),
    };
  }

  /**
   * Persist the full session state.
   * Only non-null fields are written to keep the hash compact.
   * TTL is refreshed every write.
   */
  async setAll(sessionId: string, state: SessionState): Promise<void> {
    const pipe = this.redis.pipeline();
    const k = key(sessionId);

    // Shared fields (always present)
    pipe.hset(k, {
      meta: serialize(state.meta),
      session_start_t: serialize(state.session_start_t),
      pricing_rect: serialize(state.pricing_rect),
      viewport_height: serialize(state.viewport_height),
      scroll_y: serialize(state.scroll_y),
      scroll_y_history: serialize(state.scroll_y_history),
      hover_pricing_entered_at: serialize(state.hover_pricing_entered_at),
      pricing_section_entered_at: serialize(state.pricing_section_entered_at),
      pricing_cta_clicked: serialize(state.pricing_cta_clicked),
      pinch_zoom_triggered: serialize(state.pinch_zoom_triggered),
      last_interaction_t: serialize(state.last_interaction_t),
      last_pointer_pos: serialize(state.last_pointer_pos),
      active_signals: serialize(state.active_signals),
      hysteresis: serialize(state.hysteresis),
      mixed_input: serialize(state.mixed_input),
      dom_snapshot: serialize(state.dom_snapshot),
      dom_mutations: serialize(state.dom_mutations),
      last_element_info: serialize(state.last_element_info),
      replay_buffer: serialize(state.replay_buffer),
      sales_intent_state: serialize(state.sales_intent_state),
      fitts_pairs: serialize(state.fitts_pairs),
    });

    // Platform-specific data (only write the one that's active)
    if (state.desktop) {
      pipe.hset(k, 'desktop', serialize(state.desktop));
    }
    if (state.mobile) {
      pipe.hset(k, 'mobile', serialize(state.mobile));
    }

    // Refresh TTL
    pipe.expire(k, redisConfig.sessionTtlS);

    await pipe.exec();
  }

  /**
   * Update a subset of fields without reading the full hash.
   * Useful when only a few fields changed (e.g. tick loop writes
   * back updated accumulators without re-reading everything).
   */
  async updateFields(sessionId: string, fields: Record<string, unknown>): Promise<void> {
    if (Object.keys(fields).length === 0) return;

    const pipe = this.redis.pipeline();
    const k = key(sessionId);

    for (const [field, value] of Object.entries(fields)) {
      pipe.hset(k, field, serialize(value));
    }
    pipe.expire(k, redisConfig.sessionTtlS);
    await pipe.exec();
  }

  /**
   * Delete a session (used on explicit disconnect).
   */
  async delete(sessionId: string): Promise<void> {
    await this.redis.del(key(sessionId));
  }

  /**
   * Refresh TTL for an active session (called from the tick loop
   * even when state hasn't changed).
   */
  async touch(sessionId: string): Promise<void> {
    await this.redis.expire(key(sessionId), redisConfig.sessionTtlS);
  }

  /**
   * Set a custom TTL for a session (used for disconnected session cleanup).
   */
  async setTtl(sessionId: string, ttl: number): Promise<void> {
    await this.redis.expire(key(sessionId), ttl);
  }

  /**
   * Return the set of active session IDs.
   * We maintain a separate SET key for this, updated on connect/disconnect.
   */
  /**
   * Check if the underlying Redis connection is ready.
   */
   isConnected(): boolean {
     return this.redis.status === 'ready';
   }

  async getActiveIds(): Promise<string[]> {
    const prefix = redisConfig.keyPrefix;
    const ids: string[] = [];
    let cursor = '0';
    do {
      const result = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = result[0];
      const keys = result[1];
      for (const k of keys) {
        ids.push(k.replace(prefix, ''));
      }
    } while (cursor !== '0');
    return ids;
  }
}
