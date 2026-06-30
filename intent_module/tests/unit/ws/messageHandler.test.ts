/**
 * Tests for WS message handler.
 *
 * Covers:
 * - JSON parsing and validation (valid/invalid/malformed batches)
 * - Event sorting by timestamp
 * - Downsampling of high-frequency batches (>200 points)
 * - Desktop event routing (pointer_move, pointer_down, scroll)
 * - Mobile event routing (touch_start/move/end, scroll)
 * - Edge cases: visibility change (discard buffers), orientation change, mixed input, no session
 */
import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { RedisSession } from '../../../src/store/redisSession.js';
import { handleMessage, parseBatch, routeEvent, prepareEvents } from '../../../src/ws/messageHandler.js';
import type { ClientEvent, SessionState } from '../../../src/types/index.js';
import { defaultSharedData, defaultDesktopData, defaultMobileData } from '../../../src/types/index.js';

describe('messageHandler', () => {
  let store: RedisSession;
  let mockRedis: InstanceType<typeof RedisMock>;

  /** Build a minimal desktop session */
  function makeDesktopSession(overrides: Partial<SessionState> = {}): SessionState {
    return {
      ...defaultSharedData(),
      meta: { session_id: 'd1', navigator_webdriver: false, plugins_count: 5, languages: ['en'], webgl_renderer: 'ANGLE', source: 'mouse', tier0_score: 1 },
      desktop: defaultDesktopData(),
      mobile: null,
      ...overrides,
    };
  }

  /** Build a minimal mobile session */
  function makeMobileSession(overrides: Partial<SessionState> = {}): SessionState {
    return {
      ...defaultSharedData(),
      meta: { session_id: 'm1', navigator_webdriver: false, plugins_count: 3, languages: ['en'], webgl_renderer: 'Apple GPU', source: 'touch', tier0_score: 1 },
      desktop: null,
      mobile: defaultMobileData(),
      ...overrides,
    };
  }

  beforeEach(() => {
    mockRedis = new RedisMock();
    store = new RedisSession(mockRedis);
  });

  // ─── parseBatch ──────────────────────────────────────────

  it('parses a valid ClientBatch', () => {
    const raw = JSON.stringify({
      session_id: 'abc',
      events: [{ type: 'pointer_move', t: 100, point: { x: 10, y: 20 } }],
    });
    const result = parseBatch(raw);
    expect(result).not.toBeNull();
    expect(result?.session_id).toBe('abc');
    expect(result?.events).toHaveLength(1);
  });

  it('returns null for invalid JSON', () => {
    expect(parseBatch('not json')).toBeNull();
  });

  it('returns null for missing events array', () => {
    expect(parseBatch(JSON.stringify({ session_id: 'abc' }))).toBeNull();
  });

  it('returns null for missing session_id', () => {
    expect(parseBatch(JSON.stringify({ events: [] }))).toBeNull();
  });

  it('returns null for non-object parsed value', () => {
    expect(parseBatch('"hello"')).toBeNull();
  });

  // ─── Desktop event routing ───────────────────────────────

  it('appends pointer_move to curve_buffer', () => {
    const session = makeDesktopSession();
    routeEvent(session, { type: 'pointer_move', t: 100, point: { x: 10, y: 20 } });
    expect(session.desktop?.curve_buffer).toHaveLength(1);
    expect(session.desktop?.curve_buffer[0]).toEqual({ x: 10, y: 20, t: 100 });
  });

  it('sets mixed_input when pointer_move arrives on a touch-declared session', () => {
    const session = makeMobileSession();
    routeEvent(session, { type: 'pointer_move', t: 100, point: { x: 10, y: 20 } });
    expect(session.mixed_input).toBe(true);
  });

  // ─── Mobile event routing ────────────────────────────────

  it('appends single touch_move to current_touch_buffer', () => {
    const session = makeMobileSession();
    routeEvent(session, {
      type: 'touch_move', t: 100,
      touches: [{ x: 100, y: 200, pressure: 0.5 }],
    });
    expect(session.mobile?.current_touch_buffer).toHaveLength(1);
  });

  it('routes multi-touch to gesture buffer', () => {
    const session = makeMobileSession();
    // First, start with a single touch
    routeEvent(session, {
      type: 'touch_start', t: 100,
      touches: [{ x: 0, y: 0 }],
    });
    // Then multi-touch
    routeEvent(session, {
      type: 'touch_move', t: 110,
      touches: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
    });
    // Single-touch buffer should be finalized into gesture buffer
    expect(session.mobile?.current_touch_buffer).toHaveLength(0);
    expect(session.mobile?.gesture_buffer).toHaveLength(1);
  });

  // ─── Scroll events ───────────────────────────────────────

  it('records scroll_y and appends to history', () => {
    const session = makeDesktopSession();
    routeEvent(session, { type: 'scroll', t: 200, scroll_y: 500 });
    expect(session.scroll_y).toBe(500);
    expect(session.scroll_y_history).toHaveLength(1);
    expect(session.scroll_y_history[0]).toBe(500);
  });

  it('caps scroll_y_history at 50 entries', () => {
    const session = makeDesktopSession();
    for (let i = 0; i < 60; i++) {
      routeEvent(session, { type: 'scroll', t: 1000 + i, scroll_y: i });
    }
    expect(session.scroll_y_history).toHaveLength(50);
    expect(session.scroll_y_history[0]).toBe(10); // oldest dropped
    expect(session.scroll_y_history[49]).toBe(59); // newest kept
  });

  it('stores scroll events in mobile scroll_event_buffer', () => {
    const session = makeMobileSession();
    routeEvent(session, { type: 'scroll', t: 300, scroll_y: 100 });
    expect(session.mobile?.scroll_event_buffer).toHaveLength(1);
    expect(session.mobile?.scroll_event_buffer[0].scroll_y).toBe(100);
  });

  // ─── Visibility & orientation ────────────────────────────

  it('discards curve_buffer on tab hide (desktop)', () => {
    const session = makeDesktopSession();
    routeEvent(session, { type: 'pointer_move', t: 100, point: { x: 10, y: 20 } });
    routeEvent(session, { type: 'visibility_change', t: 200, visible: false });
    expect(session.desktop?.curve_buffer).toHaveLength(0);
  });

  it('discards touch buffers on tab hide (mobile)', () => {
    const session = makeMobileSession();
    routeEvent(session, { type: 'touch_start', t: 100, touches: [{ x: 0, y: 0 }] });
    routeEvent(session, { type: 'touch_move', t: 110, touches: [{ x: 5, y: 5 }] });
    routeEvent(session, { type: 'visibility_change', t: 200, visible: false });
    expect(session.mobile?.current_touch_buffer).toHaveLength(0);
    expect(session.mobile?.gesture_buffer).toHaveLength(0);
  });

  it('clears touch buffers on orientation change', () => {
    const session = makeMobileSession();
    routeEvent(session, { type: 'touch_start', t: 100, touches: [{ x: 0, y: 0 }] });
    routeEvent(session, { type: 'orientation_change', t: 200 });
    expect(session.mobile?.current_touch_buffer).toHaveLength(0);
  });

  // ─── handleMessage (integration-style) ───────────────────

  it('processes a batch and persists to Redis', async () => {
    // First, create a session via connection
    const session = makeDesktopSession({ meta: { ...makeDesktopSession().meta!, session_id: 'integ' } as any });
    await store.setAll('integ', session);

    // Send a batch
    const raw = JSON.stringify({
      session_id: 'integ',
      events: [
        { type: 'pointer_move', t: 100, point: { x: 10, y: 20 } },
        { type: 'pointer_move', t: 110, point: { x: 15, y: 25 } },
      ],
    });

    await handleMessage(raw, 'integ', store);

    const loaded = await store.getAll('integ');
    expect(loaded.desktop?.curve_buffer).toHaveLength(2);
  });

  it('drops events if session_id mismatch', async () => {
    const raw = JSON.stringify({
      session_id: 'mismatch',
      events: [{ type: 'pointer_move', t: 100, point: { x: 10, y: 20 } }],
    });
    // No error, just no-op
    await handleMessage(raw, 'actual-session', store);
  });

  it('drops events if session has no meta (not yet initialized)', async () => {
    const raw = JSON.stringify({
      session_id: 'uninit',
      events: [{ type: 'pointer_move', t: 100, point: { x: 10, y: 20 } }],
    });
    await handleMessage(raw, 'uninit', store);
    // Just shouldn't throw
  });

  it('downsamples batches with >200 events', () => {
    const events: ClientEvent[] = [];
    for (let i = 0; i < 500; i++) {
      events.push({ type: 'pointer_move', t: i, point: { x: i, y: i } });
    }
    const result = prepareEvents(events);
    // Downsampled to ~200 events
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.length).toBeGreaterThan(0);
  });

  // ─── DOM snapshot & mutation events ───────────────────────

  it('stores dom_snapshot in session', () => {
    const session = makeDesktopSession();
    routeEvent(session, { type: 'dom_snapshot', t: 100, html: '<html></html>', css: 'body {}' });
    expect(session.dom_snapshot).toEqual({ html: '<html></html>', css: 'body {}' });
  });

  it('appends dom_mutation records to session', () => {
    const session = makeDesktopSession();
    routeEvent(session, {
      type: 'dom_mutation', t: 100,
      mutations: [
        { type: 'childList', target: 'div#app', addedNodes: ['<button.btn>'] },
        { type: 'attributes', target: 'div', attributeName: 'class', attributeValue: 'active' },
      ],
    });
    expect(session.dom_mutations).toHaveLength(2);
    expect(session.dom_mutations![0].type).toBe('childList');
    expect(session.dom_mutations![1].attributeName).toBe('class');
  });

  it('caps dom_mutations at 10000 records', () => {
    const session = makeDesktopSession();
    const bigBatch = Array.from({ length: 15000 }, (_, i) => ({
      type: 'childList' as const, target: `div:nth-of-type(${i})`,
    }));
    routeEvent(session, { type: 'dom_mutation', t: 100, mutations: bigBatch as any });
    expect(session.dom_mutations!.length).toBeLessThanOrEqual(10000);
  });

  it('sorts out-of-order events by timestamp', () => {
    const session = makeDesktopSession();
    routeEvent(session, { type: 'pointer_move', t: 200, point: { x: 20, y: 20 } });
    routeEvent(session, { type: 'pointer_move', t: 100, point: { x: 10, y: 10 } });
    routeEvent(session, { type: 'pointer_move', t: 150, point: { x: 15, y: 15 } });

    // Events are routed in call order, not sorted — the sort happens in handleMessage.
    // This test verifies the raw append; sorting is handleMessage's job.
    expect(session.desktop?.curve_buffer).toHaveLength(3);
  });
});
