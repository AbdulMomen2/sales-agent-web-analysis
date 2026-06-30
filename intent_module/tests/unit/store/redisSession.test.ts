/**
 * Tests for RedisSession store.
 *
 * Uses ioredis-mock so no Redis server is needed.
 * Verifies round-trip serialisation, TTL refresh, partial updates.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { RedisSession } from '../../../src/store/redisSession.js';
import type { SessionState } from '../../../src/types/index.js';
import { defaultSharedData, defaultDesktopData } from '../../../src/types/index.js';

describe('RedisSession', () => {
  let store: RedisSession;
  let mockRedis: InstanceType<typeof RedisMock>;

  // A realistic session state for testing
  const sampleSession: SessionState = {
    ...defaultSharedData(),
    meta: {
      session_id: 'test-session-1',
      navigator_webdriver: false,
      plugins_count: 5,
      languages: ['en-US', 'fr'],
      webgl_renderer: 'ANGLE (Intel)',
      source: 'mouse',
      tier0_score: 0.8,
    },
    session_start_t: 1_000_000,
    desktop: {
      ...defaultDesktopData(),
      curve_buffer: [{ x: 10, y: 20 }],
      welford_E: { n: 3, mean: 0.85, M2: 0.02 },
    },
    mobile: null,
  };

  beforeEach(() => {
    mockRedis = new RedisMock();
    store = new RedisSession(mockRedis);
  });

  it('returns defaults for a non-existent session', async () => {
    const state = await store.getAll('unknown');
    expect(state.meta).toBeNull();
    expect(state.desktop).toBeNull();
    expect(state.mobile).toBeNull();
    expect(state.session_start_t).toBeGreaterThan(0);
  });

  it('round-trips a session with desktop data', async () => {
    await store.setAll('s1', sampleSession);
    const loaded = await store.getAll('s1');

    expect(loaded.meta?.source).toBe('mouse');
    expect(loaded.desktop?.welford_E).toEqual({ n: 3, mean: 0.85, M2: 0.02 });
    expect(loaded.desktop?.curve_buffer).toHaveLength(1);
    expect(loaded.mobile).toBeNull();
    expect(loaded.mixed_input).toBe(false);
  });

  it('round-trips a session with mobile data', async () => {
    const mobileSession: SessionState = {
      ...defaultSharedData(),
      meta: {
        session_id: 'mobile-1',
        navigator_webdriver: false,
        plugins_count: 2,
        languages: ['en'],
        webgl_renderer: 'Apple GPU',
        source: 'touch',
        tier0_score: 0.9,
      },
      session_start_t: 2_000_000,
      desktop: null,
      mobile: {
        current_touch_buffer: [{ x: 100, y: 200, pressure: 0.5 }],
        gesture_buffer: [],
        scroll_event_buffer: [{ t: 100, scroll_y: 500 }],
        welford_path_efficiency: { n: 5, mean: 0.6, M2: 0.1 },
        welford_pressure: { n: 10, mean: 0.3, M2: 0.05 },
        welford_radius: { n: 10, mean: 15, M2: 8 },
        welford_decay_rate: { n: 0, mean: 0, M2: 0 },
        pressure_quirk_checked: false,
      },
    };

    await store.setAll('m1', mobileSession);
    const loaded = await store.getAll('m1');

    expect(loaded.meta?.source).toBe('touch');
    expect(loaded.mobile?.current_touch_buffer).toHaveLength(1);
    expect(loaded.mobile?.welford_path_efficiency?.mean).toBeCloseTo(0.6);
    expect(loaded.mobile?.scroll_event_buffer).toHaveLength(1);
    expect(loaded.desktop).toBeNull();
  });

  it('handles null fields correctly (e.g. hysteresis not set yet)', async () => {
    await store.setAll('s2', sampleSession);
    const loaded = await store.getAll('s2');
    expect(loaded.hysteresis).toEqual(
      expect.objectContaining({ ema_value: 0, last_trigger: false })
    );
  });

  it('sets TTL on write', async () => {
    await store.setAll('ttl-test', sampleSession);
    const ttl = await mockRedis.ttl('session:ttl-test');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1800);
  });

  it('refreshes TTL on touch', async () => {
    await store.setAll('touch-test', sampleSession);
    await mockRedis.expire('session:touch-test', 1); // almost expired

    await store.touch('touch-test');
    const ttl = await mockRedis.ttl('session:touch-test');
    expect(ttl).toBeGreaterThan(100); // refreshed to 1800
  });

  it('deletes a session', async () => {
    await store.setAll('del-test', sampleSession);
    await store.delete('del-test');
    const exists = await mockRedis.exists('session:del-test');
    expect(exists).toBe(0);
  });

  it('updateFields writes only specified fields', async () => {
    await store.setAll('uf-test', sampleSession);

    // Update only the scroll position
    await store.updateFields('uf-test', { scroll_y: 1500 });

    const loaded = await store.getAll('uf-test');
    expect(loaded.scroll_y).toBe(1500);
    // Other fields unchanged
    expect(loaded.meta?.source).toBe('mouse');
    expect(loaded.desktop?.welford_E?.mean).toBeCloseTo(0.85);
  });

  it('updateFields refreshes TTL', async () => {
    await store.setAll('uf-ttl', sampleSession);
    await store.updateFields('uf-ttl', { scroll_y: 999 });
    const ttl = await mockRedis.ttl('session:uf-ttl');
    expect(ttl).toBeGreaterThan(100);
  });

  it('getActiveIds returns known session keys', async () => {
    await store.setAll('alpha', sampleSession);
    await store.setAll('beta', sampleSession);
    const ids = await store.getActiveIds();
    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');
  });
});
