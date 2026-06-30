import type { FastifyInstance } from 'fastify';
import type { RedisSession } from '../store/redisSession.js';
import { checkOrigin } from './auth.js';

export function registerReplayRoutes(
  app: FastifyInstance,
  store: RedisSession,
): void {
  app.get<{ Params: { sessionId: string } }>('/api/replay/:sessionId', async (req, reply) => {
    if (!checkOrigin(req, reply)) return;
    try {
      const session = await store.getAll(req.params.sessionId);
      const snapshot = session.dom_snapshot;
      const replayEvents = session.replay_buffer || [];
      if (!snapshot || !snapshot.html || snapshot.html.length === 0) {
        const ph = '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#f5f5f5;min-height:100vh"></body></html>';
        return {
          snapshot: { html: ph, css: snapshot?.css || '' },
          events: replayEvents,
          mutations: session.dom_mutations || [],
          meta: session.meta,
          start_t: session.session_start_t,
        };
      }
      return {
        snapshot,
        events: replayEvents,
        mutations: session.dom_mutations || [],
        meta: session.meta,
        start_t: session.session_start_t,
      };
    } catch (err) {
      console.error('[api/replay] error:', err);
      return reply.status(500).send({ error: 'Failed to load replay data' });
    }
  });

  app.get<{ Params: { sessionId: string } }>('/api/replay/:sessionId/events', async (req, reply) => {
    if (!checkOrigin(req, reply)) return;
    try {
      const session = await store.getAll(req.params.sessionId);
      return {
        events: session.replay_buffer || [],
        meta: session.meta,
        start_t: session.session_start_t,
      };
    } catch (err) {
      console.error('[api/replay/events] error:', err);
      return reply.status(500).send({ error: 'Failed to load replay events' });
    }
  });
}
