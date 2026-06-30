export const redis = {
  sessionTtlS: parseInt(process.env.SESSION_TTL_S ?? '1800', 10),
  keyPrefix: process.env.SESSION_KEY_PREFIX ?? 'session:',
} as const;

export const ws = {
  maxPayload: parseInt(process.env.WS_MAX_PAYLOAD ?? '262144', 10),
  pingTimeoutMs: parseInt(process.env.WS_PING_TIMEOUT_MS ?? '10000', 10),
} as const;

export const messages = {
  maxPointsPerBatch: parseInt(process.env.MAX_POINTS_PER_BATCH ?? '200', 10),
  scrollHistoryCap: parseInt(process.env.SCROLL_HISTORY_CAP ?? '50', 10),
} as const;

export const tick = {
  intervalMs: parseInt(process.env.TICK_INTERVAL_MS ?? '1000', 10),
} as const;

export const tier0 = {
  lowPluginsPenalty: parseFloat(process.env.TIER0_LOW_PLUGINS_PENALTY ?? '0.3'),
  midPluginsPenalty: parseFloat(process.env.TIER0_MID_PLUGINS_PENALTY ?? '0.1'),
  noLanguagesPenalty: parseFloat(process.env.TIER0_NO_LANGUAGES_PENALTY ?? '0.4'),
  suspiciousWebglPenalty: parseFloat(process.env.TIER0_SUSPICIOUS_WEBGL_PENALTY ?? '0.5'),
  suspiciousWebglRenderers: [
    'swiftshader',
    'llvmpipe',
    'basic',
    'google',
    'mesa',
  ],
} as const;
