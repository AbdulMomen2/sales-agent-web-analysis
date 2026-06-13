(function() {
    var token = window._agencyToken || 'anonymous';
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws = new WebSocket(protocol + '//' + window.location.host + '/ws/track?token=' + token);

    var mapSent = false;

    if (window._opencode) {
        window._opencode.sendMap = function(payload) {
            if (ws.readyState === WebSocket.OPEN) ws.send(payload);
        };
    }

    ws.addEventListener('open', function() {
        if (!mapSent && window._opencode && window._opencode.elementMap) {
            var mapFn = window._opencode.elementMap.lastMap || window._opencode.elementMap.export;
            var map = mapFn ? mapFn() : null;
            if (map && typeof map === 'object' && !mapSent) {
                mapSent = true;
                var src = map.elements ? map : (window._opencode.elementMap.export ? JSON.parse(window._opencode.elementMap.export()) : map);
                var els = src.elements || [];
                var payload = JSON.stringify({
                    type: 'element_map',
                    token: token, timestamp: Date.now(),
                    data: { elements: els, total: els.length, categories: src.categories || {}, url: src.url }
                });
                ws.send(payload);
            }
        }
    });

    var WINDOW_MS = 500;

    var buffer = {
        events: [],
        hesitations: [],
        lastHoverStart: null,
        lastHoverEl: null,
        lastHoverFP: null,
        distancePx: 0,
        lastX: 0, lastY: 0,
        lastMoveTime: 0,
        scrollY: 0,
        cursorX: 0, cursorY: 0,
        currentEl: null,
        currentFP: null,
        hoverDurations: [],
        clicks: [],
        inputType: 'unknown',
        readingStart: null,
        readingPos: null,
        isReading: false,
    };

    // ==================== USE SHARED CLASSIFICATION SYSTEM ====================
    function getClassifier() {
        return window._opencode;
    }

    function classifyWithSystem(el) {
        var api = getClassifier();
        if (api && api.analyzeElement) return api.analyzeElement(el);
        if (api && api.classifyElement) {
            var cat = api.classifyElement(el);
            return { tag: el.tagName.toLowerCase(), category: cat.id, priority: cat.priority, text: '', price: null };
        }
        // Fallback if element-map.js not loaded
        return fallbackAnalyze(el);
    }

    function buildChainWithSystem(el) {
        var api = getClassifier();
        if (api && api.buildParentChain) return api.buildParentChain(el);
        return fallbackChain(el);
    }

    function scanSiblingsForProductWithSystem(container, exclude) {
        var api = getClassifier();
        if (api && api.scanSiblingsForProduct) return api.scanSiblingsForProduct(container, exclude);
        return null;
    }

    // ==================== FALLBACK (when element-map.js not loaded) ====================
    var FALLBACK_CATEGORIES = {
        add_to_cart: /add.?to.?cart|add.?to.?bag/i,
        buy_now: /buy.?now|purchase|order.?now/i,
        checkout: /checkout|place.?order/i,
        cart: /cart|bag|basket/i,
        search: /search|find/i,
        product_card: /product.?card|product.?tile|card|tile/i,
        product_grid: /product.?grid|product.?list|gallery|catalog/i,
        product_title: /product.?title|product.?name|card.?title/i,
        product_price: /price|sale/i,
        button: /btn|button/i,
        cta: /cta|shop.?now|learn.?more|get.?started/i,
        nav: /nav|menu|navbar/i,
        header: /header|topbar/i,
        footer: /footer/i,
        hero: /hero|banner|jumbotron/i,
        modal: /modal|dialog|popup/i,
        badge: /badge|tag|label|pill/i,
        rating: /rating|review|star/i,
        variant: /variant|swatch|color|size/i,
        form: /form|input|select|textarea/i,
        image: /img|picture|figure/i,
        heading: /^h[1-6]$/,
    };

    function fallbackClassify(el) {
        if (!el || el.nodeType !== 1) return { id: 'unknown', priority: 0 };
        var tag = el.tagName.toLowerCase();
        var cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
        var id = (el.id || '').toLowerCase();
        var text = (el.innerText || '').toLowerCase().slice(0, 60);
        var combined = cls + ' ' + id + ' ' + text;

        for (var key in FALLBACK_CATEGORIES) {
            if (FALLBACK_CATEGORIES[key].test(combined) || FALLBACK_CATEGORIES[key].test(tag)) {
                return { id: key, priority: 60 };
            }
        }
        if (tag === 'button') return { id: 'button', priority: 40 };
        if (tag === 'a') return { id: 'link', priority: 35 };
        if (/^h[1-6]$/.test(tag)) return { id: 'heading', priority: 30 };
        if (tag === 'p' || tag === 'span') return { id: 'text', priority: 10 };
        if (tag === 'div' || tag === 'section') return { id: 'container', priority: 5 };
        return { id: tag, priority: 1 };
    }

    function fallbackAnalyze(el) {
        if (!el || el.nodeType !== 1) return null;
        var tag = el.tagName.toLowerCase();
        var text = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        var cls = (el.className && typeof el.className === 'string') ? el.className : '';
        var href = (el.getAttribute('href') || '').toLowerCase();
        var cat = fallbackClassify(el);
        var price = null;
        var pm = text.match(/[\$\u00a3\u20ac\u00a5]\s*[\d,]+(?:\.\d{2})?/);
        if (pm) price = pm[0];

        return {
            tag: tag,
            id: el.id || null,
            classes: cls.split(/\s+/).filter(function(c) { return c; }).slice(0, 3).join(' ') || null,
            category: cat.id,
            priority: cat.priority,
            text: text.slice(0, 80),
            href: href || null,
            price: price,
            selector: el.id ? '#' + el.id : tag + (cls ? '.' + cls.split(/\s+/)[0] : ''),
        };
    }

    function fallbackChain(el) {
        if (!el || el.nodeType !== 1) return { chain: [], target: null, product_parent: null, section_parent: null };
        var targetInfo = fallbackAnalyze(el);
        var chain = [];
        var current = el.parentElement;
        var depth = 0;
        var productParent = null;
        var sectionParent = null;

        while (current && current.nodeType === 1 && depth < 6) {
            var info = fallbackAnalyze(current);
            info.depth = depth + 1;
            chain.push(info);
            if (!productParent && (info.category === 'product_card' || info.category === 'product_grid')) productParent = info;
            if (!sectionParent && (current.tagName === 'SECTION' || current.tagName === 'MAIN')) sectionParent = info;
            if (current.tagName === 'BODY') break;
            current = current.parentElement;
            depth++;
        }
        return { chain: chain, target: targetInfo, product_parent: productParent, section_parent: sectionParent, nav_parent: null, form_parent: null };
    }

    // ==================== GATHER FULL CONTEXT ====================
    function gatherContext(el) {
        if (!el || el.nodeType !== 1) return null;

        var info = classifyWithSystem(el);
        var parentData = buildChainWithSystem(el);

        var text = info ? info.text || '' : '';
        var type = info ? info.category || 'unknown' : 'unknown';
        var price = info ? info.price : null;

        var productParent = parentData.product_parent;
        var sectionParent = parentData.section_parent;
        var navParent = parentData.nav_parent;
        var formParent = parentData.form_parent;

        var productText = null;
        var productPrice = null;
        if (productParent) {
            productText = productParent.text || productParent.category;
            productPrice = productParent.price;
        }

        var combined = text + ' ' + type;
        var actions = [];
        if (/add.?to.?cart|buy|purchase/i.test(combined)) actions.push('buy');
        if (/shop/i.test(combined)) {
            var sm = combined.match(/shop\s+(men|wom|kids|now|all|sale|acg)/i);
            actions.push(sm ? 'shop_' + sm[1].toLowerCase() : 'shop');
        }
        if (/checkout|place.?order/i.test(combined)) actions.push('checkout');
        if (/cart|bag|basket/i.test(combined)) actions.push('view_cart');
        if (/subscribe|join|sign.?up|register/i.test(combined)) actions.push('subscribe');
        if (/log.?in|sign.?in/i.test(combined)) actions.push('login');
        if (/search|find/i.test(combined)) actions.push('search');
        if (/contact|help|support/i.test(combined)) actions.push('support');
        if (/learn.?more|about/i.test(combined)) actions.push('learn_more');

        return {
            element_id: 'el_' + Math.abs(Array.from(text + (info ? info.tag : '') + (info ? (info.selector || '') : '')).reduce(function(a, c) { return a * 31 + c.charCodeAt(0); }, 0)).toString(36),
            tag: info ? info.tag : 'unknown',
            category: type,
            text: text.slice(0, 80),
            href: info ? info.href || null : null,
            price: price,
            selector: info ? info.selector : null,
            parent_chain: parentData.chain,
            product_parent: productParent ? {
                category: productParent.category,
                text: productText ? productText.slice(0, 120) : null,
                price: productPrice,
                selector: productParent.selector,
            } : null,
            section_parent: sectionParent ? { category: sectionParent.category, tag: sectionParent.tag, id: sectionParent.id, classes: sectionParent.classes } : null,
            nav_parent: navParent ? { category: navParent.category, tag: navParent.tag } : null,
            form_parent: formParent ? { category: formParent.category, tag: formParent.tag } : null,
            actions: actions,
        };
    }

    // ==================== READING DETECTION ====================
    function checkReading(x, y, now) {
        if (buffer.readingStart) {
            var elapsed = now - buffer.readingStart;
            var moved = Math.abs(x - buffer.lastX) + Math.abs(y - buffer.lastY);
            if (moved > 30) {
                if (buffer.isReading) finishReading(now);
                buffer.readingStart = now;
                buffer.readingPos = { x: x, y: y };
                return;
            }
            if (elapsed > 2000 && !buffer.isReading) {
                buffer.isReading = true;
                var viewportTexts = [];
                var textEls = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
                var vh = window.innerHeight;
                var sy = window.scrollY;
                for (var i = 0; i < textEls.length && viewportTexts.length < 6; i++) {
                    var te = textEls[i];
                    var r = te.getBoundingClientRect();
                    if (!r || r.width === 0 || r.height === 0) continue;
                    if (r.top > vh || r.bottom < 0) continue;
                    var tt = (te.innerText || '').replace(/\s+/g, ' ').trim();
                    if (tt.length < 15) continue;
                    var vh2 = Math.min(r.bottom, vh) - Math.max(r.top, 0);
                    if (vh2 / r.height < 0.3) continue;
                    viewportTexts.push({ tag: te.tagName.toLowerCase(), text: tt.slice(0, 120), visible_pct: Math.round((vh2 / r.height) * 100) });
                }
                var re = { type: 'reading', ts: now, x: x, y: y, scroll_y: sy, element: gatherContext(buffer.currentEl), duration_ms: 0, viewport_texts: viewportTexts };
                buffer.events.push(re);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'reading_start', token: token, timestamp: now, data: re }));
                }
            }
        } else {
            buffer.readingStart = now;
            buffer.readingPos = { x: x, y: y };
        }
    }

    function finishReading(now) {
        if (buffer.readingStart && buffer.isReading) {
            var dur = now - buffer.readingStart;
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'reading_end', token: token, timestamp: now, data: { duration_ms: dur, x: buffer.cursorX, y: buffer.cursorY, scroll_y: buffer.scrollY } }));
            }
        }
        buffer.readingStart = null;
        buffer.readingPos = null;
        buffer.isReading = false;
    }

    // ==================== ENRICH FROM MAP ====================
    function enrichFromMap(fp, x, y, scrollY) {
        if (!fp) return fp;
        var api = getClassifier();
        if (!api || !api.elementMap) return fp;
        var finder = api.elementMap.findAt;
        if (typeof finder !== 'function') return fp;

        var mapEl = finder(x, y, scrollY);
        if (!mapEl) return fp;

        var r = JSON.parse(JSON.stringify(fp));

        if (mapEl.category && mapEl.category !== 'container' && mapEl.category !== 'text' && mapEl.category !== 'unknown') {
            var cur = r.category || '';
            if (cur === 'unknown' || cur === 'text' || cur === 'container') r.category = mapEl.category;
        }
        if ((!r.text || r.text.length < 4) && mapEl.text && mapEl.text.length > 4) r.text = mapEl.text.slice(0, 80);
        if (!r.price && mapEl.price) r.price = mapEl.price;
        if (!r.product_parent && mapEl.product_parent) r.product_parent = mapEl.product_parent;
        if (!r.section_parent && mapEl.section) r.section_parent = { category: mapEl.section };

        r._map_source = mapEl.selector || true;
        return r;
    }

    // ==================== POINTER HANDLING ====================
    function handleMove(x, y, target, source) {
        var now = Date.now();
        if (buffer.lastX && buffer.lastY) buffer.distancePx += Math.hypot(x - buffer.lastX, y - buffer.lastY);
        buffer.cursorX = x;
        buffer.cursorY = y;
        buffer.currentEl = target;
        buffer.currentFP = gatherContext(target);
        buffer.lastX = x;
        buffer.lastY = y;
        buffer.lastMoveTime = now;
        buffer.inputType = source;
        buffer.events.push({ type: 'pointermove', ts: now, source: source });
        checkReading(x, y, now);
    }

    function handleClick(x, y, target, source) {
        var now = Date.now();
        var fp = gatherContext(target);
        var enriched = enrichFromMap(fp, x, y, buffer.scrollY);
        buffer.clicks.push({ x: x, y: y, scroll_y: buffer.scrollY, timestamp: now, element: enriched, source: source });
        buffer.events.push({ type: 'click', ts: now, source: source });
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'click', token: token, timestamp: now, data: { x: x, y: y, scroll_y: buffer.scrollY, element: enriched, source: source } }));
        }
        finishReading(now);
    }

    // Mouse
    document.addEventListener('mousemove', function(e) { if (e.isTrusted) handleMove(e.clientX, e.clientY, e.target, 'mouse'); });
    document.addEventListener('click', function(e) { if (e.isTrusted) handleClick(e.clientX, e.clientY, e.target, 'mouse'); }, true);
    document.addEventListener('mouseover', function(e) { if (e.isTrusted && e.target) { buffer.lastHoverStart = Date.now(); buffer.lastHoverEl = e.target; buffer.lastHoverFP = gatherContext(e.target); } });
    document.addEventListener('mouseout', function() {
        if (buffer.lastHoverStart && buffer.lastHoverFP) {
            var dur = Date.now() - buffer.lastHoverStart;
            if (dur > 200) { buffer.hoverDurations.push({ fp: buffer.lastHoverFP, dur: dur }); buffer.events.push({ type: 'hover_end', ts: Date.now(), dur: dur }); }
        }
        buffer.lastHoverStart = null; buffer.lastHoverEl = null; buffer.lastHoverFP = null;
    });

    // Touch
    var activeTouches = {};
    document.addEventListener('touchstart', function(e) { if (!e.isTrusted) return; buffer.inputType = 'touch'; for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; activeTouches[t.identifier] = { x: t.clientX, y: t.clientY, start: Date.now() }; handleMove(t.clientX, t.clientY, document.elementFromPoint(t.clientX, t.clientY), 'touch'); } }, { passive: true });
    document.addEventListener('touchmove', function(e) { if (!e.isTrusted) return; for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; if (activeTouches[t.identifier]) { activeTouches[t.identifier].x = t.clientX; activeTouches[t.identifier].y = t.clientY; } handleMove(t.clientX, t.clientY, document.elementFromPoint(t.clientX, t.clientY), 'touch'); } }, { passive: true });
    document.addEventListener('touchend', function(e) { if (!e.isTrusted) return; for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; var touch = activeTouches[t.identifier]; if (touch) { var dx = Math.abs(t.clientX - touch.x); var dy = Math.abs(t.clientY - touch.y); if (dx < 15 && dy < 15) handleClick(t.clientX, t.clientY, document.elementFromPoint(t.clientX, t.clientY), 'touch'); delete activeTouches[t.identifier]; } } }, { passive: true });

    // Hesitation
    var hesitationTimer = null;
    function onMove() { clearTimeout(hesitationTimer); hesitationTimer = setTimeout(function() { buffer.hesitations.push(Date.now()); }, 1500); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: true });

    // Scroll
    document.addEventListener('scroll', function() { buffer.scrollY = window.scrollY; }, { passive: true });

    // ==================== FLUSH ====================
    function flushWindow() {
        var has = buffer.events.length > 0 || buffer.hoverDurations.length > 0 || buffer.clicks.length > 0;
        if (!has) return;

        var now = Date.now();
        var numEv = buffer.events.length;
        var avgSpeed = buffer.distancePx > 0 && numEv > 0 ? Math.round(buffer.distancePx / (WINDOW_MS / 1000)) : 0;

        var maxHover = 0;
        var hoveredEls = [];
        buffer.hoverDurations.forEach(function(h) {
            if (h.dur > maxHover) maxHover = h.dur;
            if (h.dur > 400) hoveredEls.push(enrichFromMap(h.fp, buffer.cursorX, buffer.cursorY, buffer.scrollY));
        });

        var focused = enrichFromMap(buffer.currentFP, buffer.cursorX, buffer.cursorY, buffer.scrollY);

        var actions = [];
        if (focused && focused.actions) actions = actions.concat(focused.actions);
        hoveredEls.forEach(function(h) { if (h && h.actions) actions = actions.concat(h.actions); });
        buffer.clicks.forEach(function(c) { if (c.element && c.element.actions) actions = actions.concat(c.element.actions); });

        var hadHes = buffer.hesitations.some(function(h) { return now - h < 5000; });

        var vh = window.innerHeight || 898;
        var ph = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, document.body.offsetHeight, document.documentElement.offsetHeight) || 1;

        var ua = [];
        actions.forEach(function(a) { if (ua.indexOf(a) === -1) ua.push(a); });

        var re = null;
        for (var i = 0; i < buffer.events.length; i++) {
            if (buffer.events[i].type === 'reading') { re = buffer.events[i]; re.duration_ms = buffer.isReading ? (now - buffer.readingStart) : 0; break; }
        }

        var payload = {
            type: 'window_500ms',
            token: token,
            data: {
                ts: now,
                x: buffer.cursorX, y: buffer.cursorY,
                scroll_y: buffer.scrollY,
                viewport_height: vh, page_height: ph,
                scroll_percent: ph > 0 ? Math.round((buffer.scrollY / ph) * 100) : 0,
                element: focused,
                hovered_elements: hoveredEls.slice(0, 4),
                clicks: buffer.clicks.slice(-3),
                num_events: numEv,
                avg_speed_px_sec: avgSpeed,
                max_hover_duration_ms: maxHover,
                actions: ua,
                hesitation: hadHes,
                input_type: buffer.inputType,
                reading: re ? { duration_ms: re.duration_ms, viewport_texts: re.viewport_texts } : null,
            }
        };

        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));

        buffer.events = [];
        buffer.hoverDurations = [];
        buffer.clicks = [];
        buffer.distancePx = 0;
        if (!hadHes) buffer.hesitations = buffer.hesitations.filter(function(h) { return now - h < 5000; });
    }

    setInterval(flushWindow, WINDOW_MS);
    window.addEventListener('beforeunload', function() { if (buffer.isReading) finishReading(Date.now()); flushWindow(); });

    console.log('%c[Tracker] 64-category classification + sibling product scan active', 'color: #00ff88; font-weight: bold');
})();
