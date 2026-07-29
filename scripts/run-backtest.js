const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

import {
  runBacktest, summarizeBacktest, deriveWeights,
  runProbabilisticBacktest, summarizeProbabilisticBacktest,
  isIndistinguishableFromChance, buildCandidates, nextDrawDateFrom,
} from "../lib/models.js";

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

async function upsert(table, rows, onConflict, resolution = "merge-duplicates") {
  if (rows.length === 0) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json", Prefer: `resolution=${resolution},return=minimal`,
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`Upsert ${table} failed: ${r.status} ${await r.text()}`);
}

async function main() {
  const draws = await fetchAllDraws();
  console.log(`[run-backtest] Loaded ${draws.length} draws`);
  if (draws.length < 10) throw new Error("Too few draws to backtest meaningfully (<10) — aborting.");

  const classic = summarizeBacktest(runBacktest(draws));
  const weights = deriveWeights(runBacktest(draws));
  const probRows = runProbabilisticBacktest(draws);
  const probSummary = summarizeProbabilisticBacktest(probRows);
  const computedAt = new Date().toISOString();

  const merged = classic.map((c) => {
    const p = probSummary.find((x) => x.strategy === c.strategy);
    const w = weights.find((x) => x.strategy === c.strategy);
    return {
      strategy: c.strategy, computed_at: computedAt, sample_size: c.runs,
      back2_hit_rate: c.back2HitRate, back3_hit_rate: c.back3HitRate, front3_hit_rate: c.front3HitRate,
      composite_score: c.compositeScore, weight: w.weight,
      brier_score: p.brierScore, log_loss: p.logLoss, mean_rank: p.meanRank,
      top1_accuracy: p.top1Accuracy, top5_accuracy: p.top5Accuracy, top10_accuracy: p.top10Accuracy, top20_accuracy: p.top20Accuracy,
      random_baseline_brier: p.randomBaseline.brierScore, random_baseline_log_loss: p.randomBaseline.logLoss,
      indistinguishable_from_chance: isIndistinguishableFromChance(p, p.runs),
    };
  });

  console.log("[run-backtest] Per-strategy results:");
  for (const r of merged) {
    console.log(`  ${r.strategy}: back2HitRate=${(r.back2_hit_rate * 100).toFixed(2)}% brier=${r.brier_score.toFixed(4)} (baseline ${r.random_baseline_brier.toFixed(4)}) weight=${r.weight.toFixed(3)} noEdgeDetected=${r.indistinguishable_from_chance}`);
  }

  await upsert("model_performance", merged, "strategy", "merge-duplicates");
  await upsert("performance_history", merged.map((r) => ({ ...r, sample_size_at_run: draws.length })), "strategy,computed_at", "ignore-duplicates");
  console.log(`[run-backtest] Stored ${merged.length} model_performance rows + performance_history entries`);

  const targetDrawDate = nextDrawDateFrom(draws);
  const candidates = buildCandidates(draws, weights, 3).map((c) => ({
    target_draw_date: targetDrawDate, rank: c.rank, first_prize: c.firstPrize,
    front3: c.front3, back3: c.back3, back2: c.back2,
    agreement_score: c.agreementScore, statistical_score: c.statisticalScore,
    contributing_strategies: c.contributingStrategies, explanation_th: c.explanationTh,
    generated_at: computedAt, source: "auto-pipeline",
  }));
  await upsert("predictions", candidates, "target_draw_date,rank", "merge-duplicates");
  console.log(`[run-backtest] Stored ${candidates.length} predictions for ${targetDrawDate}`);
  console.log("[run-backtest] Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
