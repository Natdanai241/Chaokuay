function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

// Fetches the most recent walk-forward replay and aggregates it client-side
// (same "fetch raw, aggregate in JS" style as runBacktest/summarizeBacktest
// elsewhere in this codebase) rather than depending on a PostgREST aggregate
// feature that may not be enabled on this project. Null if none stored yet.
async function loadWalkForwardSummary() {
  const latest = await supabase
    .from("walk_forward_ensemble_runs")
    .select("run_id")
    .order("created_at", { ascending: false })
    .limit(1);
  const runId = latest.data?.[0]?.run_id;
  if (!runId) return null;

  const rows = await supabase
    .from("walk_forward_ensemble_runs")
    .select("baseline_back2_brier, adaptive_back2_brier, baseline_back2_match_pct, adaptive_back2_match_pct")
    .eq("run_id", runId);
  if (rows.error || !rows.data?.length) return null;

  const n = rows.data.length;
  const avg = (key) => mean(rows.data.map((r) => Number(r[key])));
  // Paired difference test -- same 2*SE convention as isIndistinguishable-
  // FromChance / run-evolution.js's adoption threshold elsewhere in this
  // codebase: is baseline_brier - adaptive_brier reliably above zero?
  const diffs = rows.data.map((r) => Number(r.baseline_back2_brier) - Number(r.adaptive_back2_brier));
  const meanDiff = mean(diffs);
  const variance = diffs.reduce((a, d) => a + (d - meanDiff) ** 2, 0) / Math.max(n - 1, 1);
  const seDiff = Math.sqrt(variance / n);

  return {
    n,
    avgBaselineBrier: avg("baseline_back2_brier"),
    avgAdaptiveBrier: avg("adaptive_back2_brier"),
    avgBaselineHitPct: avg("baseline_back2_match_pct"),
    avgAdaptiveHitPct: avg("adaptive_back2_match_pct"),
    adaptiveBeatsBaseline: meanDiff > 2 * seDiff,
  };
}

// One honest verdict from whatever's actually been validated so far. Every
// entry is a live flag read from a DB row, not a hardcoded conclusion --
// if a method genuinely starts beating baseline, this reflects it
// automatically next time it's run.
function computeVerdict({ featureDiscovery, evolution, mlModels, walkForward }) {
  const checks = [];
  if (featureDiscovery) checks.push({ label: "Feature Discovery", beats: !!featureDiscovery.beats_baseline_on_held_out });
  if (evolution) checks.push({ label: "Evolution Engine", beats: !!evolution.evolved_beats_random_on_held_out });
  if (mlModels) {
    checks.push({ label: "Random Forest", beats: !!mlModels.random_forest_beats_random });
    checks.push({ label: "Gradient Boosted Trees", beats: !!mlModels.gbt_beats_random });
    checks.push({ label: "Neural Network", beats: !!mlModels.nn_beats_random });
  }
  if (walkForward) checks.push({ label: "Adaptive Learning (walk-forward)", beats: !!walkForward.adaptiveBeatsBaseline });
  return { checks, beatCount: checks.filter((c) => c.beats).length, total: checks.length };
}

function ResearchView() {
  const [loading, setLoading] = useState(true);
  const [featureDiscovery, setFeatureDiscovery] = useState(null);
  const [evolution, setEvolution] = useState(null);
  const [mlModels, setMlModels] = useState(null);
  const [weightHistory, setWeightHistory] = useState([]);
  const [walkForward, setWalkForward] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [fd, evo, ml, wh, wf] = await Promise.all([
        supabase.from("feature_discovery_runs").select("*").order("run_at", { ascending: false }).limit(1),
        supabase.from("evolution_runs").select("*").order("run_at", { ascending: false }).limit(1),
        supabase.from("ml_model_runs").select("*").order("run_at", { ascending: false }).limit(1),
        supabase.from("weight_version_history").select("*").order("created_at", { ascending: false }).limit(10),
        loadWalkForwardSummary(),
      ]);
      if (cancelled) return;
      setFeatureDiscovery(fd.data?.[0] || null);
      setEvolution(evo.data?.[0] || null);
      setMlModels(ml.data?.[0] || null);
      setWeightHistory(wh.data || []);
      setWalkForward(wf);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";

  if (loading) {
    return (
      <div className="mx-auto flex flex-col items-center" style={{ maxWidth: 950, gap: 12, paddingTop: 60 }}>
        <Loader2 size={24} color={COLORS.gold} className="animate-spin" />
        <p style={{ fontSize: "0.85rem", color: "var(--mist)" }}>กำลังโหลดผลการวิจัย...</p>
      </div>
    );
  }

  const verdict = computeVerdict({ featureDiscovery, evolution, mlModels, walkForward });

  return (
    <div className="mx-auto flex flex-col" style={{ maxWidth: 950, gap: 20 }}>
      <div>
        <p className="ck-eyebrow" style={{ marginBottom: 4 }}>งานวิจัยเชิงลึก</p>
        <h1 className="ck-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "var(--parchment)" }}>Feature Discovery · Evolution Engine · ML Models</h1>
        <p style={{ marginTop: 4, maxWidth: 640, fontSize: "0.875rem", color: "var(--mist)" }}>
          กระบวนการค้นหาเชิงลึกที่รันเป็นระยะ (ไม่ใช่ทุกงวด) แต่ละอย่างมีการตรวจสอบด้วยข้อมูลชุดที่ไม่เคยใช้ระหว่างค้นหา (held-out validation)
          เพื่อแยกแยะรูปแบบที่เกิดจากสัญญาณจริง ออกจากรูปแบบที่เกิดจากความผันผวนของข้อมูลชุดค้นหาเอง
        </p>
      </div>
            <Card>
        <CardHeader>
          <CardTitle>สรุปภาพรวมอย่างตรงไปตรงมา</CardTitle>
          <CardDescription>ผลจากทุกวิธีการค้นหารูปแบบที่ผ่านมา ทดสอบด้วยข้อมูล held-out ที่ไม่เคยใช้ตอนค้นหาทั้งหมด</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col" style={{ gap: 12 }}>
          {verdict.total === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--mist)" }}>ยังไม่มีผลการทดสอบให้สรุป — รันกระบวนการค้นหาด้านล่างก่อน</p>
          ) : (
            <>
              <div className="flex flex-wrap" style={{ gap: 8 }}>
                {verdict.checks.map((c) => (
                  <Badge key={c.label} tone={c.beats ? "gold" : "mist"}>{c.label}: {c.beats ? "เหนือกว่าโอกาสสุ่ม" : "ไม่ต่างจากโอกาสสุ่ม"}</Badge>
                ))}
              </div>
              <p style={{ fontSize: "0.85rem", color: "var(--parchment)" }}>
                {verdict.beatCount === 0
                  ? `จากทั้งหมด ${verdict.total} วิธีการที่ทดสอบด้วยข้อมูล held-out ยังไม่มีวิธีใดเหนือกว่าโอกาสสุ่มอย่างมีนัยสำคัญ — สอดคล้องกับสมมติฐานที่ว่าผลสลากเป็นเหตุการณ์สุ่มอิสระในแต่ละงวด`
                  : `${verdict.beatCount} จาก ${verdict.total} วิธีการเหนือกว่าโอกาสสุ่มบนข้อมูล held-out — ควรตรวจสอบเพิ่มเติมก่อนเชื่อถือ เนื่องจากการทดสอบหลายวิธีพร้อมกันมีโอกาสพบผลบวกลวงได้โดยบังเอิญ`}
              </p>
              {walkForward && (
                <p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>
                  Adaptive learning (walk-forward, {walkForward.n} งวด): Brier เฉลี่ย baseline {walkForward.avgBaselineBrier.toFixed(5)} เทียบ adaptive {walkForward.avgAdaptiveBrier.toFixed(5)}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center" style={{ gap: 8 }}><ScanSearch size={16} color={COLORS.gold} /> Feature Discovery</CardTitle>
            {featureDiscovery && <Badge tone="gold">{fmtDate(featureDiscovery.run_at)}</Badge>}
          </div>
          <CardDescription>ค้นหาฟีเจอร์ทีละตัวจากทั้งหมด 7 ตัว บนข้อมูล 70% แรก เก็บเฉพาะตัวที่ผ่านเกณฑ์นัยสำคัญ</CardDescription>
        </CardHeader>
        <CardContent>
          {!featureDiscovery ? (
            <p style={{ fontSize: "0.85rem", color: "var(--mist)" }}>ยังไม่มีการรัน — สั่งรัน "Run feature discovery" ใน GitHub Actions</p>
          ) : (
            <div className="flex flex-col" style={{ gap: 10 }}>
              <div>
                <p style={{ fontSize: "0.75rem", color: "var(--mist)" }}>ฟีเจอร์ที่ผ่านเกณฑ์ (จากทั้งหมด 7 ตัว)</p>
                <p style={{ fontSize: "0.95rem", color: "var(--parchment)", marginTop: 2 }}>
                  {featureDiscovery.selected_features?.length ? featureDiscovery.selected_features.join(", ") : "ไม่มี — ไม่มีฟีเจอร์ใดผ่านเกณฑ์ความสำคัญ"}
                </p>
              </div>
              <div className="grid grid-cols-2" style={{ gap: 10 }}>
                <div>
                  <p style={{ fontSize: "0.7rem", color: "var(--mist)" }}>Held-out Brier (ข้อมูล {featureDiscovery.held_out_sample_size} งวดที่ไม่เคยใช้ค้นหา)</p>
                  <p className="ck-numeral" style={{ fontSize: "1.1rem", color: "var(--gold-bright)" }}>{featureDiscovery.held_out_brier?.toFixed(4)}</p>
                </div>
                <div>
                  <p style={{ fontSize: "0.7rem", color: "var(--mist)" }}>เส้นฐานโอกาสสุ่ม</p>
                  <p className="ck-numeral" style={{ fontSize: "1.1rem", color: "var(--mist)" }}>{featureDiscovery.random_baseline_brier?.toFixed(4)}</p>
                </div>
              </div>
              <Badge tone="gold">{featureDiscovery.beats_baseline_on_held_out ? "ดีกว่าเส้นฐานบนข้อมูล held-out" : "ไม่ต่างจากเส้นฐานอย่างมีนัยสำคัญ"}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center" style={{ gap: 8 }}><TrendingUp size={16} color={COLORS.gold} /> Evolution Engine</CardTitle>
            {evolution && <Badge tone="gold">{fmtDate(evolution.run_at)}</Badge>}
          </div>
          <CardDescription>ค้นหาชุดน้ำหนักของแบบจำลองทั้ง 11 ตัวด้วยวิธีเชิงพันธุกรรม เปรียบเทียบกับน้ำหนักเท่ากันทุกแบบจำลอง</CardDescription>
        </CardHeader>
        <CardContent>
          {!evolution ? (
            <p style={{ fontSize: "0.85rem", color: "var(--mist)" }}>ยังไม่มีการรัน — สั่งรัน "Run evolution engine" ใน GitHub Actions</p>
          ) : (
            <div className="flex flex-col" style={{ gap: 12 }}>
              <p style={{ fontSize: "0.75rem", color: "var(--mist)" }}>
                ประเมิน {evolution.evaluation_count?.toLocaleString()} ชุดน้ำหนัก ({evolution.population_size} ตัวต่อรุ่น x {evolution.generations} รุ่น)
              </p>
              <table className="w-full" style={{ fontSize: "0.8rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--mist)", textAlign: "left" }}>
                    <th style={{ paddingBottom: 6 }}></th>
                    <th style={{ paddingBottom: 6 }}>ชุดค้นหา (selection)</th>
                    <th style={{ paddingBottom: 6 }}>Held-out</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderTop: "1px solid rgba(201,162,75,0.15)" }}>
                    <td style={{ padding: "6px 0", color: "var(--parchment)" }}>น้ำหนักที่วิวัฒนาการ</td>
                    <td style={{ color: "var(--gold-bright)" }}>{evolution.selection_brier_evolved?.toFixed(4)}</td>
                    <td style={{ color: "var(--gold-bright)" }}>{evolution.held_out_brier_evolved?.toFixed(4)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 0", color: "var(--parchment)" }}>น้ำหนักเท่ากันทุกแบบ</td>
                    <td style={{ color: "var(--mist)" }}>{evolution.selection_brier_equal_weight?.toFixed(4)}</td>
                    <td style={{ color: "var(--mist)" }}>{evolution.held_out_brier_equal_weight?.toFixed(4)}</td>
                  </tr>
                </tbody>
              </table>
              <p style={{ fontSize: "0.75rem", color: "var(--mist)" }}>
                {evolution.evolved_beats_equal_weight_on_held_out
                  ? "น้ำหนักที่วิวัฒนาการดีกว่าน้ำหนักเท่ากันอย่างมีนัยสำคัญ แม้ในข้อมูล held-out"
                  : "ส่วนต่างที่เห็นในชุดค้นหาไม่คงอยู่ในข้อมูล held-out — สอดคล้องกับการที่ไม่มีรูปแบบจริงให้ค้นพบ ไม่ใช่ข้อบกพร่องของการค้นหา"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center" style={{ gap: 8 }}><BrainCircuit size={16} color={COLORS.gold} /> ML Models</CardTitle>
            {mlModels && <Badge tone="gold">{fmtDate(mlModels.run_at)}</Badge>}
          </div>
          <CardDescription>Random Forest, Gradient Boosted Trees, และโครงข่ายประสาทเทียมขนาดเล็ก — ไม่รวม LSTM/Transformer เนื่องจากข้อมูลไม่มีความสัมพันธ์เชิงลำดับเวลาให้จับ</CardDescription>
        </CardHeader>
        <CardContent>
          {!mlModels ? (
            <p style={{ fontSize: "0.85rem", color: "var(--mist)" }}>ยังไม่มีการรัน — สั่งรัน "Run ML models" ใน GitHub Actions</p>
          ) : (
            <div className="flex flex-col" style={{ gap: 10 }}>
              {[
                { label: "Random Forest", sel: mlModels.random_forest_selection_brier, ho: mlModels.random_forest_held_out_brier, beats: mlModels.random_forest_beats_random },
                { label: "Gradient Boosted Trees", sel: mlModels.gbt_selection_brier, ho: mlModels.gbt_held_out_brier, beats: mlModels.gbt_beats_random },
                { label: "Neural Network", sel: mlModels.nn_selection_brier, ho: mlModels.nn_held_out_brier, beats: mlModels.nn_beats_random },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between" style={{ padding: "6px 0", borderBottom: "1px solid rgba(201,162,75,0.1)" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--parchment)" }}>{row.label}</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--mist)" }}>held-out {row.ho?.toFixed(4)}</span>
                  <Badge tone="gold">{row.beats ? "เหนือเส้นฐาน" : "เท่าเส้นฐาน"}</Badge>
                </div>
              ))}
              <p style={{ fontSize: "0.72rem", color: "var(--mist)", marginTop: 4 }}>เส้นฐานโอกาสสุ่ม: {mlModels.random_baseline_brier?.toFixed(4)} (ยิ่งใกล้ค่านี้ยิ่งแปลว่าไม่มีความได้เปรียบจริง)</p>
            </div>
          )}
        </CardContent>
      </Card>      {/* Weight Version History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center" style={{ gap: 8 }}><TrendingUp size={16} color={COLORS.gold} /> ประวัติน้ำหนักของแบบจำลอง</CardTitle>
          <CardDescription>ทุกครั้งที่ evolution engine รัน จะเทียบน้ำหนักใหม่กับค่าที่ใช้งานอยู่บนข้อมูล held-out — เปลี่ยนเฉพาะเมื่อดีขึ้นจริงเท่านั้น</CardDescription>
        </CardHeader>
        <CardContent>
          {weightHistory.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--mist)" }}>ยังไม่มีประวัติ — สั่งรัน "Run evolution engine" ใน GitHub Actions</p>
          ) : (
            <div className="flex flex-col" style={{ gap: 16 }}>
              {(() => {
                const active = weightHistory.find((r) => r.adopted);
                if (!active) return null;
                const topWeights = [...active.weights].sort((a, b) => b.weight - a.weight).slice(0, 5);
                return (
                  <div style={{ borderRadius: 10, padding: 12, background: "rgba(201,162,75,0.06)", border: "1px solid rgba(201,162,75,0.2)" }}>
                    <p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>ค่าที่ใช้งานอยู่ปัจจุบัน (นำมาใช้เมื่อ {fmtDate(active.created_at)})</p>
                    <div className="flex flex-wrap" style={{ gap: 6, marginTop: 8 }}>
                      {topWeights.map((w) => (
                        <Badge key={w.strategy} tone="gold">
                          {STRATEGIES.find((s) => s.id === w.strategy)?.nameTh ?? w.strategy} · {w.weight.toFixed(2)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div className="flex flex-col" style={{ gap: 8 }}>
                {weightHistory.map((row) => (
                  <div key={row.id} className="flex items-start justify-between" style={{ padding: "8px 0", borderTop: "1px solid rgba(201,162,75,0.1)", gap: 12 }}>
                    <div>
                      <p style={{ fontSize: "0.78rem", color: "var(--parchment)" }}>{fmtDate(row.created_at)}</p>
                      <p style={{ fontSize: "0.72rem", color: "var(--mist)", marginTop: 2 }}>
                        {row.adopted
                          ? row.held_out_brier_previous == null
                            ? "ยังไม่มีค่าเริ่มต้นมาก่อน — นำมาใช้เป็นค่าเริ่มต้น"
                            : `ดีขึ้นบนข้อมูล held-out จาก ${row.held_out_brier_previous.toFixed(4)} เป็น ${row.held_out_brier_new.toFixed(4)}`
                          : `ไม่ต่างจากค่าปัจจุบันอย่างมีนัยสำคัญ (${row.held_out_brier_new?.toFixed(4)} เทียบ ${row.held_out_brier_previous?.toFixed(4)}) — คงค่าเดิมไว้`}
                      </p>
                    </div>
                    <Badge tone={row.adopted ? "gold" : "mist"}>{row.adopted ? "นำมาใช้" : "ไม่เปลี่ยนแปลง"}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
