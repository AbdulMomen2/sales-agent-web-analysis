# Friend — Intent Engine (Sales Intelligence Pipeline)

Real-time behavioral intent detection for B2B websites. Streams mouse/touch behavior from browsers, scores it continuously, and emits a smoothed `intent_probability` + `trigger` for a sales-assist UI.

The entire active codebase lives in [`intent_module/`](intent_module/).

## Quick Start

```bash
cd intent_module
npm install
npm run build:collector
cp .env.example .env   # edit if needed
npm run dev
```

See [`intent_module/README.md`](intent_module/README.md) for full instructions, including setting up Redis and PostgreSQL.

## Structure

| Path | Description |
|------|-------------|
| `intent_module/` | Node.js/TypeScript backend (Fastify + Redis + PostgreSQL) |
| `intent_module/web/` | Dashboard and session replay pages |

## Tech Stack

- **Server**: TypeScript, Fastify, Redis (ioredis), PostgreSQL (pg)
- **Pipeline**: Welford accumulators, Bayesian intent scoring, EMA hysteresis, element classification
- **Collector**: TypeScript → esbuild IIFE, browser-side event capture
- **Tests**: Vitest, ioredis-mock
