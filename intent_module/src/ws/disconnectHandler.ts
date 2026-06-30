/**
 * WS disconnect handler.
 *
 * On connection close:
 * 1. Remove the connection from the active ConnectionMap
 * 2. Clear ping tracking
 * 3. Do NOT delete Redis session — TTL (1800s) handles cleanup.
 *    This supports WS reconnects mid-session (§16-C).
 */
import type { ConnectionMap } from './connectionHandler.js';
import { clearPing } from './connectionHandler.js';
import type { RedisSession } from '../store/redisSession.js';

/**
 * Handle a WebSocket disconnect for the given session_id.
 *
 * @param sessionId  The session that disconnected
 * @param connections  Active connection map (mutated in place)
 * @param store        Redis session store (optional — used for cleanup if needed)
 */
export function handleDisconnect(
  sessionId: string,
  connections: ConnectionMap,
  store?: RedisSession,
): void {
  connections.delete(sessionId);
  clearPing(sessionId);
  if (store) {
    store.setTtl(sessionId, 120).catch(() => {});
  }
}
