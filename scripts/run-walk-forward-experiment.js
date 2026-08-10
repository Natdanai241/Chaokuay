const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

import {
  STRATEGIES, computeStrategyPicks, runBacktest, deriveWeights,
  computeLiveAdjustedWeights, buildCandidates, scoreStrategyPick,
  makeRng, seedFromDraws, strategyBack2FullDistribution,
} from "../lib/models.js";
import { randomUUID } from "crypto";

const MIN_TRAIN_WINDOW = 50;

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

async function insertRows(table, rows) {
  if (rows.length === 0) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json", Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`Insert ${table} failed: ${r.status} ${await r.text()}`);
}

function computeAllDistributions(history) {
  const dists = {};
  for (const s of STRATEGIES) dists[s.id] = strategyBack2FullDistribution(s.id, history);
  return dists;
}

// Combines each strategy's REAL probability distribution (not the sampled point pick) with
// the SAME "missing weight defaults to 1" rule buildCandidates uses -- so this Brier score
// reflects the identical implicit weighting the point-prediction itself used.
function ensembleBack2Brier(weightsNamed, dists, actualBack2) {
  const weightMap = new Map(weightsNamed.map((w) => [w.strategy, w.weight]));
  const total = STRATEGIES.reduce((a, s) => a + Math.max(weightMap.get(s.id) ?? 1, 0), 0) || 1;
  const combined = new Array(100).fill(0);
  for (const s of STRATEGIES) {
    const w = Math.max(weightMap.get(s.id) ?? 1, 0) / total;
    if (w === 0) continue;
    const d = dists[s.id];
    for (let k = 0; k < 100; k++) combined[k] += w * d[k];
  }
  const actualIdx = Number(actualBack2[0]) * 10 + Number(actualBack2[1]);
  return combined.reduce((sum, p, idx) => sum + (p - (idx === actualIdx ? 1 : 0)) ** 2, 0);
}

async function main() {
  const allDraws = await fetchAllDraws();
  const simulateLast = process.env.SIMULATE_LAST_N ? parseInt(process.env.SIMULATE_LAST_N, 10) : null;

  if (allDraws.length <= MIN_TRAIN_WINDOW) {
    throw new Error(`Need more than ${MIN_TRAIN_WINDOW} draws to run the experiment (have ${allDraws.length}).`);
  }

  const firstTargetIdx = simulateLast
    ? Math.max(MIN_TRAIN_WINDOW, allDraws.length - simulateLast)
    : MIN_TRAIN_WINDOW;

  const runId = randomUUID();
  console.log(`[walk-forward] run_id=${runId}`);
  console.log(`[walk-forward] ${allDraws.length} draws loaded, simulating indices ${firstTargetIdx}..${allDraws.length - 1} (${allDraws.length - firstTargetIdx} steps)`);

  let accumulatedEvaluations = []; // grows by one draw's evidence per step; never contains T or later

  for (let t = firstTargetIdx; t < allDraws.length; t++) {
    const history = allDraws.slice(0, t); // strictly before target
    const rng = makeRng(seedFromDraws(history));

    const strategyPicks = computeStrategyPicks(history, rng);
    const baselineWeights = deriveWeights(runBacktest(history));
    const adaptiveWeights = computeLiveAdjustedWeights(baselineWeights, accumulatedEvaluations);

    const baselineEnsemble = buildCandidates(history, baselineWeights, 1)[0];
    const adaptiveEnsemble = buildCandidates(history, adaptiveWeights, 1)[0];
    const dists = computeAllDistributions(history);

    // --- boundary: draw t's actual result is read for the first time on the next line ---
    const actual = allDraws[t];

    const baselineScores = scoreStrategyPick(
      { back2: baselineEnsemble.back2, front3: baselineEnsemble.front3, back3: baselineEnsemble.back3, first: baselineEnsemble.firstPrize }, actual
    );
    const adaptiveScores = scoreStrategyPick(
      { back2: adaptiveEnsemble.back2, front3: adaptiveEnsemble.front3, back3: adaptiveEnsemble.back3, first: adaptiveEnsemble.firstPrize }, actual
    );
    const baselineBrier = ensembleBack2Brier(baselineWeights, dists, actual.back2);
    const adaptiveBrier = ensembleBack2Brier(adaptiveWeights, dists, actual.back2);
    const adaptiveWeightMap = new Map(adaptiveWeights.map((w) => [w.strategy, w.weight]));

    const strategyRows = strategyPicks.map(({ strategy, pick }) => {
      const scores = scoreStrategyPick(pick, actual);
      return {
        run_id: runId, target_draw_date: actual.drawDate, history_size: history.length,
        strategy_id: strategy, weight_before: adaptiveWeightMap.get(strategy) ?? 1, weight_after: null,
        predicted_back2: pick.back2, predicted_front3: pick.front3, predicted_back3: pick.back3, predicted_first_prize: pick.first,
        actual_back2: actual.back2, actual_front3: actual.front3, actual_back3: actual.back3, actual_first_prize: actual.firstPrize,
        back2_match_pct: scores.back2MatchPct, front3_match_pct: scores.front3MatchPct,
        back3_match_pct: scores.back3MatchPct, first_prize_match_pct: scores.firstPrizeMatchPct,
      };
    });

    const stepEvaluations = strategyPicks.map(({ strategy, pick }) => ({
      strategy_id: strategy, back2_match_pct: scoreStrategyPick(pick, actual).back2MatchPct,
    }));
    accumulatedEvaluations = accumulatedEvaluations.concat(stepEvaluations);

    // "weight_after" isolates the effect of THIS draw's evidence alone: same baseline
    // (history hasn't grown yet), only accumulatedEvaluations changed.
    const nextAdaptiveWeights = computeLiveAdjustedWeights(baselineWeights, accumulatedEvaluations);
    const nextAdaptiveMap = new Map(nextAdaptiveWeights.map((w) => [w.strategy, w.weight]));
    for (const row of strategyRows) row.weight_after = nextAdaptiveMap.get(row.strategy_id) ?? 1;

    await insertRows("walk_forward_strategy_runs", strategyRows);
    await insertRows("walk_forward_ensemble_runs", [{
      run_id: runId, target_draw_date: actual.drawDate, history_size: history.length,
      live_sample_size_at_step: accumulatedEvaluations.length - stepEvaluations.length,
      baseline_back2: baselineEnsemble.back2, baseline_front3: baselineEnsemble.front3,
      baseline_back3: baselineEnsemble.back3, baseline_first_prize: baselineEnsemble.firstPrize,
      baseline_back2_match_pct: baselineScores.back2MatchPct, baseline_front3_match_pct: baselineScores.front3MatchPct,
      baseline_back3_match_pct: baselineScores.back3MatchPct, baseline_first_prize_match_pct: baselineScores.firstPrizeMatchPct,
      baseline_back2_brier: baselineBrier,
      adaptive_back2: adaptiveEnsemble.back2, adaptive_front3: adaptiveEnsemble.front3,
      adaptive_back3: adaptiveEnsemble.back3, adaptive_first_prize: adaptiveEnsemble.firstPrize,
      adaptive_back2_match_pct: adaptiveScores.back2MatchPct, adaptive_front3_match_pct: adaptiveScores.front3MatchPct,
      adaptive_back3_match_pct: adaptiveScores.back3MatchPct, adaptive_first_prize_match_pct: adaptiveScores.firstPrizeMatchPct,
      adaptive_back2_brier: adaptiveBrier,
    }]);

    if ((t - firstTargetIdx) % 25 === 0) {
      console.log(`[walk-forward] step ${t - firstTargetIdx + 1}/${allDraws.length - firstTargetIdx} -- ${actual.drawDate}: baseline brier=${baselineBrier.toFixed(4)} adaptive brier=${adaptiveBrier.toFixed(4)} live_samples=${accumulatedEvaluations.length}`);
    }
  }

  console.log(`[walk-forward] Done. run_id=${runId} -- query WHERE run_id='${runId}' to analyze this run specifically.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
