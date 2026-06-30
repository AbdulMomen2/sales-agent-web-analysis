/**
 * WebSocket message handler (§5.1, §16-C)
 *
 * Ingests ClientBatch messages from the browser collector.
 */
import type { ClientBatch, ClientEvent, ReplayEvent, SessionState } from '../types/index.js';
import type { RedisSession } from '../store/redisSession.js';
import { messages as messagesConfig } from '../config/index.js';

export function parseBatch(raw: string): ClientBatch | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.session_id || typeof parsed.session_id !== 'string') return null;
    if (!Array.isArray(parsed.events)) return null;
    return parsed as ClientBatch;
  } catch {
    return null;
  }
}

/**
 * Ramer-Douglas-Peucker line simplification.
 * Preserves curve shape while reducing point count.
 */
function rdpSimplify(
  points: { t: number; x: number; y: number }[],
  epsilon: number,
): number[] {
  if (points.length <= 2) return points.map((_, i) => i);

  let dmax = 0;
  let idx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > dmax) { dmax = d; idx = i; }
  }

  if (dmax > epsilon) {
    const left = rdpSimplify(points.slice(0, idx + 1), epsilon);
    const right = rdpSimplify(points.slice(idx), epsilon);
    return [...left.slice(0, -1), ...right.map(i => i + idx)];
  }

  return [0, points.length - 1];
}

function perpendicularDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

export function prepareEvents(events: ClientEvent[]): ClientEvent[] {
  const sorted = [...events].sort((a, b) => a.t - b.t);

  // Extract pointer_move events for RDP simplification
  const moveEvents = sorted.filter(
    (e): e is ClientEvent & { type: 'pointer_move'; point: { x: number; y: number } } =>
      e.type === 'pointer_move' && 'point' in e,
  );
  const nonMoveEvents = sorted.filter(e => e.type !== 'pointer_move');

  if (moveEvents.length > messagesConfig.maxPointsPerBatch) {
    const points = moveEvents.map(e => ({ t: e.t, x: e.point.x, y: e.point.y }));
    const keepIdx = new Set(rdpSimplify(points, 2));
    const simplified = moveEvents.filter((_, i) => keepIdx.has(i));
    return [...simplified, ...nonMoveEvents].sort((a, b) => a.t - b.t);
  }

  return sorted;
}

const REPLAY_CAP = 10000;

function appendReplay(session: SessionState, ev: ReplayEvent): void {
  if (!session.replay_buffer) session.replay_buffer = [];
  session.replay_buffer.push(ev);
  if (session.replay_buffer.length > REPLAY_CAP) {
    session.replay_buffer.splice(0, session.replay_buffer.length - REPLAY_CAP);
  }
}

// Snapshot chunk reassembly (TTL 2min to prevent memory leaks, allow slow sessions)
const snapshotChunks = new Map<string, {
  html: string[]; htmlTotal: number; htmlDone: boolean;
  css: string[]; cssTotal: number; cssDone: boolean;
  timer: ReturnType<typeof setTimeout>;
}>();
const SNAPSHOT_CHUNKS_CAP = 200;

function reassembleSnapshot(sessionId: string): { html: string; css: string } | null {
  const chunks = snapshotChunks.get(sessionId);
  if (!chunks || !chunks.htmlDone) return null;
  const cssOptional = chunks.cssTotal === 0;
  if (!chunks.cssDone && !cssOptional) return null;
  clearTimeout(chunks.timer);
  const html = chunks.html.join('');
  const css = chunks.css.join('');
  snapshotChunks.delete(sessionId);
  return { html, css };
}

function setSnapshotChunkTTL(sessionId: string): void {
  const chunks = snapshotChunks.get(sessionId);
  if (!chunks) return;
  clearTimeout(chunks.timer);
  chunks.timer = setTimeout(() => {
    snapshotChunks.delete(sessionId);
  }, 120000);
}

function sanitizeEvent(event: ClientEvent): void {
  if (typeof event.t !== 'number' || !isFinite(event.t)) event.t = Date.now();
  if ('point' in event && event.point) {
    if (typeof event.point.x !== 'number' || !isFinite(event.point.x)) event.point.x = 0;
    if (typeof event.point.y !== 'number' || !isFinite(event.point.y)) event.point.y = 0;
  }
  if ('target' in event && event.target) {
    if (typeof event.target.x !== 'number' || !isFinite(event.target.x)) event.target.x = 0;
    if (typeof event.target.y !== 'number' || !isFinite(event.target.y)) event.target.y = 0;
    if (typeof event.target.w !== 'number' || !isFinite(event.target.w)) event.target.w = 0;
    if (typeof event.target.h !== 'number' || !isFinite(event.target.h)) event.target.h = 0;
  }
  if ('touches' in event && Array.isArray(event.touches)) {
    if (event.touches.length > 20) event.touches = event.touches.slice(0, 20);
    for (const t of event.touches) {
      if (typeof t.x !== 'number' || !isFinite(t.x)) t.x = 0;
      if (typeof t.y !== 'number' || !isFinite(t.y)) t.y = 0;
    }
  }
  if ('element' in event && event.element) {
    const el = event.element;
    if (el.text && el.text.length > 200) el.text = el.text.slice(0, 200);
    if (el.selector && el.selector.length > 500) el.selector = el.selector.slice(0, 500);
    if (el.tag && el.tag.length > 50) el.tag = el.tag.slice(0, 50);
    if (el.classes && Array.isArray(el.classes)) {
      if (el.classes.length > 20) el.classes = el.classes.slice(0, 20);
      for (let i = 0; i < el.classes.length; i++) {
        if (typeof el.classes[i] !== 'string') el.classes[i] = '';
        if (el.classes[i].length > 50) el.classes[i] = el.classes[i].slice(0, 50);
      }
    }
  }
  if (event.type === 'dom_snapshot') {
    if (typeof event.html === 'string' && event.html.length > 1048576) event.html = event.html.slice(0, 1048576);
    if (typeof event.css === 'string' && event.css.length > 1048576) event.css = event.css.slice(0, 1048576);
  }
  if (event.type === 'scroll' && (typeof event.scroll_y !== 'number' || !isFinite(event.scroll_y))) {
    event.scroll_y = 0;
  }
  if (event.type === 'visibility_change' && typeof event.visible !== 'boolean') {
    event.visible = true;
  }
}

export function routeEvent(
  session: SessionState,
  event: ClientEvent,
): void {
  sanitizeEvent(event);
  const source = session.meta?.source;

  switch (event.type) {
    case 'pointer_move':
      appendReplay(session, {
        t: event.t, type: 'move', x: event.point.x, y: event.point.y,
        scroll_y: session.scroll_y,
      });
      session.last_interaction_t = event.t;
      session.last_pointer_pos = { x: event.point.x, y: event.point.y };
      if (source === 'mouse' && session.desktop) {
        session.desktop.curve_buffer.push({ ...event.point, t: event.t });
      } else {
        session.mixed_input = true;
      }
      break;

    case 'pointer_down':
      if (event.element) session.last_element_info = event.element;
      appendReplay(session, {
        t: event.t, type: 'click',
        x: event.point.x, y: event.point.y,
        tag: event.element?.tag, selector: event.element?.selector, text: event.element?.text,
        scroll_y: session.scroll_y,
      });
      if (event.target && session.pricing_rect) {
        const t = event.target;
        const pr = session.pricing_rect;
        if (t.x < pr.x + pr.w && t.x + t.w > pr.x &&
            t.y < pr.y + pr.h && t.y + t.h > pr.y) {
          session.pricing_cta_clicked = true;
        }
      }
      const prevInteractionT = session.last_interaction_t;
      session.last_interaction_t = event.t;
      if (source === 'mouse' && session.desktop) {
        const prevPos = session.last_pointer_pos;
        const clickPoint = event.point;
        const targetRect = event.target;
        let fitts_x = 0;
        let fitts_y = 0;
        if (prevPos) {
          const dx = clickPoint.x - prevPos.x;
          const dy = clickPoint.y - prevPos.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const targetWidth = targetRect ? Math.max(targetRect.w, targetRect.h, 1) : 1;
          fitts_x = Math.log2(Math.max(distance, 1) / targetWidth + 1);
          fitts_y = event.t - prevInteractionT;
        }
        session.fitts_pairs.push({ fitts_x, fitts_y });
        if (session.fitts_pairs.length > 200) {
          session.fitts_pairs.shift();
        }
      }
      break;

    case 'touch_move':
      session.last_interaction_t = event.t;
      if (source === 'touch' && session.mobile) {
        if (event.touches.length === 1) {
          session.mobile.current_touch_buffer.push({ ...event.touches[0], t: event.t });
        } else {
          if (session.pricing_rect) {
            session.pinch_zoom_triggered = true;
          }
          if (session.mobile.current_touch_buffer.length > 0) {
            session.mobile.gesture_buffer.push(session.mobile.current_touch_buffer);
            if (session.mobile.gesture_buffer.length > 50) {
              session.mobile.gesture_buffer.shift();
            }
            session.mobile.current_touch_buffer = [];
          }
        }
      }
      break;

    case 'touch_start':
      if (event.element) session.last_element_info = event.element;
      session.last_interaction_t = event.t;
      appendReplay(session, {
        t: event.t, type: 'touch',
        x: event.touches[0]?.x, y: event.touches[0]?.y,
        tag: event.element?.tag, selector: event.element?.selector,
        scroll_y: session.scroll_y,
      });
      if (event.target && session.pricing_rect) {
        const t = event.target;
        const pr = session.pricing_rect;
        if (t.x < pr.x + pr.w && t.x + t.w > pr.x &&
            t.y < pr.y + pr.h && t.y + t.h > pr.y) {
          session.pricing_cta_clicked = true;
        }
      }
      if (source === 'touch' && session.mobile) {
        if (event.touches.length === 1) {
          session.mobile.current_touch_buffer.push({ ...event.touches[0], t: event.t });
        } else {
          session.mobile.gesture_buffer.push(event.touches);
          if (session.mobile.gesture_buffer.length > 50) {
            session.mobile.gesture_buffer.shift();
          }
        }
      }
      break;

    case 'touch_end':
      if (event.element) session.last_element_info = event.element;
      session.last_interaction_t = event.t;
      appendReplay(session, {
        t: event.t, type: 'touch_end',
        x: event.touches[0]?.x, y: event.touches[0]?.y,
        tag: event.element?.tag,
        scroll_y: session.scroll_y,
      });
      if (event.target && session.pricing_rect) {
        const t = event.target;
        const pr = session.pricing_rect;
        if (t.x < pr.x + pr.w && t.x + t.w > pr.x &&
            t.y < pr.y + pr.h && t.y + t.h > pr.y) {
          session.pricing_cta_clicked = true;
        }
      }
      break;

    case 'scroll':
      session.scroll_y = event.scroll_y;
      session.last_interaction_t = event.t;
      appendReplay(session, { t: event.t, type: 'scroll', scroll_y: event.scroll_y });
      session.scroll_y_history.push(event.scroll_y);
      if (session.scroll_y_history.length > messagesConfig.scrollHistoryCap) {
        session.scroll_y_history.shift();
      }
      if (source === 'touch' && session.mobile) {
        session.mobile.scroll_event_buffer.push({ t: event.t, scroll_y: event.scroll_y });
      }
      break;

    case 'visibility_change':
      if (!event.visible) {
        if (session.desktop) session.desktop.curve_buffer = [];
        if (session.mobile) {
          session.mobile.current_touch_buffer = [];
          session.mobile.gesture_buffer = [];
        }
      }
      break;

    case 'orientation_change':
      if (session.mobile) {
        session.mobile.current_touch_buffer = [];
        session.mobile.gesture_buffer = [];
      }
      break;

    case 'dom_snapshot':
      {
        const html = typeof event.html === 'string' ? event.html.slice(0, 1048576) : '';
        const css = typeof event.css === 'string' ? event.css.slice(0, 1048576) : '';
        session.dom_snapshot = { html, css };
      }
      break;

    case 'dom_snapshot_chunk':
      {
        const sid = session.meta?.session_id || '';
        if (!snapshotChunks.has(sid)) {
          if (snapshotChunks.size >= SNAPSHOT_CHUNKS_CAP) {
            const oldest = snapshotChunks.keys().next().value;
            if (oldest) snapshotChunks.delete(oldest);
          }
          snapshotChunks.set(sid, {
            html: [], htmlTotal: 0, htmlDone: false,
            css: [], cssTotal: 0, cssDone: false,
            timer: null as any,
          });
        }
        const chunks = snapshotChunks.get(sid)!;
        if (event.part === 'html' && event.html !== undefined) {
          chunks.htmlTotal = event.total;
          chunks.html[event.index] = event.html;
          chunks.htmlDone = chunks.html.filter(Boolean).length >= chunks.htmlTotal;
        }
        if (event.part === 'css' && event.css_chunk !== undefined) {
          chunks.cssTotal = event.total;
          chunks.css[event.index] = event.css_chunk;
          chunks.cssDone = chunks.css.filter(Boolean).length >= chunks.cssTotal;
        }
        setSnapshotChunkTTL(sid);
        const cssOptional = chunks.cssTotal === 0;
        if (chunks.htmlDone && (chunks.cssDone || cssOptional)) {
          const rebuilt = reassembleSnapshot(sid);
          if (rebuilt) {
            session.dom_snapshot = rebuilt;
          }
        }
      }
      break;

    case 'dom_snapshot_complete':
      {
        const sid = session.meta?.session_id || '';
        const chunks = snapshotChunks.get(sid);
        if (chunks) {
          if (event.htmlTotal !== undefined) chunks.htmlTotal = event.htmlTotal;
          if (event.cssTotal !== undefined) chunks.cssTotal = event.cssTotal;
          chunks.htmlDone = chunks.html.filter(Boolean).length >= chunks.htmlTotal;
          chunks.cssDone = chunks.css.filter(Boolean).length >= chunks.cssTotal || chunks.cssTotal === 0;
          const cssOptional = chunks.cssTotal === 0;
          if (chunks.htmlDone && (chunks.cssDone || cssOptional)) {
            const rebuilt = reassembleSnapshot(sid);
            if (rebuilt) {
              session.dom_snapshot = rebuilt;
            }
          }
        }
      }
      break;

    case 'dom_mutation':
      if (!session.dom_mutations) session.dom_mutations = [];
      if (Array.isArray(event.mutations)) {
        for (const m of event.mutations) {
          if (m.target && typeof m.target === 'string') m.target = m.target.slice(0, 500);
          if (m.attributeName && typeof m.attributeName === 'string') m.attributeName = m.attributeName.slice(0, 100);
          if (m.attributeValue && typeof m.attributeValue === 'string') m.attributeValue = m.attributeValue.slice(0, 500);
          if (m.textContent && typeof m.textContent === 'string') m.textContent = m.textContent.slice(0, 500);
        }
        session.dom_mutations.push(...event.mutations);
        if (session.dom_mutations.length > 10000) {
          session.dom_mutations.splice(0, session.dom_mutations.length - 10000);
        }
      }
      break;

    case 'heartbeat':
      session.last_interaction_t = event.t;
      break;
  }
}

export async function handleMessage(
  raw: string,
  sessionId: string,
  store: RedisSession,
): Promise<void> {
  const batch = parseBatch(raw);
  if (!batch) return;

  if (batch.session_id !== sessionId) return;

  const events = prepareEvents(batch.events);
  if (events.length === 0) return;

  const session = await store.getAll(sessionId);
  if (!session.meta) return;

  for (const event of events) {
    routeEvent(session, event);
  }

  await store.setAll(sessionId, session);
}
