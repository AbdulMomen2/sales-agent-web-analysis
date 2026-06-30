import type { FastifyRequest, FastifyReply } from 'fastify';

const API_KEY = process.env.API_KEY || '';

export function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!API_KEY) return true;

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }
  if (auth.slice(7) !== API_KEY) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function checkOrigin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.method !== 'DELETE' && req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') return true;

  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  const host = req.headers.host || '';

  if (origin && !origin.includes(host)) {
    reply.status(403).send({ error: 'Cross-origin request rejected' });
    return false;
  }
  if (!origin && referer && !referer.includes(host)) {
    reply.status(403).send({ error: 'Cross-origin request rejected' });
    return false;
  }
  return true;
}
