(function() {
    var SCAN_VERSION = 0;
    var OBSERVER = null;
    var CALLBACKS = [];
    var LAST_MAP = null;
    var SCANNING = false;
    var DEBOUNCE_TIMER = null;
    var WS_SENT = false;

    // ==================== COMPREHENSIVE CATEGORY SYSTEM ====================
    var CATEGORIES = [
        // === TIER 1: IMMEDIATE COMMERCE ACTIONS ===
        { id: 'add_to_cart', priority: 100, test: function(t, cls, id, attr, text, parentCats) {
            return /add.?to.?cart|add.?to.?bag|add.?to.?basket/i.test(cls + ' ' + id + ' ' + (attr['aria-label']||'') + ' ' + text);
        }},
        { id: 'buy_now', priority: 99, test: function(t, cls, id, attr, text) {
            return /buy.?now|buy.?it|purchase|order.?now|get.?it/i.test(cls + ' ' + id + ' ' + text + ' ' + (attr['aria-label']||''));
        }},
        { id: 'checkout', priority: 98, test: function(t, cls, id, attr, text) {
            return /checkout|place.?order|proceed.?to.?checkout|continue.?to.?shipping|complete.?order/i.test(cls + ' ' + id + ' ' + text + ' ' + (attr['aria-label']||''));
        }},
        { id: 'cart', priority: 97, test: function(t, cls, id, attr, text) {
            return /cart|shopping.?cart|my.?cart|bag|basket|cart.?icon|mini.?cart|cart.?count/i.test(cls + ' ' + id + ' ' + (attr['aria-label']||'') + ' ' + text);
        }},
        { id: 'signup_register', priority: 96, test: function(t, cls, id, attr, text) {
            return /sign.?up|register|create.?account|join.?now|become.?a.?member|get.?started/i.test(cls + ' ' + id + ' ' + text + ' ' + (attr['aria-label']||''));
        }},
        { id: 'login_signin', priority: 95, test: function(t, cls, id, attr, text) {
            return /log.?in|sign.?in|login|my.?account|account.?login/i.test(cls + ' ' + id + ' ' + text + ' ' + (attr['aria-label']||''));
        }},
        { id: 'subscribe', priority: 94, test: function(t, cls, id, attr, text) {
            return /subscribe|newsletter|get.?updates|stay.?informed|notify.?me/i.test(cls + ' ' + id + ' ' + text + ' ' + (attr['aria-label']||''));
        }},
        { id: 'search', priority: 93, test: function(t, cls, id, attr, text) {
            return (t === 'input' && (/search/i.test(cls + ' ' + id + ' ' + (attr['type']||'') + ' ' + (attr['aria-label']||'')) || /search|find/i.test(text))) ||
                   /search/i.test(cls + ' ' + id) || (attr['role'] === 'search');
        }},
        { id: 'wishlist_favorites', priority: 92, test: function(t, cls, id, attr, text) {
            return /wishlist|favorites|save.?item|saved|my.?favorites|heart.?icon/i.test(cls + ' ' + id + ' ' + (attr['aria-label']||'') + ' ' + text);
        }},

        // === TIER 2: COMMERCE CONTENT ===
        { id: 'product_card', priority: 90, test: function(t, cls, id, attr, text) {
            return /product.?card|product.?tile|product.?item|product.?box|product.?wrap|card.?product|tile.?product|item.?product|prod.?card|prod.?tile|plp.?card/i.test(cls + ' ' + id);
        }},
        { id: 'product_grid', priority: 89, test: function(t, cls, id, attr, text) {
            return /product.?grid|product.?list|product.?row|product.?container|product.?gallery|catalog.?grid|plp.?grid|plp.?list|product.?feed/i.test(cls + ' ' + id);
        }},
        { id: 'product_title', priority: 88, test: function(t, cls, id, attr, text) {
            return /product.?title|product.?name|item.?name|product.?heading|card.?title|product.?label|prod.?title|item.?title|product.?link/i.test(cls + ' ' + id);
        }},
        { id: 'product_price', priority: 87, test: function(t, cls, id, attr, text) {
            return /price|product.?price|item.?price|sale.?price|current.?price|offer.?price|final.?price|total.?price|subtotal/i.test(cls + ' ' + id + ' ' + (attr['aria-label']||'')) ||
                   (t !== 'body' && /^[\$\u00a3\u20ac\u00a5]\s*[\d,]+(?:\.\d{2})?$/.test(text.trim()));
        }},
        { id: 'sale_price', priority: 86, test: function(t, cls, id, attr, text) {
            return /sale.?price|old.?price|was.?price|original.?price|compare.?at|strikethrough|price.?old|price.?was|regular.?price/i.test(cls + ' ' + id);
        }},
        { id: 'discount_badge', priority: 85, test: function(t, cls, id, attr, text) {
            return /discount|off|percent.?off|save|sale.?tag|deal|offer.?badge|promo.?badge/i.test(cls + ' ' + id + ' ' + text);
        }},
        { id: 'product_image', priority: 84, test: function(t, cls, id, attr, text) {
            return t === 'img' && (/product.?img|product.?photo|prod.?img|item.?img|card.?img|thumbnail|product.?image/i.test(cls + ' ' + id + ' ' + (attr['aria-label']||'')));
        }},
        { id: 'product_gallery', priority: 83, test: function(t, cls, id, attr) {
            return /product.?gallery|image.?gallery|prod.?gallery|product.?slider|image.?slider|main.?image|product.?carousel/i.test(cls + ' ' + id);
        }},
        { id: 'product_rating', priority: 82, test: function(t, cls, id, attr, text) {
            return /rating|review.?star|star.?rating|stars|product.?rating|review.?score|customer.?rating/i.test(cls + ' ' + id + ' ' + text);
        }},
        { id: 'review', priority: 81, test: function(t, cls, id, attr, text) {
            return /review|customer.?review|user.?review|testimonial|review.?card|review.?item/i.test(cls + ' ' + id);
        }},
        { id: 'variant_selector', priority: 80, test: function(t, cls, id, attr, text) {
            return /variant|swatch|color.?swatch|color.?picker|size.?picker|size.?option|option.?selector|product.?option/i.test(cls + ' ' + id);
        }},
        { id: 'quantity_selector', priority: 79, test: function(t, cls, id, attr, text) {
            return /quantity|qty|quantity.?selector|qty.?selector|quantity.?input|stepper/i.test(cls + ' ' + id + ' ' + (attr['aria-label']||''));
        }},
        { id: 'stock_status', priority: 78, test: function(t, cls, id, attr, text) {
            return /in.?stock|out.?of.?stock|availability|stock.?status|sold.?out|low.?stock|only.?\d+\/?/i.test(cls + ' ' + id + ' ' + text);
        }},
        { id: 'product_description', priority: 77, test: function(t, cls, id, attr, text) {
            return /product.?desc|item.?desc|description|product.?details|details|about.?this.?item/i.test(cls + ' ' + id);
        }},

        // === TIER 3: NAVIGATION & LAYOUT ===
        { id: 'header', priority: 75, test: function(t, cls, id) {
            return t === 'header' || /header|topbar|top.?bar|site.?header|header.?inner|sticky.?header/i.test(cls + ' ' + id);
        }},
        { id: 'nav', priority: 74, test: function(t, cls, id) {
            return t === 'nav' || /nav|menu|navbar|navigation|nav.?menu|primary.?nav|main.?nav|nav.?bar|menu.?bar/i.test(cls + ' ' + id) ||
                   attr['role'] === 'navigation';
        }},
        { id: 'nav_link', priority: 73, test: function(t, cls, id, attr) {
            return t === 'a' && (/nav.?link|menu.?link|nav.?item|menu.?item|nav.?a|header.?link/i.test(cls + ' ' + id));
        }},
        { id: 'breadcrumb', priority: 72, test: function(t, cls, id) {
            return /breadcrumb|bread.?crumb|breadcrumbs|crumb/i.test(cls + ' ' + id);
        }},
        { id: 'pagination', priority: 71, test: function(t, cls, id) {
            return /pagination|page.?number|page.?link|pager|next.?page|prev.?page|page.?item/i.test(cls + ' ' + id);
        }},
        { id: 'footer', priority: 70, test: function(t, cls, id) {
            return t === 'footer' || /footer|site.?footer|footer.?inner|footer.?content|bottom|footer.?section/i.test(cls + ' ' + id);
        }},
        { id: 'hero', priority: 69, test: function(t, cls, id) {
            return /hero|hero.?section|hero.?banner|hero.?image|jumbotron|cover|masthead/i.test(cls + ' ' + id);
        }},
        { id: 'banner', priority: 68, test: function(t, cls, id) {
            return /banner|promo.?banner|top.?banner|announcement.?bar|promo.?bar/i.test(cls + ' ' + id);
        }},
        { id: 'carousel', priority: 67, test: function(t, cls, id) {
            return /carousel|slider|slideshow|swiper|slick|glide|flickity/i.test(cls + ' ' + id);
        }},
        { id: 'modal', priority: 66, test: function(t, cls, id, attr) {
            return /modal|dialog|popup|pop.?up|lightbox|modal.?content|modal.?dialog|overlay/i.test(cls + ' ' + id) ||
                   attr['role'] === 'dialog' || attr['aria-modal'] === 'true';
        }},
        { id: 'drawer', priority: 65, test: function(t, cls, id) {
            return /drawer|side.?panel|side.?bar|slide.?out|off.?canvas|side.?drawer/i.test(cls + ' ' + id);
        }},

        // === TIER 4: INTERACTIVE ===
        { id: 'button', priority: 60, test: function(t, cls, id, attr) {
            return t === 'button' || attr['role'] === 'button' || /btn|button/i.test(cls + ' ' + id);
        }},
        { id: 'cta', priority: 59, test: function(t, cls, id, attr, text) {
            var combined = cls + ' ' + id + ' ' + text + ' ' + (attr['aria-label']||'') + ' ' + (attr['href']||'');
            return /cta|call.?to.?action|shop.?now|learn.?more|get.?started|try.?free|book.?now|shop.?all|view.?all|see.?more|read.?more/i.test(combined);
        }},
        { id: 'link', priority: 58, test: function(t, cls, id, attr) {
            return t === 'a' && !!attr['href'] && attr['href'] !== '#';
        }},
        { id: 'filter', priority: 57, test: function(t, cls, id, attr) {
            return /filter|refine|sort.?by|sort|facet/i.test(cls + ' ' + id);
        }},
        { id: 'sort', priority: 56, test: function(t, cls, id, attr) {
            return /sort.?by|sort.?select|sort.?option|order.?by|sort/i.test(cls + ' ' + id);
        }},

        // === TIER 5: CONTENT ===
        { id: 'heading', priority: 50, test: function(t) {
            return /^h[1-6]$/.test(t);
        }},
        { id: 'paragraph', priority: 49, test: function(t) {
            return t === 'p';
        }},
        { id: 'image', priority: 48, test: function(t, cls, id, attr) {
            return t === 'img' || t === 'picture' || t === 'figure' || (t === 'div' && /hero.?img|banner.?img|bg.?image|background.?image/i.test(cls + ' ' + id));
        }},
        { id: 'video', priority: 47, test: function(t, cls, id) {
            return t === 'video' || /video|player|video.?player/i.test(cls + ' ' + id);
        }},
        { id: 'icon', priority: 46, test: function(t, cls, id, attr) {
            return t === 'svg' || t === 'i' || /icon|svg|ico|material.?icon|font.?awesome|fa[-_]/.test(cls + ' ' + id) ||
                   (t === 'span' && /icon/i.test(cls + ' ' + id));
        }},
        { id: 'social_link', priority: 45, test: function(t, cls, id, attr, text) {
            return /social|facebook|twitter|instagram|linkedin|youtube|tiktok|pinterest|snapchat/i.test(cls + ' ' + id + ' ' + (attr['href']||''));
        }},
        { id: 'testimonial', priority: 44, test: function(t, cls, id, attr, text) {
            return /testimonial|quote|customer.?story|success.?story/i.test(cls + ' ' + id);
        }},

        // === TIER 6: FORMS ===
        { id: 'form', priority: 40, test: function(t, cls, id) {
            return t === 'form' || /form/i.test(cls + ' ' + id);
        }},
        { id: 'input', priority: 39, test: function(t, cls, id, attr) {
            return t === 'input' && attr['type'] !== 'hidden' && attr['type'] !== 'submit' && attr['type'] !== 'checkbox' && attr['type'] !== 'radio';
        }},
        { id: 'textarea', priority: 38, test: function(t) { return t === 'textarea'; }},
        { id: 'select', priority: 37, test: function(t) { return t === 'select'; }},
        { id: 'checkbox', priority: 36, test: function(t, cls, id, attr) {
            return (t === 'input' && attr['type'] === 'checkbox') || /checkbox/i.test(cls + ' ' + id);
        }},
        { id: 'radio', priority: 35, test: function(t, cls, id, attr) {
            return (t === 'input' && attr['type'] === 'radio') || /radio/i.test(cls + ' ' + id);
        }},
        { id: 'form_label', priority: 34, test: function(t, cls, id) {
            return t === 'label' || /label/i.test(cls + ' ' + id);
        }},
        { id: 'form_error', priority: 33, test: function(t, cls, id, attr, text) {
            return /error|invalid|validation|error.?msg|error.?text|has.?error|form.?error/i.test(cls + ' ' + id + ' ' + text);
        }},

        // === TIER 7: UTILITY ===
        { id: 'badge', priority: 30, test: function(t, cls, id, attr, text) {
            return /badge|tag|label|pill|chip|count|notification.?count|new.?badge|sale.?badge|exclusive|just.?in|limited/i.test(cls + ' ' + id + ' ' + text);
        }},
        { id: 'tooltip', priority: 29, test: function(t, cls, id, attr) {
            return /tooltip|hover.?info|info.?icon|help.?text/i.test(cls + ' ' + id) || attr['aria-describedby'] || (attr['role'] === 'tooltip');
        }},
        { id: 'notification', priority: 28, test: function(t, cls, id, attr, text) {
            return /notification|toast|alert|flash|notice|message.?bar|alert.?bar|alert.?msg|success.?msg|error.?msg|info.?msg|warning/i.test(cls + ' ' + id + ' ' + text);
        }},
        { id: 'loading', priority: 27, test: function(t, cls, id, attr) {
            return /loading|spinner|skeleton|placeholder|loader|progress|waiting|busy/i.test(cls + ' ' + id) || attr['aria-busy'] === 'true';
        }},
        { id: 'accordion', priority: 26, test: function(t, cls, id) {
            return /accordion|collapse|expand|toggle/i.test(cls + ' ' + id);
        }},
        { id: 'tab', priority: 25, test: function(t, cls, id, attr) {
            return /tab|tab.?panel|tab.?list|tab.?item/i.test(cls + ' ' + id) || attr['role'] === 'tab' || attr['role'] === 'tabpanel';
        }},
        { id: 'cookie_banner', priority: 24, test: function(t, cls, id, attr, text) {
            return /cookie|consent|gdpr|cookie.?notice|cookie.?banner|cookie.?consent/i.test(cls + ' ' + id + ' ' + text);
        }},
        { id: 'progress', priority: 23, test: function(t, cls, id, attr) {
            return /progress|step|stepper|progress.?bar|progress.?step|checkout.?step/i.test(cls + ' ' + id) ||
                   attr['role'] === 'progressbar' || t === 'progress';
        }},

        // === TIER 8: GENERIC ===
        { id: 'container', priority: 10, test: function(t) { return t === 'div' || t === 'section' || t === 'article'; }},
        { id: 'list', priority: 9, test: function(t) { return t === 'ul' || t === 'ol' || t === 'li' || t === 'dl' || t === 'dt' || t === 'dd'; }},
        { id: 'table', priority: 8, test: function(t) { return t === 'table' || t === 'tr' || t === 'td' || t === 'th' || t === 'thead' || t === 'tbody' || t === 'tfoot'; }},
        { id: 'text', priority: 7, test: function(t) { return t === 'span' || t === 'p' || t === 'strong' || t === 'em' || t === 'b' || t === 'i' || t === 'u' || t === 'small'; }},
        { id: 'heading_text', priority: 6, test: function(t) { return /^h[1-6]$/.test(t); }},
    ];

    // ==================== CLASSIFICATION ENGINE ====================
    function classifyElement(el) {
        if (!el || el.nodeType !== 1) return { id: 'unknown', priority: 0 };

        var tag = el.tagName.toLowerCase();
        var cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
        var id = (el.id || '').toLowerCase();
        var text = ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '')).replace(/\s+/g, ' ').trim().slice(0, 120);
        var href = (el.getAttribute('href') || '').toLowerCase();

        var attr = {};
        for (var i = 0; i < el.attributes.length; i++) {
            var a = el.attributes[i];
            attr[a.name.toLowerCase()] = a.value;
        }

        var best = { id: 'unknown', priority: 0 };

        for (var i = 0; i < CATEGORIES.length; i++) {
            var cat = CATEGORIES[i];
            try {
                if (cat.test(tag, cls, id, attr, text)) {
                    if (cat.priority > best.priority) {
                        best = { id: cat.id, priority: cat.priority };
                    }
                }
            } catch(e) {}
        }

        if (tag === 'body') best = { id: 'body', priority: 1 };
        if (tag === 'html') best = { id: 'html', priority: 1 };

        return best;
    }

    // ==================== PRICE EXTRACTION ====================
    function extractPrice(text) {
        if (!text) return null;
        var m = text.match(/[\$\u00a3\u20ac\u00a5]\s*[\d,]+(?:\.\d{2})?/);
        if (m) return m[0];
        m = text.match(/[\d,]+(?:\.\d{2})?\s*(?:USD|EUR|GBP)/i);
        return m ? m[0] : null;
    }

    // ==================== ROBUST PARENT CHAIN ====================
    function buildParentChain(el, maxDepth) {
        if (maxDepth === void 0) maxDepth = 8;
        if (!el || el.nodeType !== 1) return { chain: [], target: null, product_parent: null, section_parent: null };

        var targetInfo = analyzeElement(el);
        var chain = [];
        var current = el.parentElement;
        var depth = 0;

        var productParent = null;
        var sectionParent = null;
        var navParent = null;
        var formParent = null;

        while (current && current.nodeType === 1 && depth < maxDepth) {
            var info = analyzeElement(current);
            info.depth = depth + 1;
            chain.push(info);

            var cat = info.category;
            if (!productParent && (cat === 'product_card' || cat === 'product_grid')) {
                productParent = info;
            }
            if (!sectionParent && (cat === 'hero' || cat === 'banner' || cat === 'carousel' || current.tagName === 'SECTION' || current.tagName === 'MAIN' || current.tagName === 'ARTICLE')) {
                sectionParent = info;
            }
            if (!navParent && (cat === 'nav' || cat === 'header' || cat === 'footer')) {
                navParent = info;
            }
            if (!formParent && (cat === 'form')) {
                formParent = info;
            }

            if (current.tagName === 'BODY' || current.tagName === 'HTML') break;
            current = current.parentElement;
            depth++;
        }

        // === SCAN SIBLINGS FOR PRODUCT CONTEXT ===
        // If the element is a price, variant, or add-to-cart button, scan siblings for product name
        if (!productParent && el.parentElement) {
            var targetCat = targetInfo.category;
            if (targetCat === 'product_price' || targetCat === 'sale_price' || targetCat === 'variant_selector' || targetCat === 'quantity_selector' || targetCat === 'add_to_cart' || targetCat === 'buy_now') {
                productParent = scanSiblingsForProduct(el.parentElement, el);
            }
        }

        return {
            chain: chain,
            target: targetInfo,
            product_parent: productParent,
            section_parent: sectionParent,
            nav_parent: navParent,
            form_parent: formParent,
        };
    }

    function scanSiblingsForProduct(container, excludeEl) {
        // Look through all children of the container for product name/title elements
        var children = container.children;
        var best = null;
        var bestScore = 0;

        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (child === excludeEl) continue;
            var info = analyzeElement(child);
            var cat = info.category;

            if (cat === 'product_title') {
                if (info.confidence > bestScore) {
                    bestScore = info.confidence;
                    best = info;
                }
            }
            // Also check text content — if it looks like a product name
            if (info.text && info.text.length > 5 && info.text.length < 120) {
                var textLower = info.text.toLowerCase();
                if (!/price|sale|add to cart|buy|shop|$|%|\d{5,}/.test(textLower) && info.text.length > 10) {
                    var score = 30 + Math.min(info.text.length, 40);
                    if (score > bestScore) {
                        bestScore = score;
                        best = info;
                    }
                }
            }
        }

        // If no product found among siblings, scan the container itself
        if (!best) {
            var containerInfo = analyzeElement(container);
            if (containerInfo.category === 'product_card' || containerInfo.category === 'product_grid') {
                best = containerInfo;
            } else {
                // Container's text might have product info
                var containerText = (container.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
                var price = extractPrice(containerText);
                if (price) {
                    var namePart = containerText.replace(price, '').trim().slice(0, 80);
                    if (namePart.length > 5) {
                        best = { category: 'product_context', text: namePart, price: price, confidence: 40 };
                    }
                }
            }
        }

        return best;
    }

    // ==================== ELEMENT ANALYSIS ====================
    function analyzeElement(el) {
        if (!el || el.nodeType !== 1) return null;

        var tag = el.tagName.toLowerCase();
        var cls = (el.className && typeof el.className === 'string') ? el.className : '';
        var id = (el.id || '');
        var text = ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '')).replace(/\s+/g, ' ').trim().slice(0, 120);
        var href = (el.getAttribute('href') || '').toLowerCase();

        var classification = classifyElement(el);

        var price = null;
        var priceMatch = text.match(/[\$\u00a3\u20ac\u00a5]\s*[\d,]+(?:\.\d{2})?/);
        if (priceMatch) price = priceMatch[0];
        if (!price) {
            priceMatch = text.match(/[\d,]+(?:\.\d{2})?\s*(?:USD|EUR|GBP)/i);
            if (priceMatch) price = priceMatch[0];
        }

        var classes = cls.split(/\s+/).filter(function(c) { return c && !/^el_/.test(c); });

        return {
            tag: tag,
            id: id || null,
            classes: classes.slice(0, 4).join(' ') || null,
            category: classification.id,
            priority: classification.priority,
            text: text.slice(0, 80) || null,
            href: href || null,
            price: price,
            selector: buildSimpleSelector(el, 3),
        };
    }

    function buildSimpleSelector(el, maxDepth) {
        if (maxDepth === void 0) maxDepth = 4;
        if (!el || el.nodeType !== 1) return '';
        if (el.id) return '#' + el.id;
        var path = [];
        var c = el;
        for (var i = 0; i < maxDepth && c && c.nodeType === 1; i++) {
            var t = c.tagName.toLowerCase();
            var cl = '';
            if (c.className && typeof c.className === 'string') {
                var parts = c.className.trim().split(/\s+/).filter(function(x) { return x && !/^el_/.test(x) && x !== 'active' && x !== 'selected'; });
                if (parts.length > 0) cl = '.' + parts[0];
            }
            path.unshift(t + cl);
            if (t === 'body' || t === 'html') break;
            c = c.parentElement;
        }
        return path.join(' > ');
    }

    // ==================== SCAN DOM ====================
    function scanDOM() {
        if (SCANNING) return;
        SCANNING = true;

        var all = document.querySelectorAll('*');
        var elements = [];
        var byCategory = {};
        var spatialIndex = {};
        var GRID_SIZE = 50;

        var pageW = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
        var pageH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, document.body.offsetHeight, document.documentElement.offsetHeight);

        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el.nodeType !== 1) continue;

            var tag = el.tagName.toLowerCase();
            if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'noscript') continue;

            var rect = el.getBoundingClientRect();
            if (!rect || rect.width === 0 || rect.height === 0) continue;
            if (rect.width < 3 && rect.height < 3) continue;
            if (rect.width > pageW * 0.98 && rect.height > pageH * 0.98 && tag !== 'body') continue;

            var docX = Math.round(rect.left + window.scrollX);
            var docY = Math.round(rect.top + window.scrollY);
            var w = Math.round(rect.width);
            var h = Math.round(rect.height);

            var analysis = analyzeElement(el);
            var parentData = buildParentChain(el);

            var entry = {
                id: el.id || undefined,
                tag: tag,
                selector: analysis.selector,
                category: analysis.category,
                priority: analysis.priority,
                text: analysis.text,
                href: analysis.href || undefined,
                price: analysis.price || undefined,
                section: parentData.section_parent ? parentData.section_parent.category : undefined,
                product_parent: parentData.product_parent ? {
                    category: parentData.product_parent.category,
                    text: parentData.product_parent.text,
                    price: parentData.product_parent.price,
                    selector: parentData.product_parent.selector,
                } : undefined,
                rect: {
                    x: docX, y: docY, w: w, h: h,
                    cx: Math.round(docX + w / 2),
                    cy: Math.round(docY + h / 2),
                },
                area: w * h,
            };

            elements.push(entry);

            if (!byCategory[analysis.category]) byCategory[analysis.category] = [];
            byCategory[analysis.category].push(entry);

            var gx1 = Math.floor(docX / GRID_SIZE);
            var gy1 = Math.floor(docY / GRID_SIZE);
            var gx2 = Math.floor((docX + w) / GRID_SIZE);
            var gy2 = Math.floor((docY + h) / GRID_SIZE);
            for (var gx = gx1; gx <= gx2; gx++) {
                for (var gy = gy1; gy <= gy2; gy++) {
                    var key = gx + ',' + gy;
                    if (!spatialIndex[key]) spatialIndex[key] = [];
                    spatialIndex[key].push({ idx: elements.length - 1, area: w * h });
                }
            }
        }

        byCategory._layout = [];
        var layoutOrder = ['header','nav','hero','banner','carousel','search','product_grid','product_card','product_title','product_price','add_to_cart','buy_now','cart','checkout','wishlist_favorites','badge','filter','sort','pagination','footer','cookie_banner','modal','drawer'];
        for (var li = 0; li < layoutOrder.length; li++) {
            if (byCategory[layoutOrder[li]]) {
                byCategory._layout.push({ category: layoutOrder[li], count: byCategory[layoutOrder[li]].length });
            }
        }
        for (var cat in byCategory) {
            if (cat === '_layout' || cat === '_counts' || !Array.isArray(byCategory[cat])) continue;
            var found = false;
            for (var li = 0; li < layoutOrder.length; li++) {
                if (layoutOrder[li] === cat) { found = true; break; }
            }
            if (!found) {
                byCategory._layout.push({ category: cat, count: byCategory[cat].length });
            }
        }

        byCategory._counts = {};
        for (var cat in byCategory) {
            if (cat !== '_layout' && cat !== '_counts' && Array.isArray(byCategory[cat])) {
                byCategory._counts[cat] = byCategory[cat].length;
            }
        }

        var map = {
            url: window.location.href,
            title: document.title,
            version: ++SCAN_VERSION,
            scanned_at: Date.now(),
            viewport: { w: window.innerWidth, h: window.innerHeight },
            page: { w: pageW, h: pageH },
            scroll: { x: window.scrollX, y: window.scrollY },
            total: elements.length,
            categories: byCategory._counts,
            total_categories: Object.keys(byCategory._counts).length,
            elements: elements,
            by_category: byCategory,
            spatial: spatialIndex,
        };

        LAST_MAP = map;
        SCANNING = false;

        CALLBACKS.forEach(function(fn) { fn(map); });
        CALLBACKS = [];

        return map;
    }

    // ==================== FIND AT POSITION ====================
    function findAt(x, y, scrollY) {
        if (!LAST_MAP) return null;
        var docY = y + (scrollY || 0);
        var GRID_SIZE = 50;
        var gx = Math.floor(x / GRID_SIZE);
        var gy = Math.floor(docY / GRID_SIZE);
        var key = gx + ',' + gy;
        var cells = LAST_MAP.spatial;

        var candidateKeys = [key, (gx-1)+','+gy, (gx+1)+','+gy, gx+','+(gy-1), gx+','+(gy+1)];
        var candidates = [];
        for (var ki = 0; ki < candidateKeys.length; ki++) {
            if (cells[candidateKeys[ki]]) candidates = candidates.concat(cells[candidateKeys[ki]]);
        }

        if (candidates.length === 0) {
            for (var k in cells) {
                candidates = candidates.concat(cells[k]);
                if (candidates.length >= 10) break;
            }
        }

        var matches = [];
        var seen = {};
        for (var ci = 0; ci < candidates.length; ci++) {
            var idx = candidates[ci].idx;
            if (seen[idx]) continue;
            seen[idx] = true;
            var el = LAST_MAP.elements[idx];
            if (!el) continue;
            var r = el.rect;
            if (x >= r.x && x <= r.x + r.w && docY >= r.y && docY <= r.y + r.h) {
                matches.push(el);
            }
        }

        matches.sort(function(a, b) {
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.area - b.area;
        });
        return matches.length > 0 ? matches[0] : null;
    }

    // ==================== PUBLIC API ====================
    function getMap(callback) {
        if (LAST_MAP) { callback(LAST_MAP); return; }
        CALLBACKS.push(callback);
        if (!SCANNING) scanDOM();
    }

    function sendMapToServer() {
        if (!LAST_MAP || WS_SENT) return;
        WS_SENT = true;
        if (window._opencode && typeof window._opencode.sendMap === 'function') {
            var payload = JSON.stringify({
                type: 'element_map',
                token: window._agencyToken || 'anonymous',
                timestamp: Date.now(),
                data: {
                    url: LAST_MAP.url,
                    title: LAST_MAP.title,
                    viewport: LAST_MAP.viewport,
                    page: LAST_MAP.page,
                    total: LAST_MAP.total,
                    categories: LAST_MAP.categories,
                    total_categories: LAST_MAP.total_categories,
                    elements: LAST_MAP.elements.map(function(e) {
                        return {
                            tag: e.tag,
                            category: e.category,
                            priority: e.priority,
                            text: e.text,
                            href: e.href,
                            price: e.price,
                            section: e.section,
                            product_parent: e.product_parent,
                            selector: e.selector,
                            rect: e.rect,
                        };
                    }),
                }
            });
            window._opencode.sendMap(payload);
        }
    }

    function scheduleScan() {
        if (DEBOUNCE_TIMER) clearTimeout(DEBOUNCE_TIMER);
        DEBOUNCE_TIMER = setTimeout(function() {
            if (SCANNING) return;
            scanDOM();
            sendMapToServer();
        }, 800);
    }

    // ==================== INIT ====================
    if (window._opencode && !window._opencode._elementMapInstalled) {
        window._opencode._elementMapInstalled = true;
        window._opencode.categories = CATEGORIES;
        window._opencode.classifyElement = classifyElement;
        window._opencode.analyzeElement = analyzeElement;
        window._opencode.buildParentChain = buildParentChain;
        window._opencode.extractPrice = extractPrice;
        window._opencode.scanSiblingsForProduct = scanSiblingsForProduct;
        window._opencode.elementMap = {
            scan: scanDOM,
            getMap: getMap,
            findAt: findAt,
            export: function() { return LAST_MAP ? JSON.stringify(LAST_MAP, null, 2) : null; },
            getByCategory: function(cat) { return LAST_MAP && LAST_MAP.by_category ? LAST_MAP.by_category[cat] || [] : []; },
            getCategories: function() { return LAST_MAP && LAST_MAP.categories ? LAST_MAP.categories : {}; },
            getLayout: function() { return LAST_MAP && LAST_MAP.by_category ? LAST_MAP.by_category._layout || [] : []; },
            lastMap: function() { return LAST_MAP; },
        };
    }

    function init() {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(function() { scanDOM(); sendMapToServer(); }, 300);
        } else {
            document.addEventListener('DOMContentLoaded', function() {
                setTimeout(function() { scanDOM(); sendMapToServer(); }, 300);
            });
        }

        if (window.MutationObserver) {
            OBSERVER = new MutationObserver(function(mutations) {
                var shouldRescan = false;
                for (var i = 0; i < mutations.length; i++) {
                    var m = mutations[i];
                    if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
                        for (var j = 0; j < m.addedNodes.length; j++) {
                            if (m.addedNodes[j].nodeType === 1) { shouldRescan = true; break; }
                        }
                        if (!shouldRescan) {
                            for (var j = 0; j < m.removedNodes.length; j++) {
                                if (m.removedNodes[j].nodeType === 1) { shouldRescan = true; break; }
                            }
                        }
                    }
                    if (shouldRescan) break;
                }
                if (shouldRescan && !SCANNING) {
                    WS_SENT = false;
                    scheduleScan();
                }
            });
            OBSERVER.observe(document.body || document.documentElement, {
                childList: true, subtree: true, attributes: false,
            });
        }

        window.addEventListener('popstate', function() {
            WS_SENT = false;
            setTimeout(function() { scanDOM(); sendMapToServer(); }, 500);
        });
    }

    if (typeof window !== 'undefined') {
        if (!window._opencode) window._opencode = {};
        init();
    }

    console.log('%c[Element Map] 64-category system active — window._opencode.analyzeElement(el)', 'color: #ffaa00; font-weight: bold');
})();
