import type { RedisSession } from '../store/redisSession.js';

interface ViewportInfoMessage {
  session_id: string;
  t: number;
  pricing_rect: { x: number; y: number; w: number; h: number } | null;
  viewport_height: number;
  scroll_y: number;
}

export async function handleViewportInfo(
  raw: string,
  sessionId: string,
  store: RedisSession,
): Promise<void> {
  try {
    const msg = JSON.parse(raw) as ViewportInfoMessage;
    await store.updateFields(sessionId, {
      pricing_rect: msg.pricing_rect ?? null,
      viewport_height: msg.viewport_height ?? 0,
      scroll_y: msg.scroll_y ?? 0,
    });
  } catch {
    // Malformed viewport info — silently drop
  }
}
