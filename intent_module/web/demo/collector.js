(function () {
  'use strict';

  var config = {
    batchMs: 200,
    pointerThrottleMs: 33,
    heartbeatMs: 30000,
    maxBufferSize: 5000,
    snapshotEnabled: true,
    snapshotMaxBytes: 524288,
    mutationObserverEnabled: true,
    mutationAttributeFilter: ['class', 'style'],
    zoneSelector: null,
    reconnectBaseMs: 1000,
    reconnectMaxMs: 30000,
    collectTextContent: true,
    collectAttributes: true,
    collectCss: true,
    pointerCaptureEnabled: true,
    disableAutoZoneDetection: false,
  };

  var SESSION_ID = (function () {
    try { return localStorage.getItem('intent_session_id') || crypto.randomUUID(); }
    catch (_) { return crypto.randomUUID(); }
  })();
  var WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  var ws = null;
  var buffer = [];
  var mutationBuffer = [];
  var lastPtr = 0;
  var timer = null;
  var heartbeatTimer = null;
  var reconnectTimer = null;
  var snapshotSent = false;
  var observer = null;
  var reconnectAttempts = 0;

  var SAFE_ATTRS = { 'class':1, 'id':1, 'role':1, 'type':1, 'aria-label':1, 'aria-expanded':1, 'aria-haspopup':1, 'aria-checked':1, 'aria-selected':1, 'aria-current':1, 'tabindex':1, 'disabled':1, 'readonly':1, 'placeholder':1, 'title':1, 'alt':1, 'for':1, 'target':1, 'rel':1, 'style':1 };

  function sanitizeHtml(html) {
    html = html.replace(/<input[^>]*type=["']password["'][^>]*>/gi, '<input type="password" value="[REDACTED]">');
    html = html.replace(/\s(value|data-token|data-csrf|data-session|data-secret|data-key|data-auth|autocomplete)\s*=\s*(?:"[^"]*"|'[^']*'|[\w\-]+)/gi, function(m, a) { return ' ' + a + '="[REDACTED]"'; });
    return html;
  }

  function persistSessionId(id) {
    try { localStorage.setItem('intent_session_id', id); } catch (_) {}
  }

  function getSafeAttrs(el) {
    var a = {}, attr, val;
    for (var i = 0; i < (el.attributes || []).length; i++) {
      attr = el.attributes[i];
      if (!SAFE_ATTRS[attr.name]) continue;
      if (attr.name === 'href' && /^\s*javascript:/i.test(attr.value)) continue;
      val = attr.value;
      if (val.length > 200) val = val.slice(0, 200);
      a[attr.name] = val;
    }
    return a;
  }

  var selCache = new WeakMap();
  function cssSel(el) {
    if (selCache.has(el)) return selCache.get(el);
    if (el.id) { selCache.set(el, '#' + el.id); return '#' + el.id; }
    var parts = [], node = el, depth = 0, sel, cls, p, sibs;
    while (node && node.nodeType === 1 && depth < 5) {
      sel = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + node.id); break; }
      if (node.className && typeof node.className === 'string') {
        cls = node.className.trim().split(/\s+/).filter(Boolean);
        if (cls.length) sel += '.' + cls.slice(0, 2).join('.');
      }
      parts.unshift(sel);
      node = node.parentElement;
      depth++;
    }
    var result = parts.join(' > ');
    selCache.set(el, result);
    return result;
  }

  function elInfo(el) {
    if (!el || !el.tagName) return null;
    var info = {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: Array.prototype.slice.call(el.classList || []).slice(0, 20),
      selector: cssSel(el),
    };
    if (config.collectTextContent) {
      info.text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    }
    if (config.collectAttributes) info.attributes = getSafeAttrs(el);
    return info;
  }

  function getWebGL() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) {
        var ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      }
    } catch (_) {}
    return '';
  }

  function isTouch() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  function connect() {
    ws = new WebSocket(WS_URL);
    ws.onopen = function () {
      reconnectAttempts = 0;
      sendMeta();
      startTimers();
    };
    ws.onmessage = function (msg) {
      try {
        var data = JSON.parse(msg.data);
        if (data.type === 'connected') {
          if (data.session_id) { SESSION_ID = data.session_id; persistSessionId(SESSION_ID); }
          if (data.config) applyConfig(data.config);
          if (data.config && data.config.snapshotEnabled && !snapshotSent) setTimeout(captureSnapshot, 500);
          if (data.config && data.config.mutationObserverEnabled) setTimeout(startMutationObserver, 100);
        }
      } catch (_) {}
    };
    ws.onclose = function () {
      stopTimers();
      flush();
      reconnectAttempts++;
      var delay = Math.min(config.reconnectBaseMs * Math.pow(2, reconnectAttempts - 1), config.reconnectMaxMs);
      delay += Math.random() * 1000;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, delay);
    };
    ws.onerror = function () { ws.close(); };
  }

  function applyConfig(cfg) {
    if (cfg.batchMs != null) config.batchMs = cfg.batchMs;
    if (cfg.pointerThrottleMs != null) config.pointerThrottleMs = cfg.pointerThrottleMs;
    if (cfg.heartbeatMs != null) config.heartbeatMs = cfg.heartbeatMs;
    if (cfg.maxBufferSize != null) config.maxBufferSize = cfg.maxBufferSize;
    if (cfg.snapshotEnabled != null) config.snapshotEnabled = cfg.snapshotEnabled;
    if (cfg.snapshotMaxBytes != null) config.snapshotMaxBytes = cfg.snapshotMaxBytes;
    if (cfg.mutationObserverEnabled != null) config.mutationObserverEnabled = cfg.mutationObserverEnabled;
    if (cfg.mutationAttributeFilter != null) config.mutationAttributeFilter = cfg.mutationAttributeFilter;
    if (cfg.zoneSelector !== undefined) config.zoneSelector = cfg.zoneSelector;
    if (cfg.reconnectBaseMs != null) config.reconnectBaseMs = cfg.reconnectBaseMs;
    if (cfg.reconnectMaxMs != null) config.reconnectMaxMs = cfg.reconnectMaxMs;
    if (cfg.collectTextContent != null) config.collectTextContent = cfg.collectTextContent;
    if (cfg.collectAttributes != null) config.collectAttributes = cfg.collectAttributes;
    if (cfg.collectCss != null) config.collectCss = cfg.collectCss;
    if (cfg.pointerCaptureEnabled != null) config.pointerCaptureEnabled = cfg.pointerCaptureEnabled;
    if (cfg.disableAutoZoneDetection != null) config.disableAutoZoneDetection = cfg.disableAutoZoneDetection;
  }

  function sendMeta() {
    ws.send(JSON.stringify({
      session_id: SESSION_ID,
      navigator_webdriver: navigator.webdriver || false,
      plugins_count: navigator.plugins ? navigator.plugins.length : 0,
      languages: navigator.languages || [navigator.language],
      webgl_renderer: getWebGL(),
      source: isTouch() ? 'touch' : 'mouse',
      screen_width: screen.width,
      screen_height: screen.height,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
  }

  function startTimers() {
    if (timer) return;
    timer = setInterval(flush, config.batchMs);
    heartbeatTimer = setInterval(function () {
      push({ type: 'heartbeat', t: Date.now() });
    }, config.heartbeatMs);
  }

  function stopTimers() {
    if (timer) { clearInterval(timer); timer = null; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function flush() {
    if (!buffer.length && !mutationBuffer.length) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    var events = buffer;
    if (mutationBuffer.length) {
      events = events.concat({ type: 'dom_mutation', t: Date.now(), mutations: mutationBuffer });
      mutationBuffer = [];
    }
    try { ws.send(JSON.stringify({ session_id: SESSION_ID, events: events })); } catch (_) {}
    buffer = [];
  }

  function push(e) {
    if (buffer.length >= config.maxBufferSize) return;
    buffer.push(e);
  }

  /* ── event capture ── */

  document.addEventListener('pointermove', function (e) {
    var now = Date.now();
    if (now - lastPtr < config.pointerThrottleMs) return;
    lastPtr = now;
    push({ type: 'pointer_move', t: now, point: { x: e.clientX, y: e.clientY } });
  }, { passive: true });

  document.addEventListener('pointerdown', function (e) {
    var now = Date.now();
    var ev = { type: 'pointer_down', t: now, point: { x: e.clientX, y: e.clientY } };
    if (config.pointerCaptureEnabled && e.target && typeof e.target.getBoundingClientRect === 'function') {
      var r = e.target.getBoundingClientRect();
      ev.target = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    ev.element = elInfo(e.target);
    push(ev);
  }, { passive: true });

  window.addEventListener('scroll', function () {
    push({ type: 'scroll', t: Date.now(), scroll_y: window.scrollY || window.pageYOffset });
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    push({ type: 'visibility_change', t: Date.now(), visible: !document.hidden });
  }, { passive: true });

  document.addEventListener('touchstart', function (e) {
    push({ type: 'touch_start', t: Date.now(), touches: Array.prototype.map.call(e.touches, function (t) { return { x: t.clientX, y: t.clientY }; }) });
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    push({ type: 'touch_move', t: Date.now(), touches: Array.prototype.map.call(e.touches, function (t) { return { x: t.clientX, y: t.clientY }; }) });
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    push({ type: 'touch_end', t: Date.now(), touches: Array.prototype.map.call(e.changedTouches, function (t) { return { x: t.clientX, y: t.clientY }; }) });
  }, { passive: true });

  /* ── DOM snapshot ── */

  function captureSnapshot() {
    if (snapshotSent || !config.snapshotEnabled) return;
    snapshotSent = true;
    var html = document.documentElement.outerHTML;
    html = sanitizeHtml(html);
    if (html.length > config.snapshotMaxBytes) {
      html = html.slice(0, config.snapshotMaxBytes);
    }
    var msg = { type: 'dom_snapshot', t: Date.now(), html: html };
    if (config.collectCss) msg.css = getAllCSS();
    push(msg);
  }

  function retakeSnapshot() {
    snapshotSent = false;
    mutationBuffer = [];
    if (observer) { observer.disconnect(); observer = null; }
    if (config.mutationObserverEnabled) setTimeout(startMutationObserver, 50);
    setTimeout(captureSnapshot, 100);
  }

  /* Expose retake for SPA navigation */
  window.__retakeSnapshot = retakeSnapshot;

  function getAllCSS() {
    var css = '', maxBytes = 51200;
    for (var i = 0; i < document.styleSheets.length; i++) {
      try {
        var sheet = document.styleSheets[i];
        if (sheet.cssRules) {
          for (var j = 0; j < sheet.cssRules.length; j++) {
            css += sheet.cssRules[j].cssText + '\n';
            if (css.length > maxBytes) { css = css.slice(0, maxBytes); break; }
          }
        }
      } catch (_) {}
      if (css.length > maxBytes) break;
    }
    return css;
  }

  /* ── MutationObserver ── */

  function startMutationObserver() {
    if (observer || !config.mutationObserverEnabled) return;
    observer = new MutationObserver(function (mutations) {
      var records = [], m, rec, n;
      for (var i = 0; i < mutations.length && records.length < 50; i++) {
        m = mutations[i];
        rec = { type: m.type };
        if (m.type === 'childList') {
          rec.target = cssSel(m.target);
          if (m.addedNodes.length > 0) {
            rec.addedTags = [];
            for (var j = 0; j < m.addedNodes.length && j < 5; j++) {
              n = m.addedNodes[j];
              if (n.nodeType === 1) rec.addedTags.push(n.tagName.toLowerCase());
              else if (n.nodeType === 3 && config.collectTextContent) rec.addedText = (n.textContent || '').slice(0, 100);
            }
          }
          rec.removedCount = m.removedNodes.length;
        } else if (m.type === 'attributes') {
          if (config.mutationAttributeFilter.indexOf(m.attributeName) === -1) continue;
          rec.target = cssSel(m.target);
          rec.attributeName = m.attributeName;
        } else if (m.type === 'characterData' && config.collectTextContent) {
          rec.target = cssSel(m.target.parentElement);
          rec.textContent = (m.target.textContent || '').slice(0, 100);
        }
        if (rec.target) records.push(rec);
      }
      if (records.length) mutationBuffer.push.apply(mutationBuffer, records);
    });
    observer.observe(document.documentElement, {
      childList: true, attributes: true,
      characterData: config.collectTextContent,
      subtree: true,
      attributeFilter: config.mutationAttributeFilter,
    });
  }

  /* ── pricing zone auto-detection ── */

  function detectPricingZone() {
    if (config.disableAutoZoneDetection || config.zoneSelector) {
      return config.zoneSelector ? document.querySelector(config.zoneSelector) : null;
    }

    var el, p, label, headings, i;

    // Strategy 1: data attributes
    el = document.querySelector('[data-pricing-container]');
    if (el) return el;

    el = document.querySelector('[data-plan]');
    if (el) { p = el.closest('section, .pricing-section, .pricing-grid, [role="region"]'); return p || el.parentElement; }

    el = document.querySelector('[data-pricing]');
    if (el) return el;

    // Strategy 2: ARIA role with pricing label
    var allRegions = document.querySelectorAll('[role="region"]');
    for (i = 0; i < allRegions.length; i++) {
      label = allRegions[i].getAttribute('aria-label') || '';
      if (/pricing|plan/i.test(label)) return allRegions[i];
    }

    // Strategy 3: class names
    el = document.querySelector('.pricing, .pricing-section, .pricing-grid, .pricing-table, .plan-card');
    if (el) { p = el.closest('section, .pricing-section'); return p || el.parentElement; }

    // Strategy 4: heading text → parent section
    headings = document.querySelectorAll('h1, h2, h3');
    for (i = 0; i < headings.length; i++) {
      if (/pricing|plans?|subscription/i.test(headings[i].textContent || '')) {
        p = headings[i].closest('section, [role="region"]');
        return p || headings[i].parentElement;
      }
    }

    // Strategy 5: schema.org
    el = document.querySelector('[itemtype*="Product"]');
    if (el) return el;

    return null;
  }

  /* ── viewport info ── */

  function viewportInfo() {
    var zone = detectPricingZone();
    var r = zone ? zone.getBoundingClientRect() : null;
    var msg = {
      type: 'viewport_info', session_id: SESSION_ID, t: Date.now(),
      pricing_rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
      viewport_height: window.innerHeight,
      scroll_y: window.scrollY || window.pageYOffset,
    };
    if (ws && ws.readyState === WebSocket.OPEN) try { ws.send(JSON.stringify(msg)); } catch (_) {}
  }

  window.addEventListener('load', function () {
    setTimeout(viewportInfo, 500);
    setTimeout(captureSnapshot, 1000);
    startMutationObserver();
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(viewportInfo, 200);
  });

  window.addEventListener('beforeunload', flush);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }
})();
