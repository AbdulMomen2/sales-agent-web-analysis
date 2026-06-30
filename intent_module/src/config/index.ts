export { infra } from './infra.js';
export { redis, ws, messages, tick, tier0 } from './constants.js';

export type { DesktopSignalConfig, DesktopConfig, MobileSignalConfig, MobileConfig, Thresholds } from './thresholds.js';
export { thresholds, getTriggerThreshold, getTriggerSustainSeconds, getEmaHalfLifeSeconds } from './thresholds.js';

export type { LRTable } from './signals.js';
export { lrTableDesktop, lrTableMobile, getP0 } from './signals.js';
