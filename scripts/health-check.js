// Read-only production health check. Never writes to draws, learning
// state, predictions, position_predictions, or weights, and never
// triggers learning/prediction generation — it only inspects Supabase
// and reports. Exit 0 = normal. Exit 1 = needs a look — GitHub's own
// failed-run notification is the alert; no separate channel added.
//
// Deliberately independent of lib/models.js and lib/learning.js: a
// health check that imports the thing it verifies can't catch a change
// to that thing. Game-shape constants below are fixed on purpose.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const STRATEGY_COUNT = 11;
const POSITIONS_PER_TYPE = { firstPrize: 6, front3: 3, back3: 3, back2: 2 };
const EXPECTED_STATE_COUNT = STRATEGY_COUNT * Object.values(POSITIONS_PER_TYPE).reduce((a, b) => a + b, 0); // 154

let failed = false;
const fail = (msg) => { console.log(`[FAIL] ${msg}`); failed = true; };
const warn = (msg) => { console.log(`[WARN] ${msg}`); failed = true; };
const ok = (msg) => console.log(`[OK] ${msg}`);
const info = (msg) => console.log(`[INFO] ${msg}`);

async function getJSON(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.slice(0, 300)}`); }
}

// Same rule as mostRecentDrawDate() in scripts/import-draw.js.
function expectedDrawDate(now) {
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const year = bkk.getUTCFullYear();
  const month = bkk.getUTCMonth() + 1;
  const day = bkk.getUTCDate() >= 16 ? 16 : 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
// Same rule as nextDrawDateFrom() in lib/models.js.
function nextExpected(drawDateStr) {
  const d = new Date(drawDateStr + "T00:00:00Z");
  if (d.getUTCDate() === 1) d.setUTCDate(16);
  else d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
}
function hoursSincePollWindowClose(drawDateStr, now) {
  return (now.getTime() - new Date(drawDateStr + "T12:59:00Z").getTime()) / 3_600_000;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    fail("Missing SUPABASE_URL/SUPABASE_SECRET_KEY env vars.");
    process.exit(1);
  }
  if (process.env.TRIGGERING_IMPORT_CONCLUSION) {
    info(`Triggered by Import lottery draw completion (conclusion: ${process.env.TRIGGERING_IMPORT_CONCLUSION}).`);
  }
  const now = new Date();

  let draws;
  try {
    draws = await getJSON(`draws?select=draw_date&order=draw_date.desc&limit=1`);
  } catch (e) {
    fail(`Supabase unreachable, or draws query failed: ${e.message}`);
    console.log("\n=== HEALTH CHECK: ATTENTION NEEDED ===");
    process.exit(1);
  }
  if (draws.length === 0) {
    fail("draws table reachable but empty.");
    console.log("\n=== HEALTH CHECK: ATTENTION NEEDED ===");
    process.exit(1);
  }
  const latestDraw = draws[0].draw_date;
  const expected = expectedDrawDate(now);
  const drawIsCurrent = latestDraw >= expected;
  ok(`Supabase reachable. Latest draw: ${latestDraw} (expected as of today: ${expected}).`);

  if (drawIsCurrent) {
    ok("Latest draw is current.");
  } else {
    const graceHours = hoursSincePollWindowClose(expected, now);
    if (graceHours < 24) {
      info(`No draw for ${expected} yet — ${graceHours.toFixed(1)}h since poll window closed, within grace. NORMAL.`);
    } else {
      warn(`Draw ${expected} still missing ${graceHours.toFixed(1)}h after the poll window closed.`);
    }
  }

  let posState = [];
  try {
    posState = await getJSON(`strategy_position_learning_state?select=strategy_id,prediction_type,digit_position,last_target_draw_date`);
  } catch (e) {
    fail(`strategy_position_learning_state query failed: ${e.message}`);
  }
  if (posState.length === 0) {
    fail(`strategy_position_learning_state has no rows (expected ${EXPECTED_STATE_COUNT}).`);
  } else {
    const seen = new Map();
    let dupes = 0, nullId = 0, badType = 0, badPos = 0;
    for (const row of posState) {
      if (!row.strategy_id || row.prediction_type == null || row.digit_position == null) { nullId++; continue; }
      const key = `${row.strategy_id}|${row.prediction_type}|${row.digit_position}`;
      if (seen.has(key)) dupes++; else seen.set(key, row);
      if (!(row.prediction_type in POSITIONS_PER_TYPE)) badType++;
      else if (row.digit_position < 0 || row.digit_position >= POSITIONS_PER_TYPE[row.prediction_type]) badPos++;
    }
    const distinctStrategies = new Set(posState.map((r) => r.strategy_id)).size;
    info(`Position-state rows: ${posState.length}, distinct keys: ${seen.size}, distinct strategies: ${distinctStrategies} (expected ${EXPECTED_STATE_COUNT} / ${STRATEGY_COUNT}).`);
    if (seen.size !== EXPECTED_STATE_COUNT) warn(`Position-state key count is ${seen.size}, expected ${EXPECTED_STATE_COUNT}.`);
    if (distinctStrategies !== STRATEGY_COUNT) warn(`${distinctStrategies} distinct strategy_id(s), expected ${STRATEGY_COUNT}.`);
    if (dupes) warn(`${dupes} duplicate (strategy,type,position) key(s).`);
    if (nullId) warn(`${nullId} row(s) with a null identifying field.`);
    if (badType) warn(`${badType} row(s) with an unrecognized prediction_type.`);
    if (badPos) warn(`${badPos} row(s) with digit_position out of range for their type.`);
    if (!dupes && !nullId && !badType && !badPos && seen.size === EXPECTED_STATE_COUNT && distinctStrategies === STRATEGY_COUNT) {
      ok("All 154 position-learning states structurally valid.");
    }
    if (drawIsCurrent) {
      const behind = [...seen.values()].filter((r) => r.last_target_draw_date && r.last_target_draw_date < latestDraw);
      if (behind.length > 0) {
        warn(`${behind.length}/${seen.size} position-state row(s) haven't advanced to ${latestDraw} (e.g. ${behind[0].strategy_id}/${behind[0].prediction_type}/${behind[0].digit_position} last learned ${behind[0].last_target_draw_date}).`);
      } else {
        ok(`Position-learning state is caught up with ${latestDraw}.`);
      }
    } else {
      info("Skipping position-state advancement check — no new draw this cycle yet.");
    }
  }

  try {
    const flat = await getJSON(`strategy_learning_state?select=strategy_id,last_target_draw_date`);
    if (drawIsCurrent) {
      const behindFlat = flat.filter((r) => r.last_target_draw_date && r.last_target_draw_date < latestDraw);
      if (behindFlat.length > 0) warn(`${behindFlat.length}/${flat.length} flat strategy_learning_state row(s) haven't advanced to ${latestDraw}.`);
      else ok("Flat strategy_learning_state is caught up.");
    }
  } catch (e) {
    warn(`strategy_learning_state query failed: ${e.message}`);
  }

  if (!drawIsCurrent) {
    info("Skipping prediction-currency check — no new draw this cycle yet, so no new prediction is expected yet either.");
  } else {
    const targetDate = nextExpected(latestDraw);
    let preds = [];
    try {
      preds = await getJSON(`position_predictions?target_draw_date=eq.${targetDate}&source=eq.position-pipeline&select=rank&order=rank.asc`);
    } catch (e) {
      fail(`position_predictions query failed: ${e.message}`);
    }
    if (preds.length > 0) {
      ok(`position-pipeline prediction present for ${targetDate} (${preds.length}/3 ranked candidate(s)).`);
    } else {
      let mostRecent = null;
      try {
        const fallback = await getJSON(`position_predictions?source=eq.position-pipeline&select=target_draw_date&order=generated_at.desc&limit=1`);
        mostRecent = fallback[0]?.target_draw_date ?? null;
      } catch { /* diagnostic only */ }
      warn(mostRecent
        ? `No position-pipeline prediction for expected target ${targetDate} — most recent on file targets ${mostRecent} instead.`
        : `No position-pipeline prediction found for expected target ${targetDate}, and none exist at all.`);
    }
  }

  console.log(failed ? "\n=== HEALTH CHECK: ATTENTION NEEDED (see WARN/FAIL above) ===" : "\n=== HEALTH CHECK: ALL NORMAL ===");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
