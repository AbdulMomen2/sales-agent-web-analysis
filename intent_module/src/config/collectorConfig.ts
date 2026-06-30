export interface CollectorConfig {
  batchMs: number;
  pointerThrottleMs: number;
  heartbeatMs: number;
  maxBufferSize: number;
  snapshotEnabled: boolean;
  snapshotMaxBytes: number;
  mutationObserverEnabled: boolean;
  mutationAttributeFilter: string[];
  zoneSelector: string | null;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  collectTextContent: boolean;
  collectAttributes: boolean;
  collectCss: boolean;
  pointerCaptureEnabled: boolean;
  disableAutoZoneDetection: boolean;
}

export function getCollectorConfig(): CollectorConfig {
  return {
    batchMs: parseInt(process.env.COLLECTOR_BATCH_MS ?? '200', 10),
    pointerThrottleMs: parseInt(process.env.COLLECTOR_POINTER_THROTTLE_MS ?? '33', 10),
    heartbeatMs: parseInt(process.env.COLLECTOR_HEARTBEAT_MS ?? '30000', 10),
    maxBufferSize: parseInt(process.env.COLLECTOR_MAX_BUFFER_SIZE ?? '5000', 10),
    snapshotEnabled: process.env.COLLECTOR_SNAPSHOT_ENABLED !== 'false',
    snapshotMaxBytes: parseInt(process.env.COLLECTOR_SNAPSHOT_MAX_BYTES ?? '524288', 10),
    mutationObserverEnabled: process.env.COLLECTOR_MUTATION_OBSERVER_ENABLED !== 'false',
    mutationAttributeFilter: (process.env.COLLECTOR_MUTATION_ATTRIBUTE_FILTER ?? 'class,style').split(',').map(s => s.trim()).filter(Boolean),
    zoneSelector: process.env.COLLECTOR_ZONE_SELECTOR ?? null,
    reconnectBaseMs: parseInt(process.env.COLLECTOR_RECONNECT_BASE_MS ?? '1000', 10),
    reconnectMaxMs: parseInt(process.env.COLLECTOR_RECONNECT_MAX_MS ?? '30000', 10),
    collectTextContent: process.env.COLLECTOR_COLLECT_TEXT_CONTENT !== 'false',
    collectAttributes: process.env.COLLECTOR_COLLECT_ATTRIBUTES !== 'false',
    collectCss: process.env.COLLECTOR_COLLECT_CSS !== 'false',
    pointerCaptureEnabled: process.env.COLLECTOR_POINTER_CAPTURE_ENABLED !== 'false',
    disableAutoZoneDetection: process.env.COLLECTOR_DISABLE_AUTO_ZONE_DETECTION === 'true',
  };
}
