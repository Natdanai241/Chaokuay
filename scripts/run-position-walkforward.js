/* ---------------------------------------------------------------------- */
/* scripts/run-position-walkforward.js                                    */
/* Step B: sequential walk-forward validation of the position-level       */
/* (prediction_type x digit_position) ensemble, vs three baselines:       */
/*   A = legacy/global ensemble  (buildCandidates + deriveWeights(        */
/*       runBacktest(history)) -- what run-backtest.js's baseline does)   */
/*   B = equal-weight position-level ensemble (1/11 every position)       */
/*   C = learned position-level ensemble (154-state sequential update)    */
/*   D = individual strategies, scored directly, no mixing                */
/*                                                                        */
/* Sequence per draw: history -> distributions -> position-weighted       */
/* mixture -> argmax digit -> assemble -> observe actual -> score         */
/* A/B/C/D -> update the 154 learning states -> repeat.                   */
/*                                                                        */
/* Not filtered by dataset_splits frozen boundary -- this replays a       */
/* fixed rule, it doesn't search/select a config by score (that's what    */
/* run-evolution.js / run-feature-discovery.js need held-out data for).   */
/* Matches run-backtest.js's own "informational only" choice.             */
/*                                                                        */
/* ASSUMED strategy_position_learning_state columns (please confirm       */
/* against actual schema): strategy_id, prediction_type, digit_position,  */
/* evaluated_count, long_term_mean_brier, recent_briers,                  */
/* last_target_draw_date, last_brier, model_version, updated_at.          */
/* ---------------------------------------------------------------------- */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SIMULATE_LAST_N = process.env.SIMULATE_LAST_N ? parseInt(process.env.SIMULATE_LAST_N, 10) : null;
const COMMIT_POSITION_STATE = process.env.COMMIT_POSITION_STATE === "true";
// Arm A's legacy weight is O(history length) to derive; recomputing every
// step would make arm A alone O(n^2). Recomputed every N draws instead.
const LEGACY_WEIGHT_RECOMPUTE_INTERVAL = 25;

import {
  STRATEGIES, MIN_WARMUP, strategyFieldPositionProbs, positionMatchPct, bestPositionMatchPct,
  deriveWeights, runBacktest, buildCandidates,
} from "../lib/models.js";
import {
  PREDICTION_TYPE_POSITIONS, RANDOM_BASELINE_DIGIT_BRIER,
  applyPositionLearningUpdateForAllStrategies, deployPositionWeightsFromState, strategyFieldPositionSkill,
} from "../lib/learning.js";
import { randomUUID } from "crypto";

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
  return rows[0]?.frozen_boundary_date ?? null;
}

async function fetchPositionLearningState() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/strategy_position_learning_state?select=strategy_id,prediction_type,digit_position,evaluated_count,long_term_mean_brier,recent_briers,last_target_draw_date,last_brier,model_version,updated_at`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!r.ok) throw new Error(`Fetch position learning state failed: ${r.status} ${await r.text()}`);
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

function positionKey(strategyId, predictionType, position) { return `${strategyId}|${predictionType}|${position}`; }

function positionStateRowToState(row) {
  return {
    strategyId: row.strategy_id, evaluatedCount: row.evaluated_count, longTermMeanBrier: row.long_term_mean_brier,
    recentBriers: row.recent_briers ?? [], lastTargetDrawDate: row.last_target_draw_date,
    lastBrier: row.last_brier, modelVersion: row.model_version, updatedAt: row.updated_at,
  };
}
function positionStateToRow(key, state) {
  const [strategyId, predictionType, positionStr] = key.split("|");
  return {
    strategy_id: strategyId, prediction_type: predictionType, digit_position: Number(positionStr),
    evaluated_count: state.evaluatedCount, long_term_mean_brier: state.longTermMeanBrier,
    recent_briers: state.recentBriers, last_target_draw_date: state.lastTargetDrawDate,
    last_brier: state.lastBrier, model_version: state.modelVersion, updated_at: state.updatedAt,
  };
}

function getActualValues(actual, predictionType) {
  if (predictionType === "firstPrize") return [actual.firstPrize];
  if (predictionType === "back2") return [actual.back2];
  return actual[predictionType];
}

function digitSkillFromDist(dist, actualDigit) {
  const brierScore = dist.reduce((sum, p, idx) => sum + (p - (idx === actualDigit ? 1 : 0)) ** 2, 0);
  const ranked = dist.map((p, idx) => idx).sort((a, b) => dist[b] - dist[a]);
  const rankOfActual = ranked.indexOf(actualDigit) + 1;
  const brierSkill = (RANDOM_BASELINE_DIGIT_BRIER - brierScore) / RANDOM_BASELINE_DIGIT_BRIER;
  const rankSkill = (5.5 - rankOfActual) / 4.5;
  return { brierScore, rankOfActual, skillScore: 0.5 * brierSkill + 0.5 * rankSkill };
}

function argmaxDigit(dist) {
  let best = 0;
  for (let d = 1; d < 10; d++) if (dist[d] > dist[best]) best = d;
  return best;
}

function mixDistribution(distsByStrategy, weightsForPosition, position) {
  const weightMap = new Map(weightsForPosition.map((w) => [w.strategy, w.weight]));
  const mixed = new Array(10).fill(0);
  for (const s of STRATEGIES) {
    const w = weightMap.get(s.id) ?? 1 / STRATEGIES.length;
    const dist = distsByStrategy.get(s.id)[position];
    for (let d = 0; d < 10; d++) mixed[d] += w * dist[d];
  }
  return mixed;
}

function emptyArmAccumulator() {
  const byType = {};
  for (const type of Object.keys(PREDICTION_TYPE_POSITIONS)) byType[type] = { brierSum: 0, rankSum: 0, matchPctSum: 0, exactHits: 0, n: 0 };
  return byType;
}
function recordArm(acc, type, brierScore, rankOfActual, matchPct) {
  const a = acc[type];
  a.brierSum += brierScore; a.rankSum += rankOfActual; a.matchPctSum += matchPct;
  a.exactHits += matchPct === 100 ? 1 : 0; a.n += 1;
}

function emptyPositionSummaryAccumulator() {
  const acc = {};
  for (const [type, len] of Object.entries(PREDICTION_TYPE_POSITIONS)) {
    acc[type] = Array.from({ length: len }, () => ({ brierSum: 0, rankSum: 0, scoredN: 0, hits: 0, n: 0 }));
  }
  return acc;
}
function recordPositionCell(cell, brierScore, rankOfActual, isHit) {
  if (brierScore != null) { cell.brierSum += brierScore; cell.rankSum += rankOfActual; cell.scoredN += 1; }
  cell.hits += isHit ? 1 : 0;
  cell.n += 1;
}

function positionSummaryRows(runId, variant, acc) {
  const rows = [];
  for (const [type, len] of Object.entries(PREDICTION_TYPE_POSITIONS)) {
    for (let pos = 0; pos < len; pos++) {
      const a = acc[type][pos];
      if (a.n === 0) continue;
      rows.push({
        run_id: runId, prediction_type: type, digit_position: pos, variant,
        sample_size: a.n,
        mean_brier: a.scoredN > 0 ? a.brierSum / a.scoredN : null,
        mean_rank: a.scoredN > 0 ? a.rankSum / a.scoredN : null,
        digit_hit_rate: a.hits / a.n,
        random_baseline_brier: RANDOM_BASELINE_DIGIT_BRIER,
      });
    }
  }
  return rows;
}
export function runWalkForward(sortedDraws, { startIndex = MIN_WARMUP, priorStateByKey = new Map(), legacyRecomputeInterval = LEGACY_WEIGHT_RECOMPUTE_INTERVAL } = {}) {
  let stateByKey = new Map(priorStateByKey);
  const equalBaseWeights = STRATEGIES.map((s) => ({ strategy: s.id, weight: 1 / STRATEGIES.length }));

  const armBWeights = {};
  for (const [type, len] of Object.entries(PREDICTION_TYPE_POSITIONS)) {
    armBWeights[type] = [];
    for (let pos = 0; pos < len; pos++) armBWeights[type].push(deployPositionWeightsFromState(equalBaseWeights, new Map(), type, pos));
  }

  const armA = emptyArmAccumulator(), armB = emptyArmAccumulator(), armC = emptyArmAccumulator();
  const armD = new Map(STRATEGIES.map((s) => [s.id, emptyArmAccumulator()]));
  const positionSummaryA = emptyPositionSummaryAccumulator();
  const positionSummaryB = emptyPositionSummaryAccumulator();
  const positionSummaryC = emptyPositionSummaryAccumulator();
  const positionSummaryD = new Map(STRATEGIES.map((s) => [s.id, emptyPositionSummaryAccumulator()]));
  let legacyWeights = null;
  let stepsWalked = 0;
  const drawDatesWalked = [];

  for (let i = startIndex; i < sortedDraws.length; i++) {
    const history = sortedDraws.slice(0, i);
    const actual = sortedDraws[i];

    const distsByType = {};
    for (const type of Object.keys(PREDICTION_TYPE_POSITIONS)) {
      const m = new Map();
      for (const s of STRATEGIES) m.set(s.id, strategyFieldPositionProbs(s.id, history, type));
      distsByType[type] = m;
    }

    for (const s of STRATEGIES) {
      for (const [type, len] of Object.entries(PREDICTION_TYPE_POSITIONS)) {
        const actualValues = getActualValues(actual, type);
        if (!actualValues || actualValues.length === 0) continue;
        for (let pos = 0; pos < len; pos++) {
          const skill = strategyFieldPositionSkill(s.id, history, actualValues, type, pos);
          const a = armD.get(s.id)[type];
          a.brierSum += skill.brierScore; a.rankSum += skill.rankOfActual; a.n += 1;
          
          const predictedDigit = argmaxDigit(distsByType[type].get(s.id)[pos]);
          const isHit = actualValues.some((av) => Number(av[pos]) === predictedDigit);
          recordPositionCell(positionSummaryD.get(s.id)[type][pos], skill.brierScore, skill.rankOfActual, isHit);
        }
      }
    }

    for (const [type, len] of Object.entries(PREDICTION_TYPE_POSITIONS)) {
      const actualValues = getActualValues(actual, type);
      if (!actualValues || actualValues.length === 0) continue;

      const digitsB = [], digitsC = [];
      let brierB = 0, brierC = 0, rankB = 0, rankC = 0;
      for (let pos = 0; pos < len; pos++) {
        const weightsC = deployPositionWeightsFromState(equalBaseWeights, stateByKey, type, pos);
        const distB = mixDistribution(distsByType[type], armBWeights[type][pos], pos);
        const distC = mixDistribution(distsByType[type], weightsC, pos);
        digitsB.push(argmaxDigit(distB));
        digitsC.push(argmaxDigit(distC));

        let bestSkillB = null, bestSkillC = null;
        for (const av of actualValues) {
          const digit = Number(av[pos]);
          const sb = digitSkillFromDist(distB, digit), sc = digitSkillFromDist(distC, digit);
          if (!bestSkillB || sb.skillScore > bestSkillB.skillScore) bestSkillB = sb;
          if (!bestSkillC || sc.skillScore > bestSkillC.skillScore) bestSkillC = sc;
        }
        brierB += bestSkillB.brierScore; rankB += bestSkillB.rankOfActual;
        brierC += bestSkillC.brierScore; rankC += bestSkillC.rankOfActual;
        
        const digitB = digitsB[digitsB.length - 1], digitC = digitsC[digitsC.length - 1];
        const hitB = actualValues.some((av) => Number(av[pos]) === digitB);
        const hitC = actualValues.some((av) => Number(av[pos]) === digitC);
        recordPositionCell(positionSummaryB[type][pos], bestSkillB.brierScore, bestSkillB.rankOfActual, hitB);
        recordPositionCell(positionSummaryC[type][pos], bestSkillC.brierScore, bestSkillC.rankOfActual, hitC);
      }

      const assembledB = digitsB.join(""), assembledC = digitsC.join("");
      recordArm(armB, type, brierB / len, rankB / len, bestPositionMatchPct([assembledB], actualValues));
      recordArm(armC, type, brierC / len, rankC / len, bestPositionMatchPct([assembledC], actualValues));
    }

    if (stepsWalked % legacyRecomputeInterval === 0) {
      legacyWeights = deriveWeights(runBacktest(history));
    }
    const legacyCandidate = buildCandidates(history, legacyWeights, 1)[0];
    if (legacyCandidate) {
        const legacyByType = { firstPrize: legacyCandidate.firstPrize, front3: legacyCandidate.front3[0], back3: legacyCandidate.back3[0], back2: legacyCandidate.back2 };
    }
      for (const type of Object.keys(PREDICTION_TYPE_POSITIONS)) {
        const actualValues = getActualValues(actual, type);
        if (!actualValues || actualValues.length === 0) continue;
        const predicted = legacyByType[type];
        const predictedList = Array.isArray(predicted) ? predicted : [predicted];
        recordArm(armA, type, 0, 0, bestPositionMatchPct(predictedList, actualValues));
        
      for (let pos = 0; pos < PREDICTION_TYPE_POSITIONS[type]; pos++) {
          const isHit = actualValues.some((av) => Number(av[pos]) === Number(predicted[pos]));
          recordPositionCell(positionSummaryA[type][pos], null, null,
     }

    stateByKey = applyPositionLearningUpdateForAllStrategies(stateByKey, history, actual);

    stepsWalked++;
    drawDatesWalked.push(actual.drawDate);
  }

  function summarize(acc) {
    const out = {};
    for (const [type, a] of Object.entries(acc)) {
      out[type] = a.n === 0 ? null : {
        n: a.n, meanBrier: a.brierSum / a.n, meanRank: a.rankSum / a.n,
        meanMatchPct: a.matchPctSum / a.n, exactHitRate: a.exactHits / a.n,
      };
    }
    return out;
  }
  const armDSummary = {};
  for (const [id, acc] of armD.entries()) armDSummary[id] = summarize(acc);

  const finalWeights = {};
  for (const [type, len] of Object.entries(PREDICTION_TYPE_POSITIONS)) {
    finalWeights[type] = [];
    for (let pos = 0; pos < len; pos++) finalWeights[type].push(deployPositionWeightsFromState(equalBaseWeights, stateByKey, type, pos));
  }

  return {
    stepsWalked, firstDrawDateWalked: drawDatesWalked[0] ?? null, lastDrawDateWalked: drawDatesWalked.at(-1) ?? null,
    armA: summarize(armA), armB: summarize(armB), armC: summarize(armC), armD: armDSummary,
    finalWeights, stateByKey, positionSummaryA, positionSummaryB, positionSummaryC, positionSummaryD,

  };
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(`Missing Supabase env vars -- SUPABASE_URL=${SUPABASE_URL ? "set" : "MISSING"}, SUPABASE_SECRET_KEY=${SUPABASE_SECRET_KEY ? "set" : "MISSING"}.`);
  }
  const allDraws = await fetchAllDraws();
  const frozenBoundaryDate = await fetchFrozenBoundary();
  console.log(`[run-position-walkforward] Loaded ${allDraws.length} draws (frozen boundary: ${frozenBoundaryDate ?? "none set"} -- informational only, NOT filtered)`);
  if (allDraws.length < MIN_WARMUP + 1) throw new Error(`Too few draws to walk forward (<${MIN_WARMUP + 1}).`);

  const priorRows = await fetchPositionLearningState();
  console.log(`[run-position-walkforward] Loaded ${priorRows.length} existing position learning state rows (expect 154)`);
  const priorStateByKey = new Map(priorRows.map((row) => [positionKey(row.strategy_id, row.prediction_type, row.digit_position), positionStateRowToState(row)]));

  const startIndex = SIMULATE_LAST_N ? Math.max(MIN_WARMUP, allDraws.length - SIMULATE_LAST_N) : MIN_WARMUP;
  console.log(`[run-position-walkforward] Walking from index ${startIndex} to ${allDraws.length - 1} (${allDraws.length - startIndex} draws)${SIMULATE_LAST_N ? ` [SIMULATE_LAST_N=${SIMULATE_LAST_N}]` : ""}`);

  const result = runWalkForward(allDraws, { startIndex, priorStateByKey });

  console.log(`[run-position-walkforward] Walked ${result.stepsWalked} draws: ${result.firstDrawDateWalked} .. ${result.lastDrawDateWalked}`);
  console.log("[run-position-walkforward] --- A vs B vs C summary ---");
  for (const type of Object.keys(PREDICTION_TYPE_POSITIONS)) {
    const a = result.armA[type], b = result.armB[type], c = result.armC[type];
    console.log(`  ${type}:`);
    if (a) console.log(`    A legacy/global : match%=${a.meanMatchPct.toFixed(2)} exactHit=${(a.exactHitRate * 100).toFixed(2)}% (n=${a.n}) [vote-based -> no Brier/rank]`);
    if (b) console.log(`    B equal-position: brier=${b.meanBrier.toFixed(4)} rank=${b.meanRank.toFixed(2)}/10 match%=${b.meanMatchPct.toFixed(2)} exactHit=${(b.exactHitRate * 100).toFixed(2)}% (n=${b.n})`);
    if (c) console.log(`    C learned-position: brier=${c.meanBrier.toFixed(4)} rank=${c.meanRank.toFixed(2)}/10 match%=${c.meanMatchPct.toFixed(2)} exactHit=${(c.exactHitRate * 100).toFixed(2)}% (n=${c.n})`);
    if (b && c) console.log(`    learned vs equal-weight Brier diff: ${(b.meanBrier - c.meanBrier >= 0 ? "+" : "")}${(b.meanBrier - c.meanBrier).toFixed(5)} (positive = learned better)`);
  }
  console.log("[run-position-walkforward] --- D: individual strategies ---");
  for (const s of STRATEGIES) {
    const d = result.armD[s.id];
    console.log(`  ${s.id}: ` + Object.entries(d).filter(([, v]) => v).map(([type, v]) => `${type}=${v.meanBrier.toFixed(4)}`).join(", "));
  }
  console.log("[run-position-walkforward] --- Final learned weights (154 states) ---");
  for (const [type, len] of Object.entries(PREDICTION_TYPE_POSITIONS)) {
    for (let pos = 0; pos < len; pos++) {
      console.log(`  ${type}[${pos}]: ` + result.finalWeights[type][pos].map((w) => `${w.strategy}=${w.weight.toFixed(3)}`).join(" "));
    }
  }

  if (COMMIT_POSITION_STATE) {
    const rows = [...result.stateByKey.entries()].map(([key, state]) => positionStateToRow(key, state));
    await upsert("strategy_position_learning_state", rows, "strategy_id,prediction_type,digit_position", "merge-duplicates");
    console.log(`[run-position-walkforward] Committed ${rows.length} position learning state rows.`);
  } else {
    console.log("[run-position-walkforward] COMMIT_POSITION_STATE is not true -- dry run only.");
  }
  
  console.log("[run-position-walkforward] Done.");
}
  const runId = randomUUID();
  const summaryRows = [
    ...positionSummaryRows(runId, "A", result.positionSummaryA),
    ...positionSummaryRows(runId, "B", result.positionSummaryB),
    ...positionSummaryRows(runId, "C", result.positionSummaryC),
    ...[...result.positionSummaryD.entries()].flatMap(([strategyId, acc]) => positionSummaryRows(runId, `D:${strategyId}`, acc)),
  ];
  await upsert("position_walkforward_summary", summaryRows, "run_id,prediction_type,digit_position,variant", "merge-duplicates");
  console.log(`[run-position-walkforward] Recorded ${summaryRows.length} A/B/C/D comparison rows to position_walkforward_summary (run_id=${runId}).`);
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
