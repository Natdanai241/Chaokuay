const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

import {
  STRATEGIES, computeStrategyPicks, runBacktest, deriveWeights,
  buildCandidates, scoreStrategyPick,
  makeRng, seedFromDraws, strategyBack2FullDistribution,
} from "../lib/models.js";
import {
  applyLearningUpdateForAllStrategies, deployWeightsFromState, stateToRow,
} from "../lib/learning.js";
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

// NEW: only needed for the optional end-of-run commit into strategy_learning_state.
async function upsertRows(table, rows, onConflict, resolution = "merge-duplicates") {
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

function computeAllDistributions(history) {
  const dists = {};
  for (const s of STRATEGIES) dists[s.id] = strategyBack2FullDistribution(s.id, history);
  return dists;
}

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
  const commitLiveState = process.env.COMMIT_LIVE_STATE === "true";

  if (commitLiveState && simulateLast) {
    throw new Error("COMMIT_LIVE_STATE requires a full replay (leave simulate_last_n blank) -- committing a partial window as the production learning state would understate evaluated_count and skew the long-term mean.");
  }
  if (allDraws.length <= MIN_TRAIN_WINDOW) {
    throw new Error(`Need more than ${MIN_TRAIN_WINDOW} draws to run the experiment (have ${allDraws.length}).`);
  }

  const firstTargetIdx = simulateLast
    ? Math.max(MIN_TRAIN_WINDOW, allDraws.length - simulateLast)
    : MIN_TRAIN_WINDOW;

  const runId = randomUUID();
  console.log(`[walk-forward] run_id=${runId}`);
  console.log(`[walk-forward] ${allDraws.length} draws loaded, simulating indices ${firstTargetIdx}..${allDraws.length - 1} (${allDraws.length - firstTargetIdx} steps)`);
  if (commitLiveState) console.log(`[walk-forward] COMMIT_LIVE_STATE=true -- final learning state will REPLACE strategy_learning_state at the end of this run`);

  // Always starts EMPTY, regardless of whatever strategy_learning_state
  // currently holds in production. This simulates "if learning had run
  // sequentially from firstTargetIdx using only the draws in this dataset" --
  // reading today's live (possibly-already-advanced) state would make the
  // result depend on WHEN you run this, breaking determinism.
  let learningState = new Map();

  for (let t = firstTargetIdx; t < allDraws.length; t++) {
    const history = allDraws.slice(0, t); // strictly before target
    const rng = makeRng(seedFromDraws(history));

    const strategyPicks = computeStrategyPicks(history, rng);
    const baselineWeights = deriveWeights(runBacktest(history));
    const adaptiveWeights = deployWeightsFromState(baselineWeights, learningState);

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

    // learn from this draw -- same function scripts/run-backtest.js calls for
    // live continuation, so incremental and replay can never silently drift apart.
    const nextLearningState = applyLearningUpdateForAllStrategies(learningState, history, actual);
    const nextAdaptiveWeights = deployWeightsFromState(baselineWeights, nextLearningState); // isolates this draw's effect: same baseline, only the learning state changed
    const nextAdaptiveMap = new Map(nextAdaptiveWeights.map((w) => [w.strategy, w.weight]));
    const nextAdaptiveNoteMap = new Map(nextAdaptiveWeights.map((w) => [w.strategy, w.note]));

    const strategyRows = strategyPicks.map(({ strategy, pick }) => {
      const scores = scoreStrategyPick(pick, actual);
      const priorState = learningState.get(strategy) ?? null;
      const newState = nextLearningState.get(strategy);
      return {
        run_id: runId, target_draw_date: actual.drawDate, history_size: history.length,
        strategy_id: strategy, weight_before: adaptiveWeightMap.get(strategy) ?? 1, weight_after: nextAdaptiveMap.get(strategy) ?? 1,
        predicted_back2: pick.back2, predicted_front3: pick.front3, predicted_back3: pick.back3, predicted_first_prize: pick.first,
        actual_back2: actual.back2, actual_front3: actual.front3, actual_back3: actual.back3, actual_first_prize: actual.firstPrize,
        back2_match_pct: scores.back2MatchPct, front3_match_pct: scores.front3MatchPct,
        back3_match_pct: scores.back3MatchPct, first_prize_match_pct: scores.firstPrizeMatchPct,
        back2_brier: newState.lastBrier,
        learned_mean_before: priorState?.longTermMeanBrier ?? null,
        learned_mean_after: newState.longTermMeanBrier,
        evaluated_count_after: newState.evaluatedCount,
        update_reason: nextAdaptiveNoteMap.get(strategy) ?? null,
        model_version: newState.modelVersion,
      };
    });

    learningState = nextLearningState; // advance for next iteration

    await insertRows("walk_forward_strategy_runs", strategyRows);
    await insertRows("walk_forward_ensemble_runs", [{
      run_id: runId, target_draw_date: actual.drawDate, history_size: history.length,
      live_sample_size_at_step: t - firstTargetIdx,
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
      console.log(`[walk-forward] step ${t - firstTargetIdx + 1}/${allDraws.length - firstTargetIdx} -- ${actual.drawDate}: baseline brier=${baselineBrier.toFixed(4)} adaptive brier=${adaptiveBrier.toFixed(4)}`);
    }
  }

  if (commitLiveState) {
    const rows = STRATEGIES.map((s) => stateToRow(learningState.get(s.id))).filter(Boolean);
    await upsertRows("strategy_learning_state", rows, "strategy_id", "merge-duplicates");
    console.log(`[walk-forward] Committed final learning state for ${rows.length} strategies to strategy_learning_state.`);
  }

  console.log(`[walk-forward] Done. run_id=${runId} -- query WHERE run_id='${runId}' to analyze this run specifically.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
