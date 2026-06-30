import type { MobileSignalConfig } from '../../config/index.js';
import type { SessionState } from '../../types/index.js';

export function evaluateMobileSignals(
  session: SessionState,
  signalCfg: MobileSignalConfig,
): string[] {
  const signals: string[] = [];
  const now = Date.now();
  const pricingRect = session.pricing_rect;
  const viewportHeight = session.viewport_height;
  const scrollY = session.scroll_y;

  const timeOnPageMs = signalCfg.time_on_page_ms ?? 60000;
  const dwellMs = signalCfg.pricing_section_dwell_ms ?? 3000;
  const scrollThresholdPx = signalCfg.scroll_reversal_threshold_px ?? 50;
  const scrollHistMinLen = signalCfg.scroll_history_min_length ?? 3;

  if (now - session.session_start_t >= timeOnPageMs) {
    signals.push('time_on_page_gt_60s');
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

  if (pricingRect && viewportHeight > 0) {
    const viewportTop = scrollY;
    const viewportBottom = scrollY + viewportHeight;
    const pricingTop = pricingRect.y;
    const pricingBottom = pricingRect.y + pricingRect.h;
    const pricingVisible = pricingTop < viewportBottom && pricingBottom > viewportTop;

    if (pricingVisible) {
      if (session.pricing_section_entered_at === null) {
        session.pricing_section_entered_at = now;
      } else if (now - session.pricing_section_entered_at >= dwellMs) {
        signals.push('pricing_section_dwell_3s');
      }
    } else {
      session.pricing_section_entered_at = null;
    }
  }

  if (session.pricing_cta_clicked) signals.push('click_pricing_cta');
  if (session.pinch_zoom_triggered) signals.push('pinch_zoom_on_pricing');

  return signals;
}
