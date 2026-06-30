import type { DesktopSignalConfig } from '../../config/index.js';
import type { SessionState } from '../../types/index.js';

export function evaluateDesktopSignals(
  session: SessionState,
  signalCfg: DesktopSignalConfig,
): string[] {
  const signals: string[] = [];
  const now = Date.now();
  const pricingRect = session.pricing_rect;

  const timeOnPageMs = signalCfg.time_on_page_ms ?? 60000;
  const hoverDwellMs = signalCfg.hover_dwell_ms ?? 3000;
  const scrollThresholdPx = signalCfg.scroll_reversal_threshold_px ?? 50;
  const scrollHistMinLen = signalCfg.scroll_history_min_length ?? 3;
  const eMeanHighThreshold = signalCfg.E_mean_high_threshold ?? 0.7;

  if (now - session.session_start_t >= timeOnPageMs) {
    signals.push('time_on_page_gt_60s');
  }

  if (pricingRect && session.desktop) {
    const buffer = session.desktop.curve_buffer;
    if (buffer.length > 0) {
      const lastPt = buffer[buffer.length - 1];
      const inRect =
        lastPt.x >= pricingRect.x &&
        lastPt.x <= pricingRect.x + pricingRect.w &&
        lastPt.y >= pricingRect.y &&
        lastPt.y <= pricingRect.y + pricingRect.h;

      if (inRect) {
        if (session.hover_pricing_entered_at === null) {
          session.hover_pricing_entered_at = now;
        } else if (now - session.hover_pricing_entered_at >= hoverDwellMs) {
          signals.push('hover_pricing_3s');
        }
      } else {
        session.hover_pricing_entered_at = null;
      }
    }
  }

  if (pricingRect && session.scroll_y_history.length >= scrollHistMinLen) {
    const recent = session.scroll_y_history.slice(-10);
    let wentDown = false;
    let cameBack = false;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] > recent[i - 1] + scrollThresholdPx) wentDown = true;
      if (wentDown && recent[i] < pricingRect.y + pricingRect.h) cameBack = true;
    }
    if (wentDown && cameBack) signals.push('scroll_back_to_pricing');
  }

  if (
    session.desktop?.welford_E &&
    session.desktop.welford_E.n >= 1 &&
    session.desktop.welford_E.mean > eMeanHighThreshold
  ) {
    signals.push('E_session_mean_high');
  }

  if (session.pricing_cta_clicked) signals.push('click_pricing_cta');

  return signals;
}
