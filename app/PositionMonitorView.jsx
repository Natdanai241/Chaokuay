"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { STRATEGIES } from "../lib/models.js";
import {
  PREDICTION_TYPE_POSITIONS, RANDOM_BASELINE_DIGIT_BRIER,
  deployPositionWeightsFromState, positionKey, positionStateRowToState,
} from "../lib/learning.js";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Target, Gauge, Grid3x3 } from "lucide-react";

const COLORS = {
  gold: "#C9A24B", cold: "#5C7A99", mist: "#8B839C", parchment: "#EDE6D6",
  ember: "#B8552F", surface: "#17131F",
};

function Card({ children, className = "" }) { return <div className={`ck-card ck-edge-gilt ${className}`}>{children}</div>; }
function CardHeader({ children }) { return <div className="flex flex-col gap-1" style={{ padding: "20px 20px 12px" }}>{children}</div>; }
function CardTitle({ children, className = "" }) { return <h3 className={`ck-display ${className}`} style={{ fontSize: "1rem", fontWeight: 600, color: "var(--parchment)" }}>{children}</h3>; }
function CardDescription({ children }) { return <p style={{ fontSize: "0.875rem", color: "var(--mist)" }}>{children}</p>; }
function CardContent({ children, className = "" }) { return <div className={className} style={{ padding: "0 20px 20px" }}>{children}</div>; }
function Badge({ tone = "mist", children }) { return <span className={`ck-badge ck-badge-${tone}`}>{children}</span>; }

const TYPE_LABELS = { firstPrize: "รางวัลที่ 1 (6 หลัก)", front3: "เลขหน้า 3 ตัว", back3: "เลขท้าย 3 ตัว", back2: "เลขท้าย 2 ตัว" };

export default function PositionMonitorView() {
  const [state, setState] = useState([]);
  const [stateLoading, setStateLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("strategy_position_learning_state")
      .select("strategy_id, prediction_type, digit_position, evaluated_count, long_term_mean_brier, recent_briers, last_target_draw_date, last_brier, model_version, updated_at")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setState(data);
        setStateLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const [summaryRows, setSummaryRows] = useState([]);
  const [summaryMeta, setSummaryMeta] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("position_walkforward_summary")
      .select("run_id, run_at")
      .order("run_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled || error || !data?.length) { setSummaryLoading(false); return; }
        const latest = data[0];
        setSummaryMeta(latest);
        supabase
          .from("position_walkforward_summary")
          .select("prediction_type, digit_position, variant, sample_size, mean_brier, digit_hit_rate, mean_rank, random_baseline_brier")
          .eq("run_id", latest.run_id)
          .then(({ data: rows, error: err2 }) => {
            if (cancelled) return;
            if (!err2 && rows) setSummaryRows(rows);
            setSummaryLoading(false);
          });
      });
    return () => { cancelled = true; };
  }, []);

  const stateByKey = useMemo(() => {
    const m = new Map();
    for (const row of state) m.set(positionKey(row.strategy_id, row.prediction_type, row.digit_position), positionStateRowToState(row));
    return m;
  }, [state]);

  const equalBaseWeights = useMemo(() => STRATEGIES.map((s) => ({ strategy: s.id, weight: 1 / STRATEGIES.length })), []);

  const [weightType, setWeightType] = useState("firstPrize");
  const weightMatrix = useMemo(() => {
    if (!state.length) return [];
    const len = PREDICTION_TYPE_POSITIONS[weightType];
    const cols = [];
    for (let pos = 0; pos < len; pos++) cols.push(deployPositionWeightsFromState(equalBaseWeights, stateByKey, weightType, pos));
    return cols;
  }, [state, stateByKey, equalBaseWeights, weightType]);

  const comparisonByType = useMemo(() => {
    const out = {};
    for (const type of Object.keys(PREDICTION_TYPE_POSITIONS)) {
      out[type] = {};
      for (const variant of ["A", "B", "C"]) {
        const rows = summaryRows.filter((r) => r.prediction_type === type && r.variant === variant);
        if (!rows.length) continue;
        const n = rows.reduce((s, r) => s + r.sample_size, 0);
        const hitRate = rows.reduce((s, r) => s + r.digit_hit_rate * r.sample_size, 0) / n;
        out[type][variant] = { hitRate, n };
      }
    }
    return out;
  }, [summaryRows]);

  const comparisonChartData = Object.keys(PREDICTION_TYPE_POSITIONS).map((type) => ({
    type: TYPE_LABELS[type],
    A: comparisonByType[type]?.A ? +(comparisonByType[type].A.hitRate * 100).toFixed(2) : null,
    B: comparisonByType[type]?.B ? +(comparisonByType[type].B.hitRate * 100).toFixed(2) : null,
    C: comparisonByType[type]?.C ? +(comparisonByType[type].C.hitRate * 100).toFixed(2) : null,
  }));

  const calibrationRows = summaryRows
    .filter((r) => r.variant === "C" && r.mean_brier != null)
    .sort((a, b) => a.prediction_type.localeCompare(b.prediction_type) || a.digit_position - b.digit_position);

  return (
    <div className="mx-auto flex flex-col" style={{ maxWidth: 950, gap: 20 }}>
      <div>
        <p className="ck-eyebrow" style={{ marginBottom: 4 }}>ระบบเรียนรู้รายตำแหน่ง</p>
        <h1 className="ck-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "var(--parchment)" }}>ติดตามระบบ Position Learning</h1>
        <p style={{ marginTop: 4, maxWidth: 640, fontSize: "0.875rem", color: "var(--mist)" }}>
          น้ำหนักรายกลยุทธ์/ประเภท/ตำแหน่งหลัก, อัตราตรงหลัก, และการเทียบ A (ระบบเดิม) vs B (น้ำหนักเท่ากัน) vs C (เรียนรู้แล้ว)
          {summaryMeta && <> — ข้อมูลจากรอบทดสอบล่าสุด {new Date(summaryMeta.run_at).toLocaleString("th-TH")}</>}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center" style={{ gap: 8 }}><Target size={16} color={COLORS.gold} /> เทียบ A / B / C: อัตราตรงหลัก</CardTitle>
          <CardDescription>อัตราที่หลักที่ทำนาย (argmax) ตรงกับหลักจริง เฉลี่ยทุกตำแหน่งในแต่ละประเภท จากการวอล์กฟอร์เวิร์ดล่าสุด</CardDescription>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <p style={{ fontSize: "0.8rem", color: "var(--mist)" }}>กำลังโหลด...</p>
          ) : summaryRows.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "var(--mist)" }}>ยังไม่มีข้อมูล — รัน "Run position walk-forward comparison" ใน GitHub Actions ก่อน</p>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={comparisonChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(201,162,75,0.1)" />
                  <XAxis dataKey="type" tick={{ fontSize: 10, fill: "var(--mist)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--mist)" }} unit="%" />
                  <Tooltip contentStyle={{ background: COLORS.surface, border: "1px solid rgba(201,162,75,0.3)", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="A" name="A: ระบบเดิม" fill={COLORS.ember} />
                  <Bar dataKey="B" name="B: น้ำหนักเท่ากัน" fill={COLORS.cold} />
                  <Bar dataKey="C" name="C: เรียนรู้แล้ว" fill={COLORS.gold} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center" style={{ gap: 8 }}><Gauge size={16} color={COLORS.gold} /> การปรับเทียบ (Calibration) — C เทียบกับโอกาสสุ่ม</CardTitle>
          <CardDescription>Brier score รายตำแหน่งของระบบเรียนรู้ (C) เทียบกับเส้นฐานสุ่ม ({RANDOM_BASELINE_DIGIT_BRIER.toFixed(2)}) ยิ่งต่ำกว่าเส้นฐานยิ่งดี</CardDescription>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <p style={{ fontSize: "0.8rem", color: "var(--mist)" }}>กำลังโหลด...</p>
          ) : calibrationRows.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "var(--mist)" }}>ยังไม่มีข้อมูล</p>
          ) : (
            <div className="grid md:grid-cols-2" style={{ gap: 8 }}>
              {calibrationRows.map((r) => {
                const skill = (r.random_baseline_brier - r.mean_brier) / r.random_baseline_brier;
                return (
                  <div key={`${r.prediction_type}-${r.digit_position}`} className="flex items-center justify-between" style={{ fontSize: "0.78rem", padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)" }}>
                    <span style={{ color: "var(--parchment)" }}>{TYPE_LABELS[r.prediction_type]} · ตำแหน่ง {r.digit_position + 1}</span>
                    <span style={{ color: "var(--mist)" }}>brier {r.mean_brier.toFixed(4)} / ฐาน {r.random_baseline_brier.toFixed(2)}</span>
                    <Badge tone={skill > 0.01 ? "gold" : "mist"}>{skill >= 0 ? "+" : ""}{(skill * 100).toFixed(1)}%</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center" style={{ gap: 8 }}><Grid3x3 size={16} color={COLORS.gold} /> น้ำหนักรายกลยุทธ์ × ตำแหน่ง</CardTitle>
          <CardDescription>น้ำหนักที่ deploy จริงในแต่ละตำแหน่งหลัก (คำนวณจาก strategy_position_learning_state ล่าสุด)</CardDescription>
          <div className="flex flex-wrap" style={{ gap: 6, marginTop: 8 }}>
            {Object.keys(PREDICTION_TYPE_POSITIONS).map((type) => (
              <button
                key={type}
                onClick={() => setWeightType(type)}
                className={`ck-badge ck-badge-${weightType === type ? "gold" : "mist"}`}
                style={{ cursor: "pointer", border: "none" }}
              >
                {TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {stateLoading ? (
            <p style={{ fontSize: "0.8rem", color: "var(--mist)" }}>กำลังโหลด...</p>
          ) : weightMatrix.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "var(--mist)" }}>ยังไม่มีข้อมูล — รัน walk-forward พร้อม COMMIT_POSITION_STATE ก่อน</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--mist)" }}>กลยุทธ์</th>
                    {weightMatrix.map((_, pos) => (
                      <th key={pos} style={{ textAlign: "center", padding: "4px 8px", color: "var(--mist)" }}>ตำแหน่ง {pos + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STRATEGIES.map((s) => (
                    <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "4px 8px", color: "var(--parchment)" }}>{s.nameTh}</td>
                      {weightMatrix.map((col, pos) => {
                        const w = col.find((x) => x.strategy === s.id)?.weight ?? 0;
                        const strong = w > (1 / STRATEGIES.length) * 1.15;
                        return (
                          <td key={pos} style={{ textAlign: "center", padding: "4px 8px", color: strong ? "var(--gold-bright)" : "var(--mist)", fontWeight: strong ? 600 : 400 }}>
                            {w.toFixed(3)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
