export const infra = {
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
} as const;
