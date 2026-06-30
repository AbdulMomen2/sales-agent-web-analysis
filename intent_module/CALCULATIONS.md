# Intent Engine — Full Calculation Pipeline

## Overview

Every 1s tick, the pipeline processes each active session through these stages:

```
Raw events → Curve segmentation → Feature extraction → Welford accumulators
                                                              ↓
Browser meta → Tier 0 score ──────────────────────→ Humanness factor
                                                              ↓
                                      Signals (business rules) → Intent probability
                                                                      ↓
                                                              Hysteresis (EMA + trigger)
```

---

## Stage 1: Tier 0 Score (static, computed once at connect)

Browser fingerprint check. Pure heuristic.

```
tier0 = 1.0
  - 0.30  if plugins_count < 2
  - 0.10  if plugins_count < 5 (but ≥ 2)
  - 0.40  if languages is empty
  - 0.50  if WebGL renderer contains: swiftshader | llvmpipe | basic | google | mesa
clamped to [0, 1]
```

---

## Stage 2: Curve Segmentation (desktop only)

Mouse movements are grouped into **curves** — sequences of pointer_move events.

A curve ends when:
- A pause > `curve_gap_ms` (500ms) occurs between consecutive moves, OR
- The curve exceeds `curve_max_duration_ms` (3000ms)

**Input:** `TimedPoint[]` from `curve_buffer`  
**Output:** finalized curves + remaining (unfinished) points for next tick

---

## Stage 3: Curve Features

For each finalized curve, three features are extracted.

### E — Path efficiency (curvature)

```
E = displacement / pathLength
```

- `pathLength` = sum of Euclidean distances between consecutive points
- `displacement` = Euclidean distance from first to last point
- **Range:** (0, 1]
  - `1.0` = perfectly straight line
  - `0.0` = highly inefficient (loopy/noisy)
- Humans typically score **0.5–0.8** (slightly curved, some correction)

### R — Direction reversals

Counts how many times the movement reverses direction on X or Y axis.

```
reversals = 0
for each consecutive triple (p[i], p[i+1], p[i+2]):
  vx1 = p[i+1].x - p[i].x
  vx2 = p[i+2].x - p[i+1].x
  if sign(vx1) != 0 AND sign(vx2) != 0 AND sign(vx1) != sign(vx2):
    reversals++
  (same for Y)
```

- **Range:** 0+ per curve
- Humans produce **reversals** (hesitations, micro-corrections). Bots are often too straight.

### Jerk variance

Third derivative of position. Computed as:

```
v = velocity = diff(position) / dt
a = acceleration = diff(v) / dt
j = jerk = diff(a) / dt
jerk_variance = variance(j.x) + variance(j.y)
```

- **Range:** ≥ 0
- **High** = jittery, noisy (human-like)
- **Low** = unnaturally smooth (bot-like)

---

## Stage 4: Welford Online Accumulators

Each feature (E, R, jerk) feeds a **Welford accumulator** — a numerically stable online algorithm for mean and variance.

On each tick, for each finalized curve:
```
welford_E.update(features.E)     // accumulates E values
welford_R.update(features.R)     // accumulates R values  
welford_jerk.update(features.jerk_variance)  // accumulates jerk
```

The accumulator tracks three values:

| Field | Meaning |
|-------|---------|
| `n` | Count of observations |
| `mean` | Running arithmetic mean |
| `M2` | Sum of squared differences from current mean |

**Sample variance** is computed as: `variance = M2 / (n - 1)` (only when `n >= 2`)

The variance is only used when `n >= minCurvesForVariance` (default: 5).

---

## Stage 5: Humanness Factor

Four components are scored and weighted-averaged:

### Component A: Tier 0 (raw score)
```
score = tier0_score  (0.0 – 1.0)
```
Weight: `1.0`

### Component B: E variance score
Saturating function: `score = v / (v + k)` where `k = 0.01`

- `v = welford_E.variance`
- If `v` is null (not enough data): score = 0.5 (neutral)
- High E-variance → score → 1.0 (erratic, human-like)
- Low E-variance → score → 0.0 (too consistent, bot-like)

Weight: `1.0`

### Component C: R variance score
Same saturating function: `score = v / (v + k)` where `k = 0.5`

- `v = welford_R.variance`
- High R-variance → more reversals → more human

Weight: `1.0`

### Component D: Fitts correlation score
Fitts' Law: movement time = a + b·log₂(D/W + 1)

Each click event creates a Fitts pair:
- `fitts_x = log₂(D / W + 1)` where D = distance cursor moved, W = target size
- `fitts_y = time from last move to click`

Pearson correlation `r` between `fitts_x` and `fitts_y`:
```
r = (n·Σxy - Σx·Σy) / √((n·Σx² - (Σx)²)(n·Σy² - (Σy)²))
```

Then scored via sigmoid:
```
fitts_score = 1 / (1 + exp(-r / scale))   where scale = 0.15
```

- `r ≈ 1.0` → score ≈ 1.0 (strong Fitts correlation = human-like)
- `r ≈ 0.0` → score ≈ 0.5 (no correlation)
- `r < 0` → score → 0.0

Weight: `1.0`

### Weighted average
```
humanness = (tier0 × 1.0 + E_score × 1.0 + R_score × 1.0 + fitts_score × 1.0) / 4.0
```

---

## Stage 6: Business Signals

Evaluated from session state. Each signal has an LR (Likelihood Ratio) and weight.

| Signal | Condition | LR | Weight |
|--------|-----------|----|--------|
| `time_on_page_gt_60s` | Session duration > 60s | 1.4 | 1.0 |
| `hover_pricing_3s` | Hover over pricing element > 3s | 2.0 | 1.0 |
| `scroll_back_to_pricing` | Scrolled past pricing, then back | 2.5 | 1.0 |
| `click_pricing_cta` | Clicked on pricing element | 3.0 | 1.0 |
| `E_session_mean_high` | Mean E > 0.7 | 1.6 | 1.0 |

---

## Stage 7: Intent Probability

Bayesian update with LR signals:

```
prior_odds = p0 / (1 - p0)          // p0 = 0.025 (2.5% baseline)
log_odds = ln(prior_odds)

for each active signal:
  log_odds += weight · ln(LR)

p_buying_raw = 1 / (1 + exp(-log_odds))
p_buying = p_buying_raw × humanness_factor
```

The `humanness_factor` scales down intent for low-humanness sessions (bots).

---

## Stage 8: Hysteresis (EMA + Trigger)

Exponential Moving Average smooths the intent probability:

```
alpha = 2 / (half_life / tick_interval + 1) = 2 / (7 / 1 + 1) = 0.25
ema_t = alpha × intent_t + (1 - alpha) × ema_{t-1}
```

Trigger logic:
```
if ema_t >= threshold (0.6):
  if above_threshold_since is null:
    above_threshold_since = now
else:
  above_threshold_since = null

sustained = (now - above_threshold_since) / 1000  (seconds)
trigger = sustained >= sustain_seconds (2.5s)
```

Trigger fires only on the rising edge (transition from false → true).

---

## Example: Current 3% Score

```
prior_odds = 0.025 / 0.975 = 0.02564
log_odds = ln(0.02564) = -3.663

Signal: time_on_page_gt_60s  LR=1.4
log_odds += 1.0 × ln(1.4) = +0.336
total_log_odds = -3.327

p_buying_raw = 1 / (1 + exp(3.327)) = 0.0346 (3.5%)

humanness = 0.728
p_buying_final = 0.0346 × 0.728 = 0.0252 (2.5%)

→ 3% intent probability (matches dashboard)
```

To reach trigger (EMA > 0.6 for 2.5s), you'd need multiple strong signals like `click_pricing_cta` (LR=3.0) and `scroll_back_to_pricing` (LR=2.5) combined with sustained high intent over several ticks.
