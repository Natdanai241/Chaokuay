const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

import { runMLModelsEvaluation, developmentDraws } from "../lib/models.js";

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
  if (!rows[0]) throw new Error("No row in dataset_splits -- a frozen boundary must exist before ML model evaluation can run.");
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
  console.log(`[run-ml-models] Loaded ${allDraws.length} total draws; ${draws.length} within development/validation boundary (frozen boundary: ${frozenBoundaryDate})`);
  console.log("[run-ml-models] Note: LSTM/Transformer intentionally not included -- both model");
  console.log("[run-ml-models] temporal dependencies, and this dataset has none (i.i.d. draws).");

  const result = runMLModelsEvaluation(draws, 0.7, frozenBoundaryDate);
  const heldOutSampleSize = result.models.randomForest.heldOutSampleSize;

  console.log(`[run-ml-models] Random baseline Brier: ${result.randomBaselineBrier.toFixed(4)}`);
  for (const [id, r] of Object.entries(result.models)) {
    console.log(
      `[run-ml-models] ${id}: selection=${r.selectionBrier.toFixed(4)} held-out=${r.heldOutBrier.toFixed(4)} ` +
      `beatsRandomOnHeldOut=${r.beatsRandomOnHeldOut}`
    );
  }

  const row = {
    run_at: new Date().toISOString(),
    random_baseline_brier: result.randomBaselineBrier,
    held_out_sample_size: heldOutSampleSize,
    random_forest_selection_brier: result.models.randomForest.selectionBrier,
    random_forest_held_out_brier: result.models.randomForest.heldOutBrier,
    random_forest_beats_random: result.models.randomForest.beatsRandomOnHeldOut,
    gbt_selection_brier: result.models.gbt.selectionBrier,
    gbt_held_out_brier: result.models.gbt.heldOutBrier,
    gbt_beats_random: result.models.gbt.beatsRandomOnHeldOut,
    nn_selection_brier: result.models.nn.selectionBrier,
    nn_held_out_brier: result.models.nn.heldOutBrier,
    nn_beats_random: result.models.nn.beatsRandomOnHeldOut,
  };
  await insertRow("ml_model_runs", row);
  console.log("[run-ml-models] Stored run. Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
