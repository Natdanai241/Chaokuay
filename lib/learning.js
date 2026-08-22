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
/*   + CONFIDENCE/REGULARIZATION (deployWeightsFromState's |z|>2 gate,   */
/*     +/-15% bounded nudge -- gates DEPLOYMENT, not learning)           */
/*   = ADAPTIVE PRODUCTION WEIGHT                                        */
/* ---------------------------------------------------------------------- */

import { STRATEGIES, strategyBack2FullDistribution, back2ToIndex } from "./models.js";

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

export const LEARNING_MODEL_VERSION = "learning-v1";

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

// Same 0.02/sqrt(n) approximate standard-error shape already used by
// isIndistinguishableFromChance() and rollingCalibrationCheck() in
// lib/models.js -- reused, not re-derived, so the significance bar means
// the same thing everywhere in this codebase.
function approxSE(n) {
  return 0.02 / Math.sqrt(Math.max(n, 1));
}

export function strategyBack2Brier(strategyId, history, actualBack2) {
  const dist = strategyBack2FullDistribution(strategyId, history);
  const actualIdx = back2ToIndex(actualBack2);
  return dist.reduce((sum, p, idx) => sum + (p - (idx === actualIdx ? 1 : 0)) ** 2, 0);
}

// Pure state transition for ONE strategy. priorState is the existing row
// (or null the first time a strategy is ever evaluated). Idempotent: if
// priorState already recorded a target draw on/after evalResult's, this
// is a no-op -- re-running the live pipeline on an already-evaluated draw
// can't double-count. Never reads anything about draws at or after
// evalResult.targetDrawDate itself; callers are responsible for only
// calling this after the actual result for that draw has been read.
export function applyLearningUpdate(priorState, strategyId, evalResult) {
  if (priorState?.lastTargetDrawDate && priorState.lastTargetDrawDate >= evalResult.targetDrawDate) {
    return priorState;
  }
  const n = (priorState?.evaluatedCount ?? 0) + 1;
  const priorMean = priorState?.longTermMeanBrier ?? evalResult.brierScore;
  // Welford's running mean -- exact, O(1) per update, no re-scan of history.
  const longTermMeanBrier = priorMean + (evalResult.brierScore - priorMean) / n;
  const recentBriers = [...(priorState?.recentBriers ?? []), evalResult.brierScore].slice(-RECENT_BUFFER_CAP);
  return {
    strategyId,
    evaluatedCount: n,
    longTermMeanBrier,
    recentBriers,
    lastTargetDrawDate: evalResult.targetDrawDate,
    lastBrier: evalResult.brierScore,
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
    const brierScore = strategyBack2Brier(s.id, history, actual.back2);
    const prior = stateByStrategy.get(s.id) ?? null;
    updated.set(s.id, applyLearningUpdate(prior, s.id, { targetDrawDate: actual.drawDate, brierScore }));
  }
  return updated;
}

// Deployment layer: baseline weight * confidence-gated adjustment, same
// shape (|z|>2 gate, +/-15% bounded nudge) as the existing
// computeLiveAdjustedWeights in lib/models.js, just fed by the blended
// recent/long-term learned estimate instead of a cumulative binary hit
// rate re-scanned from scratch every run.
export function deployWeightsFromState(baseWeights, stateByStrategy) {
  const adjusted = baseWeights.map(({ strategy, weight }) => {
    const state = stateByStrategy.get(strategy);
    if (!state || state.evaluatedCount === 0) {
      return {
        strategy, weight, evaluatedCount: 0, windowUsed: null, adjustment: 1,
        note: "no learning state yet -- baseline weight used unchanged",
      };
    }
    const recent = state.recentBriers.slice(-RECENT_DEPLOY_WINDOW);
    const useRecent = recent.length >= RECENT_DEPLOY_WINDOW;
    const blendedBrier = useRecent ? mean(recent) : state.longTermMeanBrier;
    const nForSE = useRecent ? recent.length : state.evaluatedCount;
    const z = (RANDOM_BASELINE_BACK2_BRIER - blendedBrier) / approxSE(nForSE);
    const significant = Math.abs(z) > 2;
    const adjustment = significant ? Math.max(0.85, Math.min(1.15, 1 + z / 20)) : 1;
    const windowUsed = useRecent ? `recent-${RECENT_DEPLOY_WINDOW}` : "long-term";
    return {
      strategy, weight: weight * adjustment, evaluatedCount: state.evaluatedCount, windowUsed, blendedBrier, z, adjustment,
      note: significant
        ? `${windowUsed} Brier ${blendedBrier.toFixed(4)} vs ${RANDOM_BASELINE_BACK2_BRIER.toFixed(4)} random baseline (n=${nForSE}) -- significant, weight nudged ${adjustment > 1 ? "up" : "down"} ${Math.abs((adjustment - 1) * 100).toFixed(1)}%`
        : `${windowUsed} Brier ${blendedBrier.toFixed(4)} (n=${nForSE}) -- within noise of random baseline, no adjustment`,
    };
  });
  const total = adjusted.reduce((a, r) => a + r.weight, 0) || 1;
  return adjusted.map((r) => ({ ...r, weight: r.weight / total }));
}

// -- Supabase row <-> in-memory state mapping (snake_case <-> camelCase) --
// Kept here (not duplicated per-script) so both scripts serialize/
// deserialize identically.
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
