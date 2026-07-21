const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const THAI_MONTHS = {
  "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4,
  "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8,
  "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
};

function thaiDateToIso(thaiDate) {
  const [day, monthName, yearBE] = thaiDate.trim().split(/\s+/);
  const month = THAI_MONTHS[monthName];
  const year = Number(yearBE) - 543;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function main() {
  const res = await fetch("https://lotto.api.rayriffy.com/latest");
  if (!res.ok) throw new Error(`rayriffy fetch failed: ${res.status}`);
  const data = await res.json();
  if (data.status !== "success") throw new Error("rayriffy returned non-success status");

  const r = data.response;
  const findPrize = (id) => r.prizes.find((p) => p.id === id)?.number?.[0];
  const findRunning = (id) => r.runningNumbers.find((n) => n.id === id)?.number;

  const row = {
    draw_date: thaiDateToIso(r.date),
    first_prize: findPrize("prizeFirst"),
    front3: findRunning("runningNumberFrontThree"),
    back3: findRunning("runningNumberBackThree"),
    back2: findRunning("runningNumberBackTwo")?.[0],
  };

  if (!row.draw_date || !row.first_prize || !row.front3 || !row.back3 || !row.back2) {
    throw new Error("Missing expected fields in rayriffy response: " + JSON.stringify(r));
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
