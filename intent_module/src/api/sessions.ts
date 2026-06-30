import type { FastifyInstance } from 'fastify';
import type { RedisSession } from '../store/redisSession.js';
import type { ConnectionMap } from '../ws/connectionHandler.js';
import { requireAuth, checkOrigin } from './auth.js';

export function registerSessionRoutes(
  app: FastifyInstance,
  store: RedisSession,
  connections: ConnectionMap,
): void {
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/sessions', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);
      const ids = await store.getActiveIds();
      const page = ids.slice(offset, offset + limit);
      const sessions = [];
      for (const id of page) {
        const s = await store.getAll(id);
        sessions.push({
          session_id: id,
          source: s.meta?.source ?? null,
          started: s.session_start_t,
          scroll_y: s.scroll_y,
          dom_snapshot_stored: !!s.dom_snapshot,
          dom_mutation_count: (s.dom_mutations || []).length,
          replay_event_count: (s.replay_buffer || []).length,
        });
      }
      return sessions;
    } catch (err) {
      console.error('[api] sessions error:', err);
      return reply.status(500).send({ error: 'Failed to list sessions' });
    }
  });

  app.delete<{ Params: { sessionId: string } }>('/api/session/:sessionId', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    if (!checkOrigin(req, reply)) return;
    try {
      await store.delete(req.params.sessionId);
      const ws = connections.get(req.params.sessionId);
      if (ws) {
        ws.close(4001, 'Session terminated');
        connections.delete(req.params.sessionId);
      }
      return { status: 'deleted', session_id: req.params.sessionId };
    } catch (err) {
      console.error('[api] delete session error:', err);
      return reply.status(500).send({ error: 'Failed to delete session' });
    }
  });
}
