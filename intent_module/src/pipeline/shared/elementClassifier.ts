import type { ElementInfo } from '../../types/index.js';

export interface ElementData {
  category?: string;
  type?: string;
  text?: string;
  price?: string | number;
  section?: string;
  product_parent?: ElementData;
  parent_chain?: ElementData[];
}

const CATEGORY_ATTRS = (process.env.ELEMENT_CATEGORY_ATTRS || 'data-category,data-type,category,type').split(',').map(s => s.trim());
const PRICE_ATTRS = (process.env.ELEMENT_PRICE_ATTRS || 'data-price,price').split(',').map(s => s.trim());
const SECTION_ATTRS = (process.env.ELEMENT_SECTION_ATTRS || 'data-section,section').split(',').map(s => s.trim());

function firstAttr(attrs: Record<string, string>, names: string[]): string {
  for (const name of names) {
    if (attrs[name]) return attrs[name];
  }
  return '';
}

/** Convert server-side ElementInfo to the format classifier.py expects */
export function elementInfoToData(el: ElementInfo): ElementData {
  const attrs = el.attributes || {};
  return {
    category: firstAttr(attrs, CATEGORY_ATTRS),
    type: firstAttr(attrs, CATEGORY_ATTRS),
    text: (el.text || '').slice(0, 200),
    price: firstAttr(attrs, PRICE_ATTRS),
    section: firstAttr(attrs, SECTION_ATTRS),
    parent_chain: [],
  };
}

export function classifyElement(element: ElementData | null | undefined): string | null {
  if (!element) return null;

  const cat = (element.category || element.type || '').toLowerCase();
  const elText = (element.text || '').toLowerCase();
  const elSection = (element.section || '').toLowerCase();
  const hasPrice = element.price !== undefined && element.price !== null && element.price !== '';
  let productParent = element.product_parent;
  const parentChain = element.parent_chain || [];

  if (!productParent && parentChain.length > 0) {
    for (const p of parentChain) {
      const pc = (p.category || '').toLowerCase();
      if (['product_card', 'product_grid', 'product_title', 'product_price', 'sale_price'].includes(pc)) {
        productParent = p;
        break;
      }
    }
  }

  const combined = `${cat} ${elText} ${elSection}`;

  // TIER 1: COMMERCE ACTIONS
  if (cat === 'add_to_cart' || cat === 'buy_now') {
    const pname = (productParent?.text || elText).trim();
    return (pname.length > 3) ? `Purchase: ${pname.slice(0, 60).replace(/\b\w/g, c => c.toUpperCase())}` : 'Purchase Intent';
  }
  if (cat === 'checkout') return 'Checkout';
  if (cat === 'cart') return 'Cart / Bag';

  // TIER 2: COMMERCE CONTENT
  if (cat === 'product_card' || cat === 'product_grid') {
    const pname = (productParent?.text || elText).trim();
    return (pname.length > 3) ? `Product Card: ${pname.slice(0, 60).replace(/\b\w/g, c => c.toUpperCase())}` : 'Product Card';
  }
  if (cat === 'product_title') {
    return elText ? `Product Title: ${elText.slice(0, 60).replace(/\b\w/g, c => c.toUpperCase())}` : 'Product Title';
  }
  if (['product_price', 'sale_price', 'discount_badge'].includes(cat)) {
    const pname = (productParent?.text || elText).trim();
    return (pname.length > 3) ? `Pricing: ${pname.slice(0, 60).replace(/\b\w/g, c => c.toUpperCase())}` : 'Pricing';
  }
  if (['product_rating', 'review'].includes(cat)) return 'Reviews / Social Proof';
  if (['variant_selector', 'quantity_selector'].includes(cat)) {
    const pname = (productParent?.text || elText).trim();
    return pname.length > 3 ? `Options: ${pname.slice(0, 60).replace(/\b\w/g, c => c.toUpperCase())}` : 'Product Options';
  }
  if (cat === 'stock_status') return 'Stock / Availability';
  if (['product_image', 'product_gallery'].includes(cat)) return 'Product Media';
  if (cat === 'product_description') return 'Product Details';

  // TIER 3: NAV & LAYOUT
  if (['header', 'nav'].includes(cat)) return 'Navigation';
  if (cat === 'footer') return 'Footer';
  if (cat === 'hero') return 'Hero / Banner';
  if (cat === 'banner') return 'Promo Banner';
  if (cat === 'carousel') return 'Carousel / Slider';
  if (['modal', 'drawer'].includes(cat)) return 'Modal / Overlay';
  if (cat === 'breadcrumb') return 'Breadcrumb';
  if (cat === 'pagination') return 'Pagination';
  if (cat === 'search') return 'Search';

  // TIER 4: INTERACTIVE
  if (cat === 'cta') {
    if (/buy|shop|purchase/.test(combined)) return 'Purchase CTA';
    if (/learn|about/.test(combined)) return 'Info CTA';
    if (/subscribe|join/.test(combined)) return 'Subscribe CTA';
    return 'CTA';
  }
  if (cat === 'button') {
    return productParent?.text ? `Button: ${productParent.text.slice(0, 40).replace(/\b\w/g, c => c.toUpperCase())}` : 'Button';
  }
  if (['link', 'nav_link'].includes(cat)) return 'Link';
  if (['filter', 'sort'].includes(cat)) return 'Filter / Sort';

  // TIER 5: CONTENT
  if (cat === 'heading') {
    return elText ? `Heading: ${elText.slice(0, 60).replace(/\b\w/g, c => c.toUpperCase())}` : 'Heading';
  }
  if (['paragraph', 'text'].includes(cat)) {
    return (elText.length > 15) ? `Reading: ${elText.slice(0, 60).replace(/\b\w/g, c => c.toUpperCase())}` : 'Text Content';
  }
  if (['image', 'video', 'icon'].includes(cat)) return 'Media';
  if (['social_link', 'testimonial'].includes(cat)) return 'Social Proof';

  // TIER 6: FORMS
  if (['form', 'input', 'textarea', 'select', 'checkbox', 'radio'].includes(cat)) return 'Form / Input';
  if (['signup_register', 'login_signin', 'subscribe'].includes(cat)) return 'Registration / Auth';
  if (cat === 'form_error') return 'Form Error / Issue';

  // TIER 7: UTILITY
  if (cat === 'badge') return 'Badge / Tag';
  if (cat === 'notification') return 'Notification / Alert';
  if (cat === 'loading') return 'Loading';
  if (cat === 'cookie_banner') return 'Cookie Consent';
  if (cat === 'tooltip') return 'Tooltip';

  // TIER 8: GENERIC
  if (['container', 'list'].includes(cat)) return null;
  if (cat === 'unknown') return (elText.length > 4) ? elText.slice(0, 50).replace(/\b\w/g, c => c.toUpperCase()) : null;

  if (cat) return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (elText.length > 4) return elText.slice(0, 50).replace(/\b\w/g, c => c.toUpperCase());

  return null;
}

/** Classify an ElementInfo directly */
export function classifyElementInfo(el: ElementInfo | null | undefined): string | null {
  if (!el) return null;
  return classifyElement(elementInfoToData(el));
}
