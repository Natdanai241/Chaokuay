/* ---------------------------------------------------------------------- */
/* lib/models.js                                                          */
/*                                                                        */
/* Shared statistical-model + backtest logic for เฉาก๊วย.                  */
/* Pure JS only — no "use client", no browser/Node-only APIs — so it      */
/* works from both app/page.js (client) and scripts/run-backtest.js       */
/* (server, via GitHub Actions).                                          */
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

export const STRATEGIES = [
  { id: "frequency", nameTh: "แบบจำลองความถี่", descriptionTh: "เลือกเลขจากค่าความถี่สะสมของแต่ละหลักตลอดฐานข้อมูล" },
  { id: "markov", nameTh: "แบบจำลองห่วงโซ่มาร์คอฟ", descriptionTh: "ประมาณความน่าจะเป็นของหลักถัดไป จากหลักของงวดล่าสุด" },
  { id: "monteCarlo", nameTh: "แบบจำลองมอนติคาร์โล", descriptionTh: "สุ่มตัวอย่างซ้ำจากการกระจายตัวของหลักที่เคยเกิดขึ้นจริง" },
  { id: "bayesian", nameTh: "แบบจำลองเบย์เชียน", descriptionTh: "ปรับความน่าจะเป็นแบบเบย์ด้วยข้อมูลย้อนหลัง (Laplace smoothing)" },
  { id: "gap", nameTh: "แบบจำลองเลขค้างคิว", descriptionTh: "ให้น้ำหนักกับเลขที่ไม่ออกมานานที่สุด ตามความเชื่อเรื่องเลขค้าง" },
  { id: "entropy", nameTh: "แบบจำลองเอนโทรปี", descriptionTh: "ให้น้ำหนักหลักที่ปรากฏน้อยกว่าค่าเฉลี่ย (มี 'ปริมาณข้อมูล' สูงกว่าในเชิงทฤษฎีข้อมูล)" },
  { id: "pairCorrelation", nameTh: "แบบจำลองสหสัมพันธ์คู่หลัก", descriptionTh: "ประมาณความน่าจะเป็นของหลักถัดไป จากหลักก่อนหน้าในเลขตัวเดียวกัน (ไม่ใช่งวดก่อนหน้า)" },
  { id: "tripletCorrelation", nameTh: "แบบจำลองสหสัมพันธ์สามหลัก", descriptionTh: "ต่อยอดจากคู่หลัก โดยพิจารณาหลักสองตัวก่อนหน้าร่วมกัน" },
  { id: "digitalRoot", nameTh: "แบบจำลองเลขศาสตร์ (Digital Root)", descriptionTh: "ให้น้ำหนักเลขที่ผลรวมหลัก (บวกซ้ำจนเหลือหลักเดียว) ตรงกับค่าที่พบบ่อยที่สุดในอดีต" },
  { id: "mirrorNumber", nameTh: "แบบจำลองเลขกลับหลัก", descriptionTh: "ให้น้ำหนักเลขตามความถี่ของตัวเองรวมกับความถี่ของเลขที่กลับหลักกัน" },
  { id: "digitMomentum", nameTh: "แบบจำลองโมเมนตัมของหลัก", descriptionTh: "เทียบความถี่ของหลักในช่วงล่าสุดกับค่าเฉลี่ยทั้งหมด ให้น้ำหนักหลักที่มีแนวโน้มเพิ่มขึ้น" },
];
export const EXPLANATIONS = {
  frequency: "อิงจากหลักที่ปรากฏบ่อยที่สุดในแต่ละตำแหน่งตลอดฐานข้อมูลย้อนหลัง",
  markov: "ต่อยอดจากหลักของผลรางวัลงวดล่าสุด ผ่านตารางความน่าจะเป็นการเปลี่ยนหลัก",
  monteCarlo: "สุ่มตัวอย่างซ้ำหลายครั้งจากการกระจายตัวของหลักในอดีต",
  bayesian: "ปรับน้ำหนักความน่าจะเป็นของแต่ละหลักแบบเบย์เชียนจากความถี่สะสม",
  gap: "เลือกเลขที่ไม่ปรากฏมานานที่สุด ตามแนวคิดเรื่อง 'เลขค้างคิว'",
  entropy: "ให้น้ำหนักตามส่วนกลับของความถี่ หลักที่หายากกว่าได้น้ำหนักมากกว่า",
  pairCorrelation: "เงื่อนไขความน่าจะเป็นของหลักที่ p จากหลักที่ p-1 ในเลขเดียวกัน (สหสัมพันธ์ภายในเลข ไม่ใช่ระหว่างงวด)",
  tripletCorrelation: "เงื่อนไขความน่าจะเป็นของหลักที่ p จากหลักสองตัวก่อนหน้า (p-2, p-1) ร่วมกัน",
  digitalRoot: "ผลรวมหลักซ้ำจนเหลือหลักเดียว (numerology) — ให้น้ำหนักเลขที่ผลรวมนี้ตรงกับค่าที่พบบ่อยในอดีต",
  mirrorNumber: "เลขที่กลับหลักกันแล้วเคยออกทั้งคู่ ได้น้ำหนักสูงกว่า ตามความเชื่อเรื่อง 'เลขคู่กลับ'",
  digitMomentum: "เปรียบเทียบความถี่ในช่วง 25% หลังสุดของข้อมูล กับความถี่เฉลี่ยทั้งหมด",
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
export function buildConditionalTable(numbers, order) {
  const tables = [];
  for (const n of numbers) {
    for (let p = order; p < n.length; p++) {
      const key = n.slice(p - order, p);
      const digit = Number(n[p]);
      tables[p] = tables[p] || new Map();
      const inner = tables[p].get(key) || new Array(10).fill(0);
      inner[digit]++;
      tables[p].set(key, inner);
    }
  }
  return tables;
}
export function entropyWeights(numbers) {
  const table = positionFrequency(numbers);
  return table.map((row) => {
    const total = row.reduce((a, b) => a + b, 0) || 1;
    const inv = row.map((c) => 1 / (c / total + 0.05));
    const invTotal = inv.reduce((a, b) => a + b, 0);
    return inv.map((v) => (v / invTotal) * total);
  });
}
function pickWithConditional(length, marginalTable, conditionalTables, order, rng) {
  const digits = [];
  for (let p = 0; p < length; p++) {
    if (p < order || !conditionalTables[p]) {
      digits.push(monteCarloDigitLocal(marginalTable[p] || marginalTable[0] || new Array(10).fill(1), rng));
      continue;
    }
    const key = digits.slice(p - order, p).join("");
    const row = conditionalTables[p].get(key);
    digits.push(monteCarloDigitLocal(row && row.some((x) => x > 0) ? row : marginalTable[p] || new Array(10).fill(1), rng));
  }
  return digits.join("");
}
export function entropyPick(draws, rng = Math.random) {
  const back2Pool = draws.map((d) => d.back2), back3Pool = draws.flatMap((d) => d.back3);
  const front3Pool = draws.flatMap((d) => d.front3), firstPool = draws.map((d) => d.firstPrize);
  const pick = (pool, length) => monteCarloNumberLocal(length, entropyWeights(pool), rng);
  return {
    back2: pick(back2Pool, 2), back3: [pick(back3Pool, 3), pick(back3Pool, 3)],
    front3: [pick(front3Pool, 3), pick(front3Pool, 3)], first: pick(firstPool, 6),
  };
}
export function pairCorrelationPick(draws, rng = Math.random) {
  const back2Pool = draws.map((d) => d.back2), back3Pool = draws.flatMap((d) => d.back3);
  const front3Pool = draws.flatMap((d) => d.front3), firstPool = draws.map((d) => d.firstPrize);
  const pick = (pool, length) => pickWithConditional(length, positionFrequency(pool), buildConditionalTable(pool, 1), 1, rng);
  return {
    back2: pick(back2Pool, 2), back3: [pick(back3Pool, 3), pick(back3Pool, 3)],
    front3: [pick(front3Pool, 3), pick(front3Pool, 3)], first: pick(firstPool, 6),
  };
}
export function tripletCorrelationPick(draws, rng = Math.random) {
  const back3Pool = draws.flatMap((d) => d.back3), front3Pool = draws.flatMap((d) => d.front3), firstPool = draws.map((d) => d.firstPrize);
  const pick3plus = (pool, length) => pickWithConditional(length, positionFrequency(pool), buildConditionalTable(pool, 2), 2, rng);
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const triples = new Map();
  for (let i = 1; i < sorted.length; i++) {
    const key = sorted[i - 1].back2[1] + sorted[i].back2[0];
    const row = triples.get(key) || new Array(10).fill(0);
    row[Number(sorted[i].back2[1])]++;
    triples.set(key, row);
  }
  const marginal = positionFrequency(sorted.map((d) => d.back2));
  const digit0 = monteCarloDigitLocal(marginal[0] || new Array(10).fill(1), rng);
  const lastBack2 = sorted[sorted.length - 1]?.back2 || "00";
  const key = lastBack2[1] + digit0.toString();
  const row = triples.get(key);
  const digit1 = monteCarloDigitLocal(row && row.some((x) => x > 0) ? row : marginal[1] || new Array(10).fill(1), rng);
  return {
    back2: `${digit0}${digit1}`,
    back3: [pick3plus(back3Pool, 3), pick3plus(back3Pool, 3)],
    front3: [pick3plus(front3Pool, 3), pick3plus(front3Pool, 3)],
    first: pick3plus(firstPool, 6),
  };
}
function digitalRoot(numStr) {
  let n = numStr.split("").reduce((a, d) => a + Number(d), 0);
  while (n >= 10) n = String(n).split("").reduce((a, d) => a + Number(d), 0);
  return n;
}
export function digitalRootPick(draws, rng = Math.random) {
  const pick = (pool) => {
    const freq = new Map();
    for (const n of pool) freq.set(n, (freq.get(n) || 0) + 1);
    const candidates = [...freq.keys()];
    if (candidates.length === 0) return null;
    const rootCounts = new Array(10).fill(0);
    for (const n of pool) rootCounts[digitalRoot(n)]++;
    const rootTotal = rootCounts.reduce((a, b) => a + b, 0) || 1;
    const weights = candidates.map((n) => (freq.get(n) || 0) * ((rootCounts[digitalRoot(n)] + 1) / (rootTotal + 10)) + 0.1);
    return candidates[monteCarloDigitLocal(weights, rng)];
  };
  const back2Pool = draws.map((d) => d.back2), back3Pool = draws.flatMap((d) => d.back3);
  const front3Pool = draws.flatMap((d) => d.front3), firstPool = draws.map((d) => d.firstPrize);
  return {
    back2: pick(back2Pool) || "00", back3: [pick(back3Pool) || "000", pick(back3Pool) || "999"],
    front3: [pick(front3Pool) || "000", pick(front3Pool) || "999"], first: pick(firstPool) || "000000",
  };
}
export function mirrorNumberPick(draws, rng = Math.random) {
  const pick = (pool) => {
    const freq = new Map();
    for (const n of pool) freq.set(n, (freq.get(n) || 0) + 1);
    const candidates = [...freq.keys()];
    if (candidates.length === 0) return null;
    const weights = candidates.map((n) => {
      const mirror = n.split("").reverse().join("");
      return (freq.get(n) || 0) + (freq.get(mirror) || 0) + 0.5;
    });
    return candidates[monteCarloDigitLocal(weights, rng)];
  };
  const back2Pool = draws.map((d) => d.back2), back3Pool = draws.flatMap((d) => d.back3);
  const front3Pool = draws.flatMap((d) => d.front3), firstPool = draws.map((d) => d.firstPrize);
  return {
    back2: pick(back2Pool) || "00", back3: [pick(back3Pool) || "000", pick(back3Pool) || "999"],
    front3: [pick(front3Pool) || "000", pick(front3Pool) || "999"], first: pick(firstPool) || "000000",
  };
}
export function digitMomentumWeights(numbers, recentFraction = 0.25) {
  const recentCount = Math.max(5, Math.floor(numbers.length * recentFraction));
  const recent = numbers.slice(-recentCount);
  const overallTable = positionFrequency(numbers);
  const recentTable = positionFrequency(recent);
  return overallTable.map((row, p) => {
    const rRow = recentTable[p] || row;
    const oTotal = row.reduce((a, b) => a + b, 0) || 1;
    const rTotal = rRow.reduce((a, b) => a + b, 0) || 1;
    return row.map((c, d) => {
      const momentum = (rRow[d] || 0) / rTotal - c / oTotal;
      return Math.max(0.05, c + momentum * oTotal * 3);
    });
  });
}
export function digitMomentumPick(draws, rng = Math.random) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const back2Pool = sorted.map((d) => d.back2), back3Pool = sorted.flatMap((d) => d.back3);
  const front3Pool = sorted.flatMap((d) => d.front3), firstPool = sorted.map((d) => d.firstPrize);
  const pick = (pool, length) => monteCarloNumberLocal(length, digitMomentumWeights(pool), rng);
  return {
    back2: pick(back2Pool, 2), back3: [pick(back3Pool, 3), pick(back3Pool, 3)],
    front3: [pick(front3Pool, 3), pick(front3Pool, 3)], first: pick(firstPool, 6),
  };
}
export function runStrategy(id, draws, rng = Math.random) {
  if (id === "frequency") return frequencyPick(draws, rng);
  if (id === "markov") return markovPick(draws, rng);
  if (id === "monteCarlo") return monteCarloPick(draws, rng);
  if (id === "bayesian") return bayesianPick(draws, rng);
  if (id === "gap") return gapPick(draws, rng);
  if (id === "entropy") return entropyPick(draws, rng);
  if (id === "pairCorrelation") return pairCorrelationPick(draws, rng);
  if (id === "tripletCorrelation") return tripletCorrelationPick(draws, rng);
  if (id === "digitalRoot") return digitalRootPick(draws, rng);
  if (id === "mirrorNumber") return mirrorNumberPick(draws, rng);
  if (id === "digitMomentum") return digitMomentumPick(draws, rng);
  return frequencyPick(draws, rng);
}
export function defaultWeights() {
  return STRATEGIES.map((s) => ({ strategy: s.id, weight: 1 }));
}
export function computeStrategyPicks(draws, rng) {
  return STRATEGIES.map((s) => ({ strategy: s.id, pick: runStrategy(s.id, draws, rng) }));
}

export function positionMatchPct(predicted, actual) {
  if (!predicted || !actual || predicted.length !== actual.length) return 0;
  let matches = 0;
  for (let i = 0; i < actual.length; i++) if (predicted[i] === actual[i]) matches++;
  return (matches / actual.length) * 100;
}

export function bestPositionMatchPct(predictedValues, actualValues) {
  let best = 0;
  for (const p of predictedValues) for (const a of actualValues) best = Math.max(best, positionMatchPct(p, a));
  return best;
}

export function scoreStrategyPick(pick, actual) {
  return {
    back2MatchPct: positionMatchPct(pick.back2, actual.back2),
    front3MatchPct: bestPositionMatchPct(pick.front3, actual.front3),
    back3MatchPct: bestPositionMatchPct(pick.back3, actual.back3),
    firstPrizeMatchPct: positionMatchPct(pick.first, actual.firstPrize),
  };
}

export function buildCandidates(draws, weights, count = 3) {
  const weightMap = new Map(weights.map((w) => [w.strategy, w.weight]));
  const totalWeight = STRATEGIES.reduce((a, s) => a + (weightMap.get(s.id) ?? 1), 0) || 1;
  const rng = makeRng(seedFromDraws(draws));
  const picks = computeStrategyPicks(draws, rng);

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
    const gaps = hotColdNumbers(draws, "back2");
    const gapByDigitPos = [new Array(10).fill(1), new Array(10).fill(1)];
    for (const g of gaps) { gapByDigitPos[0][Number(g.number[0])] += g.gap; gapByDigitPos[1][Number(g.number[1])] += g.gap; }
    return gapByDigitPos.map((row) => { const t = row.reduce((a, b) => a + b, 0); return row.map((c) => c / t); });
  }
  if (id === "digitMomentum") {
    const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
    const table = digitMomentumWeights(sorted.map((d) => d.back2));
    return table.map((row) => { const t = row.reduce((a, b) => a + b, 0); return row.map((c) => c / t); });
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
function laplaceRow(row, alpha = 0.5) {
  if (!row) return new Array(10).fill(0.1);
  const total = row.reduce((a, b) => a + b, 0);
  return row.map((c) => (c + alpha) / (total + alpha * 10));
}
export function strategyBack2FullDistribution(id, draws) {
  const back2Pool = draws.map((d) => d.back2);
  if (id === "pairCorrelation") {
    const marginal0 = laplaceRow(positionFrequency(back2Pool)[0]);
    const cond = buildConditionalTable(back2Pool, 1)[1];
    const dist = new Array(100).fill(0);
    for (let d0 = 0; d0 < 10; d0++) {
      const p1given0 = laplaceRow(cond?.get(String(d0)));
      for (let d1 = 0; d1 < 10; d1++) dist[d0 * 10 + d1] = marginal0[d0] * p1given0[d1];
    }
    return dist;
  }
  if (id === "tripletCorrelation") {
    const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
    const marginal0 = laplaceRow(positionFrequency(sorted.map((d) => d.back2))[0]);
    const triples = new Map();
    for (let i = 1; i < sorted.length; i++) {
      const key = sorted[i - 1].back2[1] + sorted[i].back2[0];
      const row = triples.get(key) || new Array(10).fill(0);
      row[Number(sorted[i].back2[1])]++;
      triples.set(key, row);
    }
    const lastBack2 = sorted[sorted.length - 1]?.back2 || "00";
    const dist = new Array(100).fill(0);
    for (let d0 = 0; d0 < 10; d0++) {
      const p1 = laplaceRow(triples.get(lastBack2[1] + d0.toString()));
      for (let d1 = 0; d1 < 10; d1++) dist[d0 * 10 + d1] = marginal0[d0] * p1[d1];
    }
    return dist;
  }
  if (id === "entropy") return back2FullDistribution(entropyWeights(back2Pool).map(laplaceRow));
  if (id === "digitalRoot") {
    const rootCounts = new Array(10).fill(0);
    for (const n of back2Pool) rootCounts[digitalRoot(n)]++;
    const rootTotal = rootCounts.reduce((a, b) => a + b, 0) || 1;
    const dist = new Array(100);
    for (let i = 0; i < 100; i++) dist[i] = (rootCounts[digitalRoot(i.toString().padStart(2, "0"))] + 1) / (rootTotal + 10);
    const s = dist.reduce((a, b) => a + b, 0);
    return dist.map((v) => v / s);
  }
  if (id === "mirrorNumber") {
    const freq = new Array(100).fill(0);
    for (const n of back2Pool) freq[back2ToIndex(n)]++;
    const total = freq.reduce((a, b) => a + b, 0) || 1;
    const dist = new Array(100);
    for (let i = 0; i < 100; i++) {
      const mirrorIdx = back2ToIndex(i.toString().padStart(2, "0").split("").reverse().join(""));
      dist[i] = (freq[i] + freq[mirrorIdx] + 1) / (2 * total + 100);
    }
    const s = dist.reduce((a, b) => a + b, 0);
    return dist.map((v) => v / s);
  }
  return back2FullDistribution(strategyBack2DigitProbs(id, draws));
}

export function runProbabilisticBacktest(draws, topKs = [1, 5, 10, 20]) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const rows = [];
  for (let i = MIN_WARMUP; i < sorted.length; i++) {
    const history = sorted.slice(0, i), actual = sorted[i];
    const actualIdx = back2ToIndex(actual.back2);
    for (const s of STRATEGIES) {
      const dist = strategyBack2FullDistribution(s.id, history);
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

/* ---------------------------------------------------------------------- */
/* Feature discovery                                                      */
/*                                                                        */
/* Engineered features as independent building blocks (not full models). */
/* Greedy forward selection on a 70% "selection" slice, keeping a feature */
/* only if it clears a noise threshold; the final set is then scored ONCE */
/* on the untouched final 30% (held_out) -- selection never sees that      */
/* slice, so held-out performance isn't inflated by the search itself.    */
/* ---------------------------------------------------------------------- */

export function featureFreq(draws) {
  return positionFrequency(draws.map((d) => d.back2)).map((row) => row.map((c) => c + 0.5));
}
export function featureGap(draws) {
  const gaps = hotColdNumbers(draws, "back2");
  const perPos = [new Array(10).fill(0), new Array(10).fill(0)];
  for (const g of gaps) { perPos[0][Number(g.number[0])] += g.gap; perPos[1][Number(g.number[1])] += g.gap; }
  return perPos.map((row) => row.map((v) => v + 1));
}
export function featureEntropy(draws) {
  return entropyWeights(draws.map((d) => d.back2));
}
export function featureMomentum(draws) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  return digitMomentumWeights(sorted.map((d) => d.back2)).map((row) => row.map((v) => Math.max(v, 0.01)));
}
export function featureMovingAverage(draws, halfLife = 40) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const decay = Math.pow(0.5, 1 / halfLife);
  const ewma = [new Array(10).fill(0.1), new Array(10).fill(0.1)];
  for (const d of sorted) {
    for (let p = 0; p < 2; p++) {
      for (let digit = 0; digit < 10; digit++) ewma[p][digit] *= decay;
      ewma[p][Number(d.back2[p])] += 1;
    }
  }
  return ewma;
}
export function featureTransition(draws) {
  const matrix = digitTransitionMatrix(draws, "back2");
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const last = sorted[sorted.length - 1];
  const row = matrix[last ? Number(last.back2[0]) : 0].map((v) => v + 0.01);
  return [row, row];
}
export function featurePairCorrelation(draws) {
  const back2Pool = draws.map((d) => d.back2);
  const cond = buildConditionalTable(back2Pool, 1)[1];
  const marginal0 = laplaceRow(positionFrequency(back2Pool)[0]);
  const avgP1 = new Array(10).fill(0);
  for (let d0 = 0; d0 < 10; d0++) {
    const row = laplaceRow(cond?.get(String(d0)));
    for (let d1 = 0; d1 < 10; d1++) avgP1[d1] += marginal0[d0] * row[d1];
  }
  return [marginal0, avgP1];
}

export const FEATURES = [
  { id: "freq", label: "ความถี่ดิบ" },
  { id: "gap", label: "ช่วงห่างจากครั้งล่าสุด" },
  { id: "entropy", label: "เอนโทรปี (ส่วนกลับความถี่)" },
  { id: "momentum", label: "โมเมนตัมล่าสุด" },
  { id: "movingAverage", label: "ค่าเฉลี่ยเคลื่อนที่ถ่วงน้ำหนักเอกซ์โพเนนเชียล" },
  { id: "transition", label: "การเปลี่ยนสถานะ (มาร์คอฟ)" },
  { id: "pairCorrelation", label: "สหสัมพันธ์คู่หลัก" },
];
const FEATURE_FNS = {
  freq: featureFreq, gap: featureGap, entropy: featureEntropy, momentum: featureMomentum,
  movingAverage: featureMovingAverage, transition: featureTransition, pairCorrelation: featurePairCorrelation,
};

function normalizeRow(row) {
  const t = row.reduce((a, b) => a + b, 0) || 1;
  return row.map((v) => v / t);
}
export function combineFeatures(featureIds, draws) {
  const perPos = [new Array(10).fill(0), new Array(10).fill(0)];
  if (featureIds.length === 0) return [new Array(10).fill(0.1), new Array(10).fill(0.1)];
  for (const id of featureIds) {
    const raw = FEATURE_FNS[id](draws);
    for (let p = 0; p < 2; p++) {
      const norm = normalizeRow(raw[p]);
      for (let d = 0; d < 10; d++) perPos[p][d] += norm[d] / featureIds.length;
    }
  }
  return perPos;
}
export function walkForwardBrierForFeatureSet(featureIds, draws) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  let total = 0, n = 0;
  for (let i = MIN_WARMUP; i < sorted.length; i++) {
    const history = sorted.slice(0, i), actual = sorted[i];
    const dist = back2FullDistribution(combineFeatures(featureIds, history));
    const actualIdx = back2ToIndex(actual.back2);
    total += dist.reduce((sum, p, idx) => sum + (p - (idx === actualIdx ? 1 : 0)) ** 2, 0);
    n++;
  }
  return { brierScore: total / (n || 1), n };
}
export function runFeatureDiscovery(draws, trainFraction = 0.7) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const splitIdx = Math.floor(sorted.length * trainFraction);
  const selectionSet = sorted.slice(0, splitIdx);

  let selected = [];
  let currentBrier = walkForwardBrierForFeatureSet([], selectionSet).brierScore;
  const log = [];
  let remaining = FEATURES.map((f) => f.id);

  while (remaining.length > 0) {
    let best = null, bestBrier = currentBrier, bestImprovement = 0;
    for (const id of remaining) {
      const { brierScore } = walkForwardBrierForFeatureSet([...selected, id], selectionSet);
      if (brierScore < bestBrier) { best = id; bestBrier = brierScore; bestImprovement = currentBrier - brierScore; }
    }
    const n = Math.max(selectionSet.length - MIN_WARMUP, 1);
    const threshold = 2 * (0.02 / Math.sqrt(n));
    const accepted = Boolean(best) && bestImprovement > threshold;
    log.push({ step: selected.length + 1, candidate: best, improvement: bestImprovement, threshold, accepted });
    if (accepted) { selected.push(best); currentBrier = bestBrier; remaining = remaining.filter((id) => id !== best); }
    else break;
  }

  let heldOutTotal = 0, heldOutN = 0;
  for (let i = Math.max(MIN_WARMUP, splitIdx); i < sorted.length; i++) {
    const history = sorted.slice(0, i), actual = sorted[i];
    const dist = back2FullDistribution(combineFeatures(selected, history));
    const actualIdx = back2ToIndex(actual.back2);
    heldOutTotal += dist.reduce((sum, p, idx) => sum + (p - (idx === actualIdx ? 1 : 0)) ** 2, 0);
    heldOutN++;
  }
  const heldOutBrier = heldOutTotal / (heldOutN || 1);
  const randomBaselineBrier = (1 - 0.01) ** 2 + 99 * 0.01 ** 2;
  const heldOutSE = 0.02 / Math.sqrt(heldOutN || 1);

  return {
    selectedFeatures: selected,
    selectionLog: log,
    selectionSetSize: selectionSet.length,
    heldOutBrier, heldOutSampleSize: heldOutN, randomBaselineBrier,
    beatsBaselineOnHeldOut: heldOutBrier < randomBaselineBrier - 2 * heldOutSE,
  };
}

/* ---------------------------------------------------------------------- */
/* Evolution engine                                                       */
/*                                                                        */
/* Searches ensemble WEIGHT VECTORS (one weight per strategy) rather than */
/* re-running the expensive per-strategy math for every candidate: each   */
/* strategy's distribution at each walk-forward step is computed ONCE and */
/* cached, then thousands of candidate weight combinations are scored     */
/* cheaply against that cache. Same 70/30 selection/held-out split as     */
/* feature discovery, for the same reason -- a search this flexible is    */
/* exactly the kind that can "discover" an ensemble that fits noise in    */
/* the selection slice; only held-out performance says whether it's real. */
/* ---------------------------------------------------------------------- */

export function precomputeStrategyDistributions(draws, fromIdx, toIdx) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const cache = [];
  for (let i = fromIdx; i < toIdx; i++) {
    const history = sorted.slice(0, i), actual = sorted[i];
    const dists = {};
    for (const s of STRATEGIES) dists[s.id] = strategyBack2FullDistribution(s.id, history);
    cache.push({ dists, actualIdx: back2ToIndex(actual.back2) });
  }
  return cache;
}
export function fitnessForWeights(weightVector, cache) {
  const total = weightVector.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
  let totalBrier = 0;
  for (const { dists, actualIdx } of cache) {
    const combined = new Array(100).fill(0);
    STRATEGIES.forEach((s, idx) => {
      const w = Math.max(weightVector[idx], 0) / total;
      if (w === 0) return;
      const d = dists[s.id];
      for (let k = 0; k < 100; k++) combined[k] += w * d[k];
    });
    totalBrier += combined.reduce((sum, p, idx) => sum + (p - (idx === actualIdx ? 1 : 0)) ** 2, 0);
  }
  return totalBrier / (cache.length || 1);
}
function mutateWeights(weights, rng, rate = 0.3, strength = 0.35) {
  return weights.map((w) => (rng() < rate ? Math.max(0, w + (rng() - 0.5) * strength * 2) : w));
}
function crossoverWeights(a, b, rng) {
  return a.map((w, i) => (rng() < 0.5 ? w : b[i]));
}
export function runEvolutionEngine(draws, opts = {}) {
  const trainFraction = opts.trainFraction ?? 0.7;
  const populationSize = opts.populationSize ?? 60;
  const generations = opts.generations ?? 50;
  const survivorCount = opts.survivorCount ?? 10;

  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const splitIdx = Math.floor(sorted.length * trainFraction);
  const rng = makeRng(seedFromDraws(sorted));

  const selectionCache = precomputeStrategyDistributions(sorted, MIN_WARMUP, splitIdx);
  const equalWeights = STRATEGIES.map(() => 1);
  const baselineBrier = fitnessForWeights(equalWeights, selectionCache);

  let population = [equalWeights];
  while (population.length < populationSize) population.push(STRATEGIES.map(() => rng() * 2));

  const generationLog = [];
  let best = { weights: equalWeights, brier: baselineBrier };
  let evaluationCount = 0;

  for (let gen = 0; gen < generations; gen++) {
    const scored = population.map((w) => ({ weights: w, brier: fitnessForWeights(w, selectionCache) }));
    evaluationCount += scored.length;
    scored.sort((a, b) => a.brier - b.brier);
    if (scored[0].brier < best.brier) best = scored[0];
    generationLog.push({ generation: gen, bestBrier: scored[0].brier, medianBrier: scored[Math.floor(scored.length / 2)].brier });

    const survivors = scored.slice(0, survivorCount).map((s) => s.weights);
    const nextPop = [...survivors];
    while (nextPop.length < populationSize) {
      const a = survivors[Math.floor(rng() * survivors.length)];
      const b = survivors[Math.floor(rng() * survivors.length)];
      nextPop.push(mutateWeights(crossoverWeights(a, b, rng), rng));
    }
    population = nextPop;
  }

  const heldOutCache = precomputeStrategyDistributions(sorted, Math.max(MIN_WARMUP, splitIdx), sorted.length);
  const heldOutBrierEvolved = fitnessForWeights(best.weights, heldOutCache);
  const heldOutBrierEqual = fitnessForWeights(equalWeights, heldOutCache);
  const randomBaselineBrier = (1 - 0.01) ** 2 + 99 * 0.01 ** 2;
  const heldOutSE = 0.02 / Math.sqrt(heldOutCache.length || 1);

  const totalW = best.weights.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
  const bestWeightsNamed = STRATEGIES.map((s, i) => ({ strategy: s.id, weight: Math.max(best.weights[i], 0) / totalW }));

  return {
    evaluationCount, populationSize, generations,
    selectionSetSize: selectionCache.length,
    bestWeights: bestWeightsNamed,
    selectionBrierEvolved: best.brier, selectionBrierEqualWeight: baselineBrier,
    generationLog,
    heldOutSampleSize: heldOutCache.length,
    heldOutBrierEvolved, heldOutBrierEqualWeight: heldOutBrierEqual, randomBaselineBrier,
    evolvedBeatsEqualWeightOnHeldOut: heldOutBrierEvolved < heldOutBrierEqual - 2 * heldOutSE,
    evolvedBeatsRandomOnHeldOut: heldOutBrierEvolved < randomBaselineBrier - 2 * heldOutSE,
  };
}

/* ---------------------------------------------------------------------- */
/* Heavy ML models -- simplified, clearly-labeled versions                */
/*                                                                        */
/* Random Forest and Gradient Boosted Trees below are genuine (real tree- */
/* splitting, real bootstrap/boosting), just small (shallow, few trees)   */
/* rather than production-scale. The Neural Network is a single small     */
/* hidden layer trained with plain backprop -- also genuine, not a stub.  */
/*                                                                        */
/* LSTM and Transformer are deliberately NOT built as separate models.    */
/* Both exist specifically to model SEQUENTIAL/temporal dependencies      */
/* (what happened recently shapes what happens next). Every held-out      */
/* result on this dataset, repeatedly, shows lottery draws have no such   */
/* dependency -- they're i.i.d. random. A recurrent or attention-based    */
/* network applied to i.i.d. data reduces, in expectation, to the same    */
/* thing the neural network below already does, just with far more        */
/* failure surface (vanishing gradients, attention-weight instability)    */
/* for zero theoretical upside on this specific task. Building them       */
/* anyway would be reskinning the same MLP with more fragile machinery.   */
/*                                                                        */
/* All three reuse the same 7 engineered features from feature discovery, */
/* so "model type" and "which signals feed it" stay cleanly separated.    */
/* ---------------------------------------------------------------------- */

export function precomputeFeatureCache(draws, fromIdx, toIdx) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const cache = [];
  for (let i = fromIdx; i < toIdx; i++) {
    const history = sorted.slice(0, i), actual = sorted[i];
    const featTables = FEATURES.map((f) => {
      const raw = FEATURE_FNS[f.id](history);
      return [normalizeRow(raw[0]), normalizeRow(raw[1])];
    });
    cache.push({ featTables, actualBack2: actual.back2 });
  }
  return cache;
}
function examplesFromCacheEntry({ featTables, actualBack2 }) {
  const out = [];
  for (let p = 0; p < 2; p++) {
    const actualDigit = Number(actualBack2[p]);
    for (let d = 0; d < 10; d++) out.push({ x: featTables.map((t) => t[p][d]), y: d === actualDigit ? 1 : 0 });
  }
  return out;
}

/* --- Random Forest --------------------------------------------------- */
function giniImpurity(examples) {
  if (examples.length === 0) return 0;
  const p = examples.filter((e) => e.y === 1).length / examples.length;
  return 2 * p * (1 - p);
}
function candidateThresholds(examples, feature) {
  const values = [...new Set(examples.map((e) => e.x[feature]))].sort((a, b) => a - b);
  if (values.length <= 10) return values.slice(0, -1).map((v, i) => (v + values[i + 1]) / 2);
  const thresholds = [];
  for (let q = 1; q <= 9; q++) thresholds.push(values[Math.floor((q / 10) * (values.length - 1))]);
  return [...new Set(thresholds)];
}
function bestSplit(examples, featureCount, rng) {
  const featureSubset = [...Array(featureCount).keys()].sort(() => rng() - 0.5).slice(0, Math.max(2, Math.ceil(Math.sqrt(featureCount))));
  let best = null;
  for (const f of featureSubset) {
    for (const threshold of candidateThresholds(examples, f)) {
      const left = examples.filter((e) => e.x[f] <= threshold);
      const right = examples.filter((e) => e.x[f] > threshold);
      if (left.length < 2 || right.length < 2) continue;
      const impurity = (left.length * giniImpurity(left) + right.length * giniImpurity(right)) / examples.length;
      if (!best || impurity < best.impurity) best = { feature: f, threshold, impurity, left, right };
    }
  }
  return best;
}
function buildTree(examples, depth, maxDepth, rng) {
  const p = examples.length ? examples.filter((e) => e.y === 1).length / examples.length : 0.5;
  if (depth >= maxDepth || examples.length < 6 || p === 0 || p === 1) return { leaf: true, prob: p };
  const split = bestSplit(examples, examples[0].x.length, rng);
  if (!split) return { leaf: true, prob: p };
  return {
    leaf: false, feature: split.feature, threshold: split.threshold,
    left: buildTree(split.left, depth + 1, maxDepth, rng), right: buildTree(split.right, depth + 1, maxDepth, rng),
  };
}
function predictTree(tree, x) {
  if (tree.leaf) return tree.prob;
  return x[tree.feature] <= tree.threshold ? predictTree(tree.left, x) : predictTree(tree.right, x);
}
function bootstrapSample(examples, rng) {
  const n = examples.length;
  return Array.from({ length: n }, () => examples[Math.floor(rng() * n)]);
}
export function trainRandomForest(examples, rng, opts = {}) {
  const numTrees = opts.numTrees ?? 15, maxDepth = opts.maxDepth ?? 3;
  if (examples.length < 6) return { type: "randomForest", trees: [{ leaf: true, prob: 0.1 }] };
  const trees = [];
  for (let t = 0; t < numTrees; t++) trees.push(buildTree(bootstrapSample(examples, rng), 0, maxDepth, rng));
  return { type: "randomForest", trees };
}
export function predictRandomForest(model, x) {
  const probs = model.trees.map((t) => predictTree(t, x));
  return probs.reduce((a, b) => a + b, 0) / probs.length;
}

/* --- Gradient Boosted Trees ------------------------------------------- */
function buildRegressionTree(examples, depth, maxDepth, rng) {
  const mean = examples.length ? examples.reduce((a, e) => a + e.y, 0) / examples.length : 0;
  if (depth >= maxDepth || examples.length < 6) return { leaf: true, value: mean };
  const featureCount = examples[0].x.length;
  const featureSubset = [...Array(featureCount).keys()].sort(() => rng() - 0.5).slice(0, Math.max(2, Math.ceil(Math.sqrt(featureCount))));
  let best = null;
  for (const f of featureSubset) {
    for (const threshold of candidateThresholds(examples, f)) {
      const left = examples.filter((e) => e.x[f] <= threshold);
      const right = examples.filter((e) => e.x[f] > threshold);
      if (left.length < 2 || right.length < 2) continue;
      const variance = (rows) => { const m = rows.reduce((a, e) => a + e.y, 0) / rows.length; return rows.reduce((a, e) => a + (e.y - m) ** 2, 0); };
      const score = variance(left) + variance(right);
      if (!best || score < best.score) best = { feature: f, threshold, score, left, right };
    }
  }
  if (!best) return { leaf: true, value: mean };
  return {
    leaf: false, feature: best.feature, threshold: best.threshold,
    left: buildRegressionTree(best.left, depth + 1, maxDepth, rng), right: buildRegressionTree(best.right, depth + 1, maxDepth, rng),
  };
}
function predictRegressionTree(tree, x) {
  if (tree.leaf) return tree.value;
  return x[tree.feature] <= tree.threshold ? predictRegressionTree(tree.left, x) : predictRegressionTree(tree.right, x);
}
export function trainGradientBoostedTrees(examples, rng, opts = {}) {
  const numRounds = opts.numRounds ?? 10, maxDepth = opts.maxDepth ?? 2, learningRate = opts.learningRate ?? 0.2;
  if (examples.length < 6) return { type: "gbt", trees: [], baseline: 0.1, learningRate };
  const baseline = examples.reduce((a, e) => a + e.y, 0) / examples.length;
  let predictions = examples.map(() => baseline);
  const trees = [];
  for (let round = 0; round < numRounds; round++) {
    const residualExamples = examples.map((e, i) => ({ x: e.x, y: e.y - predictions[i] }));
    const tree = buildRegressionTree(residualExamples, 0, maxDepth, rng);
    trees.push(tree);
    predictions = predictions.map((p, i) => p + learningRate * predictRegressionTree(tree, examples[i].x));
  }
  return { type: "gbt", trees, baseline, learningRate };
}
export function predictGradientBoostedTrees(model, x) {
  let pred = model.baseline;
  for (const tree of model.trees) pred += model.learningRate * predictRegressionTree(tree, x);
  return Math.max(0, Math.min(1, pred));
}

/* --- Neural Network (single hidden layer, plain backprop) -------------- */
export function trainNeuralNetwork(examples, rng, opts = {}) {
  const hiddenSize = opts.hiddenSize ?? 8, epochs = opts.epochs ?? 60, learningRate = opts.learningRate ?? 0.05;
  const inputSize = FEATURES.length;
  if (examples.length < 6) return { type: "nn", W1: null };
  const randInit = (n) => Array.from({ length: n }, () => (rng() - 0.5) * 0.5);
  let W1 = Array.from({ length: hiddenSize }, () => randInit(inputSize));
  let b1 = randInit(hiddenSize);
  let W2 = randInit(hiddenSize);
  let b2 = (rng() - 0.5) * 0.1;
  const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
  const tanh = (z) => Math.tanh(Math.max(-15, Math.min(15, z)));

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (const { x, y } of examples) {
      const hRaw = W1.map((w, i) => w.reduce((a, wij, j) => a + wij * x[j], 0) + b1[i]);
      const h = hRaw.map(tanh);
      const outRaw = W2.reduce((a, w, i) => a + w * h[i], 0) + b2;
      const out = sigmoid(outRaw);
      const dOut = out - y;
      const dW2 = h.map((hi) => dOut * hi);
      const db2 = dOut;
      const dH = h.map((hi, i) => dOut * W2[i] * (1 - hi * hi));
      for (let i = 0; i < hiddenSize; i++) {
        for (let j = 0; j < inputSize; j++) W1[i][j] -= learningRate * dH[i] * x[j];
        b1[i] -= learningRate * dH[i];
      }
      for (let i = 0; i < hiddenSize; i++) W2[i] -= learningRate * dW2[i];
      b2 -= learningRate * db2;
    }
  }
  return { type: "nn", W1, b1, W2, b2, hiddenSize };
}
export function predictNeuralNetwork(model, x) {
  if (!model.W1) return 0.1;
  const tanh = (z) => Math.tanh(Math.max(-15, Math.min(15, z)));
  const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
  const h = model.W1.map((w, i) => tanh(w.reduce((a, wij, j) => a + wij * x[j], 0) + model.b1[i]));
  return sigmoid(model.W2.reduce((a, w, i) => a + w * h[i], 0) + model.b2);
}

/* --- Shared walk-forward harness for all three ------------------------- */
const ML_MODELS = {
  randomForest: { train: trainRandomForest, predict: predictRandomForest },
  gbt: { train: trainGradientBoostedTrees, predict: predictGradientBoostedTrees },
  nn: { train: trainNeuralNetwork, predict: predictNeuralNetwork },
};
export function walkForwardMLBacktest(modelId, cache, opts = {}) {
  const retrainEvery = opts.retrainEvery ?? 10;
  const rng = opts.rng ?? Math.random;
  const { train, predict } = ML_MODELS[modelId];
  let model = null, trainingExamples = [];
  let totalBrier = 0, n = 0;
  for (let idx = 0; idx < cache.length; idx++) {
    if (idx % retrainEvery === 0) model = train(trainingExamples, rng, opts);
    const { featTables, actualBack2 } = cache[idx];
    const dist = new Array(100).fill(0);
    for (let d0 = 0; d0 < 10; d0++) {
      const p0 = predict(model, featTables.map((t) => t[0][d0]));
      for (let d1 = 0; d1 < 10; d1++) {
        const p1 = predict(model, featTables.map((t) => t[1][d1]));
        dist[d0 * 10 + d1] = p0 * p1;
      }
    }
    const total = dist.reduce((a, b) => a + b, 0) || 1;
    for (let k = 0; k < 100; k++) dist[k] /= total;
    const actualIdx = back2ToIndex(actualBack2);
    totalBrier += dist.reduce((sum, p, idx2) => sum + (p - (idx2 === actualIdx ? 1 : 0)) ** 2, 0);
    n++;
    trainingExamples.push(...examplesFromCacheEntry(cache[idx]));
  }
  return { brierScore: totalBrier / (n || 1), n };
}
export function runMLModelsEvaluation(draws, trainFraction = 0.7) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const splitIdx = Math.floor(sorted.length * trainFraction);
  const rng = makeRng(seedFromDraws(sorted));

  const selectionCache = precomputeFeatureCache(sorted, MIN_WARMUP, splitIdx);
  const heldOutCache = precomputeFeatureCache(sorted, Math.max(MIN_WARMUP, splitIdx), sorted.length);
  const randomBaselineBrier = (1 - 0.01) ** 2 + 99 * 0.01 ** 2;

  const results = {};
  for (const modelId of Object.keys(ML_MODELS)) {
    const selection = walkForwardMLBacktest(modelId, selectionCache, { rng });
    const heldOut = walkForwardMLBacktest(modelId, heldOutCache, { rng });
    const heldOutSE = 0.02 / Math.sqrt(heldOut.n || 1);
    results[modelId] = {
      selectionBrier: selection.brierScore, selectionSampleSize: selection.n,
      heldOutBrier: heldOut.brierScore, heldOutSampleSize: heldOut.n,
      beatsRandomOnHeldOut: heldOut.brierScore < randomBaselineBrier - 2 * heldOutSE,
    };
  }
  return { randomBaselineBrier, models: results };
}


/* ---------------------------------------------------------------------- */
/* Rolling calibration check                                              */
/*                                                                        */
/* The honest alternative to a per-draw "why did it miss" story: instead  */
/* of explaining one draw, ask a real question -- has any strategy's      */
/* Brier score over a RECENT window drifted from its own all-time Brier   */
/* score by more than sampling noise would explain? Checking 11 strategies*/
/* at once means ~1 in 2 checks would show a false "significant" drift by */
/* pure chance alone at an ordinary 2-SE bar (11 simultaneous tests), so  */
/* this uses a Bonferroni-style 2.8-SE bar instead -- a rough correction  */
/* for testing all 11 at the same time, not a single strategy in isolation.*/
/* ---------------------------------------------------------------------- */
export function rollingCalibrationCheck(draws, windowSize = 50) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  if (sorted.length < MIN_WARMUP + windowSize) return null;

  const overallRows = runProbabilisticBacktest(sorted);
  const overallSummary = summarizeProbabilisticBacktest(overallRows);

  const recentFrom = sorted.length - windowSize;
  const recentByStrategy = new Map();
  for (let i = Math.max(MIN_WARMUP, recentFrom); i < sorted.length; i++) {
    const history = sorted.slice(0, i), actual = sorted[i];
    const actualIdx = back2ToIndex(actual.back2);
    for (const s of STRATEGIES) {
      const dist = strategyBack2FullDistribution(s.id, history);
      const brierTerm = dist.reduce((sum, p, idx) => sum + (p - (idx === actualIdx ? 1 : 0)) ** 2, 0);
      recentByStrategy.set(s.id, [...(recentByStrategy.get(s.id) || []), brierTerm]);
    }
  }

  const results = STRATEGIES.map((s) => {
    const overall = overallSummary.find((o) => o.strategy === s.id);
    const recentTerms = recentByStrategy.get(s.id) || [];
    const recentN = recentTerms.length || 1;
    const recentBrier = recentTerms.reduce((a, b) => a + b, 0) / recentN;
    const recentSE = 0.02 / Math.sqrt(recentN);
    const drift = recentBrier - overall.brierScore;
    return {
      strategy: s.id, recentBrier, recentSampleSize: recentTerms.length,
      overallBrier: overall.brierScore, overallSampleSize: overall.runs,
      randomBaselineBrier: overall.randomBaseline.brierScore,
      drift, driftSignificant: Math.abs(drift) > 2.8 * recentSE,
    };
  });

  return { windowSize, drawCount: sorted.length, results };
}

/* ---------------------------------------------------------------------- */
/* Generalized field scoring -- back3/front3 with the same rigor as back2 */
/*                                                                        */
/* back3/front3 differ from back2 in two ways that matter for honest      */
/* scoring: 3 digits (1000 outcomes, not 100) and TWO winning numbers per */
/* draw, not one. Two winners -> each draw contributes 2 independent      */
/* scoring instances (one per winner) against the same predicted          */
/* distribution, rather than inventing a "co-winner" concept that doesn't */
/* correspond to how the draw actually happens.                          */
/* ---------------------------------------------------------------------- */

function fieldPool(draws, field) {
  return field === "back2" ? draws.map((d) => d.back2) : draws.flatMap((d) => d[field]);
}
function fieldDigitLength(field) { return field === "back2" ? 2 : 3; }
function fieldValueToIndex(value) {
  let idx = 0;
  for (const ch of value) idx = idx * 10 + Number(ch);
  return idx;
}
export function fieldFullDistribution(perPositionProbs) {
  const len = perPositionProbs.length;
  const size = Math.pow(10, len);
  const dist = new Array(size).fill(1);
  for (let i = 0; i < size; i++) {
    let rem = i;
    const digits = [];
    for (let p = 0; p < len; p++) digits.unshift(rem % 10), (rem = Math.floor(rem / 10));
    for (let p = 0; p < len; p++) dist[i] *= perPositionProbs[p][digits[p]];
  }
  return dist;
}

export function strategyFieldDigitProbs(id, draws, field) {
  const pool = fieldPool(draws, field);
  const len = fieldDigitLength(field);
  if (pool.length === 0) return Array.from({ length: len }, () => new Array(10).fill(0.1));
  if (id === "frequency" || id === "monteCarlo") {
    const table = positionFrequency(pool);
    return table.map((row) => { const t = row.reduce((a, b) => a + b, 0); return row.map((c) => c / t); });
  }
  if (id === "bayesian") {
    const p = bayesianDigitPosterior(pool, 2);
    return Array.from({ length: len }, () => p);
  }
  if (id === "markov") {
    const matchField = field === "back2" ? "back2" : field === "front3" ? "front3a" : "back3a";
    const matrix = digitTransitionMatrix(draws, matchField);
    const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
    let lastDigit = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const values = field === "back2" ? [sorted[i].back2] : sorted[i][field];
      if (values && values.length > 0 && values[0]) { lastDigit = Number(values[0][0]); break; }
    }
    const row = matrix[lastDigit];
    return Array.from({ length: len }, () => row);
  }
  if (id === "gap") {
    const gaps = hotColdNumbers(draws, field);
    const gapByPos = Array.from({ length: len }, () => new Array(10).fill(1));
    for (const g of gaps) for (let p = 0; p < len; p++) gapByPos[p][Number(g.number[p])] += g.gap;
    return gapByPos.map((row) => { const t = row.reduce((a, b) => a + b, 0); return row.map((c) => c / t); });
  }
  if (id === "digitMomentum") {
    const table = digitMomentumWeights(pool);
    return table.map((row) => { const t = row.reduce((a, b) => a + b, 0); return row.map((c) => c / t); });
  }
  const uniform = new Array(10).fill(0.1);
  return Array.from({ length: len }, () => uniform);
}

export function strategyFieldFullDistribution(id, draws, field) {
  const pool = fieldPool(draws, field);
  const len = fieldDigitLength(field);
  if (pool.length === 0) return new Array(Math.pow(10, len)).fill(1 / Math.pow(10, len));
  if (id === "entropy") return fieldFullDistribution(entropyWeights(pool).map(laplaceRow));

  if (id === "pairCorrelation" || id === "tripletCorrelation") {
    const order = id === "pairCorrelation" ? 1 : 2;
    const posTable = positionFrequency(pool);
    const conditional = buildConditionalTable(pool, order);
    const size = Math.pow(10, len);
    const dist = new Array(size).fill(1);
    for (let i = 0; i < size; i++) {
      let rem = i;
      const digits = [];
      for (let p = 0; p < len; p++) digits.unshift(rem % 10), (rem = Math.floor(rem / 10));
      let digitsStr = digits.join("");
      for (let p = 0; p < len; p++) {
        let probs;
        if (p < order || !conditional[p]) probs = laplaceRow(posTable[p]);
        else probs = laplaceRow(conditional[p].get(digitsStr.slice(p - order, p)));
        dist[i] *= probs[digits[p]];
      }
    }
    return dist;
  }
  if (id === "digitalRoot") {
    const rootCounts = new Array(10).fill(0);
    for (const n of pool) rootCounts[digitalRoot(n)]++;
    const rootTotal = rootCounts.reduce((a, b) => a + b, 0) || 1;
    const size = Math.pow(10, len);
    const dist = new Array(size);
    for (let i = 0; i < size; i++) {
      const value = i.toString().padStart(len, "0");
      dist[i] = (rootCounts[digitalRoot(value)] + 1) / (rootTotal + 10);
    }
    const s = dist.reduce((a, b) => a + b, 0);
    return dist.map((v) => v / s);
  }
  if (id === "mirrorNumber") {
    const size = Math.pow(10, len);
    const freq = new Array(size).fill(0);
    for (const n of pool) freq[fieldValueToIndex(n)]++;
    const total = freq.reduce((a, b) => a + b, 0) || 1;
    const dist = new Array(size);
    for (let i = 0; i < size; i++) {
      const mirrorIdx = fieldValueToIndex(i.toString().padStart(len, "0").split("").reverse().join(""));
      dist[i] = (freq[i] + freq[mirrorIdx] + 1) / (2 * total + size);
    }
    const s = dist.reduce((a, b) => a + b, 0);
    return dist.map((v) => v / s);
  }
  return fieldFullDistribution(strategyFieldDigitProbs(id, draws, field));
}

export function summarizeProbabilisticBacktestForField(rows, field, topKs = [1, 5, 10, 20]) {
  const byStrategy = new Map();
  for (const r of rows) byStrategy.set(r.strategy, [...(byStrategy.get(r.strategy) || []), r]);
  const universeSize = Math.pow(10, fieldDigitLength(field));
  const p = 1 / universeSize;
  const randomBaseline = { brierScore: (1 - p) ** 2 + (universeSize - 1) * p ** 2, logLoss: -Math.log(p) };
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

export function runProbabilisticBacktestForField(draws, field, topKs = [1, 5, 10, 20]) {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const rows = [];
  for (let i = MIN_WARMUP; i < sorted.length; i++) {
    const history = sorted.slice(0, i), actual = sorted[i];
    const actualValues = field === "back2" ? [actual.back2] : actual[field];
    for (const s of STRATEGIES) {
      const dist = strategyFieldFullDistribution(s.id, history, field);
      for (const actualValue of actualValues) {
        const actualIdx = fieldValueToIndex(actualValue);
        const probAssigned = dist[actualIdx];
        const brierTerm = dist.reduce((sum, p, idx) => sum + (p - (idx === actualIdx ? 1 : 0)) ** 2, 0);
        const ranked = dist.map((p, idx) => idx).sort((a, b) => dist[b] - dist[a]);
        const rankOfActual = ranked.indexOf(actualIdx) + 1;
        const row = { strategy: s.id, drawDate: actual.drawDate, probAssigned, brierTerm, logLossTerm: -Math.log(Math.max(probAssigned, 1e-9)), rankOfActual };
        for (const k of topKs) row[`top${k}`] = rankOfActual <= k;
        rows.push(row);
      }
    }
  }
  return rows;
}
/* ---------------------------------------------------------------------- */
/* Live performance weight adjustment (Phase 2)                           */
/*                                                                        */
/* Backtest/evolution-engine weights (above) are the primary signal --    */
/* validated on hundreds of walk-forward draws. Live performance is real  */
/* but a far smaller sample (draws happen twice a month), so it can only  */
/* ever be a bounded NUDGE on top of the backtest-validated weight, gated */
/* by the same kind of significance bar used everywhere else in this      */
/* file -- never a replacement for it. Below MIN_LIVE_SAMPLES this        */
/* returns the base weights completely unchanged -- by design, that will  */
/* be true for a long time, since evaluated live draws accumulate one at  */
/* a time.                                                                */
/* ---------------------------------------------------------------------- */

export const MIN_LIVE_SAMPLES = 20;

export function computeLiveAdjustedWeights(baseWeights, liveEvaluations) {
  const byStrategy = new Map();
  for (const row of liveEvaluations) {
    if (!byStrategy.has(row.strategy_id)) byStrategy.set(row.strategy_id, []);
    byStrategy.get(row.strategy_id).push(row.back2_match_pct === 100);
  }

  const randomHitRate = 0.01; // 1/100, same back2 baseline used throughout this file

  const adjusted = baseWeights.map(({ strategy, weight }) => {
    const hits = byStrategy.get(strategy) || [];
    const n = hits.length;
    if (n < MIN_LIVE_SAMPLES) {
      return {
        strategy, weight, liveSampleSize: n, liveAdjustment: 1,
        liveNote: `only ${n}/${MIN_LIVE_SAMPLES} live draws evaluated -- backtest weight used unchanged`,
      };
    }
    const hitRate = hits.filter(Boolean).length / n;
    const se = Math.sqrt((randomHitRate * (1 - randomHitRate)) / n);
    const z = (hitRate - randomHitRate) / se;
    const significant = Math.abs(z) > 2;
    // Bounded +/-15% nudge even at extreme z -- one strategy's live record should
    // never be able to swing the ensemble on its own.
    const liveAdjustment = significant ? Math.max(0.85, Math.min(1.15, 1 + z / 20)) : 1;
    return {
      strategy, weight: weight * liveAdjustment, liveSampleSize: n, liveAdjustment,
      liveNote: significant
        ? `live hit rate ${(hitRate * 100).toFixed(1)}% over ${n} real draws vs ${(randomHitRate * 100).toFixed(1)}% baseline -- significant, weight nudged ${liveAdjustment > 1 ? "up" : "down"} ${Math.abs((liveAdjustment - 1) * 100).toFixed(1)}%`
        : `live hit rate ${(hitRate * 100).toFixed(1)}% over ${n} real draws -- within noise of baseline, no adjustment`,
    };
  });

  const total = adjusted.reduce((a, r) => a + r.weight, 0) || 1;
  return adjusted.map((r) => ({ ...r, weight: r.weight / total }));
}
