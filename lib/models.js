/* ---------------------------------------------------------------------- */
/* lib/models.js                                                          */
/*                                                                        */
/* Shared statistical-model + backtest logic for เฉาก๊วย.                  */
/* Moved out of app/page.js so the exact same math runs:                  */
/*   - client-side (GenerateView / ModelsView / DashboardView), and       */
/*   - server-side (scripts/run-backtest.js, via GitHub Actions).         */
/* Pure JS only — no "use client", no browser/Node-only APIs — so it      */
/* works unmodified in both places.                                      */
/*                                                                        */
/* Behavior of every function below is unchanged from the original        */
/* app/page.js implementation. New additions (probability distributions, */
/* Brier score, log loss, top-K accuracy) are appended at the bottom      */
/* under "Probabilistic scoring" and don't alter existing outputs.        */
/* ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- */
/* Digit-level stats                                                      */
/* ---------------------------------------------------------------------- */
export function allDigits(numbers) { return numbers.flatMap((n) => n.split("")); }

export function digitFrequency(numbers) {
  const digits = allDigits(numbers);
  const counts = new Array(10).fill(0);
  for (const d of digits) counts[Number(d)]++;
  const total = digits.length || 1;
  return counts.map((count, digit) => ({ digit: String(digit), count, pct: (count / total) * 100 }));
}
export function positionFrequency(numbers) {
  if (numbers.length === 0) return [];
  const width = numbers[0].length;
  const table = Array.from({ length: width }, () => new Array(10).fill(0));
  for (const n of numbers) for (let p = 0; p < n.length; p++) table[p][Number(n[p])]++;
  return table;
}
export function hotColdNumbers(draws, size = "back2") {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const universe = size === "back2" ? 100 : 1000;
  const digits = size === "back2" ? 2 : 3;
  const lastSeen = new Map(), count = new Map();
  sorted.forEach((draw) => {
    const nums = size === "back2" ? [draw.back2] : size === "back3" ? draw.back3 : draw.front3;
    for (const n of nums) { count.set(n, (count.get(n) || 0) + 1); lastSeen.set(n, draw.drawDate); }
  });
  const result = [];
  for (let i = 0; i < universe; i++) {
    const num = i.toString().padStart(digits, "0");
    const seen = lastSeen.get(num) || null;
    const gap = seen ? sorted.length - 1 - sorted.findIndex((d) => d.drawDate === seen) : sorted.length;
    result.push({ number: num, count: count.get(num) || 0, lastSeen: seen, gap });
  }
  return result.sort((a, b) => b.count - a.count || a.gap - b.gap);
}
export function oddEvenRatio(numbers) {
  const digits = allDigits(numbers).map(Number);
  const odd = digits.filter((d) => d % 2 === 1).length;
  const n = digits.length || 1;
  return { oddPct: (odd / n) * 100, evenPct: ((n - odd) / n) * 100 };
}
export function highLowDistribution(numbers) {
  const digits = allDigits(numbers).map(Number);
  const low = digits.filter((d) => d <= 4).length;
  const n = digits.length || 1;
  return { lowPct: (low / n) * 100, highPct: ((n - low) / n) * 100 };
}
export function repeatedDigitNumbers(numbers) {
  return numbers
    .map((n) => {
      const counts = new Map();
      for (const c of n) counts.set(c, (counts.get(c) || 0) + 1);
      return { number: n, maxRepeat: Math.max(...counts.values()) };
    })
    .filter((r) => r.maxRepeat >= 2);
}
export function findMirrorPairs(numbers) {
  const seen = new Set(numbers), used = new Set(), pairs = [];
  for (const n of numbers) {
    const rev = n.split("").reverse().join("");
    if (rev !== n && seen.has(rev) && !used.has(n) && !used.has(rev)) { pairs.push([n, rev]); used.add(n); used.add(rev); }
  }
  return pairs;
}
export function hasConsecutiveDigits(n) {
  for (let i = 0; i < n.length - 1; i++) if (Number(n[i + 1]) - Number(n[i]) === 1) return true;
  return false;
}

export function digitTransitionMatrix(draws, field) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const sequence = field === "back2" ? sorted.map((d) => d.back2)
    : field === "front3a" ? sorted.map((d) => d.front3[0]).filter(Boolean) : sorted.map((d) => d.back3[0]);
  const matrix = Array.from({ length: 10 }, () => new Array(10).fill(0));
  for (let i = 0; i < sequence.length - 1; i++) matrix[Number(sequence[i][0])][Number(sequence[i + 1][0])]++;
  return matrix.map((row) => {
    const total = row.reduce((a, b) => a + b, 0);
    return total > 0 ? row.map((c) => c / total) : row.map(() => 0.1);
  });
}
export function pairFrequency(draws) {
  const map = new Map();
  for (const d of draws) for (let i = 0; i < d.firstPrize.length - 1; i++) {
    const pair = d.firstPrize.slice(i, i + 2); map.set(pair, (map.get(pair) || 0) + 1);
  }
  return map;
}
export function tripleFrequency(draws) {
  const map = new Map();
  for (const d of draws) for (let i = 0; i < d.firstPrize.length - 2; i++) {
    const triple = d.firstPrize.slice(i, i + 3); map.set(triple, (map.get(triple) || 0) + 1);
  }
  return map;
}
export function bayesianDigitPosterior(numbers, pseudoCount = 2) {
  const digits = allDigits(numbers);
  const counts = new Array(10).fill(0);
  for (const d of digits) counts[Number(d)]++;
  const total = digits.length + pseudoCount * 10;
  return counts.map((c) => (c + pseudoCount) / total);
}
export function shannonEntropy(numbers) {
  const freq = digitFrequency(numbers);
  const total = freq.reduce((a, f) => a + f.count, 0) || 1;
  let entropy = 0;
  for (const f of freq) { if (!f.count) continue; const p = f.count / total; entropy -= p * Math.log2(p); }
  return entropy;
}
export function parityCorrelation(draws) {
  if (draws.length < 2) return 0;
  const x = draws.map((d) => Number(d.firstPrize.at(-1)) % 2);
  const y = draws.map((d) => Number(d.back2.at(-1)) % 2);
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { cov += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; }
  const denom = Math.sqrt(vx * vy);
  return denom === 0 ? 0 : cov / denom;
}

/* ---------------------------------------------------------------------- */
/* Deterministic RNG (seeded from the draw history so backtests are       */
/* reproducible — same history in, same picks out, every run)            */
/* ---------------------------------------------------------------------- */
export function seedFromDraws(draws) {
  const str = draws.map((d) => d.drawDate).sort().join("|");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function monteCarloDigitLocal(weights, rng = Math.random) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}
export function monteCarloNumberLocal(length, posTable, rng = Math.random) {
  let out = "";
  for (let p = 0; p < length; p++) out += monteCarloDigitLocal(posTable[p] || posTable[0] || new Array(10).fill(1), rng).toString();
  return out;
}
export function nextDrawDateFrom(draws) {
  const latest = draws[draws.length - 1];
  if (!latest) return new Date().toISOString().slice(0, 10);
  const d = new Date(latest.drawDate + "T00:00:00Z");
  if (d.getUTCDate() === 1) d.setUTCDate(16);
  else d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------------- */
/* Strategies — honestly-named statistical models                        */
/* ---------------------------------------------------------------------- */
export const STRATEGIES = [
  { id: "frequency", nameTh: "แบบจำลองความถี่", descriptionTh: "เลือกเลขจากค่าความถี่สะสมของแต่ละหลักตลอดฐานข้อมูล" },
  { id: "markov", nameTh: "แบบจำลองห่วงโซ่มาร์คอฟ", descriptionTh: "ประมาณความน่าจะเป็นของหลักถัดไป จากหลักของงวดล่าสุด" },
  { id: "monteCarlo", nameTh: "แบบจำลองมอนติคาร์โล", descriptionTh: "สุ่มตัวอย่างซ้ำจากการกระจายตัวของหลักที่เคยเกิดขึ้นจริง" },
  { id: "bayesian", nameTh: "แบบจำลองเบย์เชียน", descriptionTh: "ปรับความน่าจะเป็นแบบเบย์ด้วยข้อมูลย้อนหลัง (Laplace smoothing)" },
  { id: "gap", nameTh: "แบบจำลองเลขค้างคิว", descriptionTh: "ให้น้ำหนักกับเลขที่ไม่ออกมานานที่สุด ตามความเชื่อเรื่องเลขค้าง" },
];
export const EXPLANATIONS = {
  frequency: "อิงจากหลักที่ปรากฏบ่อยที่สุดในแต่ละตำแหน่งตลอดฐานข้อมูลย้อนหลัง",
  markov: "ต่อยอดจากหลักของผลรางวัลงวดล่าสุด ผ่านตารางความน่าจะเป็นการเปลี่ยนหลัก",
  monteCarlo: "สุ่มตัวอย่างซ้ำหลายครั้งจากการกระจายตัวของหลักในอดีต",
  bayesian: "ปรับน้ำหนักความน่าจะเป็นของแต่ละหลักแบบเบย์เชียนจากความถี่สะสม",
  gap: "เลือกเลขที่ไม่ปรากฏมานานที่สุด ตามแนวคิดเรื่อง 'เลขค้างคิว'",
};

export function frequencyPick(draws, rng = Math.random) {
  const back2Pool = draws.map((d) => d.back2), back3Pool = draws.flatMap((d) => d.back3);
  const front3Pool = draws.flatMap((d) => d.front3), firstPool = draws.map((d) => d.firstPrize);
  const pick3 = (pool) => monteCarloNumberLocal(3, positionFrequency(pool), rng);
  return {
    back2: monteCarloNumberLocal(2, positionFrequency(back2Pool), rng),
    back3: [pick3(back3Pool), pick3(back3Pool)],
    front3: [pick3(front3Pool), pick3(front3Pool)],
    first: Array.from({ length: 6 }, (_, i) => {
      const posterior = bayesianDigitPosterior([firstPool.map((n) => n[i]).join("")]);
      return monteCarloDigitLocal(posterior, rng).toString();
    }).join(""),
  };
}
export function markovPick(draws, rng = Math.random) {
  const back2Matrix = digitTransitionMatrix(draws, "back2");
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const last = sorted[sorted.length - 1];
  const nextRow = back2Matrix[last ? Number(last.back2[0]) : 0];
  const back2 = `${monteCarloDigitLocal(nextRow, rng)}${monteCarloDigitLocal(nextRow, rng)}`;
  const front3Matrix = digitTransitionMatrix(draws, "front3a"), back3Matrix = digitTransitionMatrix(draws, "back3a");
  const mkTriple = (matrix) => {
    let cur = monteCarloDigitLocal(new Array(10).fill(1), rng), seq = cur.toString();
    for (let i = 0; i < 2; i++) { cur = monteCarloDigitLocal(matrix[cur], rng); seq += cur.toString(); }
    return seq;
  };
  return {
    back2, back3: [mkTriple(back3Matrix), mkTriple(back3Matrix)], front3: [mkTriple(front3Matrix), mkTriple(front3Matrix)],
    first: Array.from({ length: 6 }, () => monteCarloDigitLocal(new Array(10).fill(1), rng).toString()).join(""),
  };
}
export function bayesianPick(draws, rng = Math.random) {
  const posterior = bayesianDigitPosterior(draws.map((d) => d.back2), 2);
  const back3P = bayesianDigitPosterior(draws.flatMap((d) => d.back3), 2);
  const front3P = bayesianDigitPosterior(draws.flatMap((d) => d.front3), 2);
  const firstP = bayesianDigitPosterior(draws.map((d) => d.firstPrize), 2);
  const mkTriple = (p) => `${monteCarloDigitLocal(p, rng)}${monteCarloDigitLocal(p, rng)}${monteCarloDigitLocal(p, rng)}`;
  return {
    back2: `${monteCarloDigitLocal(posterior, rng)}${monteCarloDigitLocal(posterior, rng)}`,
    back3: [mkTriple(back3P), mkTriple(back3P)], front3: [mkTriple(front3P), mkTriple(front3P)],
    first: Array.from({ length: 6 }, () => monteCarloDigitLocal(firstP, rng).toString()).join(""),
  };
}
export function gapPick(draws, rng = Math.random) {
  const o2 = [...hotColdNumbers(draws, "back2")].sort((a, b) => b.gap - a.gap);
  const o3 = [...hotColdNumbers(draws, "back3")].sort((a, b) => b.gap - a.gap);
  const oF3 = [...hotColdNumbers(draws, "front3")].sort((a, b) => b.gap - a.gap);
  return {
    back2: o2[0]?.number || "00",
    back3: [o3[0]?.number || "000", o3[1]?.number || "999"],
    front3: [oF3[0]?.number || "000", oF3[1]?.number || "999"],
    first: Array.from({ length: 6 }, () => monteCarloDigitLocal(new Array(10).fill(1), rng).toString()).join(""),
  };
}
export function monteCarloTopN(length, posTable, iterations, n, rng = Math.random) {
  const tally = new Map();
  for (let iter = 0; iter < iterations; iter++) {
    let candidate = "";
    for (let p = 0; p < length; p++) candidate += monteCarloDigitLocal(posTable[p] || posTable[0] || new Array(10).fill(1), rng).toString();
    tally.set(candidate, (tally.get(candidate) || 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([num]) => num);
}
export function monteCarloPick(draws, rng = Math.random, iterations = 1000) {
  const back2Pool = draws.map((d) => d.back2), back3Pool = draws.flatMap((d) => d.back3);
  const front3Pool = draws.flatMap((d) => d.front3), firstPool = draws.map((d) => d.firstPrize);
  const top2 = (pool) => {
    const picks = monteCarloTopN(3, positionFrequency(pool), iterations, 2, rng);
    return [picks[0] || "000", picks[1] || picks[0] || "999"];
  };
  return {
    back2: monteCarloTopN(2, positionFrequency(back2Pool), iterations, 1, rng)[0] || "00",
    back3: top2(back3Pool),
    front3: top2(front3Pool),
    first: monteCarloTopN(6, positionFrequency(firstPool), iterations, 1, rng)[0] || "000000",
  };
}
export function runStrategy(id, draws, rng = Math.random) {
  if (id === "frequency") return frequencyPick(draws, rng);
  if (id === "markov") return markovPick(draws, rng);
  if (id === "monteCarlo") return monteCarloPick(draws, rng);
  if (id === "bayesian") return bayesianPick(draws, rng);
  if (id === "gap") return gapPick(draws, rng);
  return frequencyPick(draws, rng);
}
export function defaultWeights() {
  return STRATEGIES.map((s) => ({ strategy: s.id, weight: 1 }));
}
export function buildCandidates(draws, weights, count = 3) {
  const weightMap = new Map(weights.map((w) => [w.strategy, w.weight]));
  const totalWeight = STRATEGIES.reduce((a, s) => a + (weightMap.get(s.id) ?? 1), 0) || 1;
  const rng = makeRng(seedFromDraws(draws));
  const picks = STRATEGIES.map((s) => ({ strategy: s.id, pick: runStrategy(s.id, draws, rng) }));

  function digitVotes(field, slot, pos) {
    const tally = new Array(10).fill(0);
    for (const { strategy, pick } of picks) {
      const w = weightMap.get(strategy) ?? 1;
      const str = slot == null ? pick[field] : pick[field][slot];
      const d = Number(str?.[pos]);
      if (!Number.isNaN(d)) tally[d] += w;
    }
    return tally.map((weight, digit) => ({ digit, weight })).sort((a, b) => b.weight - a.weight);
  }
  function ensembleField(field, slot, length) {
    const perPosition = Array.from({ length }, (_, pos) => digitVotes(field, slot, pos));
    return { value: perPosition.map((v) => v[0].digit).join(""), perPosition };
  }

  const back2 = ensembleField("back2", null, 2);
  const back3a = ensembleField("back3", 0, 3), back3b = ensembleField("back3", 1, 3);
  const front3a = ensembleField("front3", 0, 3), front3b = ensembleField("front3", 1, 3);
  const first = ensembleField("first", null, 6);

  const slackOrder = back2.perPosition
    .map((votes, pos) => ({ pos, slack: votes[0].weight - (votes[1]?.weight ?? 0) }))
    .sort((a, b) => a.slack - b.slack);

  const candidates = [];
  for (let rank = 1; rank <= count; rank++) {
    let back2Value = back2.value;
    if (rank > 1 && slackOrder[rank - 2]) {
      const { pos } = slackOrder[rank - 2];
      const runnerUp = back2.perPosition[pos][1]?.digit ?? back2.perPosition[pos][0].digit;
      back2Value = back2Value.slice(0, pos) + runnerUp + back2Value.slice(pos + 1);
    }
    const agreeing = picks.filter((p) => p.pick.back2 === back2Value).map((p) => p.strategy);
    const agreementScore = Math.round((agreeing.reduce((a, s) => a + (weightMap.get(s) ?? 1), 0) / totalWeight) * 100);
    const avgConsensus = Math.round(
      (back2.perPosition.reduce((a, v) => a + v[0].weight / totalWeight, 0) / back2.perPosition.length) * 100
    );
    candidates.push({
      rank,
      firstPrize: first.value,
      front3: [front3a.value, front3b.value],
      back3: [back3a.value, back3b.value],
      back2: back2Value,
      agreementScore: Math.max(agreementScore, Math.round(100 / STRATEGIES.length)),
      statisticalScore: Math.max(avgConsensus, Math.round(100 / STRATEGIES.length)),
      contributingStrategies: agreeing.length ? agreeing : STRATEGIES.map((s) => s.id),
      explanationTh: rank === 1
        ? "รวมน้ำหนักจากทุกแบบจำลองตามผลทดสอบย้อนหลังจริง เลือกหลักที่ได้น้ำหนักโหวตสูงสุดในแต่ละตำแหน่ง"
        : "ตัวแปรรอง จากตำแหน่งที่แบบจำลองต่าง ๆ มีความเห็นก้ำกึ่งที่สุด",
    });
  }
  return candidates;
}

/* ---------------------------------------------------------------------- */
/* Backtest — honest self-learning substitute                             */
/* ---------------------------------------------------------------------- */
export const MIN_WARMUP = 5;
export function runBacktest(draws) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const results = [];
  for (let i = MIN_WARMUP; i < sorted.length; i++) {
    const history = sorted.slice(0, i), actual = sorted[i];
    const rng = makeRng(seedFromDraws(history));
    for (const s of STRATEGIES) {
      const pick = runStrategy(s.id, history, rng);
      results.push({
        strategy: s.id, drawDate: actual.drawDate,
        hitBack2: pick.back2 === actual.back2,
        hitBack3: actual.back3.some((n) => pick.back3.includes(n)),
        hitFront3: pick.front3.includes(actual.front3[0]) || pick.front3.includes(actual.front3[1]),
      });
    }
  }
  return results;
}
export function summarizeBacktest(results) {
  const byStrategy = new Map();
  for (const r of results) byStrategy.set(r.strategy, [...(byStrategy.get(r.strategy) || []), r]);
  return Array.from(byStrategy.entries()).map(([strategy, rows]) => {
    const n = rows.length || 1;
    const b2 = rows.filter((r) => r.hitBack2).length, b3 = rows.filter((r) => r.hitBack3).length, f3 = rows.filter((r) => r.hitFront3).length;
    return { strategy, runs: rows.length, back2HitRate: b2 / n, back3HitRate: b3 / n, front3HitRate: f3 / n, compositeScore: (b2 * 3 + b3 + f3) / n };
  });
}
export function deriveWeights(results) {
  const summary = summarizeBacktest(results);
  const maxScore = Math.max(...summary.map((s) => s.compositeScore), 0.0001);
  return STRATEGIES.map((s) => {
    const row = summary.find((r) => r.strategy === s.id);
    return { strategy: s.id, weight: row ? 0.5 + (row.compositeScore / maxScore) * 0.5 : 1, backtestAccuracy: row ? row.back2HitRate : 0 };
  });
}

/* ---------------------------------------------------------------------- */
/* Probabilistic scoring — NEW                                            */
/*                                                                        */
/* The picks above are single hard guesses, which only support hit/miss  */
/* rates. Brier score, log loss, and top-K accuracy need each model to    */
/* expose a full probability distribution over all 100 back2 outcomes    */
/* (00-99), not just one pick. This section derives that distribution     */
/* from the SAME per-position tables the pick functions already build     */
/* (frequency table, Bayesian posterior, Markov transition row), assuming */
/* the two back2 digit positions are independent — the same independence  */
/* assumption the sampling-based picks above already make.                */
/* ---------------------------------------------------------------------- */

export function strategyBack2DigitProbs(id, draws) {
  const back2Pool = draws.map((d) => d.back2);
  if (id === "frequency" || id === "monteCarlo") {
    const table = positionFrequency(back2Pool);
    return table.map((row) => { const t = row.reduce((a, b) => a + b, 0); return row.map((c) => c / t); });
  }
  if (id === "bayesian") {
    const p = bayesianDigitPosterior(back2Pool, 2);
    return [p, p];
  }
  if (id === "markov") {
    const matrix = digitTransitionMatrix(draws, "back2");
    const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
    const last = sorted[sorted.length - 1];
    const row = matrix[last ? Number(last.back2[0]) : 0];
    return [row, row];
  }
  if (id === "gap") {
    // Longer gap since last seen -> more weight ("numbers are due"). Purely a
    // documented gambler's-fallacy-style heuristic; the backtest below scores
    // it exactly like every other model, no special treatment.
    const gaps = hotColdNumbers(draws, "back2");
    const gapByDigitPos = [new Array(10).fill(1), new Array(10).fill(1)];
    for (const g of gaps) { gapByDigitPos[0][Number(g.number[0])] += g.gap; gapByDigitPos[1][Number(g.number[1])] += g.gap; }
    return gapByDigitPos.map((row) => { const t = row.reduce((a, b) => a + b, 0); return row.map((c) => c / t); });
  }
  const uniform = new Array(10).fill(0.1);
  return [uniform, uniform];
}

export function back2FullDistribution([p0, p1]) {
  const dist = new Array(100);
  for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) dist[a * 10 + b] = p0[a] * p1[b];
  return dist;
}
function back2ToIndex(back2) { return Number(back2[0]) * 10 + Number(back2[1]); }

export function runProbabilisticBacktest(draws, topKs = [1, 5, 10, 20]) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const rows = [];
  for (let i = MIN_WARMUP; i < sorted.length; i++) {
    const history = sorted.slice(0, i), actual = sorted[i];
    const actualIdx = back2ToIndex(actual.back2);
    for (const s of STRATEGIES) {
      const dist = back2FullDistribution(strategyBack2DigitProbs(s.id, history));
      const probAssigned = dist[actualIdx];
      const brierTerm = dist.reduce((sum, p, idx) => sum + (p - (idx === actualIdx ? 1 : 0)) ** 2, 0);
      const ranked = dist.map((p, idx) => idx).sort((a, b) => dist[b] - dist[a]);
      const rankOfActual = ranked.indexOf(actualIdx) + 1;
      const row = { strategy: s.id, drawDate: actual.drawDate, probAssigned, brierTerm, logLossTerm: -Math.log(Math.max(probAssigned, 1e-9)), rankOfActual };
      for (const k of topKs) row[`top${k}`] = rankOfActual <= k;
      rows.push(row);
    }
  }
  return rows;
}

export function summarizeProbabilisticBacktest(rows, topKs = [1, 5, 10, 20]) {
  const byStrategy = new Map();
  for (const r of rows) byStrategy.set(r.strategy, [...(byStrategy.get(r.strategy) || []), r]);
  const randomBaseline = { brierScore: (1 - 0.01) ** 2 + 99 * (0.01 ** 2), logLoss: -Math.log(0.01) };
  return Array.from(byStrategy.entries()).map(([strategy, group]) => {
    const n = group.length || 1;
    const out = {
      strategy, runs: group.length,
      brierScore: group.reduce((a, r) => a + r.brierTerm, 0) / n,
      logLoss: group.reduce((a, r) => a + r.logLossTerm, 0) / n,
      meanRank: group.reduce((a, r) => a + r.rankOfActual, 0) / n,
    };
    for (const k of topKs) out[`top${k}Accuracy`] = group.filter((r) => r[`top${k}`]).length / n;
    return { ...out, randomBaseline };
  });
}

export function isIndistinguishableFromChance(summaryRow, drawCount) {
  const approxSE = 0.02 / Math.sqrt(Math.max(drawCount, 1));
  return Math.abs(summaryRow.brierScore - summaryRow.randomBaseline.brierScore) < 2 * approxSE;
}
