function ResearchView() {
  const [loading, setLoading] = useState(true);
  const [featureDiscovery, setFeatureDiscovery] = useState(null);
  const [evolution, setEvolution] = useState(null);
  const [mlModels, setMlModels] = useState(null);
  const [weightHistory, setWeightHistory] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [fd, evo, ml, wh] = await Promise.all([
        supabase.from("feature_discovery_runs").select("*").order("run_at", { ascending: false }).limit(1),
        supabase.from("evolution_runs").select("*").order("run_at", { ascending: false }).limit(1),
        supabase.from("ml_model_runs").select("*").order("run_at", { ascending: false }).limit(1),
        supabase.from("weight_version_history").select("*").order("created_at", { ascending: false }).limit(10),
      ]);
      if (cancelled) return;
      setFeatureDiscovery(fd.data?.[0] || null);
      setEvolution(evo.data?.[0] || null);
      setMlModels(ml.data?.[0] || null);
      setWeightHistory(wh.data || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

function ResearchView() {
  const [loading, setLoading] = useState(true);
  const [featureDiscovery, setFeatureDiscovery] = useState(null);
  const [evolution, setEvolution] = useState(null);
  const [mlModels, setMlModels] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [fd, evo, ml] = await Promise.all([
        supabase.from("feature_discovery_runs").select("*").order("run_at", { ascending: false }).limit(1),
        supabase.from("evolution_runs").select("*").order("run_at", { ascending: false }).limit(1),
        supabase.from("ml_model_runs").select("*").order("run_at", { ascending: false }).limit(1),
      ]);
      if (cancelled) return;
      setFeatureDiscovery(fd.data?.[0] || null);
      setEvolution(evo.data?.[0] || null);
      setMlModels(ml.data?.[0] || null);
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
      </Card>
    </div>
  );
}
