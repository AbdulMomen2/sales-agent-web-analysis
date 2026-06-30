# Intent Engine — Behavioral Intent Detection

Real-time intent scoring for websites. A lightweight browser collector streams mouse/touch behavior to a server that scores it continuously, emitting a smoothed `intent_probability` + `trigger` signal.

Designed for **100+ websites** — zero hardcoded values, all configuration server-driven, PII-safe by default.

## Architecture

```
Browser Collector ──WS──▶ Fastify Gateway ──Redis──▶ Ticker (1s) ──▶ Pipeline
                              (session:{id})                        (scorer + hysteresis)
```

- **No database** (PostgreSQL removed) — only Redis for session state with TTL-based cleanup
- **WebSocket** transport — batched events every 200ms, compressed on the client
- **1s tick loop** — loads all active sessions, runs scoring pipeline, pushes `ServerTick` to client
- **Pipeline** — platform-specific (desktop/mouse, mobile/touch) with shared intent scorer and EMA hysteresis

## Quick Start

```bash
# 1. Start Redis
docker run -d --name intent-redis -p 6379:6379 redis:7

# 2. Install
cd intent_module
npm install

# 3. Start (Redis optional — server starts without it, features degrade gracefully)
npm run dev

# 4. Open in browser
#    Demo page:  http://localhost:3000/demo
#    Dashboard:  http://localhost:3000/dashboard
#    Replay:     http://localhost:3000/replay/<session_id>
```

## Collector Script

The collector (`web/demo/collector.js`) is the client-side script embedded on websites. It is:

- **Lightweight** — no dependencies, ~4KB minified, all event listeners `{ passive: true }`
- **PII-safe** — password inputs, CSRF tokens, `data-*` secrets redacted from snapshots; attribute whitelist only allows safe attrs (class, id, role, aria-*, etc.); text content capped at 200 chars; `outerHTML` of mutations never sent
- **Buffer-safe** — event buffer capped at 5000 events; CSS selector cache prevents O(n²) DOM walks; CSS collection capped at 50KB
- **Session persistence** — session ID stored in `localStorage` so page refreshes reuse the same session
- **Server-configured** — all parameters (batch interval, throttling, feature toggles, zone selector) come from the server's `connected` response — zero hardcoded values

### Server-Driven Configuration

On WebSocket connect, the server sends a `config` object. Every parameter is tunable per website via environment variables without deploying new collector code:

```json
{
  "type": "connected",
  "session_id": "...",
  "config": {
    "batchMs": 200,
    "pointerThrottleMs": 33,
    "heartbeatMs": 30000,
    "maxBufferSize": 5000,
    "snapshotEnabled": true,
    "snapshotMaxBytes": 524288,
    "mutationObserverEnabled": true,
    "mutationAttributeFilter": ["class", "style"],
    "zoneSelector": null,
    "reconnectBaseMs": 1000,
    "reconnectMaxMs": 30000,
    "collectTextContent": true,
    "collectAttributes": true,
    "collectCss": true,
    "pointerCaptureEnabled": true
  }
}
```

Set via environment variables (prefix `COLLECTOR_`):

| Variable | Default | Description |
|----------|---------|-------------|
| `COLLECTOR_BATCH_MS` | `200` | Event batch flush interval |
| `COLLECTOR_POINTER_THROTTLE_MS` | `33` | Pointer move throttle (~30fps) |
| `COLLECTOR_HEARTBEAT_MS` | `30000` | Heartbeat interval |
| `COLLECTOR_MAX_BUFFER_SIZE` | `5000` | Max queued events before drop |
| `COLLECTOR_SNAPSHOT_ENABLED` | `true`¹ | Enable DOM snapshot on page load |
| `COLLECTOR_SNAPSHOT_MAX_BYTES` | `524288` | Max snapshot size (bytes) |
| `COLLECTOR_MUTATION_OBSERVER_ENABLED` | `true`¹ | Enable MutationObserver |
| `COLLECTOR_MUTATION_ATTRIBUTE_FILTER` | `class,style` | Observed attribute names |
| `COLLECTOR_ZONE_SELECTOR` | (none) | CSS selector for target zone detection (e.g. pricing section) |
| `COLLECTOR_RECONNECT_BASE_MS` | `1000` | Initial reconnect delay |
| `COLLECTOR_RECONNECT_MAX_MS` | `30000` | Max reconnect delay |
| `COLLECTOR_COLLECT_TEXT_CONTENT` | `true`¹ | Send element text content on click |
| `COLLECTOR_COLLECT_ATTRIBUTES` | `true`¹ | Send element attributes (whitelist) on click |
| `COLLECTOR_COLLECT_CSS` | `true`¹ | Send stylesheet text in snapshot |
| `COLLECTOR_POINTER_CAPTURE_ENABLED` | `true`¹ | Send target bounding rect on click |

¹ Set to `false` in production for stricter PII safety

## Security

### PII Protection (Collector)

| Feature | Protection |
|---------|------------|
| DOM snapshot | `<input type="password">` values redacted; `data-token/csrf/session/secret/key/auth` attributes replaced with `[REDACTED]` |
| Element attributes | Whitelist-only: `class`, `id`, `role`, `type`, `aria-*`, `tabindex`, etc. `data-*` excluded by default |
| Text content | Capped at 200 chars per element; disabled in production via `COLLECTOR_COLLECT_TEXT_CONTENT=false` |
| Mutation records | Only tag names and counts sent; full `outerHTML` never transmitted |
| WebSocket | Uses `wss://` automatically when page is served over HTTPS |
| Snapshot size | Capped at 512KB; oversized snapshots truncated |
| Event buffer | Capped at 5000 events; silent drop on overflow prevents OOM |

### Server Security

- **API Authentication**: Set `API_KEY` env var to require `Authorization: Bearer <key>` on `/api/sessions` and `DELETE /api/session/:sessionId`
- **CSRF Protection**: Mutation requests (DELETE/POST/PUT/PATCH) validated against `Origin`/`Referer` headers
- **Input Validation**: Every event field sanitized — point coordinates, touch arrays, DOM selectors, text lengths capped
- **Rate Limiting**: HTTP: 100 req/min per IP (Fastify); WebSocket: 60 msgs/sec per connection + pending buffer cap of 100
- **Replay XSS**: Snapshot HTML stripped of `<script>`, `on*` handlers, `javascript:` URLs, `<object>/<embed>/<applet>`; iframe sandboxed without `allow-same-origin`; mutation list rendered with `textContent` not `innerHTML`
- **postMessage**: All cross-frame messages validate `e.source === iframe.contentWindow`
- **Redis Resilience**: Server starts without Redis (single `info` log, no spam); tick loop silently skips when Redis unavailable; errors never crash the process
- **Concurrency Safety**: Pipeline uses targeted `updateFields` (not full `setAll`) to avoid lost-update races with the message handler; `fitts_pairs` stored as a top-level Redis field to prevent pipeline overwrite on concurrent writes

## Dynamic Pipeline

### Configurable Signals

Signal lists for desktop and mobile are configurable via environment variables:

```
SIGNALS_DESKTOP=hover_pricing_3s,scroll_back_to_pricing,E_session_mean_high,click_pricing_cta,time_on_page_gt_60s,bot_like_movement,inactive_session
SIGNALS_MOBILE=scroll_back_to_pricing,pricing_section_dwell_3s,click_pricing_cta,pinch_zoom_on_pricing,time_on_page_gt_60s,bot_like_movement,inactive_session
```

Each signal's likelihood ratio is overridable per signal: `LR_HOVER_PRICING_3S=2.5`, `LR_BOT_LIKE_MOVEMENT=0.3`

### Configurable Element Classification

| Variable | Default | Description |
|----------|---------|-------------|
| `ELEMENT_CATEGORY_ATTRS` | `data-category,data-type,category,type` | DOM attributes scanned for element category |
| `ELEMENT_PRICE_ATTRS` | `data-price,price` | DOM attributes scanned for price data |
| `ELEMENT_SECTION_ATTRS` | `data-section,section` | DOM attributes scanned for section data |

### Configurable Sales Intent Scoring

All weights, caps, and thresholds externalized to environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SALES_W_CTA` | `20` | CTA hover weight |
| `SALES_W_PRODUCT` | `10` | Product hover weight |
| `SALES_W_LONG_HOVER` | `10` | Long hover weight |
| `SALES_W_SCROLL` | `0.333` | Scroll weight |
| `SALES_CAP_ENGAGEMENT` | `100` | Engagement score cap |
| `SALES_CAP_CTA` | `35` | CTA score cap |
| `SALES_CAP_PRODUCT` | `25` | Product score cap |
| `SALES_CAP_LONG_HOVER` | `20` | Long hover cap |
| `SALES_CAP_SCROLL` | `20` | Scroll cap |
| `SALES_W_PURCHASE_CTA` | `12` | Purchase intent CTA weight |
| `SALES_W_PURCHASE_PRODUCT` | `8` | Purchase intent product weight |
| `SALES_W_PURCHASE_CART` | `15` | Purchase intent cart weight |
| `SALES_W_PURCHASE_PRICE` | `10` | Purchase intent price weight |
| `SALES_W_PURCHASE_SCROLL` | `0.1` | Purchase intent scroll weight |
| `SALES_CAP_PURCHASE_TOTAL` | `100` | Purchase intent total cap |
| `SALES_FRICTION_HOVER_NO_CART` | `20` | Friction: hover without cart |
| `SALES_FRICTION_LOW_SCROLL` | `15` | Friction: low scroll depth |
| `SALES_FRICTION_LOW_ENGAGEMENT` | `20` | Friction: low engagement |
| `SALES_FRICTION_HIGH_INTENT_NO_CART` | `15` | Friction: high intent without cart |
| `SALES_CAP_FRICTION` | `100` | Friction indicator cap |
| `SALES_SCROLL_PCT_THRESHOLD` | `15` | Min scroll % for low-scroll friction |
| `SALES_ENGAGEMENT_SCORE_THRESHOLD` | `15` | Min engagement for friction rule |
| `SALES_PURCHASE_INTENT_THRESHOLD` | `60` | Min intent for friction rule |
| `SALES_MIN_TICKS_FOR_FRICTION` | `4` | Min ticks before friction rules apply |
| `SALES_MIN_TICKS_FOR_HIGH_INTENT` | `6` | Min ticks for high-intent friction |

## Full Environment Variable Reference

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection (`rediss://` for TLS) |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `API_KEY` | (none) | Required for `/api/sessions` and `DELETE` (Bearer token) |
| `SESSION_TTL_S` | `1800` | Redis session TTL (seconds) |
| `WS_MAX_PAYLOAD` | `262144` | Max WebSocket message size (bytes) |
| `WS_PING_TIMEOUT_MS` | `10000` | WebSocket ping timeout (ms) |
| `TICK_INTERVAL_MS` | `1000` | Pipeline tick interval (ms) |
| `MAX_POINTS_PER_BATCH` | `200` | Max move points before RDP simplification |
| `SCROLL_HISTORY_CAP` | `50` | Max scroll history entries |
| `TIER0_LOW_PLUGINS_PENALTY` | `0.3` | Tier0 penalty for < 2 plugins |
| `TIER0_MID_PLUGINS_PENALTY` | `0.1` | Tier0 penalty for < 5 plugins |
| `TIER0_NO_LANGUAGES_PENALTY` | `0.4` | Tier0 penalty for no languages |
| `TIER0_SUSPICIOUS_WEBGL_PENALTY` | `0.5` | Tier0 penalty for suspicious WebGL |
| `LR_P0` | `0.025` | Prior purchase probability |
| `TRIGGER_THRESHOLD` | `0.4` | EMA trigger threshold |
| `TRIGGER_SUSTAIN_S` | `2.0` | Trigger sustain seconds |
| `EMA_HALF_LIFE_S` | `7` | EMA half-life seconds |
| `SIGNALS_DESKTOP` | (see above) | Comma-separated desktop signal names |
| `SIGNALS_MOBILE` | (see above) | Comma-separated mobile signal names |

### Thresholds (also configurable via `thresholds.json`)

| Env Variable | JSON Path | Default | Description |
|-------------|-----------|---------|-------------|
| (as above) | `trigger_threshold` | `0.4` | EMA trigger |
| (as above) | `trigger_sustain_seconds` | `2.0` | Sustain time |
| (as above) | `ema_half_life_seconds` | `7` | EMA half-life |
| (as above) | `tick_interval_seconds` | `1` | Tick interval |
| (as above) | `fitts_min_pairs` | `4` | Min pairs for Fitts correlation |
| (as above) | `fitts_corr_scale` | `0.15` | Fitts scale factor |
| (as above) | `humanness_min_valid` | `0.15` | Min humanness validity |
| (as above) | `curve_gap_ms` | `500` | Max gap between curve points |
| (as above) | `curve_max_duration_ms` | `3000` | Max curve duration |
| (as above) | `hover_dwell_ms` | `3000` | Hover dwell time |
| (as above) | `time_on_page_ms` | `60000` | Time-on-page threshold |

## API

### WebSocket `/ws`

External clients connect here. Messages:
- **ClientMeta** (first message) — session init, tier0 scoring, source detection
- **ClientBatch** (subsequent) — batched events
- **ViewportInfo** — on load, resize, orientation change

Server pushes **ServerTick** every 1s.

### `GET /api/replay/:sessionId`

Full replay data: DOM snapshot + events + mutations. Origin-validated (same-origin only when `Origin` header is present).

### `GET /api/replay/:sessionId/events`

Replay events only. Origin-validated.

### `GET /api/sessions?limit=50&offset=0`

List active sessions. Requires `Authorization: Bearer <API_KEY>` if `API_KEY` is set.

### `DELETE /api/session/:sessionId`

Delete session and disconnect WebSocket. Requires auth + Origin validation.

## Project Structure

```
intent_module/
├── src/
│   ├── index.ts               ← Server entry point
│   ├── config/                ← Config files + env var readers
│   │   ├── constants.ts       ← Server constants
│   │   ├── thresholds.ts      ← Pipeline thresholds (JSON + env)
│   │   ├── signals.ts         ← Signal definitions + LR tables
│   │   ├── collectorConfig.ts ← Client-side collector config
│   │   └── infra.ts           ← Infrastructure settings
│   ├── types/                 ← TypeScript types
│   ├── server/                ← Fastify server + routes
│   │   ├── ws.ts              ← WebSocket route (+ rate limit)
│   │   ├── routes.ts          ← Static files + dashboard WS
│   │   └── shutdown.ts        ← Graceful shutdown
│   ├── api/                   ← REST endpoints
│   │   ├── sessions.ts        ← Session listing + deletion
│   │   ├── replay.ts          ← Replay data
│   │   └── auth.ts            ← API key + Origin validation
│   ├── store/
│   │   └── redisSession.ts    ← Redis session store (KEYS→SCAN)
│   ├── ws/
│   │   ├── connectionHandler.ts ← WS connect/disconnect logic
│   │   ├── messageHandler.ts    ← Event routing + input validation
│   │   ├── viewportHandler.ts   ← Viewport info storage
│   │   └── disconnectHandler.ts ← Cleanup
│   ├── tick/
│   │   └── ticker.ts          ← 1s tick loop
│   └── pipeline/
│       ├── index.ts           ← Pipeline entry point
│       ├── shared/            ← Scorer, hysteresis, welford, saturation, element classifier, sales intent
│       ├── desktop/           ← Desktop/mouse: curves, Fitts, humanness, signals
│       └── mobile/            ← Mobile/touch: touches, scroll physics, humanness, signals
├── web/
│   ├── demo/
│   │   ├── index.html         ← Demo page
│   │   └── collector.js       ← Client collector (self-contained, ~4KB)
│   ├── dashboard.html         ← Live monitoring dashboard
│   └── replay.html            ← Session replay viewer
├── tests/unit/                ← Vitest unit tests
└── scripts/                   ← Calibration tool
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload (tsx watch) |
| `npm run build` | TypeScript compile |
| `npm start` | Run compiled server from `dist/` |
| `npm test` | Run unit tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run calibrate` | Offline LR calibration from historical outcomes |

## Edge Cases Covered

- **Concurrent connections**: spoof detection via ping tracking; assigns fresh session_id
- **Hybrid devices**: `mixed_input` flag, source locked at connection
- **Tab backgrounding**: in-progress buffers discarded
- **Out-of-order events**: server sorts by timestamp
- **High-frequency input**: downsamples batches > 200 points via RDP simplification
- **Session reconnect**: Redis TTL covers reconnects; server config applied on reconnect
- **Tick resilience**: one session failure never stalls the loop
- **Redis down**: server starts without Redis; all operations gracefully degraded
- **WebSocket buffer overflow**: pending buffer capped at 100; rate-limited at 60/sec
- **DOM snapshot too large**: capped at 512KB; chunked reassembly with 2-min TTL
- **PII in snapshots**: passwords, tokens, secrets redacted before transmission
