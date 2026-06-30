import 'dotenv/config';
import { Redis } from 'ioredis';
import { WebSocket } from 'ws';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';

import { RedisSession } from './store/redisSession.js';
import { registerSessionRoutes } from './api/sessions.js';
import { registerReplayRoutes } from './api/replay.js';
import { registerWsRoute } from './server/ws.js';
import { registerStaticRoutes } from './server/routes.js';
import { createShutdownHandler } from './server/shutdown.js';
import { startTickLoop } from './tick/ticker.js';
import { createSessionProcessor } from './pipeline/index.js';
import { infra as infraConfig, ws as wsConfig } from './config/index.js';
import type { ConnectionMap } from './ws/connectionHandler.js';

async function main(): Promise<void> {
  const redis = new Redis(infraConfig.redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 200, 3000);
    },
    lazyConnect: true,
  });
  redis.on('error', () => { /* ioredis requires a listener to prevent crash */ });
  try {
    await redis.connect();
  } catch (err) {
    console.info('[redis] not available, continuing without Redis:', (err as Error).message);
  }
  const sessionStore = new RedisSession(redis);

  const connections: ConnectionMap = new Map();
  const dashboardClients = new Set<WebSocket>();

  const app = Fastify({ logger: true });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
  await app.register(fastifyWebsocket, {
    options: { maxPayload: wsConfig.maxPayload },
  });

  registerWsRoute(app, sessionStore, connections);
  registerStaticRoutes(app, dashboardClients);
  registerSessionRoutes(app, sessionStore, connections);
  registerReplayRoutes(app, sessionStore);

  const processSession = createSessionProcessor(sessionStore, connections, dashboardClients);
  const stopTick = startTickLoop(sessionStore, connections, processSession.process, undefined, processSession.flush);

  try {
    await app.listen({ port: infraConfig.port, host: infraConfig.host });
    console.log(`Intent Engine listening on ${infraConfig.host}:${infraConfig.port}`);
  } catch (err) {
    app.log.error(err, 'Failed to start server');
    stopTick();
    await app.close();
    await redis.quit();
    process.exit(1);
  }

  const shutdown = createShutdownHandler(app, redis, stopTick);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
