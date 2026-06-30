import { classifyElementInfo, elementInfoToData, type ElementData } from './elementClassifier.js';
import type { SessionState } from '../../types/index.js';

export interface SalesIntentMetrics {
  engagement_score: number;
  purchase_intent_proxy: number;
  friction_indicator: number;
  main_focus_area: string | null;
  num_hesitations: number;
  max_scroll_percent: number;
  cta_hover_count: number;
  product_hovers: number;
  cart_actions: number;
}

export class SalesIntentSummary {
  ctaHoverCount = 0;
  longHoverCount = 0;
  productHovers = 0;
  cartActions = 0;
  priceInteractions = 0;
  purchaseCtasSeen = 0;
  numHesitations = 0;
  maxScrollPercent = 0;
  totalTicks = 0;
  focusAreas: Map<string, number> = new Map();

  updateFromSession(session: SessionState): void {
    this.totalTicks++;
    const scrollY = session.scroll_y || 0;
    const viewportH = session.viewport_height || 1;
    const scrollPct = Math.min(100, Math.round((scrollY / (scrollY + viewportH)) * 100));
    this.maxScrollPercent = Math.max(this.maxScrollPercent, scrollPct);

    const element = session.last_element_info;
    if (element) {
      const focus = classifyElementInfo(element);
      if (focus) {
        this.focusAreas.set(focus, (this.focusAreas.get(focus) || 0) + 1);
      }

      const elData = elementInfoToData(element);
      const cat = elData.category?.toLowerCase() || '';
      const text = elData.text?.toLowerCase() || '';
      const hasPrice = !!elData.price;
      const inProduct = hasPrice || session.pricing_rect !== null;

      if (inProduct) this.productHovers++;

      if (this.isPurchaseCategory(cat) || this.isPurchaseText(cat, text)) {
        this.ctaHoverCount++;
        this.purchaseCtasSeen++;
      }

      if (hasPrice && ['add_to_cart', 'buy_now', 'checkout', 'cart', 'product_price', 'cta'].includes(cat)) {
        this.priceInteractions++;
      }
    }

    if (session.pricing_cta_clicked) {
      this.ctaHoverCount += 2;
      this.cartActions++;
    }
  }

  private isPurchaseCategory(cat: string): boolean {
    return ['add_to_cart', 'buy_now', 'checkout', 'cart', 'wishlist_favorites', 'cta'].includes(cat);
  }

  private isPurchaseText(cat: string, text: string): boolean {
    const combined = `${cat} ${text}`;
    return ['cart', 'buy', 'checkout', 'purchase', 'add to cart', 'shop'].some(k => combined.includes(k));
  }

  getMetrics(): SalesIntentMetrics {
    const total = this.totalTicks || 1;

    const W_CTA = parseFloat(process.env.SALES_W_CTA || '20');
    const W_PRODUCT = parseFloat(process.env.SALES_W_PRODUCT || '10');
    const W_LONG_HOVER = parseFloat(process.env.SALES_W_LONG_HOVER || '10');
    const W_SCROLL = parseFloat(process.env.SALES_W_SCROLL || '0.333');
    const CAP_ENGAGEMENT = parseInt(process.env.SALES_CAP_ENGAGEMENT || '100', 10);
    const CAP_CTA = parseInt(process.env.SALES_CAP_CTA || '35', 10);
    const CAP_PRODUCT = parseInt(process.env.SALES_CAP_PRODUCT || '25', 10);
    const CAP_LONG_HOVER = parseInt(process.env.SALES_CAP_LONG_HOVER || '20', 10);
    const CAP_SCROLL = parseInt(process.env.SALES_CAP_SCROLL || '20', 10);

    const W_PURCHASE_CTA = parseFloat(process.env.SALES_W_PURCHASE_CTA || '12');
    const W_PURCHASE_PRODUCT = parseFloat(process.env.SALES_W_PURCHASE_PRODUCT || '8');
    const W_PURCHASE_CART = parseFloat(process.env.SALES_W_PURCHASE_CART || '15');
    const W_PURCHASE_PRICE = parseFloat(process.env.SALES_W_PURCHASE_PRICE || '10');
    const W_PURCHASE_SCROLL = parseFloat(process.env.SALES_W_PURCHASE_SCROLL || '0.1');
    const CAP_PURCHASE_CTA = parseInt(process.env.SALES_CAP_PURCHASE_CTA || '40', 10);
    const CAP_PURCHASE_PRODUCT = parseInt(process.env.SALES_CAP_PURCHASE_PRODUCT || '20', 10);
    const CAP_PURCHASE_CART = parseInt(process.env.SALES_CAP_PURCHASE_CART || '20', 10);
    const CAP_PURCHASE_PRICE = parseInt(process.env.SALES_CAP_PURCHASE_PRICE || '10', 10);
    const CAP_PURCHASE_SCROLL = parseInt(process.env.SALES_CAP_PURCHASE_SCROLL || '10', 10);
    const CAP_PURCHASE_TOTAL = parseInt(process.env.SALES_CAP_PURCHASE_TOTAL || '100', 10);

    const FRICTION_HOVER_NO_CART = parseFloat(process.env.SALES_FRICTION_HOVER_NO_CART || '20');
    const FRICTION_LOW_SCROLL = parseFloat(process.env.SALES_FRICTION_LOW_SCROLL || '15');
    const FRICTION_LOW_ENGAGEMENT = parseFloat(process.env.SALES_FRICTION_LOW_ENGAGEMENT || '20');
    const FRICTION_HIGH_INTENT_NO_CART = parseFloat(process.env.SALES_FRICTION_HIGH_INTENT_NO_CART || '15');
    const CAP_FRICTION = parseInt(process.env.SALES_CAP_FRICTION || '100', 10);

    const SCROLL_PCT_THRESHOLD = parseFloat(process.env.SALES_SCROLL_PCT_THRESHOLD || '15');
    const ENGAGEMENT_SCORE_THRESHOLD = parseFloat(process.env.SALES_ENGAGEMENT_SCORE_THRESHOLD || '15');
    const PURCHASE_INTENT_THRESHOLD = parseFloat(process.env.SALES_PURCHASE_INTENT_THRESHOLD || '60');
    const MIN_TICKS_FOR_FRICTION = parseInt(process.env.SALES_MIN_TICKS_FOR_FRICTION || '4', 10);
    const MIN_TICKS_FOR_HIGH_INTENT = parseInt(process.env.SALES_MIN_TICKS_FOR_HIGH_INTENT || '6', 10);

    const ctaScore = Math.min(this.ctaHoverCount * W_CTA, CAP_CTA);
    const productScore = Math.min(this.productHovers * W_PRODUCT, CAP_PRODUCT);
    const longHoverScore = Math.min(this.longHoverCount * W_LONG_HOVER, CAP_LONG_HOVER);
    const scrollScore = Math.min(this.maxScrollPercent * W_SCROLL, CAP_SCROLL);
    const engagementScore = Math.min(Math.round(ctaScore + productScore + longHoverScore + scrollScore), CAP_ENGAGEMENT);

    const directCta = Math.min(this.ctaHoverCount * W_PURCHASE_CTA, CAP_PURCHASE_CTA);
    const productPresence = Math.min(this.productHovers * W_PURCHASE_PRODUCT, CAP_PURCHASE_PRODUCT);
    const cartActions = Math.min(this.cartActions * W_PURCHASE_CART, CAP_PURCHASE_CART);
    const priceSignal = Math.min(this.priceInteractions * W_PURCHASE_PRICE, CAP_PURCHASE_PRICE);
    const scrollBonus = Math.min(this.maxScrollPercent * W_PURCHASE_SCROLL, CAP_PURCHASE_SCROLL);
    const purchaseIntent = Math.min(Math.round(directCta + productPresence + cartActions + priceSignal + scrollBonus), CAP_PURCHASE_TOTAL);

    let friction = 0;
    if (this.ctaHoverCount > 0 && this.cartActions === 0) {
      friction += FRICTION_HOVER_NO_CART;
    }
    if (this.maxScrollPercent < SCROLL_PCT_THRESHOLD && total > MIN_TICKS_FOR_FRICTION) {
      friction += FRICTION_LOW_SCROLL;
    }
    if (engagementScore < ENGAGEMENT_SCORE_THRESHOLD && total > MIN_TICKS_FOR_FRICTION) {
      friction += FRICTION_LOW_ENGAGEMENT;
    }
    if (purchaseIntent > PURCHASE_INTENT_THRESHOLD && this.cartActions === 0 && total > MIN_TICKS_FOR_HIGH_INTENT) {
      friction += FRICTION_HIGH_INTENT_NO_CART;
    }
    const frictionIndicator = Math.min(Math.round(friction), CAP_FRICTION);

    let mainFocus: string | null = null;
    let maxCount = 0;
    for (const [area, count] of this.focusAreas) {
      if (count > maxCount) { maxCount = count; mainFocus = area; }
    }

    return {
      engagement_score: engagementScore,
      purchase_intent_proxy: purchaseIntent,
      friction_indicator: frictionIndicator,
      main_focus_area: mainFocus,
      num_hesitations: this.numHesitations,
      max_scroll_percent: this.maxScrollPercent,
      cta_hover_count: this.ctaHoverCount,
      product_hovers: this.productHovers,
      cart_actions: this.cartActions,
    };
  }
}

export const defaultSalesIntent = (): SalesIntentMetrics => ({
  engagement_score: 0,
  purchase_intent_proxy: 0,
  friction_indicator: 0,
  main_focus_area: null,
  num_hesitations: 0,
  max_scroll_percent: 0,
  cta_hover_count: 0,
  product_hovers: 0,
  cart_actions: 0,
});
