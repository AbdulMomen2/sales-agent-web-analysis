/**
 * Tests for WS connection handler.
 *
 * Covers:
 * - Tier 0 scoring (webdriver flag, plugins, languages, WebGL)
 * - New session initialization (desktop + mobile paths)
 * - Session reconnect (preserves Welford accumulators)
 * - Concurrent connection spoof detection (§16-E)
 * - Stale connection takeover
 * - Ping tracking
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebSocket as WsWebSocket } from 'ws';
import RedisMock from 'ioredis-mock';
import { RedisSession } from '../../../src/store/redisSession.js';
import {
  handleConnection,
  recordPing,
  clearPing,
  type ConnectionMap,
} from '../../../src/ws/connectionHandler.js';
import type { ClientMeta } from '../../../src/types/index.js';

/**
 * Create a mock WebSocket that doesn't actually connect.
 * The ws constructor connects eagerly, so we use EventEmitter as a stand-in.
 */
import { EventEmitter } from 'node:events';
function mockWs(): WsWebSocket {
  const emitter = new EventEmitter() as unknown as WsWebSocket;
  Object.defineProperty(emitter, 'readyState', { value: WsWebSocket.OPEN, writable: true });
  (emitter as any).close = () => {};
  (emitter as any).send = () => {};
  return emitter;
}

describe('connectionHandler', () => {
  let store: RedisSession;
  let mockRedis: InstanceType<typeof RedisMock>;
  let connections: ConnectionMap;

  /** Unique session_id per test to avoid cross-test interference */
  let sessionCounter = 0;
  function makeSessionId(): string {
    sessionCounter++;
    return `test-${sessionCounter}`;
  }

  /** Helper: create a realistic ClientMeta with overrides */
  function makeMeta(overrides: Partial<ClientMeta> & { session_id?: string } = {}): ClientMeta {
    return {
      session_id: makeSessionId(),
      navigator_webdriver: false,
      plugins_count: 5,
      languages: ['en-US'],
      webgl_renderer: 'ANGLE (Intel, NVIDIA)',
      source: 'mouse',
      ...overrides,
    };
  }

  beforeEach(() => {
    mockRedis = new RedisMock();
    store = new RedisSession(mockRedis);
    connections = new Map();
  });

  afterEach(() => {
    for (const [sid] of connections) {
      connections.delete(sid);
      clearPing(sid);
    }
  });

  // ─── Tier 0 scoring ──────────────────────────────────────

  it('returns tier0=0 when navigator_webdriver is true', async () => {
    const ws = mockWs();
    const meta = makeMeta({ navigator_webdriver: true });
    const result = await handleConnection(ws, meta, store, connections);
    expect(result.tier0).toBe(0);
  });

  it('returns tier0=1 for a clean human-like browser', async () => {
    const ws = mockWs();
    const meta = makeMeta({
      plugins_count: 7,
      languages: ['en-US', 'fr'],
      webgl_renderer: 'ANGLE (Intel, NVIDIA)',
    });
    const result = await handleConnection(ws, meta, store, connections);
    expect(result.tier0).toBe(1);
  });

  it('penalizes low plugin count', async () => {
    const ws = mockWs();
    const meta = makeMeta({ plugins_count: 0 });
    const result = await handleConnection(ws, meta, store, connections);
    expect(result.tier0).toBeLessThan(1);
    expect(result.tier0).toBeGreaterThan(0);
  });

  it('penalizes suspicious WebGL renderer (SwiftShader)', async () => {
    const ws = mockWs();
    const meta = makeMeta({ webgl_renderer: 'Google SwiftShader' });
    const result = await handleConnection(ws, meta, store, connections);
    expect(result.tier0).toBeLessThan(1);
  });

  it('penalizes empty languages', async () => {
    const ws = mockWs();
    const meta = makeMeta({ languages: [] });
    const result = await handleConnection(ws, meta, store, connections);
    expect(result.tier0).toBeLessThan(1);
  });

  // ─── New session init ────────────────────────────────────

  it('creates a new Redis session for an unseen session_id (desktop)', async () => {
    const ws = mockWs();
    const meta = makeMeta({ source: 'mouse' });
    const result = await handleConnection(ws, meta, store, connections);

    expect(result.is_new_session).toBe(true);
    const saved = await store.getAll(result.session_id);
    expect(saved.meta).not.toBeNull();
    expect(saved.meta?.source).toBe('mouse');
    expect(saved.meta?.tier0_score).toBeGreaterThan(0);
    expect(saved.desktop).not.toBeNull();
    expect(saved.mobile).toBeNull();
  });

  it('creates a new Redis session for mobile source', async () => {
    const ws = mockWs();
    const meta = makeMeta({ source: 'touch' });
    const result = await handleConnection(ws, meta, store, connections);

    expect(result.is_new_session).toBe(true);
    const saved = await store.getAll(result.session_id);
    expect(saved.meta?.source).toBe('touch');
    expect(saved.desktop).toBeNull();
    expect(saved.mobile).not.toBeNull();
  });

  it('registers the connection in the map', async () => {
    const ws = mockWs();
    const result = await handleConnection(ws, makeMeta(), store, connections);
    expect(connections.has(result.session_id)).toBe(true);
    expect(connections.get(result.session_id)).toBe(ws);
  });

  // ─── Reconnect ───────────────────────────────────────────

  it('reconnects to an existing session and preserves accumulators', async () => {
    const sid = makeSessionId();

    // First connection: create session with some Welford state
    const ws1 = mockWs();
    await handleConnection(ws1, makeMeta({ session_id: sid }), store, connections);
    await store.updateFields(sid, {
      desktop: {
        curve_buffer: [],
        welford_E: { n: 5, mean: 0.9, M2: 0.01 },
        welford_R: { n: 0, mean: 0, M2: 0 },
        welford_jerk: { n: 0, mean: 0, M2: 0 },
      },
    });

    // "Disconnect" first WS
    connections.delete(sid);

    // Second connection: same session_id
    const ws2 = mockWs();
    const result = await handleConnection(ws2, makeMeta({ session_id: sid }), store, connections);

    expect(result.is_new_session).toBe(false);
    const loaded = await store.getAll(sid);
    expect(loaded.desktop?.welford_E?.n).toBe(5); // accumulators preserved
    expect(loaded.meta?.tier0_score).toBeGreaterThan(0);
  });

  // ─── Concurrent connection (§16-E) ───────────────────────

  it('assigns a fresh session_id when concurrent connection is alive', async () => {
    const sid = makeSessionId();

    const ws1 = mockWs();
    await handleConnection(ws1, makeMeta({ session_id: sid }), store, connections);

    // Record a recent ping → active connection
    recordPing(sid);

    // Second connection with the same session_id
    const ws2 = mockWs();
    const result = await handleConnection(ws2, makeMeta({ session_id: sid }), store, connections);

    // Should get a new session_id (spoofing protection)
    expect(result.session_id).not.toBe(sid);
    expect(connections.has(sid)).toBe(true);     // original still connected
    expect(connections.has(result.session_id)).toBe(true); // new one registered
  });

  it('takes over from a stale connection (no recent ping)', async () => {
    const sid = makeSessionId();

    const wsOld = mockWs();
    await handleConnection(wsOld, makeMeta({ session_id: sid }), store, connections);

    // Clear the ping so the existing connection appears stale (no ping within 10s)
    clearPing(sid);

    const wsNew = mockWs();
    const closeSpy = vi.spyOn(wsOld, 'close');
    const result = await handleConnection(wsNew, makeMeta({ session_id: sid }), store, connections);

    expect(result.session_id).toBe(sid); // same session taken over
    expect(closeSpy).toHaveBeenCalledWith(4000, 'reconnect');
  });

  // ─── Ping tracking ───────────────────────────────────────

  it('records ping time and clears it', () => {
    recordPing('ping-test');
    clearPing('ping-test');
  });
});
