import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import type { RedisSession } from '../store/redisSession.js';
import type { ConnectionMap } from '../ws/connectionHandler.js';
import { handleConnection, recordPing } from '../ws/connectionHandler.js';
import { handleMessage } from '../ws/messageHandler.js';
import { handleViewportInfo } from '../ws/viewportHandler.js';
import { handleDisconnect } from '../ws/disconnectHandler.js';
import { ws as wsConfig } from '../config/index.js';
import { getCollectorConfig } from '../config/collectorConfig.js';

export function registerWsRoute(
  app: FastifyInstance,
  store: RedisSession,
  connections: ConnectionMap,
): void {
  app.get('/ws', { websocket: true }, (socket, req) => {
    let sessionId: string | null = null;
    let metaReceived = false;
    const pending: Buffer[] = [];
    let processing = false;
    let msgTimestamps: number[] = [];

    async function processPending(): Promise<void> {
      if (processing) return;
      processing = true;
      while (pending.length > 0) {
        const raw = pending.shift()!;
        await onMessage(raw);
      }
      processing = false;
    }

    function checkRateLimit(): boolean {
      const now = Date.now();
      msgTimestamps = msgTimestamps.filter(t => now - t < 1000);
      if (msgTimestamps.length >= 60) {
        socket.close(4000, 'Rate limit exceeded');
        return false;
      }
      msgTimestamps.push(now);
      return true;
    }

    async function onMessage(raw: Buffer): Promise<void> {
      const text = raw.toString();

      if (!metaReceived) {
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { return; }
        if (!parsed || !parsed.session_id || !parsed.source) return;

        try {
          const result = await handleConnection(socket, parsed, store, connections);
          sessionId = result.session_id;
          metaReceived = true;

          console.log(`[ws] connected  session=${sessionId} tier0=${result.tier0.toFixed(2)} new=${result.is_new_session}`);

          socket.send(JSON.stringify({
            type: 'connected',
            session_id: sessionId,
            tier0_score: result.tier0,
            config: getCollectorConfig(),
          }));
        } catch (err) {
          console.error('[ws] meta error:', err);
          socket.close(4001, 'Invalid JSON');
        }
        return;
      }

      if (!sessionId) return;

      try {
        const parsed = JSON.parse(text);
        if (parsed.type === 'viewport_info') {
          await handleViewportInfo(text, sessionId, store);
        } else if (Array.isArray(parsed.events)) {
          await handleMessage(text, sessionId, store);
        }
      } catch {
        // Invalid JSON — silently drop
      }
    }

    socket.on('message', (raw: Buffer) => {
      if (pending.length >= 100) {
        socket.close(4000, 'Buffer overflow');
        return;
      }
      if (!checkRateLimit()) return;
      pending.push(raw);
      processPending();
    });

    socket.on('close', () => {
      if (sessionId) {
        console.log(`[ws] disconnect  session=${sessionId}`);
        handleDisconnect(sessionId, connections, store);
      }
    });

    socket.on('error', (err) => {
      console.error(`[ws] error  session=${sessionId}:`, err.message);
    });

    socket.on('ping', () => {
      if (sessionId) recordPing(sessionId);
    });
    socket.on('pong', () => {
      if (sessionId) recordPing(sessionId);
    });
  });
}
