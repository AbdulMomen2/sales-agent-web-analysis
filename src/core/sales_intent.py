from collections import Counter

from src.core.classifier import universal_classify


class SalesIntentSummary:
    def __init__(self):
        self.engagement_score = 0
        self.purchase_intent_proxy = 0
        self.main_focus_area = None
        self.focus_area_counts = Counter()
        self.num_hesitations = 0
        self.max_scroll_y = 0
        self.max_scroll_percent = 0
        self.friction_indicator = 0
        self.total_windows = 0
        self.cta_hover_count = 0
        self.long_hover_count = 0
        self.price_interactions = 0
        self.product_hovers = 0
        self.cart_actions = 0
        self.purchase_ctas_seen = 0

    def update(self, window):
        self.total_windows += 1
        data = window.get("data", {}) if isinstance(window.get("data"), dict) else window

        scroll_y = data.get("scroll_y", 0) or 0
        self.max_scroll_y = max(self.max_scroll_y, scroll_y)

        scroll_pct = data.get("scroll_percent", 0) or 0
        self.max_scroll_percent = max(self.max_scroll_percent, round(float(scroll_pct), 1))

        element = data.get("element") or {}

        focus_area = universal_classify(element, data)
        if focus_area:
            self.focus_area_counts[focus_area] += 1

        hover_dur = data.get("max_hover_duration_ms", 0) or 0
        el_cat = (element.get("category") or element.get("type") or "").lower()
        el_text = (element.get("text") or "").lower()

        has_price = bool(element.get("price"))
        product_parent = element.get("product_parent") or {}
        parent_chain = element.get("parent_chain") or []

        in_product = bool(product_parent) or any(
            (p.get("category") or "").lower() in ("product_card", "product_grid", "product_title", "product_price", "sale_price", "buy_now", "add_to_cart") for p in parent_chain
        )

        if hover_dur > 0:
            if hover_dur > 1000:
                self.long_hover_count += 1
            is_purchase_cat = el_cat in ("add_to_cart", "buy_now", "checkout", "cart", "wishlist_favorites", "cta")
            is_purchase_text = any(k in (el_cat + " " + el_text) for k in ["cart", "buy", "checkout", "purchase", "add to cart", "shop"])
            if is_purchase_cat or is_purchase_text:
                self.cta_hover_count += 1
                self.purchase_ctas_seen += 1

        if has_price or in_product:
            self.product_hovers += 1

        if has_price and el_cat in ("add_to_cart", "buy_now", "checkout", "cart", "product_price", "cta"):
            self.price_interactions += 1

        product_text = product_parent.get("text") or ""
        product_price = product_parent.get("price") or ""
        if product_text and not has_price and product_price:
            self.product_hovers += 1

        actions = data.get("actions", [])
        for action in actions:
            a = action.lower()
            if "buy" in a or "checkout" in a or "cart" in a or "purchase" in a:
                self.cart_actions += 1
            if "price" in a or "shop" in a:
                self.purchase_ctas_seen += 1

        hovered = data.get("hovered_elements", [])
        for h_el in hovered:
            h_cat = (h_el.get("category") or h_el.get("type") or "").lower()
            h_text = (h_el.get("text") or "").lower()
            h_price = h_el.get("price")
            h_product_parent = h_el.get("product_parent") or {}
            h_parent_chain = h_el.get("parent_chain") or []
            h_in_product = bool(h_product_parent) or any(
                (p.get("category") or "").lower() in ("product_card", "product_grid", "product_title", "product_price", "sale_price") for p in h_parent_chain
            )

            if h_price or h_in_product:
                self.product_hovers += 1
            if h_cat in ("add_to_cart", "buy_now", "checkout", "cart", "cta") or any(k in (h_cat + " " + h_text) for k in ["cta", "cart", "buy", "checkout", "shop"]):
                self.cta_hover_count += 1

            h_focus = universal_classify(h_el, {})
            if h_focus and h_focus != focus_area:
                self.focus_area_counts[h_focus] += 1

        clicks = data.get("clicks", [])
        for click in clicks:
            c_el = click.get("element") or {}
            c_cat = (c_el.get("category") or c_el.get("type") or "").lower()
            c_text = (c_el.get("text") or "").lower()
            c_product_parent = c_el.get("product_parent") or {}
            if c_cat in ("add_to_cart", "buy_now", "checkout", "cart", "cta") or any(k in (c_cat + " " + c_text) for k in ["cta", "cart", "buy", "checkout", "shop"]):
                self.cta_hover_count += 2
                self.cart_actions += 1
            if c_product_parent or c_el.get("price"):
                self.product_hovers += 1
                self.price_interactions += 1

            c_focus = universal_classify(c_el, {})
            if c_focus:
                self.focus_area_counts[c_focus] += 2

        if data.get("hesitation"):
            self.num_hesitations += 1

        reading = data.get("reading")
        if reading and reading.get("duration_ms", 0) > 2000:
            self.long_hover_count += 1

        self._recalculate_scores()

    def _recalculate_scores(self):
        if self.total_windows == 0:
            return

        cta_score = min(self.cta_hover_count * 20, 35)
        product_score = min(self.product_hovers * 10, 25)
        long_hover_score = min(self.long_hover_count * 10, 20)
        scroll_score = min(self.max_scroll_percent / 3, 20)

        self.engagement_score = min(round(cta_score + product_score + long_hover_score + scroll_score), 100)

        direct_cta = min(self.cta_hover_count * 12, 40)
        product_presence = min(self.product_hovers * 8, 20)
        cart_actions = min(self.cart_actions * 15, 20)
        price_signal = min(self.price_interactions * 10, 10)
        scroll_bonus = min(self.max_scroll_percent / 10, 10)

        self.purchase_intent_proxy = min(round(direct_cta + product_presence + cart_actions + price_signal + scroll_bonus), 100)

        if self.focus_area_counts:
            self.main_focus_area = self.focus_area_counts.most_common(1)[0][0]

        friction = 0
        if self.num_hesitations > 3:
            friction += min(self.num_hesitations * 8, 30)
        if self.max_scroll_percent < 15 and self.total_windows > 4:
            friction += 15
        if self.engagement_score < 15 and self.total_windows > 4:
            friction += 20
        if self.purchase_intent_proxy > 60 and self.cart_actions == 0 and self.total_windows > 6:
            friction += 15
        self.friction_indicator = min(round(friction), 100)

    def to_dict(self):
        return {
            "engagement_score": self.engagement_score,
            "purchase_intent_proxy": self.purchase_intent_proxy,
            "main_focus_area": self.main_focus_area,
            "num_hesitations": self.num_hesitations,
            "max_scroll_percent": self.max_scroll_percent,
            "friction_indicator": self.friction_indicator,
            "windows_processed": self.total_windows,
        }
