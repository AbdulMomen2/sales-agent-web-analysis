def universal_classify(element, data=None):
    if not element:
        return None

    cat = (element.get("category") or element.get("type") or "").lower()
    el_text = (element.get("text") or "").lower()
    el_section = (element.get("section") or "").lower()
    has_price = bool(element.get("price"))
    product_parent = element.get("product_parent") or {}
    parent_chain = element.get("parent_chain") or []

    if not product_parent and parent_chain:
        for p in parent_chain:
            pc = (p.get("category") or "").lower()
            if pc in ("product_card", "product_grid", "product_title", "product_price", "sale_price"):
                product_parent = p
                break

    combined = f"{cat} {el_text} {el_section}"

    # TIER 1: COMMERCE ACTIONS
    if cat in ("add_to_cart", "buy_now"):
        if product_parent:
            pname = product_parent.get("text", "") or el_text
            return f"Purchase: {pname[:60].title()}" if len(pname) > 3 else "Purchase Intent"
        return "Purchase Intent"
    if cat == "checkout":
        return "Checkout"
    if cat == "cart":
        return "Cart / Bag"

    # TIER 2: COMMERCE CONTENT
    if cat in ("product_card", "product_grid"):
        if product_parent:
            pname = product_parent.get("text", "") or el_text
            if pname and len(pname) > 3:
                return f"Product Card: {pname[:60].title()}"
        return "Product Card"
    if cat in ("product_title",):
        return f"Product Title: {el_text[:60].title()}" if el_text else "Product Title"
    if cat in ("product_price", "sale_price", "discount_badge"):
        if product_parent:
            pname = product_parent.get("text", "") or el_text
            if pname and len(pname) > 3:
                return f"Pricing: {pname[:60].title()}"
        return "Pricing"
    if cat in ("product_rating", "review"):
        return "Reviews / Social Proof"
    if cat in ("variant_selector", "quantity_selector"):
        if product_parent:
            pname = product_parent.get("text", "") or el_text
            return f"Options: {pname[:60].title()}" if len(pname) > 3 else "Product Options"
        return "Product Options"
    if cat in ("stock_status",):
        return "Stock / Availability"
    if cat in ("product_image", "product_gallery"):
        return "Product Media"
    if cat in ("product_description",):
        return "Product Details"

    # TIER 3: NAV & LAYOUT
    if cat in ("header", "nav"):
        return "Navigation"
    if cat == "footer":
        return "Footer"
    if cat == "hero":
        return "Hero / Banner"
    if cat == "banner":
        return "Promo Banner"
    if cat == "carousel":
        return "Carousel / Slider"
    if cat in ("modal", "drawer"):
        return "Modal / Overlay"
    if cat == "breadcrumb":
        return "Breadcrumb"
    if cat in ("pagination",):
        return "Pagination"
    if cat in ("search",):
        return "Search"

    # TIER 4: INTERACTIVE
    if cat == "cta":
        if "buy" in combined or "shop" in combined or "purchase" in combined:
            return "Purchase CTA"
        if "learn" in combined or "about" in combined:
            return "Info CTA"
        if "subscribe" in combined or "join" in combined:
            return "Subscribe CTA"
        return "CTA"
    if cat in ("button",):
        if product_parent:
            return f"Button: {product_parent.get('text', '')[:40].title()}" if product_parent.get('text') else "Button"
        return "Button"
    if cat in ("link", "nav_link"):
        return "Link"
    if cat in ("filter", "sort"):
        return "Filter / Sort"

    # TIER 5: CONTENT
    if cat in ("heading",):
        return f"Heading: {el_text[:60].title()}" if el_text else "Heading"
    if cat in ("paragraph", "text"):
        if el_text and len(el_text) > 15:
            return f"Reading: {el_text[:60].title()}"
        return "Text Content"
    if cat in ("image", "video", "icon"):
        return "Media"
    if cat in ("social_link", "testimonial"):
        return "Social Proof"

    # TIER 6: FORMS
    if cat in ("form", "input", "textarea", "select", "checkbox", "radio"):
        return "Form / Input"
    if cat in ("signup_register", "login_signin", "subscribe"):
        return "Registration / Auth"
    if cat in ("form_error",):
        return "Form Error / Issue"

    # TIER 7: UTILITY
    if cat == "badge":
        return "Badge / Tag"
    if cat == "notification":
        return "Notification / Alert"
    if cat == "loading":
        return "Loading"
    if cat == "cookie_banner":
        return "Cookie Consent"
    if cat == "tooltip":
        return "Tooltip"

    # TIER 8: GENERIC
    if cat in ("container", "list"):
        return None
    if cat == "unknown":
        if el_text and len(el_text) > 4:
            return el_text[:50].title()
        return None

    if cat:
        return cat.replace('_', ' ').title()

    if el_text and len(el_text) > 4:
        return el_text[:50].title()

    return None
