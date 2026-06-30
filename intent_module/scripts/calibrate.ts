/**
 * Calibration script — computes empirical LRs from outcomes table.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/calibrate.ts
 *
 * Reads all completed sessions from the `outcomes` PostgreSQL table,
 * computes:
 *   - p0 = base conversion rate
 *   - For each signal: P(signal|converter) / P(signal|non-converter)
 *   - Laplace smoothing applied to avoid division by zero
 *
 * Writes result to `src/config/calibrated.json` which the server
 * loads at startup if present.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

interface OutcomeRow {
  outcome: number;
  active_signals: string[] | null;
  source: string;
}

async function main(): Promise<void> {
  console.log('[calibrate] reading outcomes from database...');

  const result = await pool.query<OutcomeRow>(
    `SELECT outcome, active_signals, source FROM outcomes WHERE active_signals IS NOT NULL`,
  );
  const rows = result.rows;

  if (rows.length === 0) {
    console.warn('[calibrate] no outcomes found — cannot calibrate');
    await pool.end();
    process.exit(0);
  }

  const converters = rows.filter(r => r.outcome === 1);
  const nonConverters = rows.filter(r => r.outcome === 0);

  const nConverters = converters.length;
  const nNonConverters = nonConverters.length;
  const total = rows.length;

  // Compute p0 — base conversion rate
  const p0 = total > 0 ? nConverters / total : 0.025;

  // Collect all signal names seen across all sessions
  const allSignals = new Set<string>();
  for (const row of rows) {
    if (row.active_signals) {
      for (const sig of row.active_signals) {
        allSignals.add(sig);
      }
    }
  }

  // Built-in signals the system can produce
  const knownSignals = [
    'time_on_page_gt_60s',
    'hover_pricing_3s',
    'scroll_back_to_pricing',
    'E_session_mean_high',
    'click_pricing_cta',
    'pricing_section_dwell_3s',
    'pinch_zoom_on_pricing',
    'bot_like_movement',
    'inactive_session',
  ];

  // Merge known + discovered signals
  for (const sig of allSignals) knownSignals.push(sig);
  const signalSet = [...new Set(knownSignals)];

  // Compute P(signal | converter) and P(signal | non-converter)
  const lrTable: Record<string, number> = {};

  for (const signal of signalSet) {
    const converterHits = converters.filter(r =>
      r.active_signals?.includes(signal)
    ).length;
    const nonConverterHits = nonConverters.filter(r =>
      r.active_signals?.includes(signal)
    ).length;

    // Laplace smoothing: add 1 to numerator, 2 to denominator
    const pConv = nConverters > 0
      ? (converterHits + 1) / (nConverters + 2)
      : 0.5;
    const pNonConv = nNonConverters > 0
      ? (nonConverterHits + 1) / (nNonConverters + 2)
      : 0.5;

    const lr = pConv / pNonConv;

    // Clamp to [0.01, 100] to avoid extreme values
    lrTable[signal] = Math.max(0.01, Math.min(100, lr));

    console.log(
      `  ${signal.padEnd(30)} LR=${lr.toFixed(3)}  ` +
      `P(conv)=${(pConv * 100).toFixed(1)}%  ` +
      `P(non)=${(pNonConv * 100).toFixed(1)}%  ` +
      `(hits: ${converterHits}/${nConverters} vs ${nonConverterHits}/${nNonConverters})`
    );
  }

  // Output
  const output = {
    p0: parseFloat(p0.toFixed(6)),
    calibrated_at: new Date().toISOString(),
    total_sessions: total,
    converter_sessions: nConverters,
    non_converter_sessions: nNonConverters,
    lr_table: lrTable,
  };

  // Determine data source for per-signal LRs
  const desktopSignals = [
    'time_on_page_gt_60s',
    'hover_pricing_3s',
    'scroll_back_to_pricing',
    'E_session_mean_high',
    'click_pricing_cta',
    'bot_like_movement',
    'inactive_session',
  ];
  const mobileSignals = [
    'scroll_back_to_pricing',
    'pricing_section_dwell_3s',
    'click_pricing_cta',
    'pinch_zoom_on_pricing',
    'time_on_page_gt_60s',
    'bot_like_movement',
    'inactive_session',
  ];

  function buildLRTable(signals: string[]): Record<string, number> {
    const tbl: Record<string, number> = {};
    for (const s of signals) {
      tbl[s] = lrTable[s] ?? 1.0;
    }
    return tbl;
  }

  const config = {
    p0: output.p0,
    lr_table: {
      desktop: buildLRTable(desktopSignals),
      mobile: buildLRTable(mobileSignals),
    },
  };

  const outputPath = join(__dirname, '..', 'src', 'config', 'calibrated.json');
  writeFileSync(outputPath, JSON.stringify(config, null, 2));
  console.log(`\n[calibrate] written to ${outputPath}`);
  console.log(`  p0 = ${output.p0} (${(output.p0 * 100).toFixed(2)}%)`);

  await pool.end();
}

main().catch(err => {
  console.error('[calibrate] error:', err);
  process.exit(1);
});
