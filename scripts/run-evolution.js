const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

import { runEvolutionEngine, STRATEGIES } from "../lib/models.js";

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
  const draws = await fetchAllDraws();
  console.log(`[run-evolution] Loaded ${draws.length} draws, ${STRATEGIES.length} strategies in the pool`);

  const result = runEvolutionEngine(draws);

  console.log(`[run-evolution] ${result.evaluationCount} candidate ensembles evaluated (${result.populationSize} x ${result.generations} generations)`);
  console.log(`[run-evolution] Selection set: ${result.selectionSetSize} draws | Held-out: ${result.heldOutSampleSize} draws`);
  console.log(
    `[run-evolution] Selection Brier -- evolved: ${result.selectionBrierEvolved.toFixed(4)} ` +
    `equal-weight: ${result.selectionBrierEqualWeight.toFixed(4)}`
  );
  console.log(
    `[run-evolution] Held-out Brier -- evolved: ${result.heldOutBrierEvolved.toFixed(4)} ` +
    `equal-weight: ${result.heldOutBrierEqualWeight.toFixed(4)} random baseline: ${result.randomBaselineBrier.toFixed(4)}`
  );
  console.log(`[run-evolution] Evolved beats equal-weight on held-out: ${result.evolvedBeatsEqualWeightOnHeldOut}`);
  console.log(`[run-evolution] Evolved beats random on held-out: ${result.evolvedBeatsRandomOnHeldOut}`);
  console.log("[run-evolution] Best weights found:", result.bestWeights.map((w) => `${w.strategy}=${w.weight.toFixed(3)}`).join(", "));

  const row = {
    run_at: new Date().toISOString(),
    population_size: result.populationSize,
    generations: result.generations,
    evaluation_count: result.evaluationCount,
    selection_set_size: result.selectionSetSize,
    held_out_sample_size: result.heldOutSampleSize,
    best_weights: result.bestWeights,
    selection_brier_evolved: result.selectionBrierEvolved,
    selection_brier_equal_weight: result.selectionBrierEqualWeight,
    held_out_brier_evolved: result.heldOutBrierEvolved,
    held_out_brier_equal_weight: result.heldOutBrierEqualWeight,
    random_baseline_brier: result.randomBaselineBrier,
    evolved_beats_equal_weight_on_held_out: result.evolvedBeatsEqualWeightOnHeldOut,
    evolved_beats_random_on_held_out: result.evolvedBeatsRandomOnHeldOut,
    generation_log: result.generationLog,
  };
  await insertRow("evolution_runs", row);
  console.log("[run-evolution] Stored run. Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
