/**
 * Global 1-second tick loop (§4.1, §14)
 *
 * Iterates all active sessions every 1000ms.
 * Currently handles TTL refresh and basic session keepalive.
 * The `sessionProcessor` hook is where scoring pipeline logic
 * (finalize curves, compute features, intent scorer, hysteresis)
 * plugs in — left empty now, wired up when the pipeline is built.
 *
 * The loop is resilient: a single session failure never crashes the tick.
 */
import type { RedisSession } from '../store/redisSession.js';
import type { ConnectionMap } from '../ws/connectionHandler.js';
import type { SessionState } from '../types/index.js';
import { tick as tickConfig } from '../config/index.js';

/** Callback signature for per-session processing within the tick loop. */
export type SessionProcessor = (
  sessionId: string,
  session: SessionState,
  now: number,
) => Promise<void>;

/**
 * Run one tick: load all active sessions, refresh TTL, run processor.
 *
 * @param store      Redis session store
 * @param connections Active WS connection map
 * @param process    Optional per-session processing callback (filled in by pipeline)
 * @param onComplete Optional callback after all sessions are processed
 */
export async function tick(
  store: RedisSession,
  connections: ConnectionMap,
  process: SessionProcessor = defaultProcessor,
  onComplete?: () => void,
): Promise<void> {
  // Skip tick entirely if Redis is not connected (no noise in logs)
  if (!store.isConnected()) return;

  const sessionIds = await store.getActiveIds();

  // Also include sessions with active WS connections but no Redis key yet
  // (edge case: connection established but first batch hasn't arrived)
  for (const [sid] of connections) {
    if (!sessionIds.includes(sid)) {
      sessionIds.push(sid);
    }
  }

  if (sessionIds.length > 0) {
    console.log(`[tick] processing ${sessionIds.length} session(s)`);
  }

  for (const sessionId of sessionIds) {
    try {
      const session = await store.getAll(sessionId);

      // Skip sessions with no meta (not fully initialised)
      if (!session.meta) continue;

      const now = Date.now();

      // Refresh TTL only for sessions with active WS connection
      if (connections.has(sessionId)) {
        await store.touch(sessionId);
      }

      // Run the per-session processing (scoring pipeline, no-op until wired)
      await process(sessionId, session, now);

    } catch (err) {
      // One session must never stall the entire tick loop (§16-E)
      console.error(`[tick] error processing session ${sessionId}:`, err);
    }
  }

  if (onComplete) onComplete();
}

/** Default no-op processor — just touch TTL (already done above). */
async function defaultProcessor(
  _sessionId: string,
  _session: SessionState,
  _now: number,
): Promise<void> {
  // No-op: scoring pipeline plugs in here later
}

/**
 * Start the global tick loop (returns a stop function).
 */
export function startTickLoop(
  store: RedisSession,
  connections: ConnectionMap,
  process?: SessionProcessor,
  intervalMs = tickConfig.intervalMs,
  onComplete?: () => void,
): () => void {
  let running = false;
  const id = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick(store, connections, process, onComplete);
    } catch (err) {
      console.error('[tick] loop error:', err);
    } finally {
      running = false;
    }
  }, intervalMs);

  return () => clearInterval(id);
}
