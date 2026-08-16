const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

import { runFeatureDiscovery, FEATURES, developmentDraws } from "../lib/models.js";

async function fetchAllDraws() {
  const draws = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/draws?select=draw_date,first_prize,front3,back3,back2&order=draw_date.asc&offset=${offset}&limit=${pageSize}`,
      { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
    );
    if (!r.ok) throw new Error(`Fetch draws failed: ${r.status} ${await r.text()}`);
    const page = await r.json();
    draws.push(...page);
    if (page.length < pageSize) break;
  }
  return draws
    .map((d) => ({ drawDate: d.draw_date, firstPrize: d.first_prize, front3: d.front3, back3: d.back3, back2: d.back2 }))
    .sort((a, b) => a.drawDate.localeCompare(b.drawDate));
}

async function fetchFrozenBoundary() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dataset_splits?select=frozen_boundary_date&order=created_at.desc&limit=1`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!r.ok) throw new Error(`Fetch frozen boundary failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  if (!rows[0]) throw new Error("No row in dataset_splits -- a frozen boundary must exist before Feature Discovery can run.");
  return rows[0].frozen_boundary_date;
}

async function insertRow(table, row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json", Prefer: "return=minimal",
    },
    body: JSON.stringify([row]),
  });
  if (!r.ok) throw new Error(`Insert ${table} failed: ${r.status} ${await r.text()}`);
}

async function main() {
  const allDraws = await fetchAllDraws();
  const frozenBoundaryDate = await fetchFrozenBoundary();
  const draws = developmentDraws(allDraws, frozenBoundaryDate);
  console.log(`[run-feature-discovery] Loaded ${allDraws.length} total draws; ${draws.length} within development/validation boundary (frozen boundary: ${frozenBoundaryDate})`);
  console.log(`[run-feature-discovery] Feature pool: ${FEATURES.map((f) => f.id).join(", ")}`);

  const result = runFeatureDiscovery(draws, 0.7, frozenBoundaryDate);

  console.log(`[run-feature-discovery] Selection ran on ${result.selectionSetSize} draws (70% split)`);
  for (const step of result.selectionLog) {
    console.log(
      `  step ${step.step}: ${step.candidate ?? "(none passed threshold)"} ` +
      `improvement=${step.improvement.toFixed(5)} threshold=${step.threshold.toFixed(5)} accepted=${step.accepted}`
    );
  }
  console.log(`[run-feature-discovery] Selected features: ${result.selectedFeatures.length ? result.selectedFeatures.join(", ") : "(none)"}`);
  console.log(
    `[run-feature-discovery] Held-out (never seen during selection) Brier: ${result.heldOutBrier.toFixed(4)} ` +
    `vs random baseline ${result.randomBaselineBrier.toFixed(4)} over ${result.heldOutSampleSize} draws -- ` +
    `beats baseline: ${result.beatsBaselineOnHeldOut}`
  );

  const row = {
    run_at: new Date().toISOString(),
    selection_set_size: result.selectionSetSize,
    selected_features: result.selectedFeatures,
    selection_log: result.selectionLog,
    held_out_brier: result.heldOutBrier,
    held_out_sample_size: result.heldOutSampleSize,
    random_baseline_brier: result.randomBaselineBrier,
    beats_baseline_on_held_out: result.beatsBaselineOnHeldOut,
  };
  await insertRow("feature_discovery_runs", row);
  console.log("[run-feature-discovery] Stored run. Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
