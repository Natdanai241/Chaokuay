const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function isValidCandidate(c) {
  return (
    c && typeof c.rank === "number" &&
    typeof c.firstPrize === "string" && /^\d{6}$/.test(c.firstPrize) &&
    Array.isArray(c.front3) && Array.isArray(c.back3) &&
    typeof c.back2 === "string" && /^\d{2}$/.test(c.back2) &&
    typeof c.agreementScore === "number" && typeof c.statisticalScore === "number" &&
    Array.isArray(c.contributingStrategies) && typeof c.explanationTh === "string"
  );
}

export async function POST(request) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return Response.json({ error: "Server is not configured (missing SUPABASE_URL/SUPABASE_SECRET_KEY)" }, { status: 500 });
  }
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { targetDrawDate, candidates } = body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDrawDate) || !Array.isArray(candidates) || candidates.length === 0) {
    return Response.json({ error: "Expected { targetDrawDate: 'YYYY-MM-DD', candidates: [...] }" }, { status: 400 });
  }
  if (!candidates.every(isValidCandidate)) {
    return Response.json({ error: "One or more candidates has an unexpected shape" }, { status: 400 });
  }

  const generatedAt = new Date().toISOString();
  const rows = candidates.map((c) => ({
    target_draw_date: targetDrawDate, rank: c.rank, first_prize: c.firstPrize,
    front3: c.front3, back3: c.back3, back2: c.back2,
    agreement_score: c.agreementScore, statistical_score: c.statisticalScore,
    contributing_strategies: c.contributingStrategies, explanation_th: c.explanationTh,
    generated_at: generatedAt, source: "user-generated",
  }));

  const r = await fetch(`${SUPABASE_URL}/rest/v1/position_predictions?on_conflict=target_draw_date,rank,source`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) return Response.json({ error: `Supabase insert failed: ${r.status} ${await r.text()}` }, { status: 502 });
  return Response.json({ stored: rows.length }, { status: 200 });
}
