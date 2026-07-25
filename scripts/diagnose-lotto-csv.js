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
  if (str == null) return undefined;
  if (str.trim() === "[]") return [];
  const matches = str.match(/'(\d+)'/g);
  return matches ? matches.map((m) => m.replace(/'/g, "")) : undefined;
}

async function main() {
  console.log("[DEBUG-25JUL-D] diagnostic script starting");
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  const text = await res.text();
  const rawLines = text.split(/\r?\n/);
  const nonEmpty = rawLines.filter((l) => l.trim().length > 0);
  const rows = nonEmpty.slice(1);

  console.log(`[DEBUG-25JUL-D] raw lines: ${rawLines.length}, non-empty: ${nonEmpty.length}, data rows: ${rows.length}`);
  const dateStartCount = rows.filter((l) => /^\d{4}-\d{2}-\d{2},/.test(l)).length;
  console.log(`[DEBUG-25JUL-D] lines starting with a date: ${dateStartCount} (if far below ${rows.length}, rows are getting mis-split)`);

  const buckets = { csv_column_count: [], date_format: [], first_prize_format: [], front3_unparsable: [], back3_unparsable: [], front3_shape: [], back3_shape: [], back2_format: [] };
  const ok = [];

  for (const line of rows) {
    const f = splitCsvLine(line);
    if (f.length !== 10) { buckets.csv_column_count.push(`fields=${f.length} :: ${line.slice(0, 110)}`); continue; }
    const [dateStr, firstPrize, front3Str, back3Str, back2Raw] = f;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { buckets.date_format.push(`date="${dateStr}" :: ${line.slice(0, 110)}`); continue; }
    if (!/^\d{6}$/.test(firstPrize)) { buckets.first_prize_format.push(`prize="${firstPrize}" :: ${line.slice(0, 110)}`); continue; }
    const front3 = parsePyList(front3Str), back3 = parsePyList(back3Str);
    if (front3 === undefined) { buckets.front3_unparsable.push(`raw="${front3Str}" :: ${line.slice(0, 110)}`); continue; }
    if (back3 === undefined) { buckets.back3_unparsable.push(`raw="${back3Str}" :: ${line.slice(0, 110)}`); continue; }
    if (!(front3.length === 0 || front3.length === 2)) { buckets.front3_shape.push(`len=${front3.length} raw="${front3Str}" :: ${line.slice(0, 110)}`); continue; }
    if (!(back3.length === 2 || back3.length === 4)) { buckets.back3_shape.push(`len=${back3.length} raw="${back3Str}" :: ${line.slice(0, 110)}`); continue; }
    const back2 = (back2Raw || "").trim().padStart(2, "0");
    if (!/^\d{2}$/.test(back2)) { buckets.back2_format.push(`raw="${back2Raw}" :: ${line.slice(0, 110)}`); continue; }
    ok.push(dateStr);
  }

  const totalSkipped = Object.values(buckets).reduce((a, b) => a + b.length, 0);
  console.log(`[DEBUG-25JUL-D] would-parse: ${ok.length}, would-skip: ${totalSkipped}`);
  console.log("[DEBUG-25JUL-D] --- skip breakdown ---");
  for (const [name, items] of Object.entries(buckets)) console.log(`  ${name}: ${items.length}`);
  console.log("[DEBUG-25JUL-D] --- samples (up to 4 each) ---");
  for (const [name, items] of Object.entries(buckets)) {
    if (!items.length) continue;
    console.log(`  == ${name} ==`);
    items.slice(0, 4).forEach((s) => console.log(`     ${s}`));
  }
  console.log("[DEBUG-25JUL-D] diagnostic only — nothing written to Supabase.");
}
main().catch((err) => { console.error(err); process.exit(1); });
