/* ---------------------------------------------------------------------- */
/* lib/learning.js                                                        */
/*                                                                        */
/* Persistent per-strategy LEARNING STATE -- separate from lib/models.js  */
/* on purpose. models.js is pure prediction/backtest math with no notion  */
/* of "what happened last time we ran"; this file owns the one           */
/* sequential state transition (predict -> observe -> evaluate -> learn) */
/* and nothing else. It is DB-agnostic: callers (scripts/*) own reading   */
/* state from and writing state to Supabase; this file only transforms   */
/* plain JS objects.                                                     */
/*                                                                        */
/* applyLearningUpdateForAllStrategies() is the SINGLE entry point both   */
/* scripts/run-walk-forward-experiment.js (replay) and                   */
/* scripts/run-backtest.js (live, one draw at a time) call. Because both  */
/* paths call the exact same function, "incremental matches full replay" */
/* is true by construction -- there is no second implementation that     */
/* could quietly drift from this one.                                    */
/*                                                                        */
/* Two-layer design:                                                     */
/*   BASELINE WEIGHT (deriveWeights, unchanged)                          */
/*   + LEARNED PERFORMANCE (this file -- updates on every evaluated draw,*/
/*     unconditionally, never gated)                                     */
/*   + CONFIDENCE (deployWeightsFromState -- a smooth 0..1 multiplier on */
/*     top of a recent/long-term blended skill score AND a comparison    */
/*     against the other 10 strategies, not a |z|>2 on/off gate. Weak    */
/*     evidence now nudges the weight a little instead of doing nothing; */
/*     the ceiling is still the same +/-15% as before -- gates how FAR   */
/*     deployment moves, not whether learning happens.)                  */
/*   = ADAPTIVE PRODUCTION WEIGHT                                        */
/* ---------------------------------------------------------------------- */

import { STRATEGIES, strategyBack2FullDistribution, back2ToIndex, strategyFieldPositionProbs } from "./models.js";

// Same constant used throughout lib/models.js: (1-0.01)^2 + 99*0.01^2, the
// Brier score of assigning uniform 1% probability to every back2 outcome.
export const RANDOM_BASELINE_BACK2_BRIER = (1 - 0.01) ** 2 + 99 * 0.01 ** 2;

// How much per-strategy history we keep at all (bounds row size in Supabase).
export const RECENT_BUFFER_CAP = 100;
// How much of that we actually use for the "recent" side of the blend --
// matches rollingCalibrationCheck's existing windowSize=50 default, so
// "recent" means the same thing in both places rather than two tunables
// that could silently drift apart.
export const RECENT_DEPLOY_WINDOW = 50;
// The recent window's share of the blend never exceeds this, however full
// it is -- keeps long-term performance as a stabilizer per design goal #1
// instead of the old code's all-or-nothing switch to 100% recent at n=50.
export const MAX_RECENT_INFLUENCE = 0.6;
// Same +/-15% ceiling the old |z|>2 gate used -- reused, not widened,
// since the actual problem was the gate never firing, not the bound being
// too tight.
export const MAX_ADJUSTMENT = 0.15;

export const LEARNING_MODEL_VERSION = "learning-v2";

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Empirical sample standard deviation of a strategy's own recent skill
// scores -- scales confidence to the actual observed spread of this
// quantity instead of a constant calibrated for a different scale.
function sampleStdev(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  const variance = values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
// Measured empirically across all 11 strategies on the full 590-draw
// learning-v2 replay (stdev ranged ~0.29-0.31) -- used only until a
// strategy has >=2 of its own recent samples to measure its own spread.
const FALLBACK_SKILL_STDEV = 0.30;


// Multi-objective per-draw score for one strategy: Brier (continuous
// calibration) blended with rank-of-actual (the same rank
// runProbabilisticBacktest's meanRank/topKAccuracy are built from in
// models.js) so a single number captures both "how well-calibrated" and
// "how close to the top of its own ranking" -- rather than bolting on
// separately-weighted top1/top5/top10/exact-hit terms that are all just
// different summaries of that one rank anyway. 0 = exactly random;
// positive = better than random; bounded to roughly [-1, 1].
export function strategyBack2Skill(strategyId, history, actualBack2) {
  const dist = strategyBack2FullDistribution(strategyId, history);
  const actualIdx = back2ToIndex(actualBack2);
  const brierScore = dist.reduce((sum, p, idx) => sum + (p - (idx === actualIdx ? 1 : 0)) ** 2, 0);
  const ranked = dist.map((p, idx) => idx).sort((a, b) => dist[b] - dist[a]);
  const rankOfActual = ranked.indexOf(actualIdx) + 1;
  const brierSkill = (RANDOM_BASELINE_BACK2_BRIER - brierScore) / RANDOM_BASELINE_BACK2_BRIER;
  const rankSkill = (50.5 - rankOfActual) / 49.5;
  return { brierScore, rankOfActual, skillScore: 0.5 * brierSkill + 0.5 * rankSkill };
}

// Pure state transition for ONE strategy. priorState is the existing row
// (or null the first time a strategy is ever evaluated). Idempotent: if
// priorState already recorded a target draw on/after evalResult's, this
// is a no-op -- re-running the live pipeline on an already-evaluated draw
// can't double-count. Never reads anything about draws at or after
// evalResult.targetDrawDate itself; callers are responsible for only
// calling this after the actual result for that draw has been read.
//
// evalResult.skillScore (see strategyBack2Skill above) is what gets
// averaged/windowed here -- the field names below (longTermMeanBrier,
// recentBriers, lastBrier) are kept as-is for schema/DB compatibility,
// but as of learning-v2 they hold skill scores, not raw Brier scores.
export function applyLearningUpdate(priorState, strategyId, evalResult) {
  if (priorState?.lastTargetDrawDate && priorState.lastTargetDrawDate >= evalResult.targetDrawDate) {
    return priorState;
  }
  const n = (priorState?.evaluatedCount ?? 0) + 1;
  const priorMean = priorState?.longTermMeanBrier ?? evalResult.skillScore;
  // Welford's running mean -- exact, O(1) per update, no re-scan of history.
  const longTermMeanBrier = priorMean + (evalResult.skillScore - priorMean) / n;
  const recentBriers = [...(priorState?.recentBriers ?? []), evalResult.skillScore].slice(-RECENT_BUFFER_CAP);
  return {
    strategyId,
    evaluatedCount: n,
    longTermMeanBrier,
    recentBriers,
    lastTargetDrawDate: evalResult.targetDrawDate,
    lastBrier: evalResult.skillScore,
    modelVersion: LEARNING_MODEL_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

// Runs applyLearningUpdate for all STRATEGIES against one completed draw.
// stateByStrategy: Map<strategyId, state|undefined>. Returns a NEW Map --
// does not mutate the one passed in.
export function applyLearningUpdateForAllStrategies(stateByStrategy, history, actual) {
  const updated = new Map(stateByStrategy);
  for (const s of STRATEGIES) {
    const { skillScore } = strategyBack2Skill(s.id, history, actual.back2);
    const prior = stateByStrategy.get(s.id) ?? null;
    updated.set(s.id, applyLearningUpdate(prior, s.id, { targetDrawDate: actual.drawDate, skillScore }));
  }
  return updated;
}

// Deployment layer: baseline weight * confidence-scaled adjustment.
//
// Pass 1 -- per strategy: blend its own recent-window skill with its own
// long-term skill (credibility-weighted by how full the recent window is,
// capped at MAX_RECENT_INFLUENCE so long-term never gets fully drowned out
// and recent evidence never gets fully drowned out either).
//
// Pass 2 -- across strategies: compare each strategy's blended skill to
// the mean of the other evaluated strategies, so a strategy can gain
// weight for reliably beating its peers even before it has individually
// proven it beats random chance.
//
// Confidence (tanh of the same |z| the old code gated on) scales how much
// that combined signal is allowed to move the weight -- continuously, so
// weak evidence still moves it a little instead of not at all. The old
// |z|>2 cliff is gone; z=2 now just sits at confidence ~0.76 on a smooth
// curve, and the +/-15% ceiling is unchanged from before.
export function deployWeightsFromState(baseWeights, stateByStrategy) {
  const blends = new Map();
  for (const { strategy } of baseWeights) {
    const state = stateByStrategy.get(strategy);
    if (!state || state.evaluatedCount === 0) continue;
    const recent = state.recentBriers.slice(-RECENT_DEPLOY_WINDOW);
    const alpha = Math.min(recent.length / RECENT_DEPLOY_WINDOW, MAX_RECENT_INFLUENCE);
    const blended = alpha * mean(recent) + (1 - alpha) * state.longTermMeanBrier;
    const n = recent.length >= RECENT_DEPLOY_WINDOW ? recent.length : state.evaluatedCount;
    const stdev = sampleStdev(recent) ?? FALLBACK_SKILL_STDEV;
    blends.set(strategy, {
      blended, n, stdev, evaluatedCount: state.evaluatedCount,
      windowUsed: `blend(recent ${(alpha * 100).toFixed(0)}% / long-term ${((1 - alpha) * 100).toFixed(0)}%, n=${n})`,
    });
  }

  const crossMean = blends.size ? mean([...blends.values()].map((b) => b.blended)) : 0;

  const adjusted = baseWeights.map(({ strategy, weight }) => {
    const b = blends.get(strategy);
    if (!b) {
      return { strategy, weight, evaluatedCount: 0, windowUsed: null, adjustment: 1, note: "no learning state yet -- baseline weight used unchanged" };
    }
    const relative = b.blended - crossMean;
    const perf = clamp(0.5 * b.blended + 0.5 * relative, -1, 1);
    const z = b.blended / (b.stdev / Math.sqrt(Math.max(b.n, 1)));
    const confidence = Math.tanh(Math.abs(z) / 2);
    const adjustment = clamp(1 + confidence * perf * MAX_ADJUSTMENT, 1 - MAX_ADJUSTMENT, 1 + MAX_ADJUSTMENT);
    return {
      strategy, weight: weight * adjustment, evaluatedCount: b.evaluatedCount,
      windowUsed: b.windowUsed, blendedSkill: b.blended, relative, confidence, z, adjustment,
      note: `skill ${b.blended.toFixed(3)} (n=${b.n}), ${relative >= 0 ? "+" : ""}${relative.toFixed(3)} vs peer avg, confidence ${(confidence * 100).toFixed(0)}% -- weight ${adjustment >= 1 ? "up" : "down"} ${Math.abs((adjustment - 1) * 100).toFixed(1)}%`,
    };
  });
  const total = adjusted.reduce((a, r) => a + r.weight, 0) || 1;
  return adjusted.map((r) => ({ ...r, weight: r.weight / total }));
}

// -- Supabase row <-> in-memory state mapping (snake_case <-> camelCase) --
// Kept here (not duplicated per-script) so both scripts serialize/
// deserialize identically. Unchanged -- no schema migration needed for
// the learning-v2 formula above; only what number flows into these
// existing fields changed, not the fields themselves.
export function stateRowToState(row) {
  return {
    strategyId: row.strategy_id,
    evaluatedCount: row.evaluated_count,
    longTermMeanBrier: row.long_term_mean_brier,
    recentBriers: row.recent_briers ?? [],
    lastTargetDrawDate: row.last_target_draw_date,
    lastBrier: row.last_brier,
    modelVersion: row.model_version,
    updatedAt: row.updated_at,
  };
}
export function stateToRow(state) {
  return {
    strategy_id: state.strategyId,
    evaluated_count: state.evaluatedCount,
    long_term_mean_brier: state.longTermMeanBrier,
    recent_briers: state.recentBriers,
    last_target_draw_date: state.lastTargetDrawDate,
    last_brier: state.lastBrier,
    model_version: state.modelVersion,
    updated_at: state.updatedAt,
  };
}

// ---- Digit-position ensemble learning (new architecture) ----
// Parallel to everything above, not a replacement -- the back2-only,
// single-key functions above stay untouched and keep powering current
// production until this new path is wired in and validated separately.

export const RANDOM_BASELINE_DIGIT_BRIER = (1 - 0.1) ** 2 + 9 * 0.1 ** 2; // = 0.9

export const PREDICTION_TYPE_POSITIONS = { firstPrize: 6, front3: 3, back3: 3, back2: 2 };

// Skill for one strategy at one (predictionType, position). actualValues is
// an array -- 1 candidate for firstPrize/back2, 2 for front3/back3 (either
// counts as a real-world win, so skill is scored against whichever candidate
// the strategy's distribution favors more, same "best of" spirit as the
// existing bestPositionMatchPct).
export function strategyFieldPositionSkill(strategyId, history, actualValues, field, position) {
  const marginals = strategyFieldPositionProbs(strategyId, history, field);
  const dist = marginals[position];
  let best = null;
  for (const actualValue of actualValues) {
    const actualDigit = Number(actualValue[position]);
    const brierScore = dist.reduce((sum, p, idx) => sum + (p - (idx === actualDigit ? 1 : 0)) ** 2, 0);
    const ranked = dist.map((p, idx) => idx).sort((a, b) => dist[b] - dist[a]);
    const rankOfActual = ranked.indexOf(actualDigit) + 1;
    const brierSkill = (RANDOM_BASELINE_DIGIT_BRIER - brierScore) / RANDOM_BASELINE_DIGIT_BRIER;
    const rankSkill = (5.5 - rankOfActual) / 4.5;
    const skillScore = 0.5 * brierSkill + 0.5 * rankSkill;
    if (!best || skillScore > best.skillScore) best = { brierScore, rankOfActual, skillScore };
  }
  return best;
}

// Same idempotent, no-leakage state transition as applyLearningUpdate above
// (reused as-is), just called once per (strategy, predictionType, position)
// key instead of once per strategy. stateByKey: Map<"strategy|type|pos", state>.
export function applyPositionLearningUpdateForAllStrategies(stateByKey, history, actual) {
  const updated = new Map(stateByKey);
  for (const s of STRATEGIES) {
    for (const [predictionType, len] of Object.entries(PREDICTION_TYPE_POSITIONS)) {
      const actualValues = predictionType === "firstPrize" ? [actual.firstPrize]
        : predictionType === "back2" ? [actual.back2]
        : actual[predictionType];
      if (!actualValues || actualValues.length === 0) continue; // pre-~2015 draws have front3: [] -- that prize category didn't exist yet
      for (let position = 0; position < len; position++) {
        const key = `${s.id}|${predictionType}|${position}`;
        const evalResult = strategyFieldPositionSkill(s.id, history, actualValues, predictionType, position);
        const prior = stateByKey.get(key) ?? null;
        updated.set(key, applyLearningUpdate(prior, s.id, { targetDrawDate: actual.drawDate, skillScore: evalResult.skillScore }));
      }
    }
  }
  return updated;
}

// Same confidence-scaled adjustment as deployWeightsFromState above, for one
// (predictionType, position)'s slice of stateByKey. baseWeights should be
// equal weights (1/11 each) per the approved design -- no inherited baseline.
export function deployPositionWeightsFromState(baseWeights, stateByKey, predictionType, position) {
  const blends = new Map();
  for (const { strategy } of baseWeights) {
    const key = `${strategy}|${predictionType}|${position}`;
    const state = stateByKey.get(key);
    if (!state || state.evaluatedCount === 0) continue;
    const recent = state.recentBriers.slice(-RECENT_DEPLOY_WINDOW);
    const alpha = Math.min(recent.length / RECENT_DEPLOY_WINDOW, MAX_RECENT_INFLUENCE);
    const blended = alpha * mean(recent) + (1 - alpha) * state.longTermMeanBrier;
    const n = recent.length >= RECENT_DEPLOY_WINDOW ? recent.length : state.evaluatedCount;
    const stdev = sampleStdev(recent) ?? FALLBACK_SKILL_STDEV;
    blends.set(strategy, { blended, n, stdev, evaluatedCount: state.evaluatedCount });
  }
  const crossMean = blends.size ? mean([...blends.values()].map((b) => b.blended)) : 0;
  const adjusted = baseWeights.map(({ strategy, weight }) => {
    const b = blends.get(strategy);
    if (!b) return { strategy, weight, evaluatedCount: 0, adjustment: 1 };
    const relative = b.blended - crossMean;
    const perf = clamp(0.5 * b.blended + 0.5 * relative, -1, 1);
    const z = b.blended / (b.stdev / Math.sqrt(Math.max(b.n, 1)));
    const confidence = Math.tanh(Math.abs(z) / 2);
    const adjustment = clamp(1 + confidence * perf * MAX_ADJUSTMENT, 1 - MAX_ADJUSTMENT, 1 + MAX_ADJUSTMENT);
    return { strategy, weight: weight * adjustment, evaluatedCount: b.evaluatedCount, blendedSkill: b.blended, relative, confidence, z, adjustment };
  });
  const total = adjusted.reduce((a, r) => a + r.weight, 0) || 1;
  return adjusted.map((r) => ({ ...r, weight: r.weight / total }));
}
