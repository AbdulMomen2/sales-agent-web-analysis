/**
 * WebSocket connection handler (§16-E, §5.2)
 *
 * Responsibilities:
 * 1. Parse ClientMeta from the first message on a new WS connection
 * 2. Compute tier0 score (never recomputed — §16-E)
 * 3. Check for concurrent connections (§16-E — spoof detection)
 * 4. Init Redis session if first time; resume existing state on reconnect
 * 5. Bind session_id → WebSocket for downstream push (ServerTick)
 *
 * Edge cases handled:
 * - Concurrent connection for same session_id → ping check within last 10s
 *   → responsive → reject new (spoofing, assign fresh session_id)
 *   → unresponsive → treat as reconnect, close stale, accept new
 * - Invalid JSON → close with 4001
 * - Missing/invalid fields → close with 4002
 */
import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import type { ClientMeta, SessionMeta } from '../types/index.js';
import { defaultSharedData, defaultDesktopData, defaultMobileData } from '../types/index.js';
import type { RedisSession } from '../store/redisSession.js';
import { ws as wsConfig, tier0 as tier0Config } from '../config/index.js';

/** Active WS connections, keyed by session_id */
export type ConnectionMap = Map<string, WebSocket>;

/** Ping timestamps for concurrent-connection detection */
const lastPingTime = new Map<string, number>();

// ─── Tier 0 scoring (§15, §16-E) ───────────────────────────
// Computed once at connect. Catches naive bots via static browser signals.
// Defense-in-depth: Tier 0 alone is easy to spoof; Tier 1+2 (variance) follow.

function computeTier0(meta: ClientMeta): number {
  if (meta.navigator_webdriver) return 0;

  let score = 1;
  if (meta.plugins_count < 2) score -= tier0Config.lowPluginsPenalty;
  else if (meta.plugins_count < 5) score -= tier0Config.midPluginsPenalty;
  if (meta.languages.length === 0) score -= tier0Config.noLanguagesPenalty;

  const renderer = meta.webgl_renderer?.toLowerCase() ?? '';
  for (const keyword of tier0Config.suspiciousWebglRenderers) {
    if (renderer.includes(keyword)) {
      score -= tier0Config.suspiciousWebglPenalty;
      break;
    }
  }

  return Math.max(0, Math.min(1, score));
}

// ─── Connection handler ─────────────────────────────────────

export interface ConnectionResult {
  session_id: string;
  tier0: number;
  is_new_session: boolean;
}

/**
 * Handle a new WebSocket connection.
 * Returns the resolved session_id and whether it's a new session (vs reconnect).
 */
export async function handleConnection(
  ws: WebSocket,
  meta: ClientMeta,
  store: RedisSession,
  connections: ConnectionMap,
): Promise<ConnectionResult> {
  // ── Step 1: Tier 0 ──────────────────────────────────────
  const tier0 = computeTier0(meta);
  const sessionId = meta.session_id;

  // ── Step 2: Concurrent connection check (§16-E) ───────
  const existingWs = connections.get(sessionId);
  if (existingWs && existingWs.readyState === WebSocket.OPEN) {
    const lastPing = lastPingTime.get(sessionId) ?? 0;
    const now = Date.now();

    if (now - lastPing < wsConfig.pingTimeoutMs) {
      // Session is alive on another connection → likely spoofing.
      // Assign a fresh session_id so the real session is not disrupted.
      const freshId = crypto.randomUUID();
      try {
        await initSession(store, freshId, meta, tier0);
      } catch {
        ws.close(1011, 'Redis write failed');
        return { session_id: freshId, tier0, is_new_session: true };
      }

      // Register the new connection under the fresh ID
      connections.set(freshId, ws);
      lastPingTime.set(freshId, now);

      return { session_id: freshId, tier0, is_new_session: true };
    }

    // Stale connection — close it, we'll take over.
    // close() may throw if the socket is already half-closed; that's fine.
    try { existingWs.close(4000, 'reconnect'); } catch { /* already closed */ }
    connections.delete(sessionId);
  }

  // ── Step 3: Load or init session ───────────────────────
  let existing: Awaited<ReturnType<typeof store.getAll>>;
  try {
    existing = await store.getAll(sessionId);
  } catch {
    ws.close(1011, 'Redis read failed');
    return { session_id: sessionId, tier0, is_new_session: false };
  }
  const isNewSession = existing.meta === null;

  try {
    if (isNewSession) {
      await initSession(store, sessionId, meta, tier0);
    } else {
      // Reconnect: update meta and tier0 but preserve accumulators
      await store.updateFields(sessionId, {
        meta: { ...meta, tier0_score: tier0 },
      });
    }
  } catch {
    ws.close(1011, 'Redis write failed');
    return { session_id: sessionId, tier0, is_new_session: isNewSession };
  }

  // ── Step 4: Register connection ────────────────────────
  connections.set(sessionId, ws);
  lastPingTime.set(sessionId, Date.now());

  return { session_id: sessionId, tier0, is_new_session: isNewSession };
}

/**
 * Initialize a fresh Redis session for a new connection.
 */
async function initSession(
  store: RedisSession,
  sessionId: string,
  meta: ClientMeta,
  tier0: number,
): Promise<void> {
  const shared = defaultSharedData();
  shared.meta = { ...meta, tier0_score: tier0 } as SessionMeta;
  shared.session_start_t = Date.now();

  const platformData = meta.source === 'mouse'
    ? { desktop: defaultDesktopData(), mobile: null }
    : { desktop: null, mobile: defaultMobileData() };

  await store.setAll(sessionId, {
    ...shared,
    ...platformData,
  });
}

/**
 * Record a ping time for a session (called from tick or WS pong).
 */
export function recordPing(sessionId: string): void {
  lastPingTime.set(sessionId, Date.now());
}

/**
 * Remove ping tracking for a disconnected session.
 */
export function clearPing(sessionId: string): void {
  lastPingTime.delete(sessionId);
}

/**
 * Handle a WebSocket disconnect for the given session_id.
 * Removes the connection from the active ConnectionMap and clears ping tracking.
 * Does NOT delete Redis session — TTL (1800s) handles cleanup.
 * This supports WS reconnects mid-session (§16-C).
 */
export function handleDisconnect(
  sessionId: string,
  connections: ConnectionMap,
): void {
  connections.delete(sessionId);
  clearPing(sessionId);
}
