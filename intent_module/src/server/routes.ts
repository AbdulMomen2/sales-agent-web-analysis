import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function registerStaticRoutes(
  app: FastifyInstance,
  dashboardClients: Set<WebSocket>,
): void {
  // ── Health endpoint ──────────────────────────────────────
  app.get('/health', async () => {
    return { status: 'ok', uptime: process.uptime() };
  });

  // ── Serve demo page ──────────────────────────────────────
  const demoDir = join(__dirname, '..', '..', 'web', 'demo');
  app.get('/demo', async (_req, reply) => {
    try {
      const html = readFileSync(join(demoDir, 'index.html'), 'utf-8');
      return reply.type('text/html').send(html);
    } catch {
      return reply.status(404).send({ error: 'demo page not found' });
    }
  });

  // ── Demo collector script ────────────────────────────────
  const collectorPath = join(demoDir, 'collector.js');
  app.get('/demo/collector.js', async (_req, reply) => {
    try {
      const js = readFileSync(collectorPath, 'utf-8');
      return reply.type('application/javascript').send(js);
    } catch {
      return reply.status(404).send({ error: 'collector.js not found' });
    }
  });

  // ── Demo page fragments (SPA pages loaded via XHR) ────────
  const pagesDir = join(demoDir, 'pages');
  app.get<{ Params: { pageName: string } }>('/demo/pages/:pageName', async (req, reply) => {
    try {
      const html = readFileSync(join(pagesDir, req.params.pageName + '.html'), 'utf-8');
      return reply.type('text/html').send(html);
    } catch {
      return reply.status(404).send({ error: 'page not found' });
    }
  });

  // ── SPA fallback: serve index.html for all other /demo/* routes ──
  app.get('/demo/*', async (_req, reply) => {
    try {
      const html = readFileSync(join(demoDir, 'index.html'), 'utf-8');
      return reply.type('text/html').send(html);
    } catch {
      return reply.status(404).send({ error: 'demo page not found' });
    }
  });

  // ── Dashboard WS endpoint (live monitoring) ──────────────
  app.get('/dashboard/ws', { websocket: true }, (socket) => {
    dashboardClients.add(socket);
    console.log(`[dashboard] client connected  total=${dashboardClients.size}`);

    socket.on('close', () => {
      dashboardClients.delete(socket);
      console.log(`[dashboard] client disconnected  total=${dashboardClients.size}`);
    });
    socket.on('error', () => { dashboardClients.delete(socket); });
  });

  // ── Dashboard page ───────────────────────────────────────
  const dashboardPath = join(__dirname, '..', '..', 'web', 'dashboard.html');
  let dashboardHtml: string;
  try {
    dashboardHtml = readFileSync(dashboardPath, 'utf-8');
  } catch {
    console.error('[server] dashboard.html not found');
    dashboardHtml = '<h1>Dashboard not found</h1>';
  }
  app.get('/dashboard', async (_req, reply) => {
    return reply.type('text/html').send(dashboardHtml);
  });

  // ── Replay page ────────────────────────────────────────────
  const replayPath = join(__dirname, '..', '..', 'web', 'replay.html');
  let replayHtml: string;
  try {
    replayHtml = readFileSync(replayPath, 'utf-8');
  } catch {
    console.error('[server] replay.html not found');
    replayHtml = '<h1>Replay page not found</h1>';
  }
  app.get('/replay', async (_req, reply) => {
    return reply.type('text/html').send(replayHtml);
  });
  app.get<{ Params: { sessionId: string } }>('/replay/:sessionId', async (req, reply) => {
    return reply.redirect(`/replay?session=${req.params.sessionId}`);
  });
}
