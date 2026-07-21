const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const CSV_URL = "https://raw.githubusercontent.com/heart/Data-Set-Thai-Lotto/master/lotto.csv";

function splitCsvLine(line) {
  const fields = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { fields.push(cur); cur = ""; }
      else cur += c;
    }
  }
  fields.push(cur);
  return fields;
}
function parsePyList(str) {
  const matches = str.match(/'(\d+)'/g) || [];
  return matches.map((m) => m.replace(/'/g, ""));
}

async function main() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows = lines.slice(1);

  const draws = [];
  let skipped = 0;
  for (const line of rows) {
    const f = splitCsvLine(line);
    const [dateStr, firstPrize, front3Str, back3Str, back2Raw] = f;
    if (!/^\d{6}$/.test(firstPrize) || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { skipped++; continue; }
    const front3 = parsePyList(front3Str), back3 = parsePyList(back3Str);
    const back2 = (back2Raw || "").trim().padStart(2, "0");
    if (front3.length !== 2 || back3.length !== 2 || !/^\d{2}$/.test(back2)) { skipped++; continue; }
    draws.push({ draw_date: dateStr, first_prize: firstPrize, front3, back3, back2 });
  }
  console.log(`Parsed ${draws.length} draws, skipped ${skipped} bad rows`);

  const BATCH = 200;
  for (let i = 0; i < draws.length; i += BATCH) {
    const batch = draws.slice(i, i + BATCH);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/draws?on_conflict=draw_date`, {
      method: "POST",
      headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(batch),
    });
    if (!r.ok) throw new Error(`Insert failed batch ${i}: ${r.status} ${await r.text()}`);
    console.log(`Inserted batch ${i / BATCH + 1} (${batch.length} rows)`);
  }
  console.log("Done.");
}
main().catch((err) => { console.error(err); process.exit(1); });
