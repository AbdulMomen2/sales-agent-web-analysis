import { WebSocket } from 'ws';
import type { SessionState, ServerTick } from '../types/index.js';
import type { RedisSession } from '../store/redisSession.js';
import type { SessionProcessor } from '../tick/ticker.js';
import { update as welfordUpdate } from './shared/welford.js';
import { computeHumanness, sessionToHumannessInputs } from './desktop/humanness.js';
import { computeMobileHumanness, sessionToMobileHumannessInputs } from './mobile/humanness.js';
import { evaluateDesktopSignals } from './desktop/signals.js';
import { evaluateMobileSignals } from './mobile/signals.js';
import { computeIntentProbability } from './shared/intentScorer.js';
import { updateHysteresis } from './shared/hysteresis.js';
import { thresholds, lrTableDesktop, lrTableMobile, getP0, getTriggerThreshold, getTriggerSustainSeconds, getEmaHalfLifeSeconds } from '../config/index.js';
import { finalizeCurves, extractCurveFeatures } from './desktop/curves.js';
import { classifyTouch, extractTouchFeatures } from './mobile/touches.js';
import { fitFling } from './mobile/scrollPhysics.js';
import { computeFittsCorrelation } from './desktop/fitts.js';
import { score as satScore, corr_score as satCorrScore } from './shared/saturation.js';
import { SalesIntentSummary } from './shared/salesIntent.js';

const th = thresholds;

export interface SessionProcessorWithFlush {
  process: SessionProcessor;
  flush: () => void;
}

export function createSessionProcessor(
  store: RedisSession,
  connectionMap: Map<string, WebSocket>,
  dashboardClients?: Set<WebSocket>,
): SessionProcessorWithFlush {
  let sessionAccum: Record<string, any>[] = [];

  function flush(): void {
    if (!dashboardClients || dashboardClients.size === 0) return;
    if (sessionAccum.length === 0) return;

    const msg = JSON.stringify({ _type: 'dashboard_tick', sessions: sessionAccum, t: Date.now() });
    let sent = 0;
    for (const dc of dashboardClients) {
      if (dc.readyState === WebSocket.OPEN) {
        dc.send(msg);
        sent++;
      }
    }
    if (sent > 0) console.log(`[dash] broadcast ${sessionAccum.length} session(s) to ${sent} client(s)`);
    sessionAccum = [];
  }

  const process: SessionProcessor = async (sessionId: string, session: SessionState, now: number) => {
    const source = session.meta?.source;
    if (!source) return;

    let humannessFactor: number;
    let signals: string[];
    let fittsCorr: number | null = null;

    if (source === 'mouse') {
      const desktopCfg = th.desktop!;
      const desktop = session.desktop!;

      const result = finalizeCurves(
        desktop.curve_buffer, now,
        desktopCfg.curve_gap_ms ?? 500,
        desktopCfg.curve_max_duration_ms ?? 3000,
      );
      for (const curve of result.finalized) {
        const features = extractCurveFeatures(
          curve,
          desktopCfg.curve_min_path_length_px ?? 3,
          desktopCfg.curve_min_points_for_jerk ?? 5,
        );
        if (features.E !== null) {
          desktop.welford_E = welfordUpdate(desktop.welford_E!, features.E);
        }
        if (features.R !== null) {
          desktop.welford_R = welfordUpdate(desktop.welford_R!, features.R);
        }
        if (features.jerk_variance !== null) {
          desktop.welford_jerk = welfordUpdate(desktop.welford_jerk!, features.jerk_variance);
        }
      }
      desktop.curve_buffer = result.remaining;

      fittsCorr = computeFittsCorrelation(
        session.fitts_pairs,
        th.fitts_min_pairs ?? 4,
      );

      const inputs = sessionToHumannessInputs(
        session.meta!.tier0_score,
        desktop.welford_E,
        desktop.welford_R,
        fittsCorr,
        desktopCfg.humanness_min_curves_for_variance ?? 5,
      );

      humannessFactor = computeHumanness(
        inputs,
        desktopCfg.humanness_weights as any,
        desktopCfg.k_values as any,
        th.fitts_corr_scale ?? 0.15,
      );

      signals = evaluateDesktopSignals(session, desktopCfg.signals ?? {});
    } else {
      const mobileCfg = th.mobile!;
      const mobile = session.mobile!;

      if (mobile.current_touch_buffer.length >= 2) {
        const segment = classifyTouch(
          mobile.current_touch_buffer,
          mobile.current_touch_buffer[0]?.t ?? 0,
          mobile.current_touch_buffer[mobile.current_touch_buffer.length - 1]?.t ?? 0,
          mobileCfg.tap_max_duration_ms ?? 150,
          mobileCfg.tap_max_displacement_px ?? 10,
          mobileCfg.long_press_min_duration_ms ?? 500,
        );
        if (segment && segment.contact_type === 'drag' && segment.path_length > 2) {
          const features = extractTouchFeatures(segment, mobileCfg.touch_min_path_for_efficiency_px ?? 2);
          if (features.path_efficiency !== null) {
            mobile.welford_path_efficiency = welfordUpdate(mobile.welford_path_efficiency!, features.path_efficiency);
          }
          if (features.pressure_mean !== null) {
            mobile.welford_pressure = welfordUpdate(mobile.welford_pressure!, features.pressure_mean);
          }
          if (features.radius_mean !== null) {
            mobile.welford_radius = welfordUpdate(mobile.welford_radius!, features.radius_mean);
          }
        }
        mobile.current_touch_buffer = [];
      }

      if (mobile.scroll_event_buffer.length >= (mobileCfg.fling_min_samples ?? 5)) {
        const fling = fitFling(
          mobile.scroll_event_buffer,
          mobileCfg.fling_min_samples ?? 5,
          mobileCfg.fling_min_r_squared ?? 0.5,
        );
        if (fling.decay_rate !== null) {
          mobile.welford_decay_rate = welfordUpdate(mobile.welford_decay_rate!, fling.decay_rate);
        }
        mobile.scroll_event_buffer = [];
      }

      const inputs = sessionToMobileHumannessInputs(
        session.meta!.tier0_score,
        mobile.welford_path_efficiency,
        mobile.welford_pressure,
        mobile.welford_radius,
        mobile.welford_decay_rate,
        mobileCfg.humanness_min_path_efficiency_n ?? 5,
        mobileCfg.humanness_min_pressure_n ?? 5,
        mobileCfg.humanness_min_radius_n ?? 5,
        mobileCfg.humanness_min_decay_rate_n ?? 3,
      );

      humannessFactor = computeMobileHumanness(
        inputs,
        mobileCfg.humanness_weights as any,
        mobileCfg.k_values as any,
      );

      signals = evaluateMobileSignals(session, mobileCfg.signals ?? {});
    }

    if (humannessFactor < 0.3) {
      signals.push('bot_like_movement');
    }
    if (now - session.last_interaction_t > 30000) {
      signals.push('inactive_session');
    }

    const p0 = getP0();
    const lrTable = source === 'mouse' ? lrTableDesktop : lrTableMobile;

    let intentProbability = computeIntentProbability({ signals, lrTable, p0 });
    intentProbability = intentProbability * humannessFactor;

    // Sales intent business metrics (port of Python SalesIntentSummary)
    const salesIntent = new SalesIntentSummary();
    if (session.sales_intent_state) {
      const s = session.sales_intent_state;
      salesIntent.ctaHoverCount = s.ctaHoverCount;
      salesIntent.longHoverCount = s.longHoverCount;
      salesIntent.productHovers = s.productHovers;
      salesIntent.cartActions = s.cartActions;
      salesIntent.priceInteractions = s.priceInteractions;
      salesIntent.purchaseCtasSeen = s.purchaseCtasSeen;
      salesIntent.numHesitations = s.numHesitations;
      salesIntent.maxScrollPercent = s.maxScrollPercent;
      salesIntent.totalTicks = s.totalTicks;
      salesIntent.focusAreas = new Map(Object.entries(s.focusAreas));
    }
    salesIntent.updateFromSession(session);
    const sm = salesIntent.getMetrics();
    session.sales_intent_state = {
      ctaHoverCount: salesIntent.ctaHoverCount,
      longHoverCount: salesIntent.longHoverCount,
      productHovers: salesIntent.productHovers,
      cartActions: salesIntent.cartActions,
      priceInteractions: salesIntent.priceInteractions,
      purchaseCtasSeen: salesIntent.purchaseCtasSeen,
      numHesitations: salesIntent.numHesitations,
      maxScrollPercent: salesIntent.maxScrollPercent,
      totalTicks: salesIntent.totalTicks,
      focusAreas: Object.fromEntries(salesIntent.focusAreas),
    };

    const { state: hysteresisState, trigger } = updateHysteresis(
      session.hysteresis,
      intentProbability,
      now,
      {
        ema_half_life_seconds: getEmaHalfLifeSeconds(),
        tick_interval_seconds: th.tick_interval_seconds ?? 1,
        trigger_threshold: getTriggerThreshold(),
        trigger_sustain_seconds: getTriggerSustainSeconds(),
      },
    );

    session.hysteresis = hysteresisState;
    session.active_signals = signals;

    const tick: ServerTick = {
      session_id: sessionId,
      t: now,
      intent_probability: intentProbability,
      intent_ema: hysteresisState.ema_value,
      humanness_factor: humannessFactor,
      trigger,
      signals,
      trigger_threshold: getTriggerThreshold(),
      p0,
      ema_half_life_seconds: getEmaHalfLifeSeconds(),
    };

    const ws = connectionMap.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(tick));
    }

    if (dashboardClients && dashboardClients.size > 0) {
      const desktop = session.desktop;
      const lrDetails: Record<string, number> = {};
      for (const sig of signals) {
        const lr = lrTable[sig];
        if (lr !== undefined) lrDetails[sig] = lr;
      }
      const humannessDetails: Record<string, number> = {};
      if (source === 'mouse') {
        const d = session.desktop!;
        const ev = !d.welford_E || d.welford_E.n < (th.desktop?.humanness_min_curves_for_variance ?? 5) ? null : d.welford_E.M2 / (d.welford_E.n - 1);
        const rv = !d.welford_R || d.welford_R.n < (th.desktop?.humanness_min_curves_for_variance ?? 5) ? null : d.welford_R.M2 / (d.welford_R.n - 1);
        humannessDetails.E_score = ev !== null ? satScore(ev, (th.desktop?.k_values as any)?.E ?? 0.01) : 0.5;
        humannessDetails.R_score = rv !== null ? satScore(rv, (th.desktop?.k_values as any)?.R ?? 0.5) : 0.5;
        humannessDetails.fitts_score = satCorrScore(fittsCorr, th.fitts_corr_scale ?? 0.15);
      }
      sessionAccum.push({
        session_id: sessionId,
        source: session.meta?.source ?? null,
        t: now,
        intent_probability: intentProbability,
        intent_ema: hysteresisState.ema_value,
        humanness_factor: humannessFactor,
        trigger,
        signals,
        tier0_score: session.meta?.tier0_score ?? 0,
        scroll_y: session.scroll_y,
        pricing_rect: session.pricing_rect,
        curve_buffer_len: desktop?.curve_buffer.length ?? 0,
        welford_E: desktop?.welford_E ?? null,
        welford_R: desktop?.welford_R ?? null,
        welford_jerk: desktop?.welford_jerk ?? null,
        fitts_pairs_len: (session.fitts_pairs || []).length,
        fitts_correlation: fittsCorr,
        hysteresis_ema_value: hysteresisState.ema_value,
        hysteresis_above_since: hysteresisState.above_threshold_since,
        hysteresis_last_trigger: hysteresisState.last_trigger,
        session_start_t: session.session_start_t,
        mixed_input: session.mixed_input,
        humanness_details: humannessDetails,
        lr_details: lrDetails,
        desktop_present: session.desktop !== null,
        mobile_present: session.mobile !== null,
        last_element_info: session.last_element_info ?? null,
        replay_event_count: (session.replay_buffer || []).length,
        dom_mutation_count: (session.dom_mutations || []).length,
        dom_snapshot_stored: !!session.dom_snapshot,
      });
    }

    // Write back only the fields the pipeline changed (never overwrite
    // fitts_pairs, last_element_info, scroll_y, meta, etc. that the
    // message handler may have updated since our read — lost-update fix)
    const changedFields: Record<string, unknown> = {
      hysteresis: hysteresisState,
      active_signals: signals,
      sales_intent_state: session.sales_intent_state,
    };
    if (source === 'mouse') changedFields.desktop = session.desktop;
    else if (source === 'touch') changedFields.mobile = session.mobile;
    await store.updateFields(sessionId, changedFields);
  };

  return { process, flush };
}
