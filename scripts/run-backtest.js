const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

import {
  runBacktest, summarizeBacktest, deriveWeights,
  runProbabilisticBacktest, summarizeProbabilisticBacktest,
  isIndistinguishableFromChance, buildCandidates, nextDrawDateFrom,
  rollingCalibrationCheck, makeRng, seedFromDraws, computeStrategyPicks, scoreStrategyPick,
  STRATEGIES,
} from "../lib/models.js";
import {
  applyLearningUpdateForAllStrategies, deployWeightsFromState, stateRowToState, stateToRow,
} from "../lib/learning.js";

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
  if (!rows[0]) throw new Error("No row in dataset_splits -- a frozen boundary must exist before this script can run.");
  return rows[0].frozen_boundary_date;
}

// NEW: current per-strategy learning state (11 rows, fixed size -- no pagination needed).
async function fetchLearningState() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/strategy_learning_state?select=strategy_id,evaluated_count,long_term_mean_brier,recent_briers,last_target_draw_date,last_brier,model_version,updated_at`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!r.ok) throw new Error(`Fetch learning state failed: ${r.status} ${await r.text()}`);
  return r.json();
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

async function fetchPredictionsForDate(targetDate) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/predictions?target_draw_date=eq.${targetDate}&select=target_draw_date,rank,source,front3,back3,back2,contributing_strategies,agreement_score`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!r.ok) throw new Error(`Fetch predictions failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function fetchStrategyPredictionsForDate(targetDate) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/strategy_predictions?target_draw_date=eq.${targetDate}&select=target_draw_date,strategy_id,back2,front3,back3,first_prize,weight_at_prediction_time`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!r.ok) throw new Error(`Fetch strategy predictions failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function fetchActiveWeights() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/weight_version_history?adopted=eq.true&select=weights&order=created_at.desc&limit=1`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!r.ok) throw new Error(`Fetch active weights failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows[0]?.weights || null;
}

async function main() {
  const draws = await fetchAllDraws();
  console.log(`[run-backtest] Loaded ${draws.length} draws`);
  const frozenBoundaryDate = await fetchFrozenBoundary();
  console.log(`[run-backtest] Frozen boundary: ${frozenBoundaryDate} (informational -- this script's outputs are not selection/optimization, so it isn't filtered)`);
  if (draws.length < 10) throw new Error("Too few draws to backtest meaningfully (<10) — aborting.");

  const justImported = draws[draws.length - 1];
  const pastPredictions = await fetchPredictionsForDate(justImported.drawDate);
  if (pastPredictions.length > 0) {
    const evaluations = pastPredictions.map((p) => ({
      target_draw_date: p.target_draw_date, rank: p.rank, source: p.source,
      evaluated_at: new Date().toISOString(),
      predicted_back2: p.back2, actual_back2: justImported.back2, back2_exact_hit: p.back2 === justImported.back2,
      predicted_front3: p.front3, actual_front3: justImported.front3,
      front3_any_hit: p.front3.some((n) => justImported.front3.includes(n)),
      predicted_back3: p.back3, actual_back3: justImported.back3,
      back3_any_hit: p.back3.some((n) => justImported.back3.includes(n)),
      contributing_strategies: p.contributing_strategies, agreement_score: p.agreement_score,
    }));
    await upsert("prediction_evaluations", evaluations, "target_draw_date,rank,source", "merge-duplicates");
    console.log(
      `[run-backtest] Evaluated ${evaluations.length} prediction(s) for ${justImported.drawDate}: ` +
      evaluations.map((e) => `rank${e.rank}/${e.source} back2Hit=${e.back2_exact_hit}`).join(", ")
    );
  } else {
    console.log(`[run-backtest] No stored predictions found for ${justImported.drawDate} to evaluate (nothing was generated ahead of this draw)`);
  }

  const pastStrategyPredictions = await fetchStrategyPredictionsForDate(justImported.drawDate);
  if (pastStrategyPredictions.length > 0) {
    const strategyEvaluations = pastStrategyPredictions.map((p) => {
      const pick = { back2: p.back2, front3: p.front3, back3: p.back3, first: p.first_prize };
      const scores = scoreStrategyPick(pick, justImported);
      return {
        target_draw_date: p.target_draw_date,
        strategy_id: p.strategy_id,
        evaluated_at: new Date().toISOString(),
        back2_match_pct: scores.back2MatchPct,
        front3_match_pct: scores.front3MatchPct,
        back3_match_pct: scores.back3MatchPct,
        first_prize_match_pct: scores.firstPrizeMatchPct,
        weight_at_prediction_time: p.weight_at_prediction_time,
      };
    });
    await upsert("strategy_prediction_evaluations", strategyEvaluations, "target_draw_date,strategy_id", "merge-duplicates");
    console.log(
      `[run-backtest] Evaluated ${strategyEvaluations.length} per-strategy prediction(s) for ${justImported.drawDate}: ` +
      strategyEvaluations.map((e) => `${e.strategy_id} back2=${e.back2_match_pct.toFixed(0)}%`).join(", ")
    );
  } else {
    console.log(`[run-backtest] No stored per-strategy predictions found for ${justImported.drawDate} to evaluate`);
  }

  // --- continuous learning update -------------------------------------------
  // Runs every time, independent of whether a prediction was actually stored
  // ahead of this draw (strategyBack2FullDistribution is a pure function of
  // history, so "what would each strategy have said" is always
  // reconstructable). applyLearningUpdate is idempotent per strategy on its
  // own (lib/learning.js) -- re-running this script after this draw has
  // already been learned from is a safe no-op, not a double-count.
  const historyBeforeJustImported = draws.slice(0, draws.length - 1);
  const priorLearningRows = await fetchLearningState();
  const priorLearningState = new Map(priorLearningRows.map((row) => [row.strategy_id, stateRowToState(row)]));
  const updatedLearningState = applyLearningUpdateForAllStrategies(priorLearningState, historyBeforeJustImported, justImported);
  await upsert("strategy_learning_state", STRATEGIES.map((s) => stateToRow(updatedLearningState.get(s.id))), "strategy_id", "merge-duplicates");
  console.log(`[run-backtest] Learning state updated for ${STRATEGIES.length} strategies from ${justImported.drawDate}`);
  // ---------------------------------------------------------------------------

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
  await upsert("performance_history", merged.map(({ sample_size, ...r }) => ({ ...r, sample_size_at_run: draws.length })), "strategy,computed_at", "ignore-duplicates");
  console.log(`[run-backtest] Stored ${merged.length} model_performance rows + performance_history entries`);

  const calibration = rollingCalibrationCheck(draws, 50);
  if (calibration) {
    const rows = calibration.results.map((r) => ({
      strategy: r.strategy, computed_at: computedAt, window_size: calibration.windowSize,
      recent_brier: r.recentBrier, recent_sample_size: r.recentSampleSize,
      overall_brier: r.overallBrier, overall_sample_size: r.overallSampleSize,
      random_baseline_brier: r.randomBaselineBrier,
      drift: r.drift, drift_significant: r.driftSignificant,
    }));
    await upsert("calibration_checks", rows, "strategy,computed_at", "ignore-duplicates");
    const flagged = calibration.results.filter((r) => r.driftSignificant);
    console.log(
      `[run-backtest] Calibration check (window=${calibration.windowSize}): ` +
      (flagged.length === 0
        ? "no strategy's recent performance drifted beyond the noise threshold"
        : `${flagged.map((r) => r.strategy).join(", ")} flagged -- for history-dependent methods this is` +
          " usually early-data estimation noise settling as the dataset grows, not a new pattern")
    );
  } else {
    console.log("[run-backtest] Not enough draws yet for a rolling calibration check.");
  }

  const activeWeights = await fetchActiveWeights();
  const predictionWeights = activeWeights || weights;
  console.log(`[run-backtest] Using ${activeWeights ? "validated active" : "default (no validated configuration yet)"} weights for prediction generation`);

  // CHANGED: was computeLiveAdjustedWeights(predictionWeights, await fetchLiveEvaluations())
  const weightsBeforeThisUpdate = deployWeightsFromState(predictionWeights, priorLearningState);
  const finalWeights = deployWeightsFromState(predictionWeights, updatedLearningState);
  for (const w of finalWeights) console.log(`[run-backtest] Live adjustment -- ${w.strategy}: ${w.note}`);

  // Audit trail for this update -- same table replay writes to, so both are
  // queryable together; run_id='live' is the sentinel for the production
  // pipeline (vs. a fresh UUID per replay run). predicted_back2/match_pct
  // fields are left null here on purpose -- that data already lives in
  // strategy_prediction_evaluations (written above), joinable on
  // target_draw_date + strategy_id; this row is specifically the LEARNING
  // update's audit record (weight/performance before-and-after, why).
  const weightsBeforeMap = new Map(weightsBeforeThisUpdate.map((w) => [w.strategy, w.weight]));
  const finalWeightsMap = new Map(finalWeights.map((w) => [w.strategy, w.weight]));
  const finalWeightsNoteMap = new Map(finalWeights.map((w) => [w.strategy, w.note]));
  const learningAuditRows = STRATEGIES.map((s) => {
    const prior = priorLearningState.get(s.id) ?? null;
    const updated = updatedLearningState.get(s.id);
    return {
      run_id: LIVE_RUN_ID, target_draw_date: justImported.drawDate, history_size: historyBeforeJustImported.length,
      strategy_id: s.id, weight_before: weightsBeforeMap.get(s.id) ?? 1, weight_after: finalWeightsMap.get(s.id) ?? 1,
      predicted_back2: null, predicted_front3: null, predicted_back3: null, predicted_first_prize: null,
      actual_back2: justImported.back2, actual_front3: justImported.front3, actual_back3: justImported.back3, actual_first_prize: justImported.firstPrize,
      back2_match_pct: null, front3_match_pct: null, back3_match_pct: null, first_prize_match_pct: null,
      back2_brier: updated.lastBrier, learned_mean_before: prior?.longTermMeanBrier ?? null, learned_mean_after: updated.longTermMeanBrier,
      evaluated_count_after: updated.evaluatedCount, update_reason: finalWeightsNoteMap.get(s.id) ?? null, model_version: updated.modelVersion,
    };
  });
  await upsert("walk_forward_strategy_runs", learningAuditRows, "run_id,target_draw_date,strategy_id", "merge-duplicates");

  const targetDrawDate = nextDrawDateFrom(draws);
  const candidates = buildCandidates(draws, finalWeights, 3).map((c) => ({
    target_draw_date: targetDrawDate, rank: c.rank, first_prize: c.firstPrize,
    front3: c.front3, back3: c.back3, back2: c.back2,
    agreement_score: c.agreementScore, statistical_score: c.statisticalScore,
    contributing_strategies: c.contributingStrategies, explanation_th: c.explanationTh,
    generated_at: computedAt, source: "auto-pipeline",
  }));
  await upsert("predictions", candidates, "target_draw_date,rank", "merge-duplicates");
  console.log(`[run-backtest] Stored ${candidates.length} predictions for ${targetDrawDate}`);

  const strategyRng = makeRng(seedFromDraws(draws));
  const strategyPicks = computeStrategyPicks(draws, strategyRng);
  const weightMap = new Map(finalWeights.map((w) => [w.strategy, w.weight]));
  const strategyRows = strategyPicks.map(({ strategy, pick }) => ({
    target_draw_date: targetDrawDate,
    strategy_id: strategy,
    back2: pick.back2,
    front3: pick.front3,
    back3: pick.back3,
    first_prize: pick.first,
    weight_at_prediction_time: weightMap.get(strategy) ?? 1,
    generated_at: computedAt,
    source: "auto-pipeline",
  }));
  await upsert("strategy_predictions", strategyRows, "target_draw_date,strategy_id", "merge-duplicates");
  console.log(`[run-backtest] Stored ${strategyRows.length} per-strategy prediction snapshots for ${targetDrawDate}`);

  console.log("[run-backtest] Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
