(function () {
  var logEl = document.getElementById('log');
  var statusEl = document.getElementById('status');
  var windowsPanel = document.getElementById('windows-panel');
  var linesPanel = document.getElementById('lines-panel');
  var intentPanel = document.getElementById('intent-panel');
  var salesMetrics = document.getElementById('sales-metrics');
  var focusAreaContainer = document.getElementById('focus-area-container');
  var windowsCount = document.getElementById('windows-count');
  var ws = null;

  function appendLine(text) {
    var row = document.createElement('div');
    row.className = 'row';
    row.textContent = text;
    logEl.appendChild(row);
    if (logEl.children.length > 100) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setStatus(label, good) {
    statusEl.textContent = label;
    statusEl.className = 'pill status ' + (good ? 'good' : 'bad');
  }

  function barColor(val) {
    if (val >= 70) return '#86efac';
    if (val >= 40) return '#fde047';
    return '#fca5a5';
  }

  function renderSalesIntent(si) {
    if (!si) return;
    intentPanel.style.display = 'block';
    windowsCount.textContent = si.windows_processed + ' windows';

    if (si.main_focus_area) {
      focusAreaContainer.textContent = 'Focus: ' + si.main_focus_area;
    } else {
      focusAreaContainer.textContent = 'Focus: —';
    }

    var metrics = [
      { label: 'Engagement', value: si.engagement_score },
      { label: 'Purchase Intent', value: si.purchase_intent_proxy },
      { label: 'Friction', value: si.friction_indicator, invert: true },
      { label: 'Hesitations', value: si.num_hesitations, suffix: '' },
      { label: 'Max Scroll', value: si.max_scroll_percent, suffix: '%' },
    ];

    salesMetrics.innerHTML = metrics.map(function (m) {
      var val = m.value || 0;
      var color = m.invert ? barColor(100 - val) : barColor(val);
      var pct = m.invert ? 100 - val : val;
      return '<div class="metric">' +
        '<div class="metric-value" style="color:' + color + '">' + val + (m.suffix !== undefined ? (m.suffix || '') : '') + '</div>' +
        '<div class="metric-label">' + m.label + '</div>' +
        '<div class="metric-bar"><div class="metric-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
        '</div>';
    }).join('');
  }

  function renderWindows(windows) {
    if (!windows || windows.length === 0) {
      windowsPanel.innerHTML = '<span class="muted">No windows yet...</span>';
      return;
    }
    windowsPanel.innerHTML = windows.map(function (w) {
      var ts = new Date(w.timestamp).toLocaleTimeString();
      var el = w.element || {};
      var actions = w.actions || [];
      var hasHesitation = w.hesitation;
      var inputType = w.input_type || '?';
      var clicks = w.clicks || [];
      var reading = w.reading || null;

      var badges = '';
      actions.forEach(function (a) { badges += '<span class="badge action">' + a + '</span>'; });
      if (hasHesitation) badges += '<span class="badge hesitation">hesitation</span>';
      if (el.type) badges += '<span class="badge cta">' + el.type + '</span>';
      if (inputType !== 'unknown') badges += '<span class="badge" style="background:#4a3a6a">' + inputType + '</span>';

      var contextHtml = '';
      var prodCtx = el.product_context;
      if (prodCtx) {
        contextHtml += '<span class="muted">in: <strong>' + (prodCtx.text || prodCtx.category || '?') + '</strong>' + (prodCtx.price ? ' @ ' + prodCtx.price : '') + '</span>';
      }
      var sectionCtx = el.section_context;
      if (sectionCtx) {
        contextHtml += '<span class="muted" style="margin-left:8px">section: ' + (sectionCtx.classes || sectionCtx.tag || '?') + '</span>';
      }
      var parentChain = el.parent_chain;
      if (parentChain && parentChain.length > 0) {
        var chainStr = parentChain.map(function (p) { return (p.tag || '?') + (p.classes ? '.' + p.classes : ''); }).join(' > ');
        contextHtml += '<div class="muted" style="font-size:0.75rem;margin-top:2px">' + chainStr + '</div>';
      }

      var extras = '';
      if (clicks.length > 0) {
        extras += '<span style="color:#fde047">clicks:' + clicks.length + '</span> ';
      }
      if (reading) {
        extras += '<span style="color:#86efac">reading:' + (reading.duration_ms / 1000).toFixed(1) + 's</span>';
        if (reading.viewport_texts && reading.viewport_texts.length > 0) {
          var sample = reading.viewport_texts[0].text.slice(0, 60);
          extras += '<div class="muted" style="font-size:0.7rem">"' + sample + '..."</div>';
        }
      }

      var elInfo = el.text ? el.text.slice(0, 40) : (prodCtx ? prodCtx.text.slice(0, 40) : '—');
      return '<div class="window-row">' +
        '<div class="window-ts">' + ts + '</div>' +
        '<div class="window-detail">' +
        '<div>pos(' + (w.x || '?') + ', ' + (w.y || '?') + ') scroll=' + w.scroll_y + ' evts=' + w.num_events + ' speed=' + w.avg_speed + 'px/s hover=' + w.max_hover_duration_ms + 'ms ' + extras + '</div>' +
        '<div class="muted">element: ' + elInfo + ' ' + badges + '</div>' +
        contextHtml +
        '</div>' +
        '</div>';
    }).join('');
  }

  function renderLines(lines) {
    if (!lines || lines.length === 0) {
      if (linesPanel) linesPanel.innerHTML = '<span class="muted">No activity lines yet...</span>';
      return;
    }
    if (!linesPanel) return;
    linesPanel.innerHTML = lines.map(function (line) {
      var parts = line.split(' | ');
      var tsPart = parts[0];
      var rest = parts.slice(1).join(' | ');
      return '<div class="line-row" style="font-family:monospace;font-size:0.8rem;padding:4px 0;border-bottom:1px solid #172554;">' +
        '<span class="muted" style="margin-right:12px;">' + tsPart + '</span>' +
        '<span>' + rest + '</span>' +
        '</div>';
    }).join('');
  }

  function connect() {
    try {
      if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

      var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + window.location.host + '/ws/dashboard');

      ws.onopen = function () {
        setStatus('Connected', true);
        appendLine('[dashboard] Connected to live trace stream');
      };

      ws.onmessage = function (event) {
        try {
          var msg = JSON.parse(event.data);
          if (msg.type === 'behavior_pipeline') {
            if (msg.sales_intent) renderSalesIntent(msg.sales_intent);
            if (msg.windows) renderWindows(msg.windows);
            if (msg.formatted_lines) renderLines(msg.formatted_lines);
            appendLine('[pipeline] ' + (msg.windows ? msg.windows.length + ' windows' : '0 windows') + ' | lines=' + (msg.formatted_lines ? msg.formatted_lines.length : 0) + ' | engagement=' + (msg.sales_intent ? msg.sales_intent.engagement_score : 0) + ' intent=' + (msg.sales_intent ? msg.sales_intent.purchase_intent_proxy : 0));
          } else {
            appendLine('[event] ' + event.data.slice(0, 200));
          }
        } catch (e) {
          appendLine('[raw] ' + event.data.slice(0, 200));
        }
      };

      ws.onerror = function () {
        setStatus('Connection error', false);
        appendLine('[dashboard] WebSocket error');
      };

      ws.onclose = function (event) {
        setStatus('Disconnected', false);
        appendLine('[dashboard] Connection closed (code=' + event.code + ')');
      };

      window.addEventListener('beforeunload', function () { if (ws) ws.close(); });
    } catch (e) {
      setStatus('Failed to open socket', false);
      appendLine('[dashboard] ' + e);
    }
  }

  connect();
})();
