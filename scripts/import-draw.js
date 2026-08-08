const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const pad = (n) => String(n).padStart(2, "0");

function mostRecentDrawDate() {
  const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000); // Bangkok is UTC+7
  const year = bkk.getUTCFullYear();
  const month = bkk.getUTCMonth() + 1;
  const day = bkk.getUTCDate() >= 16 ? 16 : 1;
  return { year, month, day };
}

async function fetchGloWithRetry(body, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch("https://www.glo.or.th/api/checking/getLotteryResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`GLO fetch failed: ${res.status} ${await res.text()}`);
      return res.json();
    } catch (err) {
      lastErr = err;
      console.log(`[import-draw] Attempt ${i + 1}/${attempts} failed: ${err.message}`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  const { year, month, day } = mostRecentDrawDate();

  const data = await fetchGloWithRetry({ date: pad(day), month: pad(month), year: String(year) });

  const prizes = data?.response?.result?.data;
  if (!prizes) throw new Error("Unexpected GLO response shape: " + JSON.stringify(data));

  const getNumbers = (entry) => entry?.number?.map((n) => n.value).filter(Boolean) ?? [];

  const row = {
    draw_date: `${year}-${pad(month)}-${pad(day)}`,
    first_prize: getNumbers(prizes.first)[0],
    front3: getNumbers(prizes.last3f),
    back3: getNumbers(prizes.last3b),
    back2: getNumbers(prizes.last2)[0],
  };

  if (!row.first_prize || row.front3.length === 0 || row.back3.length === 0 || !row.back2) {
    throw new Error("Missing expected fields in GLO response: " + JSON.stringify(prizes));
  }

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/draws?on_conflict=draw_date`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify([row]),
  });

  if (!insertRes.ok) throw new Error(`Supabase insert failed: ${insertRes.status} ${await insertRes.text()}`);
  console.log(`Imported ${row.draw_date}: first prize ${row.first_prize}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
