# Intent Engine — Behavioral Biometrics & Intent Detection

## 1. Purpose & Scope

Implementation reference for the behavioral intent scoring system. Covers architecture (high and low level), mathematical basis for every computed signal, data contracts, state schemas, configuration, edge-case handling, and build order. Single source of truth for v1.

Audience: backend, frontend, and data engineers implementing this.

## 2. System Overview

### 2.1 What it does
For each visitor session on a B2B site, streams pointer/touch/scroll behavior to a backend, scores it continuously, and emits a smoothed `intent_probability` plus a `trigger` boolean that a sales-assist UI listens for. Goal: surface "this visitor looks ready to talk to a human" at the right moment with low false-positive rate.

### 2.2 Three problems solved

1. **Bot/non-human traffic** → `humanness_factor ∈ [0,1]` from headless-browser fingerprints and movement-pattern statistics, multiplies final intent score. Soft gate — low-data and edge-case sessions default to neutral (0.5), never zero.
2. **Correlated behavioral signals** → Combined via log-odds fusion (Naive-Bayes-style), anchored to site's real baseline conversion rate (p0), not summed as independent points.
3. **Single-action spikes** → Instantaneous score smoothed with EMA; trigger only fires after smoothed score stays above threshold for minimum duration — debouncing single-action spikes.

### 2.3 Platform-divergence principle (load-bearing)

Mouse and touch are different behavioral grammars, not the same data with extra fields.

| Aspect | Desktop (mouse) | Mobile (touch) |
|--------|----------------|----------------|
| Position exists without contact | Yes (hover) | No |
| "Click" separate from "move" | Yes | No — touchend is the position |
| Re-evaluation / hesitation | Direction reversals mid-curve (R) | Not meaningful — finger commits on contact |
| Dominant secondary gesture | Hover | Scroll/fling (with momentum physics) |
| Biometric signal source | Curve shape (velocity/jerk) | Pressure, contact radius, fling decay |
| Fitts's Law applicability | Direct (pointer to target) | Weak — touch target acquisition is mostly self-targeting |

**Consequence**: feature extraction and humanness computation are two parallel modules (`desktop/` and `mobile/`). They share only downstream pipeline: signal evaluation → log-odds fusion → EMA → hysteresis. `router.ts` dispatches based on `session.meta.source`, fixed at connection time.

## 3. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| WS gateway + tick server | Node.js + Fastify (`@fastify/websocket`) | High-concurrency, many-small-messages, persistent connections |
| Session state | Redis (hash per session, TTL 1800s) | Sub-ms read/write, native TTL, horizontally shareable |
| Outcomes / durable log | PostgreSQL | Structured, queryable, append-only — feeds offline calibration |
| Offline LR-table calibration | Python + scikit-learn | `LogisticRegression(penalty='l2')`, decoupled, never in hot path |
| Client collector | Vanilla JS, injected script | Performance-sensitive, framework-agnostic |
| Config | JSON files in repo | Versioned, PR-reviewed, hand-editable |

## 4. High-Level Architecture

```
┌──────────────┐    WS (JSON, batched)    ┌─────────────────────┐
│  Browser      │ ───────────────────────▶│  WS Gateway          │
│  Collector    │◀──────────────────────── │  (Fastify)           │
│  desktop/     │   ServerTick / trigger    └──────────┬──────────┘
│  mobile/      │                                       │
└──────────────┘                                        ▼
                                              ┌─────────────────────┐
                                              │  Redis                │
                                              │  session:{id} hash    │
                                              │  (TTL 30min)          │
                                              └──────────┬──────────┘
                                                          │
                                          global 1s tick  │
                                                          ▼
                                              ┌─────────────────────┐
                                              │  router.ts            │
                                              │  ┌─────────┬────────┐│
                                              │  │desktop/ │mobile/ ││
                                              │  │pipeline │pipeline││
                                              │  └────┬────┴───┬───┘│
                                              │       └────┬───┘    │
                                              │      shared:        │
                                              │  signals → log-odds │
                                              │  → EMA → hysteresis │
                                              └──────────┬──────────┘
                                                          │
                                       trigger transition │
                                                          ▼
                                              ┌─────────────────────┐
                                              │  PostgreSQL           │
                                              │  outcomes,            │
                                              │  trigger_events       │
                                              └──────────┬──────────┘
                                                          │ batch export
                                                          ▼
                                              ┌─────────────────────┐
                                              │  Offline calibration  │
                                              │  (Python/sklearn)     │
                                              │  → lrTable.*.json     │
                                              └─────────────────────┘
```

### 4.1 One tick, end to end

1. Global `setInterval(tick, 1000)` reads the set of active session IDs.
2. For each session: read its Redis hash (one `HGETALL`).
3. Finalize any complete curves/touches sitting in the buffer (platform-specific).
4. Update Welford accumulators with new feature values.
5. `router.ts` dispatches to `desktop.computeHumanness()` or `mobile.computeHumanness()` based on `session.meta.source`.
6. Evaluate active signals (platform-specific signal set).
7. `intentScorer.ts` (shared) computes log_odds → P_buying → intent_probability.
8. `hysteresis.ts` (shared) updates EMA, checks sustained threshold, returns trigger.
9. Write updated state back to Redis (one `HSET`), push `ServerTick` to client.
10. If trigger transitioned, write a row to `trigger_events`.

## 5. Data Contracts

### 5.1 Client → Server: event messages (batched)

```typescript
type SinglePoint = {
  x: number;
  y: number;
  pressure?: number;   // touch only, 0-1; absent if device unsupported
  radius_x?: number;   // touch only
  radius_y?: number;   // touch only
};

type TargetRect = { x: number; y: number; w: number; h: number };

type ClientEvent =
  | { type: 'pointer_move' | 'pointer_down'; t: number; point: SinglePoint; target?: TargetRect }
  | { type: 'touch_start' | 'touch_move' | 'touch_end'; t: number; touches: SinglePoint[]; target?: TargetRect }
  | { type: 'scroll'; t: number; scroll_y: number }
  | { type: 'visibility_change'; t: number; visible: boolean }
  | { type: 'orientation_change'; t: number };

type ClientBatch = {
  session_id: string;
  events: ClientEvent[];   // sorted by t before sending; re-sorted server-side defensively
};
```

Batching: `pointer_move` / `touch_move` flushed every 75ms. `pointer_down`, `touch_start`, `touch_end`, `scroll`, `visibility_change`, `orientation_change` flush immediately.

### 5.2 Client → Server: connection metadata (sent once, at WS open)

```typescript
type ClientMeta = {
  session_id: string;
  navigator_webdriver: boolean;
  plugins_count: number;
  languages: string[];
  webgl_renderer: string;
  source: 'mouse' | 'touch';   // determined by first event type received
};
```

### 5.3 Client → Server: viewport info (sent on load, resize, orientation change)

```typescript
type ViewportInfo = {
  session_id: string;
  t: number;
  pricing_rect: TargetRect;   // page coordinates
  viewport_height: number;
  scroll_y: number;
};
```

### 5.4 Server → Client: tick push

```typescript
type ServerTick = {
  session_id: string;
  t: number;
  intent_probability: number;  // instantaneous, 0-1
  intent_ema: number;          // smoothed, 0-1
  humanness_factor: number;    // 0-1
  trigger: boolean;             // only sent on transition (true→false or false→true)
};
```

### 5.5 REST: outcomes endpoint (called by host site backend)

```typescript
// POST /intent-engine/outcomes
type OutcomePayload = {
  session_id: string;
  outcome: 0 | 1;
  source: 'mouse' | 'touch';
  final_feature_snapshot: {
    // desktop fields (null if source === 'touch')
    E_session_mean: number | null;
    E_session_variance: number | null;
    R_session_variance: number | null;
    fitts_correlation: number | null;
    // mobile fields (null if source === 'mouse')
    path_efficiency_variance: number | null;
    pressure_variance: number | null;
    radius_variance: number | null;
    decay_rate_variance: number | null;
    // shared
    humanness_factor: number;
    active_signals: string[];
  };
};
```

## 6. Mathematical Foundations

### 6.1 Welford's Online Variance (shared primitive)

Used for every running mean/variance: E, R, jerk, path_efficiency, pressure, radius, decay_rate.

```
State: { n: int, mean: float, M2: float }

update(state, x):
    n     = state.n + 1
    delta = x - state.mean
    mean  = state.mean + delta / n
    delta2 = x - mean
    M2    = state.M2 + delta * delta2
    return { n, mean, M2 }

variance(state):
    if state.n < 2: return null
    return state.M2 / (state.n - 1)
```

### 6.2 Saturation Mappings (shared primitives)

**Variance → score** (low variance = bot-like = low score):
```
score(v, k) = v / (v + k)        // v >= 0, k > 0
// v=0 → 0 ; v=k → 0.5 ; v→∞ → 1
```

**Correlation → score** (smooth, centered at r=0 → 0.5):
```
corr_score(r, scale) = 1 / (1 + e^(-r/scale))     // r ∈ [-1,1]
```

**Weighted combination with null-renormalization** (used identically by `humanness.desktop.ts` and `humanness.mobile.ts`):
```
weighted_score(inputs: {name: {value, weight}}):
    sum = 0, weight_sum = 0
    for each (value, weight) in inputs:
        if value is not null:
            sum += score_fn(value) * weight
            weight_sum += weight
    if weight_sum == 0: return 0.5   // total cold-start: neutral
    return sum / weight_sum
```

This single function is the entire "renormalize when a component is unavailable" rule — applied to missing Fitts correlation, missing pressure/radius on unsupported devices, insufficient sample sizes, etc.

### 6.3 Desktop: Curve Efficiency (E) and Re-evaluation (R)

A curve = sequence of `pointer_move` points between segmentation boundaries (§7.1).

```
E(curve) = ||p_last - p_first|| / Σ ||p[i+1] - p[i]||   for i=0..n-2
// E ∈ (0,1]; 1 = perfectly straight line. Requires n>=2 and path_length > 3px
// (else: discard curve, do not feed E into accumulator).

v[i] = p[i+1] - p[i]                          for i=0..n-2   (velocity vectors)

R(curve) = Σ [sign(v_x[i+1]) ≠ sign(v_x[i])] + [sign(v_y[i+1]) ≠ sign(v_y[i])]
           for i=0..n-3
// R = count of direction reversals across both axes. Requires n>=3.
```

E_session_mean and E_session_variance both come from the same `welford_E` accumulator. E_session_mean feeds intent (§6.8); E_session_variance feeds humanness (§6.2).

### 6.4 Desktop: Jerk Variance

```
v[i] = (p[i+1] - p[i]) / (t[i+1] - t[i])     // i = 0..n-2
a[i] = (v[i+1] - v[i]) / (t[i+1] - t[i])     // i = 0..n-3
j[i] = (a[i+1] - a[i]) / (t[i+1] - t[i])     // i = 0..n-4

jerk_variance(curve) = variance(j_x) + variance(j_y)
```

Minimum data: n points → n-1 velocities → n-2 accelerations → n-3 jerks. Variance requires ≥2 jerk samples, so **n ≥ 5 points**. Curves with n ∈ [3,4] still produce valid E and R, but `jerk_variance = null` — do not zero-fill.

Duplicate-timestamp guard: if `t[i+1] == t[i]` for any consecutive pair, drop that point before computing velocities — division by zero otherwise.

### 6.5 Desktop: Fitts's Law Correlation

For each `pointer_down` with a valid target rect:

```
last_move = last pointer_move point before this pointer_down
            (if none exists, skip — see §16-A)

D = ||last_move.point - target_center||
W = max(target.w, target.h, 1)              // floor at 1 to avoid log2(D/0+1)

fitts_x = log2(D / W + 1)
fitts_y = pointer_down.t - last_move.t      // ms
```

Append `(fitts_x, fitts_y)` to `fitts_pairs` (capped at last 20). Once ≥4 pairs:

```
r = Pearson correlation(fitts_x_series, fitts_y_series)
fitts_score = corr_score(r, scale=0.15)     // §6.2
```

With fewer than 4 pairs after 60s, `fitts_correlation = null` permanently for the session.

### 6.6 Mobile: Touch Segmentation, Classification, and Features

A touch segment = points from `touch_start` to `touch_end` for a single finger (`touches.length === 1` throughout).

```
duration_ms   = t_end - t_start
displacement  = ||p_last - p_first||
path_length   = Σ ||p[i+1] - p[i]||   for i=0..n-2
path_efficiency = displacement / path_length     // only if path_length > 2px, else null
peak_velocity = max( ||p[i+1]-p[i]|| / (t[i+1]-t[i]) )   for i=0..n-2

pressure_mean = mean(pressure_i)   // null if device doesn't support / quirk (§16-D)
radius_mean   = mean( sqrt(radius_x_i * radius_y_i) )
```

**Classification:**
```
if duration_ms < 150 and displacement < 10px:  contact_type = 'tap'
elif duration_ms > 500 and displacement < 10px: contact_type = 'long_press'
else: contact_type = 'drag'
```

**Feature routing by contact_type:**

| contact_type | path_efficiency → welford_path_efficiency | duration → welford_long_press_duration | pressure/radius → accumulators |
|---|---|---|---|
| tap | No (path_length too small) | No | Yes |
| drag | Yes | No | Yes |
| long_press | No | Yes | Yes |

Pressure/radius accumulators receive samples from every touch type.

### 6.7 Mobile: Fling Deceleration Curve Fitting

After `touch_end`, momentum scrolling produces scroll events. A fling = the contiguous run of scroll events following a `touch_end`, while instantaneous velocity is positive and decreasing.

```
velocity[i] = |scroll_y[i+1] - scroll_y[i]| / (t[i+1] - t[i])     // i=0..m-2
```

Truncate the series at the first i where `velocity[i+1] >= velocity[i]` (deceleration ended). Require m >= 5 remaining velocity samples to proceed.

Fit `velocity(t) = v0 * e^(-k * (t - t0))` via log-linear regression:

```
x_i = t_i - t_0
y_i = ln(velocity_i)

slope b = [m·Σ(x_i·y_i) − Σx_i·Σy_i] / [m·Σ(x_i²) − (Σx_i)²]
intercept a = (Σy_i − b·Σx_i) / m

decay_rate = -b
r_squared  = 1 − SS_res/SS_tot
   where SS_tot = Σ(y_i − ȳ)²,  SS_res = Σ(y_i − (a + b·x_i))²
```

Only feed `decay_rate` into `welford_decay_rate` if `decay_rate > 0` and `r_squared >= 0.5`. Otherwise discard this fling sample.

### 6.8 Log-Odds Intent Fusion (shared)

```
p0 = baseline conversion rate (config, e.g. 0.025)
prior_odds = p0 / (1 - p0)
log_prior_odds = ln(prior_odds)

log_odds = log_prior_odds
for signal in active_signals:
    log_odds += signal.weight * ln(signal.LR)

P_buying = 1 / (1 + e^(-log_odds))     // sigmoid

intent_probability = P_buying * humanness_factor
```

`active_signals` is platform-specific (different LR tables, §13), but this function is identical for both.

### 6.9 EMA + Hysteresis (shared)

```
alpha = 2 / (half_life_seconds / tick_interval_seconds + 1)
// half_life=7s, tick=1s → alpha ≈ 0.25

// First tick for a session: ema_value = intent_probability (no blend)
// Subsequent ticks:
ema_value = alpha * intent_probability + (1 - alpha) * ema_value

if ema_value >= threshold:
    above_threshold_since = above_threshold_since OR now
    sustained = now - above_threshold_since
    trigger = sustained >= sustain_seconds     // e.g. 2.5
else:
    above_threshold_since = null
    trigger = false
```

`ServerTick.trigger` is sent only on transition (previous tick's trigger ≠ this tick's trigger) — not every tick.

## 7. Desktop Pipeline (Low-Level)

### 7.1 Curve segmentation rules

A curve is finalized (features extracted, accumulators updated, buffer cleared) when any of:

- Gap between consecutive `pointer_move` events > 500ms.
- Curve duration exceeds 3000ms regardless of gaps.
- A `pointer_down` event occurs (finalize curve up to that point, then start fresh).
- `visibility_change` to `visible: false` (tab backgrounded — discard buffer, don't finalize; see §16-C).

### 7.2 humanness.desktop.ts

```typescript
type DesktopHumannessInputs = {
  tier0_score: number;
  E_session_variance: number | null;   // null if n < 5 curves
  R_session_variance: number | null;   // null if n < 5 curves
  fitts_correlation: number | null;    // null if < 4 pairs
};

function computeHumanness(inputs, weights, k_values): number {
  return weighted_score({
    tier0:  { value: inputs.tier0_score,        weight: weights.tier0 },
    e_var:  { value: score(inputs.E_session_variance, k_values.E),       weight: weights.tier1 },
    r_var:  { value: score(inputs.R_session_variance, k_values.R),       weight: weights.tier1 },
    fitts:  { value: corr_score(inputs.fitts_correlation, 0.15),         weight: weights.fitts },
  });
}
```

### 7.3 signals.desktop.ts — signal definitions

| Signal key | Detector logic |
|------------|----------------|
| `hover_pricing_3s` | Cursor's page-position (last `pointer_move`) inside `pricing_rect` continuously for ≥3000ms. Track `hover_pricing_entered_at`; reset to null when cursor leaves rect. |
| `scroll_back_to_pricing` | `scroll_y` history shows a downward-then-upward reversal that re-enters `pricing_rect` vertical range. |
| `E_session_mean_high` | `welford_E.mean > 0.7` (requires n≥1; more reliable at n≥5). |
| `click_pricing_cta` | `pointer_down.target` matches the pricing CTA element (client tags via `data-intent-tag`). |
| `time_on_page_gt_60s` | `now - session_start_t >= 60000`. Time-based — can newly activate with zero new events (§16-C). |

## 8. Mobile Pipeline (Low-Level)

### 8.1 Touch & multi-touch lifecycle

- `touches.length === 1` throughout `touch_start→touch_end`: single-touch segment, processed per §6.6.
- `touches.length >= 2` at any point: route to gesture buffer. If inter-touch distance changes by >20px over the gesture's lifetime, classify as `pinch_zoom`. If a single-touch segment was in progress when second finger landed, finalize it immediately (truncated) before starting the gesture buffer.
- Pinch detection feeds `pinch_zoom_on_pricing` signal directly: did a `pinch_zoom` occur while `pricing_rect` overlapped the viewport?

### 8.2 humanness.mobile.ts

```typescript
type MobileHumannessInputs = {
  tier0_score: number;
  path_efficiency_variance: number | null;  // drag touches only, n>=5
  pressure_variance: number | null;          // null if unsupported (§16-D)
  radius_variance: number | null;
  decay_rate_variance: number | null;        // n>=3 valid flings
};

function computeHumanness(inputs, weights, k_values): number {
  return weighted_score({
    tier0:    { value: score_or_pass(inputs.tier0_score, ...), weight: weights.tier0 },
    pe_var:   { value: score(inputs.path_efficiency_variance, k_values.path_efficiency), weight: weights.tier1 },
    pressure: { value: score(inputs.pressure_variance, k_values.pressure), weight: weights.tier2 },
    radius:   { value: score(inputs.radius_variance, k_values.radius), weight: weights.tier2 },
    decay:    { value: score(inputs.decay_rate_variance, k_values.decay), weight: weights.tier1 },
  });
}
```

All k_values here are separately calibrated from desktop's — touch path_efficiency for real drags clusters much higher than mouse E. See §17.

### 8.3 signals.mobile.ts — signal definitions

| Signal key | Detector logic |
|------------|----------------|
| `scroll_back_to_pricing` | Same logic as desktop (viewport-overlap based on `scroll_y` history vs `pricing_rect`). |
| `pricing_section_dwell_3s` | `pricing_rect` overlaps viewport continuously for ≥3000ms. Track `pricing_section_entered_at`. |
| `click_pricing_cta` | `touch_end.target` matches pricing CTA (same tagging mechanism as desktop). |
| `pinch_zoom_on_pricing` | Per §8.1. |
| `time_on_page_gt_60s` | Same as desktop. |

`hover_pricing_3s` is not included — no hover state on touch.

## 9. Shared Pipeline & Router

```typescript
// router.ts
async function tick(sessionId: string) {
  const session = await redisSession.getAll(sessionId);
  const source = session.meta.source;

  const humanness = source === 'touch'
    ? mobile.computeHumanness(session, mobileWeights, mobileKValues)
    : desktop.computeHumanness(session, desktopWeights, desktopKValues);

  const lrTable = source === 'touch' ? lrTableMobile : lrTableDesktop;
  const signals = source === 'touch'
    ? mobile.evaluateSignals(session)
    : desktop.evaluateSignals(session);

  const intentProb = intentScorer.compute(signals, humanness, lrTable, thresholds.p0);

  const { state, trigger } = hysteresis.update(
    session.hysteresis, intentProb, Date.now(), thresholds
  );

  await redisSession.setAll(sessionId, { ...session, hysteresis: state });

  sendToClient(sessionId, {
    session_id: sessionId, t: Date.now(),
    intent_probability: intentProb, intent_ema: state.ema_value,
    humanness_factor: humanness,
    trigger,  // gateway layer only forwards this on transition
  });

  if (trigger !== session.hysteresis.last_trigger) {
    await logTriggerEvent(sessionId, trigger, intentProb, state.ema_value);
  }
}
```

`intentScorer.ts` and `hysteresis.ts` contain only the formulas in §6.8–6.9 — no platform branching.

## 10. Module / File Structure

```
src/
├── server.ts                      — Fastify bootstrap, WS route, REST route
├── ws/
│   ├── connectionHandler.ts        — parse ClientMeta, compute tier0, init Redis hash, session-id binding
│   ├── messageHandler.ts           — ingest ClientBatch, sort by t, append to buffers
│   └── disconnectHandler.ts        — mark session inactive (Redis TTL handles eventual cleanup)
├── tick/
│   └── ticker.ts                   — global setInterval(1000), iterates active sessions
├── pipeline/
│   ├── shared/
│   │   ├── welford.ts              — §6.1
│   │   ├── saturation.ts           — score(), corr_score(), weighted_score() — §6.2
│   │   ├── intentScorer.ts         — §6.8
│   │   └── hysteresis.ts           — §6.9
│   ├── desktop/
│   │   ├── curveSegmentation.ts    — §7.1
│   │   ├── curveFeatures.ts        — E, R, jerk_variance — §6.3, §6.4
│   │   ├── fitts.ts                — §6.5
│   │   ├── humanness.desktop.ts    — §7.2
│   │   └── signals.desktop.ts      — §7.3
│   ├── mobile/
│   │   ├── touchSegmentation.ts    — §8.1
│   │   ├── touchFeatures.ts        — §6.6
│   │   ├── scrollPhysics.ts        — §6.7
│   │   ├── humanness.mobile.ts     — §8.2
│   │   └── signals.mobile.ts       — §8.3
│   └── router.ts                   — §9
├── config/
│   ├── thresholds.json
│   ├── lrTable.desktop.json
│   └── lrTable.mobile.json
├── store/
│   ├── redisSession.ts             — typed HASH wrapper
│   └── outcomesRepo.ts             — Postgres writes
└── api/
    └── outcomesRoute.ts            — POST /intent-engine/outcomes

collector/
├── shared/
│   ├── socket.js                   — WS connect, reconnect w/ backoff, batching/flush (75ms)
│   └── metaCollector.js            — navigator.webdriver, plugins, webgl, source detection
├── desktop/
│   └── mouseListeners.js           — pointermove/pointerdown → ClientEvent
└── mobile/
    └── touchListeners.js           — touchstart/move/end, scroll → ClientEvent
```

## 11. State: Redis Schema

One HASH per session: `session:{session_id}`, TTL 1800s (refreshed every tick).

| Field | Type | Platform | Notes |
|-------|------|----------|-------|
| `meta` | JSON | both | ClientMeta + tier0_score, set once at connect |
| `session_start_t` | int | both | for time_on_page_gt_60s |
| `curve_buffer` | JSON array | desktop | in-progress curve points |
| `welford_E` | JSON `{n,mean,M2}` | desktop | |
| `welford_R` | JSON `{n,mean,M2}` | desktop | |
| `welford_jerk` | JSON `{n,mean,M2}` | desktop | |
| `fitts_pairs` | JSON array, cap 20 | desktop | |
| `current_touch_buffer` | JSON array | mobile | in-progress single-touch points |
| `gesture_buffer` | JSON array | mobile | multi-touch (pinch) points |
| `scroll_event_buffer` | JSON array | mobile | for fling fitting |
| `welford_path_efficiency` | JSON `{n,mean,M2}` | mobile | drag touches only |
| `welford_pressure` | JSON `{n,mean,M2}` | mobile | |
| `welford_radius` | JSON `{n,mean,M2}` | mobile | |
| `welford_decay_rate` | JSON `{n,mean,M2}` | mobile | |
| `pressure_quirk_checked` | bool | mobile | §16-D |
| `pricing_rect` | JSON TargetRect | both | from ViewportInfo |
| `viewport_height` | int | both | from ViewportInfo |
| `scroll_y` | int | both | |
| `scroll_y_history` | JSON array, cap 50 | both | for scroll_back_to_pricing |
| `hover_pricing_entered_at` / `pricing_section_entered_at` | int \| null | desk/mobile | dwell tracking |
| `active_signals` | JSON array | both | recomputed each tick |
| `hysteresis` | JSON `{ema_value, above_threshold_since, last_trigger}` | both | |

## 12. State: PostgreSQL Schema

```sql
CREATE TABLE outcomes (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('mouse','touch')),
  outcome SMALLINT NOT NULL CHECK (outcome IN (0,1)),
  e_session_mean DOUBLE PRECISION,
  e_session_variance DOUBLE PRECISION,
  r_session_variance DOUBLE PRECISION,
  fitts_correlation DOUBLE PRECISION,
  path_efficiency_variance DOUBLE PRECISION,
  pressure_variance DOUBLE PRECISION,
  radius_variance DOUBLE PRECISION,
  decay_rate_variance DOUBLE PRECISION,
  humanness_factor DOUBLE PRECISION,
  active_signals JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trigger_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL,
  source TEXT NOT NULL,
  triggered BOOLEAN NOT NULL,
  ema_value DOUBLE PRECISION,
  intent_probability DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outcomes_source ON outcomes(source);
CREATE INDEX idx_trigger_events_session ON trigger_events(session_id);
```

## 13. Config Files

### thresholds.json

```json
{
  "p0": 0.025,
  "ema_half_life_seconds": 7,
  "tick_interval_seconds": 1,
  "trigger_threshold": 0.6,
  "trigger_sustain_seconds": 2.5,
  "min_curves_for_variance": 5,
  "fitts_min_pairs": 4,
  "fitts_corr_scale": 0.15,

  "desktop": {
    "humanness_weights": { "tier0": 1.0, "tier1": 1.0, "fitts": 1.0 },
    "k_values": { "E": 0.01, "R": 0.5, "jerk": 50 }
  },

  "mobile": {
    "humanness_weights": { "tier0": 1.0, "tier1": 1.0, "tier2": 0.5 },
    "k_values": { "path_efficiency": 0.05, "pressure": 0.02, "radius": 2.0, "decay": 0.001 },
    "min_flings_for_variance": 3,
    "fling_min_velocity_samples": 5,
    "fling_min_r_squared": 0.5,
    "pinch_min_distance_change_px": 20
  }
}
```

### lrTable.desktop.json

```json
{
  "hover_pricing_3s":        { "LR": 2.0, "weight": 1.0 },
  "scroll_back_to_pricing":  { "LR": 2.5, "weight": 1.0 },
  "E_session_mean_high":     { "LR": 1.6, "weight": 1.0 },
  "click_pricing_cta":       { "LR": 3.0, "weight": 1.0 },
  "time_on_page_gt_60s":     { "LR": 1.4, "weight": 1.0 }
}
```

### lrTable.mobile.json

```json
{
  "scroll_back_to_pricing":      { "LR": 2.5, "weight": 1.0 },
  "pricing_section_dwell_3s":    { "LR": 2.2, "weight": 1.0 },
  "click_pricing_cta":           { "LR": 3.0, "weight": 1.0 },
  "pinch_zoom_on_pricing":         { "LR": 2.8, "weight": 1.0 },
  "time_on_page_gt_60s":            { "LR": 1.4, "weight": 1.0 }
}
```

All weights start at 1.0 — they (and the LRs themselves) are targets of the offline refit in §17.

## 14. Tick Loop — Full Orchestration

```
every 1000ms:
    session_ids = active_sessions_set()   // Redis SET, maintained on connect/disconnect

    for session_id in session_ids:
        try:
            session = redis.HGETALL(session_id)
        except RedisError:
            log("redis read failed", session_id)
            continue   // skip this session this tick, do NOT crash the loop

        now = current_time_ms()

        if session.meta.source == 'mouse':
            finalize_completed_curves(session, now)        // §7.1
            for curve in newly_finalized_curves:
                features = extract_curve_features(curve)    // §6.3, §6.4
                session.welford_E    = welford.update(session.welford_E, features.E)
                session.welford_R    = welford.update(session.welford_R, features.R)
                if features.jerk_variance is not null:
                    session.welford_jerk = welford.update(session.welford_jerk, features.jerk_variance)
            update_fitts_pairs_if_new_click(session)         // §6.5
            humanness = desktop.computeHumanness(session, ...)
            signals   = desktop.evaluateSignals(session)
            lrTable   = lrTableDesktop

        else:  // 'touch'
            finalize_completed_touches(session, now)        // §8.1
            for touch in newly_finalized_touches:
                features = extract_touch_features(touch)     // §6.6
                update_relevant_accumulators(session, features)
            process_gesture_buffer_for_pinch(session)         // §8.1
            fit_pending_flings(session)                        // §6.7
            humanness = mobile.computeHumanness(session, ...)
            signals   = mobile.evaluateSignals(session)
            lrTable   = lrTableMobile

        intent_prob = intentScorer.compute(signals, humanness, lrTable, thresholds.p0)
        { state, trigger } = hysteresis.update(session.hysteresis, intent_prob, now, thresholds)

        session.hysteresis = state
        redis.HSET(session_id, session)   // single write

        push_to_client(session_id, {
            intent_probability: intent_prob,
            intent_ema: state.ema_value,
            humanness_factor: humanness,
            trigger: trigger if trigger != session.hysteresis.last_trigger else omit
        })

        if trigger != session.hysteresis.last_trigger:
            postgres.insert_trigger_event(session_id, trigger, intent_prob, state.ema_value)
```

## 15. Client Collector Architecture

### `collector/shared/socket.js`
- On load: generate session_id (`crypto.randomUUID()`), open WS
- On open: send ClientMeta
- Maintain event buffer; flush every 75ms (pointer/touch move) or immediately (discrete events)
- Reconnect with backoff: 1s, 2s, 4s, max 10s — same session_id on reconnect
- Listen for ServerTick; on trigger:true, fire callback for sales-assist UI

### `collector/shared/metaCollector.js`
- `navigator.webdriver`, `navigator.plugins.length`, `navigator.languages`, WebGL renderer string
- Source detection: first 'mousemove' → 'mouse'; first 'touchstart' → 'touch' (sent as part of ClientMeta once determined — buffer pre-meta events briefly)

### `collector/desktop/mouseListeners.js`
- `mousemove` → `pointer_move` (buffered)
- `mousedown` → `pointer_down` (immediate), include `target.getBoundingClientRect()`
- `scroll` → `scroll` (immediate)

### `collector/mobile/touchListeners.js`
- `touchstart/touchmove/touchend` → `touch_*` (touchmove buffered, others immediate). Include `touches[].force` (pressure), `radiusX`/`radiusY` where available.
- `scroll` → `scroll` (immediate) — captures momentum-scroll events post touch_end
- `orientationchange` → `orientation_change` (immediate)

Both: `resize/orientationchange` → re-send ViewportInfo; `visibilitychange` → `visibility_change` event

## 16. Edge Cases — Comprehensive Reference

### 16-A. Desktop curve / Fitts edge cases

| Edge case | Handling |
|-----------|----------|
| Curve has 1 point (click with no prior movement) | Discard — no E/R/jerk computed |
| Curve has 2-4 points | E, R computed normally. `jerk_variance = null` (needs n≥5) |
| Duplicate consecutive timestamps (t[i+1]==t[i]) | Drop duplicate before velocity/jerk computation |
| Path length < 3px (micro-jitter) | Discard curve entirely |
| `pointer_down` with no prior `pointer_move` this session | Skip — no Fitts pair |
| `target.rect` missing or w=0 and h=0 | Skip pair. If only one of w/h is 0, W = max(w,h,1) still works |
| Click directly under existing cursor (D≈0) | Valid — ID=0, legitimate low-difficulty data point |
| <4 Fitts pairs after 60s | `fitts_correlation = null` permanently; humanness renormalizes (§6.2) |
| Trackpad producing choppier curves than mouse | No special handling — reads as more human-like, never false bot-flags |

### 16-B. Mobile touch / scroll / gesture edge cases

| Edge case | Handling |
|-----------|----------|
| Tap (duration<150ms, displacement<10px) | `path_efficiency` excluded; pressure/radius still recorded |
| path_length 0-2px but duration>150ms | Reclassify as long_press if >500ms, else tap. path_efficiency excluded |
| Second finger lands mid-drag | Finalize single-touch segment immediately (truncated). Remainder to gesture buffer |
| Inter-touch distance <20px during 2-finger contact | Not pinch — resting finger. Gesture buffer discarded |
| Fling has <5 velocity samples | Discard — not fed into `welford_decay_rate` |
| Fling decay_rate ≤ 0 or r_squared < 0.5 | Discard — noise or re-touch interrupted |
| New `touch_start` during in-progress fling fit | Truncate fling series; fit on ≥5 remaining samples, else discard |
| Single tap-scroll with no momentum | No fling fit attempted |
| Orientation change mid-session | Clear `current_touch_buffer` and `gesture_buffer`. Welford accumulators persist. Client re-sends ViewportInfo |

### 16-C. Cross-platform timing / data edge cases

| Edge case | Handling |
|-----------|----------|
| Hybrid device fires both mouse and touch | `source` locked to first event type. If other type later arrives, set `mixed_input: true` flag (logged, not scored) |
| Tick with zero new events | Pipeline still runs. Time-based signals can newly activate. EMA decays toward unchanged instantaneous intent_probability |
| Out-of-order event arrival | Server sorts `ClientBatch.events` by `t` before appending |
| Tab backgrounded (`visibility_change: false`) | Discard in-progress `curve_buffer` / `current_touch_buffer`. Welford accumulators persist |
| WS reconnect mid-session | Same session_id → resume from existing Redis hash (TTL 1800s covers typical backgrounding). Session_id lost → new session |
| EMA cold start | First tick: `ema_value = intent_probability` directly (no blend) |
| Session with <5 curves/touches | `humanness_factor` defaults toward 0.5 via weighted_score's null-renormalization. Can still trigger on strong explicit signals |
| Session transitions from cold-start to confirmed-bot while `above_threshold_since` was set | No special handling — intent_probability recomputes every tick; if it drops below threshold, `above_threshold_since` resets to null naturally |
| High-frequency input (>200 points in one 75ms batch) | Cap at 200. If exceeded, downsample (keep every Nth) before feature extraction |

### 16-D. Device / browser quirks

| Edge case | Handling |
|-----------|----------|
| Device reports pressure/radius fields but always 0.0 (Android Chrome) | After 10 events, set `pressure_quirk_checked=true`, treat pressure as null. Same check independently for radius |
| Device doesn't include pressure/radius fields at all | Already null from SinglePoint optional fields — weighted_score renormalizes |
| `navigator.webdriver` spoofed to false | Tier 1 (variance checks) is second layer. Defense-in-depth |

### 16-E. Infrastructure / security edge cases

| Edge case | Handling |
|-----------|----------|
| Same session_id opens second concurrent WS | Check ping within last 10s. Responsive → reject new (likely spoofing — assign fresh session_id). Unresponsive → treat as reconnect, close stale, accept new |
| Tier 0 recomputation mid-session | Out of scope — computed once at connect. Documented simplification |
| Redis read/write fails for one session during a tick | Catch, log, continue to next session — must not stall global tick loop |
| Tick loop exceeds 1000ms | v1: not handled. v2 (see §18): shard by `hash(session_id) % N` |
| Session ends but no final state recorded | Redis TTL (1800s) is backstop. Outcomes written by host site backend on conversion events (§5.5), independent of WS lifecycle |

## 17. Risk Mitigation & Calibration Plan

### 17.1 Calibration constants requiring real data

| Constant | Location | Bootstrap approach |
|----------|----------|-------------------|
| k_values.E, k_values.R, k_values.jerk (desktop) | thresholds.json.desktop | ~20-30 internal-staff browsing sessions (human) + ~20-30 Playwright/Selenium sessions (bot) on actual site. Set each k ≈ median variance in human set |
| k_values.path_efficiency, pressure, radius, decay (mobile) | thresholds.json.mobile | Separate collection — staff on phones (human) + Appium (bot). Touch path_efficiency clusters much higher than mouse E; reuse of desktop k will misclassify real users |
| fitts_corr_scale | thresholds.json | Start 0.15; adjust after observing real r distributions |
| ema_half_life_seconds, trigger_threshold, trigger_sustain_seconds | thresholds.json | Start 7s, 0.6, 2.5s; tune against real session pacing |
| p0 | thresholds.json | From site analytics — never guess this one |

### 17.2 Offline LR-table refit (Python/sklearn, scheduled job)

1. Export from Postgres `outcomes` table, filtered by source ('mouse' or 'touch' — fit separately)
2. Once positive outcomes >= 100-150 for that source (EPV≈10-15 with ~10 features): fit `LogisticRegression(penalty='l2')` on feature_vector → outcome
3. Convert fitted coefficients into updated `lrTable.{desktop,mobile}.json` (coefficient sign/magnitude → LR direction/strength per signal)
4. Manual review → PR → deploy

**Runtime never trains.** This job reads Postgres, writes JSON, and that JSON is the only thing the live pipeline consumes.

### 17.3 Privacy / compliance note

Pressure, contact-radius, and fine-grained movement timing are biometric-adjacent signals in some jurisdictions (notably under GDPR's special-category interpretations). Before production: confirm with legal/compliance whether this data requires explicit consent banners distinct from standard analytics cookies, and whether session_id (tied to behavioral biometrics) constitutes personal data requiring a documented lawful basis. **Flag early — can block launch.**

### 17.4 Known, accepted limitations (v1)

- **Transport spoofing**: a bot that spoofs `source: 'mouse'` while replaying touch-derived event patterns is not specifically defended beyond Tier 0.
- **The "junior analyst" problem**: a real human tasked with "go check three vendors" can produce a textbook high-intent profile without being the actual buyer. No client-side behavioral signal can fix this — addressing it would require identity/firmographic data (out of scope).

## 18. Scaling Considerations (v2 path)

v1: single Node process holds all WS connections and runs the single global tick. Sufficient until per-tick loop approaches 1000ms budget.

v2, if needed: shard sessions across N worker processes by `hash(session_id) % N`; each worker runs its own tick loop, all reading/writing the same Redis. Decouple "who holds the WS connection" from "who computes the tick" via Redis pub/sub relay — worker owning session's tick publishes ServerTick to a channel; gateway process holding WS subscribes and forwards.

## 19. Build Order

| Step | Component | Verification |
|------|-----------|-------------|
| 1 | `welford.ts` + `saturation.ts` | Unit tests with hand-crafted arrays |
| 2 | `curveFeatures.ts` | Synthetic point sequences (straight line → high E; zigzag → low E, high R; <5 points → jerk=null) |
| 3 | `connectionHandler.ts` (tier0) + `redisSession.ts` | Connection + tier0 + Redis write |
| 4 | `messageHandler.ts` + `curveSegmentation.ts` + minimal `ticker.ts` | Curves finalize, Welford updates, no scoring yet |
| 5 | `fitts.ts` + `humanness.desktop.ts` | Desktop humanness_factor end-to-end |
| 6 | `signals.desktop.ts` + `intentScorer.ts` | Desktop intent_probability |
| 7 | `hysteresis.ts` | Full desktop tick loop, ServerTick to test client |
| 8 | `collector/shared/*` + `collector/desktop/mouseListeners.js` | Real browser → local server. Desktop path fully proven before mobile |
| 9 | `touchFeatures.ts` + `touchSegmentation.ts` | Synthetic touch sequences (tap/drag/long_press, path_efficiency edge cases) |
| 10 | `scrollPhysics.ts` | Fling fitting on synthetic decaying-velocity sequences |
| 11 | `humanness.mobile.ts` + `signals.mobile.ts` + router.ts mobile entry | Mobile pipeline |
| 12 | `collector/mobile/touchListeners.js` | Real mobile browser test |
| 13 | `api/outcomesRoute.ts` + Postgres tables | Wire outcomes logging (start early — clock on accumulating positives starts at deployment) |
| — | Parallel data collection for k calibration (§17.1) | Does not block 1-13, but gates production-quality humanness scoring |
| — | Offline Python calibration script | Once outcomes past EPV threshold per source |

## 20. Testing Strategy

Every function in `pipeline/shared/` and platform-specific feature extractors (§6.3-6.7) is **pure**: state + new data → new state, no I/O. Unit-testable with hand-crafted fixtures:

- **Desktop**: straight-line sequence (E≈1, R≈0); zigzag (low E, high R≥2); 3-point and 5-point sequences (jerk_variance null vs populated); duplicate-timestamps (no division-by-zero)
- **Mobile**: short fast low-displacement (tap); long low-displacement (long_press); high-displacement (drag, valid path_efficiency); synthetic exponential decay (verify decay_rate and r_squared); linear decay (low r_squared → discarded)
- **Shared**: `weighted_score` with various null combinations (verify renormalization); `hysteresis.update` cold-start (no blend on tick 1); EMA convergence over constant input series

**Integration fixtures** (recorded, not synthetic): a handful of real recorded sessions (staff desktop, staff mobile) and scripted-bot sessions (Playwright for desktop, Appium for mobile) — serve as both test fixtures for pipeline correctness and seed dataset for k calibration in §17.1.
