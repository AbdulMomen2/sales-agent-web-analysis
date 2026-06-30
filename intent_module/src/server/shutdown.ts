import type { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';

export function createShutdownHandler(
  app: FastifyInstance,
  redis: Redis,
  stopTick: () => void,
): () => Promise<void> {
  return async () => {
    console.log('Shutting down...');
    stopTick();
    await app.close();
    try {
      if (redis.status !== 'end' && redis.status !== 'close') {
        await redis.quit();
      }
    } catch {
      // Redis already disconnected
    }
    process.exit(0);
  };
}
