import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');

export type LRTable = Record<string, number>;

function parseSignalList(envKey: string, fallback: string[]): string[] {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

const KNOWN_DESKTOP_SIGNALS = parseSignalList('SIGNALS_DESKTOP', [
  'hover_pricing_3s',
  'scroll_back_to_pricing',
  'E_session_mean_high',
  'click_pricing_cta',
  'time_on_page_gt_60s',
  'bot_like_movement',
  'inactive_session',
]);

const KNOWN_MOBILE_SIGNALS = parseSignalList('SIGNALS_MOBILE', [
  'scroll_back_to_pricing',
  'pricing_section_dwell_3s',
  'click_pricing_cta',
  'pinch_zoom_on_pricing',
  'time_on_page_gt_60s',
  'bot_like_movement',
  'inactive_session',
]);

function loadJson<T>(filename: string): T {
  const path = join(CONFIG_DIR, filename);
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

let calibratedDesktopLRs: LRTable = {};
let calibratedMobileLRs: LRTable = {};
let calibratedP0: number | undefined;

const calibratedPath = join(CONFIG_DIR, 'calibrated.json');
if (existsSync(calibratedPath)) {
  try {
    const raw = readFileSync(calibratedPath, 'utf-8');
    const data = JSON.parse(raw);
    if (data.lr_table) {
      if (data.lr_table.desktop) Object.assign(calibratedDesktopLRs, data.lr_table.desktop);
      if (data.lr_table.mobile) Object.assign(calibratedMobileLRs, data.lr_table.mobile);
    }
    if (data.p0 !== undefined) {
      calibratedP0 = data.p0;
      const pct = `${(data.p0 * 100).toFixed(2)}%`;
      console.log(`[config] loaded calibrated LRs from calibrated.json (p0=${pct})`);
    }
  } catch (e) {
    console.warn('[config] failed to parse calibrated.json, using defaults');
  }
}

function buildLRTable(signals: string[], fileFallback: LRTable, calibratedLRs: LRTable): LRTable {
  const table: LRTable = {};
  for (const sig of signals) {
    const envKey = `LR_${sig.toUpperCase()}`;
    const envVal = process.env[envKey];
    if (envVal !== undefined) {
      const parsed = parseFloat(envVal);
      if (!isNaN(parsed) && parsed > 0) {
        table[sig] = parsed;
        continue;
      }
    }
    if (calibratedLRs[sig] !== undefined) {
      table[sig] = calibratedLRs[sig];
      continue;
    }
    if (fileFallback[sig] !== undefined) {
      table[sig] = fileFallback[sig];
      continue;
    }
    table[sig] = 1.0;
  }
  return table;
}

const thresholdsJson = loadJson<{ p0?: number }>('thresholds.json');

export function getP0(): number {
  const envVal = process.env.LR_P0;
  if (envVal !== undefined) {
    const p = parseFloat(envVal);
    if (!isNaN(p) && p > 0 && p < 1) return p;
  }
  if (calibratedP0 !== undefined) return calibratedP0;
  return thresholdsJson.p0 ?? 0.025;
}

export const lrTableDesktop: LRTable = buildLRTable(
  KNOWN_DESKTOP_SIGNALS,
  loadJson<LRTable>('lrTable.desktop.json'),
  calibratedDesktopLRs,
);

export const lrTableMobile: LRTable = buildLRTable(
  KNOWN_MOBILE_SIGNALS,
  loadJson<LRTable>('lrTable.mobile.json'),
  calibratedMobileLRs,
);
