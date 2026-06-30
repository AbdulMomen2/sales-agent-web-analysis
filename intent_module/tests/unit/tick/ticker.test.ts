/**
 * Tests for the tick loop.
 *
 * Covers:
 * - Loop iterates active sessions
 * - TTL is refreshed for each session
 * - Processor callback is called with correct arguments
 * - Error in one session doesn't crash the loop
 * - Stop function stops the loop
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import RedisMock from 'ioredis-mock';
import { RedisSession } from '../../../src/store/redisSession.js';
import { tick, startTickLoop, type SessionProcessor } from '../../../src/tick/ticker.js';
import type { SessionState } from '../../../src/types/index.js';
import { defaultSharedData, defaultDesktopData } from '../../../src/types/index.js';

describe('ticker', () => {
  let store: RedisSession;
  let mockRedis: InstanceType<typeof RedisMock>;
  let connections: Map<string, any>;

  /** Build a minimal desktop session for testing */
  function seedSession(id: string, overrides: Partial<SessionState> = {}) {
    const session: SessionState = {
      ...defaultSharedData(),
      meta: { session_id: id, navigator_webdriver: false, plugins_count: 5, languages: ['en'], webgl_renderer: 'ANGLE', source: 'mouse', tier0_score: 1 },
      desktop: defaultDesktopData(),
      mobile: null,
      ...overrides,
    };
    return store.setAll(id, session);
  }

  beforeEach(async () => {
    mockRedis = new RedisMock();
    mockRedis.status = 'ready';
    store = new RedisSession(mockRedis);
    connections = new Map();
    // Flush any residual mock data
    await mockRedis.flushall();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('iterates active sessions and touches TTL', async () => {
    await seedSession('s1');
    await seedSession('s2');

    // Sessions must have active WS connections to get TTL refresh
    connections.set('s1', {});
    connections.set('s2', {});

    const touchSpy = vi.spyOn(store, 'touch');

    await tick(store, connections);

    expect(touchSpy).toHaveBeenCalledWith('s1');
    expect(touchSpy).toHaveBeenCalledWith('s2');
  });

  it('calls the processor with each session', async () => {
    await seedSession('proc-1');
    await seedSession('proc-2');

    const processedIds: string[] = [];
    const processor: SessionProcessor = async (sessionId) => {
      processedIds.push(sessionId);
    };

    await tick(store, connections, processor);

    expect(processedIds).toContain('proc-1');
    expect(processedIds).toContain('proc-2');
  });

  it('skips sessions with no meta (not initialised)', async () => {
    await store.setAll('partial', { ...defaultSharedData(), meta: null, desktop: null, mobile: null });

    const touchSpy = vi.spyOn(store, 'touch');

    await tick(store, connections);

    expect(touchSpy).not.toHaveBeenCalledWith('partial');
  });

  it('continues the loop when one session processor throws', async () => {
    await seedSession('good');
    await seedSession('bad');

    const processedIds: string[] = [];
    const processor: SessionProcessor = async (sessionId) => {
      if (sessionId === 'bad') throw new Error('processor error');
      processedIds.push(sessionId);
    };

    await tick(store, connections, processor);

    expect(processedIds).toContain('good');
    expect(processedIds).not.toContain('bad');
  });

  it('startTickLoop can be stopped', async () => {
    // Seed a session so the tick loop has work to do
    await seedSession('loop-test');

    const tickFn = vi.fn();
    const stop = startTickLoop(store, connections, tickFn, 50);

    // Wait for at least 2 ticks
    await new Promise(r => setTimeout(r, 120));
    expect(tickFn.mock.calls.length).toBeGreaterThanOrEqual(2);

    stop();

    const callsAfterStop = tickFn.mock.calls.length;
    // Wait a bit more — should not tick again
    await new Promise(r => setTimeout(r, 100));
    expect(tickFn.mock.calls.length).toBe(callsAfterStop);
  }, 10000);
});
