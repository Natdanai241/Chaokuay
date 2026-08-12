"use client";

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  LayoutDashboard, Sparkles, ScrollText, BarChart3, ScanSearch, BrainCircuit,
  ListOrdered, Settings as SettingsIcon, Menu, X, MoonStar, TrendingUp,
    Database, Loader2, ShieldAlert, ChevronDown, History,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ReferenceLine, ResponsiveContainer, CartesianGrid,
} from "recharts";

import {
  EXPLANATIONS, MIN_WARMUP, STRATEGIES, allDigits, back2FullDistribution, bayesianDigitPosterior,
  bayesianPick, buildCandidates, computeLiveAdjustedWeights, defaultWeights, deriveWeights, digitFrequency, digitTransitionMatrix,
  findMirrorPairs, frequencyPick, gapPick, hasConsecutiveDigits, highLowDistribution, hotColdNumbers,
  isIndistinguishableFromChance, makeRng, markovPick, monteCarloDigitLocal, monteCarloNumberLocal,
  monteCarloPick, monteCarloTopN, nextDrawDateFrom, oddEvenRatio, pairFrequency, parityCorrelation,
  positionFrequency, repeatedDigitNumbers, runBacktest, runProbabilisticBacktest, runStrategy,
  scoreStrategyPick, seedFromDraws, shannonEntropy, strategyBack2DigitProbs, summarizeBacktest,
  summarizeProbabilisticBacktest, tripleFrequency,
} from "../lib/models.js";

const COLORS = {
  ink: "#0D0B14", surface: "#17131F", gold: "#C9A24B", goldBright: "#E8C876",
  cold: "#5C7A99", coldBright: "#7FA0C2", mist: "#8B839C", parchment: "#EDE6D6",
  ember: "#B8552F", border: "#2C2438",
};

const SEED_DRAWS = [
  { drawDate: "2025-05-02", firstPrize: "213388", front3: ["826", "116"], back3: ["167", "662"], back2: "06" },
  { drawDate: "2025-05-16", firstPrize: "251309", front3: ["109", "231"], back3: ["965", "631"], back2: "87" },
  { drawDate: "2025-06-01", firstPrize: "559352", front3: ["349", "134"], back3: ["307", "044"], back2: "20" },
  { drawDate: "2025-06-16", firstPrize: "507392", front3: ["243", "017"], back3: ["299", "736"], back2: "06" },
  { drawDate: "2025-07-01", firstPrize: "949246", front3: ["680", "169"], back3: ["918", "261"], back2: "91" },
  { drawDate: "2025-07-16", firstPrize: "245324", front3: ["995", "171"], back3: ["084", "336"], back2: "26" },
  { drawDate: "2025-10-16", firstPrize: "059696", front3: ["531", "955"], back3: ["476", "889"], back2: "61" },
  { drawDate: "2025-11-01", firstPrize: "345898", front3: ["449", "328"], back3: ["111", "690"], back2: "87" },
  { drawDate: "2025-11-16", firstPrize: "458145", front3: ["242", "602"], back3: ["239", "389"], back2: "37" },
  { drawDate: "2025-12-01", firstPrize: "461252", front3: ["655", "389"], back3: ["137", "995"], back2: "22" },
  { drawDate: "2025-12-16", firstPrize: "763895", front3: ["431", "176"], back3: ["014", "449"], back2: "52" },
  { drawDate: "2026-01-02", firstPrize: "837706", front3: ["347", "694"], back3: ["288", "765"], back2: "16" },
  { drawDate: "2026-01-17", firstPrize: "878972", front3: ["299", "815"], back3: ["662", "363"], back2: "02" },
  { drawDate: "2026-02-01", firstPrize: "174629", front3: ["917", "195"], back3: ["408", "041"], back2: "48" },
  { drawDate: "2026-04-01", firstPrize: "292514", front3: ["406", "113"], back3: ["851", "098"], back2: "47" },
  { drawDate: "2026-04-16", firstPrize: "309612", front3: ["355", "108"], back3: ["868", "424"], back2: "77" },
  { drawDate: "2026-05-02", firstPrize: "536077", front3: ["267", "318"], back3: ["065", "153"], back2: "43" },
  { drawDate: "2026-05-16", firstPrize: "107387", front3: ["298", "091"], back3: ["602", "716"], back2: "08" },
  { drawDate: "2026-06-01", firstPrize: "173770", front3: ["848", "415"], back3: ["410", "938"], back2: "95" },
  { drawDate: "2026-06-16", firstPrize: "287184", front3: ["758", "434"], back3: ["007", "721"], back2: "48" },
  { drawDate: "2026-07-01", firstPrize: "751495", front3: ["001", "980"], back3: ["304", "531"], back2: "62" },
].map((d, i) => ({ ...d, id: `seed-${i}` }));

function formatThaiDate(isoDate) {
  const months = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const d = new Date(isoDate + "T00:00:00Z");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}

const THEME_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Mitr:wght@400;500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');

.ck-root {
  --gold: #C9A24B; --gold-bright: #E8C876; --gold-dim: #8A6E33;
  --cold: #5C7A99; --cold-bright: #7FA0C2;
  --ink: #0D0B14; --ink-soft: #141019; --surface: #17131F; --surface-raised: #1E1828; --border: #2C2438;
  --parchment: #EDE6D6; --mist: #8B839C; --ember: #B8552F;
  font-family: 'IBM Plex Sans Thai', ui-sans-serif, system-ui, sans-serif;
  background: var(--ink); color: var(--parchment); min-height: 100vh; position: relative;
  background-image: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(201,162,75,0.10), transparent),
                     radial-gradient(ellipse 60% 40% at 90% 10%, rgba(92,122,153,0.08), transparent);
}
.ck-display { font-family: 'Mitr', ui-sans-serif, sans-serif; }
.ck-numeral { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.ck-eyebrow { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.2em; color: var(--mist); }
.ck-gold-text { background: linear-gradient(135deg, #8A6E33 0%, #E8C876 45%, #C9A24B 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.ck-text-mist { color: var(--mist); } .ck-text-gold { color: var(--gold-bright); } .ck-text-cold { color: var(--cold-bright); } .ck-text-parchment { color: var(--parchment); }

.ck-card { position: relative; border: 1px solid var(--border); border-radius: 1rem; background: rgba(23,19,31,0.7); backdrop-filter: blur(10px); box-shadow: 0 4px 24px -8px rgba(0,0,0,0.5); }
.ck-edge-gilt::before { content: ""; position: absolute; inset: 0; padding: 1px; border-radius: inherit;
  background: linear-gradient(135deg, rgba(201,162,75,0.5), rgba(201,162,75,0) 40%, rgba(201,162,75,0) 60%, rgba(201,162,75,0.35));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }

.ck-badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 2px 10px; font-size: 0.72rem; font-weight: 500; border: 1px solid transparent; white-space: nowrap; }
.ck-badge-gold { background: rgba(201,162,75,0.15); color: var(--gold-bright); border-color: rgba(201,162,75,0.3); }
.ck-badge-cold { background: rgba(92,122,153,0.15); color: var(--cold-bright); border-color: rgba(92,122,153,0.3); }
.ck-badge-mist { background: var(--surface-raised); color: var(--mist); border-color: var(--border); }

.ck-btn-gold { background: linear-gradient(135deg, #8A6E33 0%, #E8C876 45%, #C9A24B 55%, #8A6E33 100%); color: var(--ink);
  box-shadow: 0 0 40px -8px rgba(201,162,75,0.35); border: none; cursor: pointer; transition: filter 0.2s, box-shadow 0.2s; }
.ck-btn-gold:hover:not(:disabled) { filter: brightness(1.1); box-shadow: 0 0 80px -12px rgba(201,162,75,0.45); }
.ck-btn-gold:disabled { opacity: 0.4; cursor: not-allowed; }

.ck-orb { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; border: 1px solid; flex-shrink: 0; }
.ck-orb-gold { border-color: rgba(201,162,75,0.4); color: var(--gold-bright); background: rgba(201,162,75,0.1); }
.ck-orb-cold { border-color: rgba(92,122,153,0.4); color: var(--cold-bright); background: rgba(92,122,153,0.1); }
.ck-orb-mist { border-color: var(--border); color: var(--parchment); background: var(--surface-raised); }

.ck-nav-link { display: flex; align-items: center; gap: 12px; border-radius: 10px; padding: 10px 12px; font-size: 0.875rem; color: var(--mist); cursor: pointer; border: none; background: none; width: 100%; text-align: left; transition: background 0.15s, color 0.15s; }
.ck-nav-link:hover { background: rgba(30,24,40,0.6); color: var(--parchment); }
.ck-nav-link-active { background: var(--surface-raised); color: var(--gold-bright); }
.ck-brand-badge { width: 32px; height: 32px; border-radius: 999px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #8A6E33 0%, #E8C876 45%, #C9A24B 55%, #8A6E33 100%); box-shadow: 0 0 40px -8px rgba(201,162,75,0.35); flex-shrink: 0; }
.ck-sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: 240px; border-right: 1px solid var(--border); background: rgba(20,16,25,0.7); backdrop-filter: blur(16px); padding: 20px 12px; flex-direction: column; z-index: 30; }
.ck-mobile-header { position: sticky; top: 0; z-index: 40; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); background: rgba(13,11,20,0.85); backdrop-filter: blur(16px); padding: 12px 16px; }
.ck-icon-btn { background: none; border: none; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; }
.ck-icon-btn:hover { background: var(--surface-raised); }

.ck-medallion-outer { position: relative; width: 210px; height: 210px; display: flex; align-items: center; justify-content: center; }
@media (min-width: 768px) { .ck-medallion-outer { width: 250px; height: 250px; } }
.ck-ring { position: absolute; inset: 0; border-radius: 999px; border: 1px solid rgba(201,162,75,0.5); }
.ck-medallion-inner { position: relative; width: 100%; height: 100%; border-radius: 999px; border: 2px solid rgba(201,162,75,0.4); background: var(--surface);
  box-shadow: 0 0 80px -12px rgba(201,162,75,0.45); display: flex; align-items: center; justify-content: center;
  background-image: radial-gradient(circle, rgba(201,162,75,0.5) 1px, transparent 1px); background-size: 22px 22px; }
.ck-medallion-ring2 { position: absolute; inset: 12px; border-radius: 999px; border: 1px solid rgba(138,110,51,0.5); }

@keyframes ck-drift { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(6px,-12px); } }
@keyframes ck-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
@keyframes ck-reveal { 0% { opacity: 0; filter: blur(8px); transform: scale(0.85); } 60% { opacity: 1; filter: blur(2px); } 100% { opacity: 1; filter: blur(0); transform: scale(1); } }
@keyframes ck-ringexpand { 0% { transform: scale(0.9); opacity: 0.9; } 100% { transform: scale(1.6); opacity: 0; } }
.ck-anim-drift { animation: ck-drift 9s ease-in-out infinite; }
.ck-anim-pulse { animation: ck-pulse 4s ease-in-out infinite; }
.ck-anim-reveal { animation: ck-reveal 0.9s cubic-bezier(0.16,1,0.3,1) forwards; }
.ck-anim-ring { animation: ck-ringexpand 1.8s cubic-bezier(0.16,1,0.3,1) forwards; }
@media (prefers-reduced-motion: reduce) { .ck-anim-drift, .ck-anim-pulse, .ck-anim-reveal, .ck-anim-ring { animation: none !important; } }

.ck-table th, .ck-table td { padding: 6px; }
.ck-divide > * + * { border-top: 1px solid var(--border); }
`;

function Card({ children, className = "" }) { return <div className={`ck-card ck-edge-gilt ${className}`}>{children}</div>; }
function CardHeader({ children }) { return <div className="flex flex-col gap-1" style={{ padding: "20px 20px 12px" }}>{children}</div>; }
function CardTitle({ children, className = "" }) { return <h3 className={`ck-display ${className}`} style={{ fontSize: "1rem", fontWeight: 600, color: "var(--parchment)" }}>{children}</h3>; }
function CardDescription({ children }) { return <p style={{ fontSize: "0.875rem", color: "var(--mist)" }}>{children}</p>; }
function CardContent({ children, className = "" }) { return <div className={className} style={{ padding: "0 20px 20px" }}>{children}</div>; }
function Badge({ tone = "mist", children }) { return <span className={`ck-badge ck-badge-${tone}`}>{children}</span>; }
function GoldButton({ children, onClick, disabled, size = "default" }) {
  const dims = { default: { h: 44, p: "0 20px", f: "0.875rem" }, lg: { h: 56, p: "0 32px", f: "1rem" } }[size];
  return (
    <button onClick={onClick} disabled={disabled} className="ck-btn-gold"
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, height: dims.h, padding: dims.p, fontSize: dims.f, fontWeight: 500 }}>
      {children}
    </button>
  );
}
function NumberOrb({ value, size = "md", tone = "gold" }) {
  const dim = { sm: 34, md: 46, lg: 78 }[size], fs = { sm: "0.7rem", md: "0.85rem", lg: "1.1rem" }[size];
  return <span className={`ck-orb ck-orb-${tone} ck-numeral`} style={{ width: dim, height: dim, fontSize: fs }}>{value}</span>;
}
function NumberRow({ digits, size = "md", tone = "gold" }) {
  return <div className="flex" style={{ gap: 6 }}>{digits.split("").map((d, i) => <NumberOrb key={i} value={d} size={size} tone={tone} />)}</div>;
}

function seededSpecks(count) {
  let seed = 42;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  return Array.from({ length: count }, () => ({
    top: `${(rand() * 100).toFixed(2)}%`, left: `${(rand() * 100).toFixed(2)}%`,
    size: Math.round(1 + rand() * 2), delay: `${(rand() * 8).toFixed(2)}s`, duration: `${(7 + rand() * 6).toFixed(2)}s`,
  }));
}
const SPECKS = seededSpecks(36);
function MagicalBackground() {
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      {SPECKS.map((s, i) => (
        <span key={i} className="ck-anim-drift" style={{ position: "absolute", top: s.top, left: s.left, width: s.size, height: s.size, borderRadius: "999px", background: COLORS.gold, opacity: 0.35, animationDelay: s.delay, animationDuration: s.duration }} />
      ))}
    </div>
  );
}
function RevealMedallion({ value, label, revealed }) {
  return (
    <div className="flex flex-col items-center" style={{ gap: 16 }}>
      <div className="ck-medallion-outer">
        {revealed && (<>
          <span className="ck-ring ck-anim-ring" />
          <span className="ck-ring ck-anim-ring" style={{ animationDelay: "0.3s" }} />
        </>)}
        <div className="ck-medallion-inner">
          <div className="ck-medallion-ring2" />
          {revealed ? (
            <span key={value} className="ck-numeral ck-gold-text ck-anim-reveal" style={{ fontSize: "2.6rem", fontWeight: 600 }}>{value}</span>
          ) : (
            <span className="ck-numeral ck-anim-pulse" style={{ fontSize: "1.4rem", color: "var(--mist)" }}>?????</span>
          )}
        </div>
      </div>
      <span className="ck-eyebrow">{label}</span>
    </div>
  );
}

const NAV_ITEMS = [
  { id: "dashboard", label: "แดชบอร์ด", icon: LayoutDashboard },
  { id: "generate", label: "สร้างคำทำนาย", icon: Sparkles },
  { id: "history", label: "ผลรางวัลย้อนหลัง", icon: ScrollText },
  { id: "statistics", label: "สถิติ", icon: BarChart3 },
  { id: "patterns", label: "ค้นหารูปแบบ", icon: ScanSearch },
  { id: "models", label: "ประสิทธิภาพแบบจำลอง", icon: BrainCircuit },
  { id: "predictions", label: "ประวัติคำทำนาย", icon: ListOrdered },
  { id: "settings", label: "ตั้งค่า", icon: SettingsIcon },
];
function Brand() {
  return (
    <div className="flex items-center" style={{ gap: 10 }}>
      <div className="ck-brand-badge"><MoonStar size={16} color={COLORS.ink} strokeWidth={2.5} /></div>
      <div className="flex flex-col" style={{ lineHeight: 1 }}>
        <span className="ck-display" style={{ fontSize: "1rem", fontWeight: 600, color: "var(--parchment)" }}>เฉาก๊วย</span>
        <span className="ck-eyebrow">สถิติสลากกินแบ่ง</span>
      </div>
    </div>
  );
}
function NavList({ view, setView, onNavigate }) {
  return (
    <nav className="flex flex-col" style={{ gap: 4 }}>
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const active = view === id;
        return (
          <button key={id} onClick={() => { setView(id); onNavigate && onNavigate(); }} className={`ck-nav-link ${active ? "ck-nav-link-active" : ""}`}>
            <Icon size={16} color={active ? COLORS.gold : COLORS.mist} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
function Sidebar({ view, setView }) {
  return (
    <aside className="ck-sidebar hidden md:flex">
      <div style={{ marginBottom: 28 }}><Brand /></div>
      <NavList view={view} setView={setView} />
      <div style={{ marginTop: "auto", paddingTop: 20 }}>
        <div className="ck-card ck-edge-gilt" style={{ padding: 12 }}>
          <p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>ตัวเลขทั้งหมดเป็นการวิเคราะห์ทางสถิติเพื่อการวิจัยและความบันเทิงเท่านั้น ไม่ใช่การรับประกันผลรางวัล</p>
        </div>
      </div>
    </aside>
  );
}
function MobileHeader({ view, setView }) {
  const [open, setOpen] = useState(false);
  return (<>
    <header className="ck-mobile-header md:hidden">
      <Brand />
      <button className="ck-icon-btn" onClick={() => setOpen(true)}><Menu size={20} color={COLORS.parchment} /></button>
    </header>
    {open && (
      <div className="md:hidden" style={{ position: "fixed", inset: 0, zIndex: 50 }}>
        <div onClick={() => setOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)" }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 280, borderRight: "1px solid var(--border)", background: "var(--ink-soft)", padding: 20, overflowY: "auto" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 28 }}>
            <Brand />
            <button className="ck-icon-btn" onClick={() => setOpen(false)}><X size={20} color={COLORS.parchment} /></button>
          </div>
          <NavList view={view} setView={setView} onNavigate={() => setOpen(false)} />
        </div>
      </div>
    )}
  </>);
}

function DashboardView({ draws, predictions, setView }) {
  const latest = draws[draws.length - 1];
  const upcoming = nextDrawDateFrom(draws);
  const back2Freq = digitFrequency(draws.map((d) => d.back2));
  const hot = hotColdNumbers(draws, "back2").filter((h) => h.count > 0).slice(0, 5);
  const backtest = summarizeBacktest(runBacktest(draws));
  const best = [...backtest].sort((a, b) => b.compositeScore - a.compositeScore)[0];

  return (
    <div className="mx-auto flex flex-col" style={{ maxWidth: 1100, gap: 24 }}>
      <div>
        <p className="ck-eyebrow" style={{ marginBottom: 4 }}>แดชบอร์ด</p>
        <h1 className="ck-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "var(--parchment)" }}>ภาพรวมสถิติสลากกินแบ่งรัฐบาล</h1>
      </div>

      <div className="grid md:grid-cols-3" style={{ gap: 20 }}>
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>ผลรางวัลล่าสุด</CardTitle>
                <Badge tone="gold">{formatThaiDate(latest.drawDate)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col" style={{ gap: 20 }}>
              <div>
                <p className="ck-eyebrow" style={{ marginBottom: 8 }}>รางวัลที่ 1</p>
                <NumberRow digits={latest.firstPrize} size="lg" tone="gold" />
              </div>
              <div className="grid grid-cols-3" style={{ gap: 16 }}>
                <div><p className="ck-eyebrow" style={{ marginBottom: 8 }}>เลขหน้า 3 ตัว</p><div className="flex flex-col" style={{ gap: 6 }}>{latest.front3.map((n, i) => <NumberRow key={i} digits={n} size="sm" tone="mist" />)}</div></div>
                <div><p className="ck-eyebrow" style={{ marginBottom: 8 }}>เลขท้าย 3 ตัว</p><div className="flex flex-col" style={{ gap: 6 }}>{latest.back3.map((n, i) => <NumberRow key={i} digits={n} size="sm" tone="mist" />)}</div></div>
                <div><p className="ck-eyebrow" style={{ marginBottom: 8 }}>เลขท้าย 2 ตัว</p><NumberRow digits={latest.back2} size="sm" tone="cold" /></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center" style={{ gap: 8 }}><Sparkles size={16} color={COLORS.gold} /> งวดถัดไป</CardTitle>
            <CardDescription>{formatThaiDate(upcoming)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col justify-between" style={{ gap: 14, flex: 1 }}>
            <p style={{ fontSize: "0.875rem", color: "var(--mist)" }}>สร้างคำทำนายเชิงสถิติสำหรับงวดนี้ พร้อมคะแนนความสอดคล้องของแบบจำลอง</p>
            <GoldButton onClick={() => setView("generate")}><Sparkles size={16} /> ไปสร้างคำทำนาย</GoldButton>
            {predictions.length > 0 && <p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>สร้างคำทำนายแล้ว {predictions.length} รายการในเซสชันนี้</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-3" style={{ gap: 20 }}>
        <div className="md:col-span-2">
          <Card>
            <CardHeader><CardTitle>ความถี่ของหลัก (เลขท้าย 2 ตัว)</CardTitle><CardDescription>สะสมจากฐานข้อมูล {draws.length} งวด</CardDescription></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={back2Freq} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                  <XAxis dataKey="digit" stroke={COLORS.mist} fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke={COLORS.mist} fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.parchment, fontSize: 12 }} cursor={{ fill: "rgba(201,162,75,0.08)" }} />
                  <Bar dataKey="count" fill={COLORS.gold} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader><CardTitle className="flex items-center" style={{ gap: 8 }}><TrendingUp size={16} color={COLORS.gold} /> เลขที่ออกบ่อย</CardTitle></CardHeader>
          <CardContent className="flex flex-col" style={{ gap: 10 }}>
            {hot.length ? hot.map((h) => (
              <div key={h.number} className="flex items-center justify-between">
                <NumberOrb value={h.number} size="sm" tone="gold" />
                <span style={{ fontSize: "0.72rem", color: "var(--mist)" }}>{h.count} ครั้ง</span>
              </div>
            )) : <p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>ยังไม่มีเลขซ้ำในฐานข้อมูลปัจจุบัน</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center" style={{ gap: 8 }}><Database size={16} color={COLORS.gold} /> ความคืบหน้าการเรียนรู้ของแบบจำลอง</CardTitle><CardDescription>ผลทดสอบย้อนหลังจริงจากข้อมูล {draws.length} งวด — ไม่ใช่ตัวเลขสมมติ</CardDescription></CardHeader>
        <CardContent>
          <div className="grid" style={{ gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            {STRATEGIES.map((s) => {
              const row = backtest.find((b) => b.strategy === s.id);
              const isBest = best?.strategy === s.id;
              return (
                <div key={s.id} style={{ borderRadius: 12, padding: 12, border: `1px solid ${isBest ? "rgba(201,162,75,0.5)" : COLORS.border}`, background: isBest ? "rgba(201,162,75,0.05)" : "rgba(30,24,40,0.4)" }}>
                  <p style={{ fontSize: "0.75rem", color: "var(--parchment)" }}>{s.nameTh}</p>
                  <p className="ck-numeral" style={{ fontSize: "1.15rem", color: "var(--gold-bright)", marginTop: 4 }}>{row ? (row.back2HitRate * 100).toFixed(1) : "0.0"}%</p>
                  <p style={{ fontSize: "0.68rem", color: "var(--mist)" }}>ตรงท้าย 2 ตัว ({row?.runs ?? 0} รอบ)</p>
                </div>
              );
            })}
          </div>
          <p style={{ marginTop: 16, fontSize: "0.72rem", color: "var(--mist)" }}>เนื่องจากผลสลากเป็นเหตุการณ์สุ่มอิสระ อัตราที่คาดหวังในระยะยาวคือระดับโอกาสสุ่ม (≈1% สำหรับเลขท้าย 2 ตัว) ตัวเลขข้างต้นคือผลจริงจากการทดสอบย้อนหลัง ไม่ใช่การรับประกัน</p>
        </CardContent>
      </Card>
    </div>
  );
}
function GenerateView({ draws, onGenerated }) {
  const [candidates, setCandidates] = useState(null);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [learningInfo, setLearningInfo] = useState(null);

  async function handleGenerate() {
    setLoading(true); setRevealed(false);

    const nextTarget = nextDrawDateFrom(draws);
    console.log(`[Generate] next draw: ${nextTarget}`);

    let baselineWeights = null;
    let evolutionDate = null;
    try {
      const { data, error } = await supabase
        .from("weight_version_history")
        .select("weights, created_at")
        .eq("adopted", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!error && Array.isArray(data?.[0]?.weights) && data[0].weights.length > 0) {
        baselineWeights = data[0].weights;
        evolutionDate = data[0].created_at;
      }
    } catch {}
    if (!baselineWeights) baselineWeights = deriveWeights(runBacktest(draws));

        let learningEvaluations = [];
    let walkForwardThrough = null;
    let walkForwardDebug = "not attempted";
    try {
      const { data: latestRun, error: runError } = await supabase
        .from("walk_forward_ensemble_runs")
        .select("run_id")
        .order("created_at", { ascending: false })
        .limit(1);
      if (runError) {
        walkForwardDebug = `run lookup error: ${runError.message}`;
      } else {
        const runId = latestRun?.[0]?.run_id;
        if (!runId) {
          walkForwardDebug = "no run_id found in walk_forward_ensemble_runs";
        } else {
          const { data: wfRows, error: wfError } = await supabase
            .from("walk_forward_strategy_runs")
            .select("strategy_id, back2_match_pct, target_draw_date")
            .eq("run_id", runId)
            .lt("target_draw_date", nextTarget);
          if (wfError) {
            walkForwardDebug = `rows query error: ${wfError.message}`;
          } else if (!wfRows?.length) {
            walkForwardDebug = `run_id ${runId.slice(0, 8)} found but 0 rows before ${nextTarget}`;
          } else {
            learningEvaluations = learningEvaluations.concat(wfRows);
            walkForwardThrough = wfRows.reduce((max, r) => (r.target_draw_date > max ? r.target_draw_date : max), wfRows[0].target_draw_date);
            walkForwardDebug = `ok: ${wfRows.length} rows`;
          }
        }
      }
    } catch (err) {
      walkForwardDebug = `exception: ${err.message}`;
    }

    const weights = computeLiveAdjustedWeights(baselineWeights, learningEvaluations);
    const learningSource = walkForwardThrough ? "walk-forward" : evolutionDate ? "evolution-engine" : "backtest";

    console.log(`[Generate] learning source: ${learningSource}`);
    console.log(`[Generate] learning through: ${walkForwardThrough || evolutionDate || "n/a"}`);
    console.log(`[Generate] learned samples: ${learningEvaluations.length}`);
    console.log(`[Generate] weights: ${weights.map((w) => `${w.strategy}=${w.weight.toFixed(3)}`).join(", ")}`);
    console.log(`[Generate] fallback: ${!evolutionDate ? "evolution-engine unavailable, used backtest baseline" : "none"}`);
    if (!walkForwardThrough) console.log("[Generate] walk-forward learning unavailable");

    await new Promise((r) => setTimeout(r, 600));
    const result = buildCandidates(draws, weights, 3);
    setCandidates(result);
        setLearningInfo({ evolutionDate, walkForwardThrough, sampleSize: learningEvaluations.length, walkForwardDebug });
    setLoading(false);
        onGenerated(result, nextTarget);
    fetch("/api/predictions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetDrawDate: nextTarget, candidates: result }),
    }).catch(() => {});
    requestAnimationFrame(() => setRevealed(true));
  }
  const top = candidates?.[0];

  return (
    <div className="mx-auto flex flex-col items-center" style={{ maxWidth: 900, gap: 28 }}>
      <div className="text-center">
        <p className="ck-eyebrow" style={{ marginBottom: 4 }}>สร้างคำทำนาย</p>
        <h1 className="ck-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "var(--parchment)" }}>พิธีเรียกเลขจากฐานข้อมูลย้อนหลัง</h1>
        <p style={{ maxWidth: 480, margin: "8px auto 0", fontSize: "0.875rem", color: "var(--mist)" }}>ตัวเลขที่ได้มาจากการคำนวณทางสถิติจริงบนข้อมูลย้อนหลัง ไม่ใช่การพยากรณ์ผลที่รับประกันความถูกต้อง เพื่อการวิจัยและความบันเทิงเท่านั้น</p>
      </div>

      <RevealMedallion value={top?.back2 ?? ""} label="เลขท้าย 2 ตัว" revealed={!!top && revealed} />

      <GoldButton onClick={handleGenerate} disabled={loading} size="lg">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {loading ? "กำลังคำนวณ..." : "สร้างคำทำนาย"}
      </GoldButton>
      {candidates && revealed && learningInfo && (
        <div className="flex flex-col items-center" style={{ gap: 2 }}>
          <p className="ck-eyebrow" style={{ color: "var(--gold-bright)" }}>
            {learningInfo.evolutionDate
              ? `ใช้ Evolution Engine weights · ${new Date(learningInfo.evolutionDate).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })}`
              : "ใช้ Backtest weights"}
          </p>
                    {learningInfo.walkForwardThrough ? (
            <p className="ck-eyebrow" style={{ color: "var(--cold-bright)" }}>
              ใช้ Walk-Forward Learning · ล่าสุด: {new Date(learningInfo.walkForwardThrough).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })} · จำนวนข้อมูลเรียนรู้: {learningInfo.sampleSize} รายการ
            </p>
          ) : (
            <p className="ck-eyebrow" style={{ color: "var(--mist)", fontSize: "0.6rem" }}>(walk-forward: {learningInfo.walkForwardDebug})</p>
          )}
        </div>
      )}
      {candidates && revealed && (
        <div className="grid md:grid-cols-3" style={{ gap: 16, width: "100%" }}>
          {candidates.map((c) => (
            <Card key={c.rank}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>อันดับ {c.rank}</CardTitle>
                  <Badge tone="gold">ความสอดคล้อง {c.agreementScore}%</Badge>
                </div>
                <CardDescription>คะแนนสถิติ {c.statisticalScore}/100</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col" style={{ gap: 14 }}>
                <div><p className="ck-eyebrow" style={{ marginBottom: 6 }}>รางวัลที่ 1</p><NumberRow digits={c.firstPrize} size="sm" tone="mist" /></div>
                <div className="grid grid-cols-3" style={{ gap: 8 }}>
                  <div><p className="ck-eyebrow" style={{ marginBottom: 6 }}>หน้า 3 ตัว</p>{c.front3.map((n, i) => <NumberRow key={i} digits={n} size="sm" tone="mist" />)}</div>
                  <div><p className="ck-eyebrow" style={{ marginBottom: 6 }}>ท้าย 3 ตัว</p>{c.back3.map((n, i) => <NumberRow key={i} digits={n} size="sm" tone="mist" />)}</div>
                  <div><p className="ck-eyebrow" style={{ marginBottom: 6 }}>ท้าย 2 ตัว</p><NumberRow digits={c.back2} size="sm" tone="gold" /></div>
                </div>
                <p style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 12, fontSize: "0.75rem", color: "var(--mist)" }}>{c.explanationTh}</p>
                <div className="flex flex-wrap" style={{ gap: 6 }}>
                  {c.contributingStrategies.map((s) => <Badge key={s} tone="mist">{STRATEGIES.find((m) => m.id === s)?.nameTh}</Badge>)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p style={{ maxWidth: 480, textAlign: "center", fontSize: "0.72rem", color: "var(--mist)" }}>คะแนนความสอดคล้อง คือสัดส่วนของแบบจำลองที่ให้ผลลัพธ์ตรงกัน ไม่ใช่ความน่าจะเป็นในการถูกรางวัล ผลสลากเป็นเหตุการณ์สุ่มอิสระในแต่ละงวด</p>
    </div>
  );
}

function DrawLearningPanel({ actual, strategyPicksForDraw, ensemblePick }) {
  const fieldDefs = [
    { key: "first", label: "รางวัลที่ 1", scoreKey: "firstPrizeMatchPct" },
    { key: "front3", label: "เลขหน้า 3 ตัว", scoreKey: "front3MatchPct" },
    { key: "back3", label: "เลขท้าย 3 ตัว", scoreKey: "back3MatchPct" },
    { key: "back2", label: "เลขท้าย 2 ตัว", scoreKey: "back2MatchPct" },
  ];

  const rows = STRATEGIES.map((s) => {
    const pick = strategyPicksForDraw.get(s.id);
    if (!pick) return null;
    return { id: s.id, label: s.nameTh, pick, scores: scoreStrategyPick(pick, actual), isEnsemble: false };
  }).filter(Boolean);

  if (ensemblePick) {
    rows.push({ id: "ensemble", label: "Ensemble (คำทำนายรวม)", pick: ensemblePick, scores: scoreStrategyPick(ensemblePick, actual), isEnsemble: true });
  }

  return (
    <div style={{ padding: "4px 20px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
      {fieldDefs.map(({ key, label, scoreKey }) => {
        const rowsSorted = [...rows].sort((a, b) => b.scores[scoreKey] - a.scores[scoreKey]);
        return (
          <div key={key}>
            <p className="ck-eyebrow" style={{ marginBottom: 6 }}>{label}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {rowsSorted.map((r) => (
                <div key={r.id} className="flex items-center justify-between" style={{ fontSize: "0.78rem", padding: "3px 0" }}>
                  <span style={{ color: r.isEnsemble ? "var(--gold-bright)" : "var(--mist)", fontWeight: r.isEnsemble ? 600 : 400 }}>
                    {r.label}
                  </span>
                  <span className="ck-numeral" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "rgba(237,230,214,0.55)", fontSize: "0.7rem" }}>
                      {key === "front3" || key === "back3" ? r.pick[key].join(", ") : r.pick[key]}
                    </span>
                    <span style={{ color: r.isEnsemble ? "var(--gold-bright)" : "var(--parchment)", minWidth: 44, textAlign: "right" }}>
                      {r.scores[scoreKey].toFixed(1)}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HistoryView({ draws }) {
  const sorted = [...draws].sort((a, b) => b.drawDate.localeCompare(a.drawDate));

  const [strategyByDate, setStrategyByDate] = useState(new Map());
  const [ensembleByDate, setEnsembleByDate] = useState(new Map());
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("strategy_predictions").select("target_draw_date, strategy_id, back2, front3, back3, first_prize"),
      supabase.from("predictions").select("target_draw_date, rank, back2, front3, back3, first_prize").eq("rank", 1),
    ]).then(([strategyRes, ensembleRes]) => {
      if (cancelled) return;
      if (!strategyRes.error && strategyRes.data) {
        const byDate = new Map();
        for (const row of strategyRes.data) {
          if (!byDate.has(row.target_draw_date)) byDate.set(row.target_draw_date, new Map());
          byDate.get(row.target_draw_date).set(row.strategy_id, { back2: row.back2, front3: row.front3, back3: row.back3, first: row.first_prize });
        }
        setStrategyByDate(byDate);
      }
      if (!ensembleRes.error && ensembleRes.data) {
        const byDate = new Map();
        for (const row of ensembleRes.data) byDate.set(row.target_draw_date, { back2: row.back2, front3: row.front3, back3: row.back3, first: row.first_prize });
        setEnsembleByDate(byDate);
      }
    });
    return () => { cancelled = true; };
  }, []);

  function toggle(drawDate) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(drawDate) ? next.delete(drawDate) : next.add(drawDate);
      return next;
    });
  }

  return (
    <div className="mx-auto flex flex-col" style={{ maxWidth: 950, gap: 20 }}>
      <div>
        <p className="ck-eyebrow" style={{ marginBottom: 4 }}>ผลรางวัลย้อนหลัง</p>
        <h1 className="ck-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "var(--parchment)" }}>ฐานข้อมูลผลสลากกินแบ่งรัฐบาล</h1>
        <p style={{ marginTop: 4, fontSize: "0.875rem", color: "var(--mist)" }}>{draws.length} งวด (ตรวจสอบแล้วจากแหล่งข่าวทางการ)</p>
      </div>
      <Card>
        <div className="ck-divide">
          {sorted.map((d) => {
            const strategyPicksForDraw = strategyByDate.get(d.drawDate);
            const ensemblePick = ensembleByDate.get(d.drawDate);
            const hasLearning = Boolean(strategyPicksForDraw && ensemblePick);
            const isOpen = expanded.has(d.drawDate);
            return (
              <div key={d.id}>
                <div
                  onClick={hasLearning ? () => toggle(d.drawDate) : undefined}
                  className="flex flex-wrap items-center justify-between"
                  style={{ padding: "16px 20px", gap: 14, cursor: hasLearning ? "pointer" : "default" }}
                >
                  <span style={{ fontSize: "0.8rem", color: "var(--parchment)", minWidth: 130 }}>{formatThaiDate(d.drawDate)}</span>
                  <NumberRow digits={d.firstPrize} size="sm" tone="gold" />
                  <div className="flex" style={{ gap: 8 }}>{d.front3.map((n, i) => <NumberRow key={i} digits={n} size="sm" tone="mist" />)}</div>
                  <div className="flex" style={{ gap: 8 }}>{d.back3.map((n, i) => <NumberRow key={i} digits={n} size="sm" tone="mist" />)}</div>
                  <NumberRow digits={d.back2} size="sm" tone="cold" />
                  {hasLearning && (
                    <ChevronDown size={16} color={COLORS.gold} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                  )}
                </div>
                {hasLearning && isOpen && (
                  <div style={{ borderTop: "1px solid rgba(201,162,75,0.15)", background: "rgba(30,24,40,0.35)" }}>
                    <p className="ck-eyebrow" style={{ padding: "12px 20px 0", color: "var(--gold-bright)" }}>ประสิทธิภาพแบบจำลองสำหรับงวดนี้</p>
                    <DrawLearningPanel actual={d} strategyPicksForDraw={strategyPicksForDraw} ensemblePick={ensemblePick} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function StatisticsView({ draws }) {
  const back2Pool = draws.map((d) => d.back2), back3Pool = draws.flatMap((d) => d.back3);
  const oe = oddEvenRatio(back2Pool), hl = highLowDistribution(back2Pool);
  const entropy = shannonEntropy(back2Pool), maxEntropy = Math.log2(10);
  const corr = parityCorrelation(draws);
  const posTable = positionFrequency(back3Pool);

  return (
    <div className="mx-auto flex flex-col" style={{ maxWidth: 1100, gap: 20 }}>
      <div>
        <p className="ck-eyebrow" style={{ marginBottom: 4 }}>สถิติ</p>
        <h1 className="ck-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "var(--parchment)" }}>การวิเคราะห์ทางสถิติของฐานข้อมูล</h1>
      </div>

      <div className="grid md:grid-cols-3" style={{ gap: 16 }}>
        <Card><CardHeader><CardTitle>คู่-คี่ (เลขท้าย 2 ตัว)</CardTitle></CardHeader><CardContent className="flex items-end" style={{ gap: 24 }}>
          <div><p className="ck-numeral" style={{ fontSize: "1.8rem", color: "var(--gold-bright)" }}>{oe.oddPct.toFixed(1)}%</p><p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>เลขคี่</p></div>
          <div><p className="ck-numeral" style={{ fontSize: "1.8rem", color: "var(--cold-bright)" }}>{oe.evenPct.toFixed(1)}%</p><p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>เลขคู่</p></div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>สูง-ต่ำ (0-4 / 5-9)</CardTitle></CardHeader><CardContent className="flex items-end" style={{ gap: 24 }}>
          <div><p className="ck-numeral" style={{ fontSize: "1.8rem", color: "var(--cold-bright)" }}>{hl.lowPct.toFixed(1)}%</p><p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>ต่ำ (0-4)</p></div>
          <div><p className="ck-numeral" style={{ fontSize: "1.8rem", color: "var(--gold-bright)" }}>{hl.highPct.toFixed(1)}%</p><p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>สูง (5-9)</p></div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>เอนโทรปีของหลัก</CardTitle></CardHeader><CardContent>
          <p className="ck-numeral" style={{ fontSize: "1.8rem", color: "var(--gold-bright)" }}>{entropy.toFixed(3)}</p>
          <p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>จากค่าสูงสุด {maxEntropy.toFixed(3)} (การกระจายสม่ำเสมอสมบูรณ์)</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>ความถี่ของหลัก — เลขท้าย 2 ตัว</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={digitFrequency(back2Pool)} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="digit" stroke={COLORS.mist} fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke={COLORS.mist} fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.parchment, fontSize: 12 }} cursor={{ fill: "rgba(201,162,75,0.08)" }} />
              <Bar dataKey="count" fill={COLORS.gold} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>ความสัมพันธ์ระหว่างรางวัล</CardTitle><CardDescription>สหสัมพันธ์ระหว่างความเป็นคู่-คี่ของหลักท้ายรางวัลที่ 1 กับเลขท้าย 2 ตัว</CardDescription></CardHeader>
        <CardContent>
          <p className="ck-numeral" style={{ fontSize: "1.8rem", color: "var(--gold-bright)" }}>{corr.toFixed(4)}</p>
          <p style={{ marginTop: 4, fontSize: "0.72rem", color: "var(--mist)" }}>ค่าใกล้ 0 หมายถึงไม่มีความสัมพันธ์เชิงเส้น สอดคล้องกับการที่แต่ละรางวัลถูกสุ่มโดยอิสระต่อกัน</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>ความถี่ตามตำแหน่งหลัก — เลขท้าย 3 ตัว</CardTitle></CardHeader>
        <CardContent style={{ overflowX: "auto" }}>
          <table className="ck-table ck-numeral" style={{ width: "100%", textAlign: "center", fontSize: "0.72rem" }}>
            <thead><tr style={{ color: "var(--mist)" }}><th style={{ textAlign: "left" }}>ตำแหน่ง</th>{Array.from({ length: 10 }, (_, i) => <th key={i}>{i}</th>)}</tr></thead>
            <tbody>
              {posTable.map((row, p) => { const max = Math.max(...row); return (
                <tr key={p} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td style={{ textAlign: "left", color: "var(--mist)" }}>{p + 1}</td>
                  {row.map((v, d) => <td key={d} style={{ color: v === max && v > 0 ? "var(--gold-bright)" : "rgba(237,230,214,0.7)", fontWeight: v === max && v > 0 ? 600 : 400 }}>{v}</td>)}
                </tr>
              ); })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function PatternsView({ draws }) {
  const back3Pool = draws.flatMap((d) => d.back3);
  const mirrors = findMirrorPairs(back3Pool), repeated = repeatedDigitNumbers(back3Pool), consecutive = back3Pool.filter(hasConsecutiveDigits);
  const overdue = [...hotColdNumbers(draws, "back2")].sort((a, b) => b.gap - a.gap).slice(0, 8);
  const pairs = [...pairFrequency(draws).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const triples = [...tripleFrequency(draws).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div className="mx-auto flex flex-col" style={{ maxWidth: 1100, gap: 20 }}>
      <div>
        <p className="ck-eyebrow" style={{ marginBottom: 4 }}>ค้นหารูปแบบ</p>
        <h1 className="ck-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "var(--parchment)" }}>รูปแบบที่ค้นพบในฐานข้อมูล</h1>
        <p style={{ marginTop: 4, fontSize: "0.875rem", color: "var(--mist)" }}>ข้อสังเกตเชิงพรรณนาจากอดีต ไม่ใช่สัญญาณที่บ่งชี้ผลในอนาคต</p>
      </div>
      <div className="grid md:grid-cols-2" style={{ gap: 16 }}>
        <Card><CardHeader><CardTitle>เลขค้างคิว (Gap Analysis)</CardTitle><CardDescription>เลขท้าย 2 ตัวที่ไม่ปรากฏมานานที่สุด</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap" style={{ gap: 12 }}>
            {overdue.map((o) => <div key={o.number} className="flex flex-col items-center" style={{ gap: 4 }}><NumberOrb value={o.number} size="md" tone="cold" /><span style={{ fontSize: "0.68rem", color: "var(--mist)" }}>{o.gap} งวด</span></div>)}
          </CardContent></Card>
        <Card><CardHeader><CardTitle>เลขกระจก (Mirror Numbers)</CardTitle><CardDescription>เลขท้าย 3 ตัวที่เป็นเลขสลับหลักของกันและกัน</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap" style={{ gap: 12 }}>
            {mirrors.length === 0 && <p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>ยังไม่พบคู่เลขกระจกในฐานข้อมูลปัจจุบัน</p>}
            {mirrors.map(([a, b], i) => <div key={i} className="flex items-center" style={{ gap: 8 }}><NumberRow digits={a} size="sm" tone="gold" /><span style={{ color: "var(--mist)" }}>⇄</span><NumberRow digits={b} size="sm" tone="gold" /></div>)}
          </CardContent></Card>
        <Card><CardHeader><CardTitle>เลขหลักซ้ำ</CardTitle><CardDescription>เลขท้าย 3 ตัวที่มีหลักซ้ำกันภายในตัวเอง</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap" style={{ gap: 8 }}>
            {repeated.length === 0 && <p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>ยังไม่พบในฐานข้อมูลปัจจุบัน</p>}
            {repeated.slice(0, 12).map((r, i) => <NumberRow key={i} digits={r.number} size="sm" tone="mist" />)}
          </CardContent></Card>
        <Card><CardHeader><CardTitle>เลขเรียงติดกัน</CardTitle><CardDescription>เลขท้าย 3 ตัวที่มีหลักเรียงต่อกัน</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap" style={{ gap: 8 }}>
            {consecutive.length === 0 && <p style={{ fontSize: "0.72rem", color: "var(--mist)" }}>ยังไม่พบในฐานข้อมูลปัจจุบัน</p>}
            {consecutive.map((n, i) => <NumberRow key={i} digits={n} size="sm" tone="mist" />)}
          </CardContent></Card>
      </div>
      <div className="grid md:grid-cols-2" style={{ gap: 16 }}>
        <Card><CardHeader><CardTitle>คู่เลขที่พบบ่อย (รางวัลที่ 1)</CardTitle></CardHeader><CardContent className="flex flex-wrap" style={{ gap: 8 }}>{pairs.map(([p, c]) => <Badge key={p} tone="gold">{p} · {c}</Badge>)}</CardContent></Card>
        <Card><CardHeader><CardTitle>ชุดเลข 3 หลักที่พบบ่อย (รางวัลที่ 1)</CardTitle></CardHeader><CardContent className="flex flex-wrap" style={{ gap: 8 }}>{triples.map(([t, c]) => <Badge key={t} tone="cold">{t} · {c}</Badge>)}</CardContent></Card>
      </div>
    </div>
  );
}

function ModelsView({ draws }) {
  const backtest = runBacktest(draws), summary = summarizeBacktest(backtest), weights = deriveWeights(backtest);
  const probRows = runProbabilisticBacktest(draws), probSummary = summarizeProbabilisticBacktest(probRows);

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("performance_history")
      .select("strategy, computed_at, back2_hit_rate, brier_score, random_baseline_brier")
      .order("computed_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
                if (!error && data) setHistory(data);
        setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const [evolutionRuns, setEvolutionRuns] = useState([]);
  const [evolutionLoading, setEvolutionLoading] = useState(true);
  const [expandedRuns, setExpandedRuns] = useState(new Set());
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("weight_version_history")
      .select("id, created_at, weights, source, adopted, previous_weights, held_out_brier_new, held_out_brier_previous, held_out_sample_size, reason")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setEvolutionRuns(data);
        setEvolutionLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function toggleRun(id) {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const chartData = useMemo(() => {
    const byTime = new Map();
    for (const row of history) {
      const key = row.computed_at;
      if (!byTime.has(key)) byTime.set(key, { computed_at: key });
      byTime.get(key)[row.strategy] = row.back2_hit_rate * 100;
    }
    return [...byTime.values()].sort((a, b) => a.computed_at.localeCompare(b.computed_at));
  }, [history]);

  const strategyColors = { frequency: COLORS.gold, markov: COLORS.goldBright, monteCarlo: "#8FB8DE", bayesian: "#C48FDE", gap: "#DE8F8F" };

  return (
    <div className="mx-auto flex flex-col" style={{ maxWidth: 950, gap: 20 }}>
      <div>
        <p className="ck-eyebrow" style={{ marginBottom: 4 }}>ประสิทธิภาพแบบจำลอง</p>
        <h1 className="ck-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "var(--parchment)" }}>ผลทดสอบย้อนหลังของแต่ละแบบจำลอง</h1>
        <p style={{ marginTop: 4, maxWidth: 640, fontSize: "0.875rem", color: "var(--mist)" }}>แต่ละแบบจำลองถูกรันด้วยข้อมูลก่อนหน้างวดที่ทดสอบเท่านั้น แล้วเทียบกับผลจริง น้ำหนักในหน้า "สร้างคำทำนาย" ปรับตามผลนี้โดยอัตโนมัติ</p>
      </div>
      <div className="grid md:grid-cols-2" style={{ gap: 16 }}>
        {STRATEGIES.map((s) => {
          const row = summary.find((r) => r.strategy === s.id), w = weights.find((x) => x.strategy === s.id);
          const prob = probSummary.find((x) => x.strategy === s.id);
          const noEdge = prob ? isIndistinguishableFromChance(prob, prob.runs) : true;
          return (
            <Card key={s.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center" style={{ gap: 8 }}><BrainCircuit size={16} color={COLORS.gold} /> {s.nameTh}</CardTitle>
                  <Badge tone="gold">น้ำหนัก {w?.weight.toFixed(2)}</Badge>
                </div>
                <CardDescription>{s.descriptionTh}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 text-center" style={{ gap: 10 }}>
                  <div><p className="ck-numeral" style={{ fontSize: "1.1rem", color: "var(--gold-bright)" }}>{row ? (row.back2HitRate * 100).toFixed(1) : "0.0"}%</p><p style={{ fontSize: "0.65rem", color: "var(--mist)" }}>ตรงท้าย 2 ตัว</p></div>
                  <div><p className="ck-numeral" style={{ fontSize: "1.1rem", color: "var(--cold-bright)" }}>{row ? (row.back3HitRate * 100).toFixed(1) : "0.0"}%</p><p style={{ fontSize: "0.65rem", color: "var(--mist)" }}>ตรงท้าย 3 ตัว</p></div>
                  <div><p className="ck-numeral" style={{ fontSize: "1.1rem", color: "var(--parchment)" }}>{row ? (row.front3HitRate * 100).toFixed(1) : "0.0"}%</p><p style={{ fontSize: "0.65rem", color: "var(--mist)" }}>ตรงหน้า 3 ตัว</p></div>
                </div>
                {prob && (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(201,162,75,0.15)" }}>
                    <div className="flex items-center justify-between" style={{ fontSize: "0.75rem", color: "var(--mist)" }}>
                      <span>Brier score: {prob.brierScore.toFixed(4)} (โอกาสสุ่ม {prob.randomBaseline.brierScore.toFixed(4)})</span>
                      <Badge tone="gold">{noEdge ? "อยู่ในช่วงผันผวนของการสุ่ม" : "ต่างจากเส้นฐานเล็กน้อย"}</Badge>
                    </div>
                    <p style={{ marginTop: 4, fontSize: "0.68rem", color: "var(--mist)" }}>Top-10: {(prob.top10Accuracy * 100).toFixed(1)}% · อันดับเฉลี่ยของผลจริง: {prob.meanRank.toFixed(0)}/100</p>
                  </div>
                )}
                <p style={{ marginTop: 10, fontSize: "0.68rem", color: "var(--mist)" }}>ทดสอบทั้งหมด {row?.runs ?? 0} รอบ</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center" style={{ gap: 8 }}><TrendingUp size={16} color={COLORS.gold} /> แนวโน้มความแม่นยำตามเวลา</CardTitle>
          <CardDescription>ผลการรันแบบจำลองแต่ละครั้งที่บันทึกไว้ (performance_history) — เส้นประคือระดับโอกาสสุ่ม ≈1%</CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <p style={{ fontSize: "0.8rem", color: "var(--mist)" }}>กำลังโหลด...</p>
          ) : chartData.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "var(--mist)" }}>ยังไม่มีประวัติ — รัน "Run model backtest" ใน GitHub Actions อย่างน้อยหนึ่งครั้งเพื่อเริ่มเก็บข้อมูล</p>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(201,162,75,0.1)" />
                  <XAxis dataKey="computed_at" tick={{ fontSize: 10, fill: "var(--mist)" }} tickFormatter={(v) => new Date(v).toLocaleDateString("th-TH", { month: "short", day: "numeric" })} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--mist)" }} unit="%" />
                  <Tooltip contentStyle={{ background: COLORS.surface, border: "1px solid rgba(201,162,75,0.3)", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={1} stroke="var(--mist)" strokeDasharray="4 4" />
                  {STRATEGIES.map((s) => (
                    <Line key={s.id} type="monotone" dataKey={s.id} name={s.nameTh} stroke={strategyColors[s.id] || COLORS.gold} strokeWidth={2} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
                    )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center" style={{ gap: 8 }}><History size={16} color={COLORS.gold} /> ประวัติการวิวัฒนาการน้ำหนัก</CardTitle>
          <CardDescription>บันทึกจริงจาก Evolution Engine (รันตามรอบที่ตั้งไว้ล่วงหน้า) — แยกจากกลไกปรับน้ำหนักจากผลจริงแบบสด (Live Learning) โดยสิ้นเชิง</CardDescription>
        </CardHeader>
        <CardContent>
          {evolutionLoading ? (
            <p style={{ fontSize: "0.8rem", color: "var(--mist)" }}>กำลังโหลด...</p>
          ) : evolutionRuns.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "var(--mist)" }}>ยังไม่มีประวัติการวิวัฒนาการน้ำหนัก</p>
          ) : (
            <div className="flex flex-col" style={{ gap: 10 }}>
              {evolutionRuns.map((run) => {
                const isOpen = expandedRuns.has(run.id);
                const prevMap = run.previous_weights ? new Map(run.previous_weights.map((w) => [w.strategy, w.weight])) : null;
                const runDate = new Date(run.created_at).toLocaleString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={run.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
                    <div
                      onClick={() => toggleRun(run.id)}
                      className="flex flex-wrap items-center justify-between"
                      style={{ padding: "12px 14px", gap: 10, cursor: "pointer", background: "rgba(30,24,40,0.4)" }}
                    >
                      <div className="flex items-center" style={{ gap: 10 }}>
                        <span style={{ fontSize: "0.8rem", color: "var(--parchment)" }}>{runDate}</span>
                        <Badge tone={run.adopted ? "gold" : "mist"}>{run.adopted ? "นำไปใช้งาน" : "ไม่ได้นำไปใช้"}</Badge>
                        {!prevMap && <Badge tone="cold">ค่าเริ่มต้น</Badge>}
                      </div>
                      <div className="flex items-center" style={{ gap: 10 }}>
                        <span className="ck-numeral" style={{ fontSize: "0.72rem", color: "var(--mist)" }}>
                          Brier {run.held_out_brier_new?.toFixed(4)}
                          {run.held_out_brier_previous != null && ` (เดิม ${run.held_out_brier_previous.toFixed(4)})`}
                          {run.held_out_sample_size != null && ` · ${run.held_out_sample_size} งวด`}
                        </span>
                        <ChevronDown size={14} color={COLORS.gold} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "10px 14px 14px", borderTop: `1px solid ${COLORS.border}` }}>
                        <p style={{ fontSize: "0.72rem", color: "var(--mist)", marginBottom: 10 }}>{run.reason}</p>
                        <div className="flex flex-col" style={{ gap: 4 }}>
                          {[...run.weights].sort((a, b) => b.weight - a.weight).map((w) => {
                            const stratName = STRATEGIES.find((s) => s.id === w.strategy)?.nameTh ?? w.strategy;
                            const prevWeight = prevMap?.get(w.strategy);
                            const delta = prevWeight != null ? w.weight - prevWeight : null;
                            return (
                              <div key={w.strategy} className="flex items-center justify-between" style={{ fontSize: "0.78rem", padding: "3px 0" }}>
                                <span style={{ color: "var(--parchment)" }}>{stratName}</span>
                                <span className="ck-numeral" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  {prevWeight != null && (<>
                                    <span style={{ color: "var(--mist)" }}>{(prevWeight * 100).toFixed(1)}%</span>
                                    <span style={{ color: "var(--mist)" }}>→</span>
                                  </>)}
                                  <span style={{ color: "var(--gold-bright)" }}>{(w.weight * 100).toFixed(1)}%</span>
                                  {delta != null && (
                                    <span style={{ color: delta > 0 ? "var(--cold-bright)" : delta < 0 ? "var(--ember)" : "var(--mist)", minWidth: 46, textAlign: "right" }}>
                                      {delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)}%
                                    </span>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle>วิธีอ่านตัวเลขเหล่านี้</CardTitle></CardHeader>

        <CardContent className="flex flex-col" style={{ gap: 8, fontSize: "0.875rem", color: "var(--mist)" }}>
          <p>ผลสลากแต่ละงวดเป็นเหตุการณ์สุ่มอิสระจากงวดก่อนหน้า อัตราตรงที่คาดหวังในระยะยาวคือระดับโอกาสสุ่มล้วน (≈1% สำหรับเลขท้าย 2 ตัว สูงขึ้นเล็กน้อยสำหรับเลขท้าย/หน้า 3 ตัว เพราะมี 2 เลขต่องวด)</p>
          <p>ตัวเลขที่สูงหรือต่ำกว่านี้ในบางช่วง เป็นความผันผวนตามธรรมชาติของกลุ่มตัวอย่างขนาดเล็ก ({draws.length} งวด) ไม่ใช่หลักฐานว่าแบบจำลองใดทำนายผลสุ่มได้จริง</p>
          <p>Brier score และ log loss คือคะแนนความแม่นยำของ "ความน่าจะเป็น" ที่แบบจำลองให้กับผลจริง ยิ่งใกล้เคียงกับเส้นฐานโอกาสสุ่มเท่าไร ยิ่งแปลว่าแบบจำลองไม่มีความได้เปรียบจริง ซึ่งเป็นผลที่คาดไว้อยู่แล้วสำหรับการสุ่มอิสระ</p>
        </CardContent>
      </Card>
    </div>
  );
}

function PredictionsView({ predictions, setView }) {
  return (
    <div className="mx-auto flex flex-col" style={{ maxWidth: 950, gap: 20 }}>
      <div>
        <p className="ck-eyebrow" style={{ marginBottom: 4 }}>ประวัติคำทำนาย</p>
        <h1 className="ck-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "var(--parchment)" }}>คำทำนายที่สร้างในเซสชันนี้</h1>
        <p style={{ marginTop: 4, fontSize: "0.875rem", color: "var(--mist)" }}>ในแอปจริง คำทำนายจะถูกบันทึกถาวรผ่าน Supabase — ที่นี่เก็บไว้ชั่วคราวระหว่างพรีวิวนี้เท่านั้น</p>
      </div>
      {predictions.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center text-center" style={{ padding: "48px 20px", gap: 12 }}>
          <ListOrdered size={28} color={COLORS.mist} />
          <p style={{ fontSize: "0.875rem", color: "var(--parchment)" }}>ยังไม่มีคำทำนายที่สร้างไว้</p>
          <GoldButton onClick={() => setView("generate")}><Sparkles size={16} /> ไปสร้างคำทำนาย</GoldButton>
        </CardContent></Card>
      ) : (
        <Card><div className="ck-divide">
          {predictions.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between" style={{ padding: "16px 20px", gap: 12 }}>
              <div className="flex items-center" style={{ gap: 12 }}>
                <NumberRow digits={p.back2} size="sm" tone="gold" />
                <div>
                  <p style={{ fontSize: "0.75rem", color: "var(--parchment)" }}>งวด {formatThaiDate(p.targetDrawDate)}</p>
                  <p style={{ fontSize: "0.68rem", color: "var(--mist)" }}>{STRATEGIES.find((s) => s.id === p.contributingStrategies[0])?.nameTh ?? "แบบจำลองรวม"} · อันดับ {p.rank}</p>
                </div>
              </div>
              <Badge tone="gold">ความสอดคล้อง {p.agreementScore}%</Badge>
            </div>
          ))}
        </div></Card>
      )}
    </div>
  );
}

function SettingsView({ draws }) {
  return (
    <div className="mx-auto flex flex-col" style={{ maxWidth: 700, gap: 20 }}>
      <div><p className="ck-eyebrow" style={{ marginBottom: 4 }}>ตั้งค่า</p><h1 className="ck-display" style={{ fontSize: "1.6rem", fontWeight: 600, color: "var(--parchment)" }}>การตั้งค่าระบบ</h1></div>
      <Card><CardHeader><CardTitle className="flex items-center" style={{ gap: 8 }}><Database size={16} color={COLORS.gold} /> แหล่งข้อมูล</CardTitle></CardHeader>
        <CardContent className="flex flex-col" style={{ gap: 10 }}>
          <div className="flex items-center justify-between"><span style={{ fontSize: "0.875rem" }}>โหมด</span><Badge tone="mist">พรีวิว — ข้อมูลตั้งต้นในไฟล์นี้</Badge></div>
          <div className="flex items-center justify-between"><span style={{ fontSize: "0.875rem" }}>จำนวนงวดในฐานข้อมูล</span><span className="ck-numeral" style={{ color: "var(--gold-bright)" }}>{draws.length}</span></div>
          <p style={{ borderRadius: 10, padding: 12, background: "rgba(30,24,40,0.5)", fontSize: "0.72rem", color: "var(--mist)" }}>เวอร์ชันที่ใช้งานจริงเชื่อมต่อ Supabase และรองรับการนำเข้าประวัติย้อนหลังเพิ่มเติมได้ถึง 40 ปี ไฟล์พรีวิวนี้ใช้ข้อมูลจริง 21 งวดที่ฝังไว้ในไฟล์เพื่อให้เปิดดูได้ทันทีโดยไม่ต้องเชื่อมฐานข้อมูล</p>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="flex items-center" style={{ gap: 8 }}><MoonStar size={16} color={COLORS.gold} /> ธีม</CardTitle></CardHeader>
        <CardContent><p style={{ fontSize: "0.875rem", color: "var(--mist)" }}>ธีม "จันทรารหัสลับ" (โทนหมึกเข้ม-ทองคำเปลว) เป็นธีมหลักของแอปพลิเคชันนี้โดยตั้งใจ เพื่อให้สอดคล้องกับแนวคิดพิธีกรรมค้นหาเลข จึงยังไม่มีโหมดสว่างในเวอร์ชันนี้</p></CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="flex items-center" style={{ gap: 8 }}><ShieldAlert size={16} color={COLORS.ember} /> ข้อจำกัดความรับผิดชอบ</CardTitle></CardHeader>
        <CardContent><p style={{ fontSize: "0.875rem", color: "var(--mist)" }}>เฉาก๊วยเป็นเครื่องมือวิเคราะห์สถิติเพื่อการวิจัยและความบันเทิงเท่านั้น ผลสลากกินแบ่งรัฐบาลเป็นเหตุการณ์สุ่มที่เป็นอิสระในแต่ละงวด ไม่มีแบบจำลองใดสามารถรับประกันผลรางวัลได้</p></CardContent>
      </Card>
    </div>
  );
}

export default function ChaokuayPreview() {
  const [view, setView] = useState("dashboard");
  const [predictions, setPredictions] = useState([]);
  const [draws, setDraws] = useState(() => [...SEED_DRAWS].sort((a, b) => a.drawDate.localeCompare(b.drawDate)));

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("draws")
      .select("draw_date, first_prize, front3, back3, back2")
      .order("draw_date", { ascending: true })
      .then(({ data, error }) => {
        if (error) { console.error("Supabase fetch failed, using seed data:", error.message); return; }
        if (data?.length && !cancelled) {
          setDraws(data.map((d, i) => ({
            id: `db-${i}`,
            drawDate: d.draw_date,
            firstPrize: d.first_prize,
            front3: d.front3,
            back3: d.back3,
            back2: d.back2,
          })));
        }
      });
    return () => { cancelled = true; };
  }, []);

  function handleGenerated(candidates, targetDate) {
    const stamped = candidates.map((c) => ({ ...c, id: `${Date.now()}-${c.rank}-${Math.random().toString(36).slice(2, 7)}`, targetDrawDate: targetDate }));
    setPredictions((prev) => [...stamped, ...prev].slice(0, 60));
  }

  const views = {
    dashboard: <DashboardView draws={draws} predictions={predictions} setView={setView} />,
    generate: <GenerateView draws={draws} onGenerated={handleGenerated} />,
    history: <HistoryView draws={draws} />,
    statistics: <StatisticsView draws={draws} />,
    patterns: <PatternsView draws={draws} />,
    models: <ModelsView draws={draws} />,
    predictions: <PredictionsView predictions={predictions} setView={setView} />,
    settings: <SettingsView draws={draws} />,
  };

  return (
    <div className="ck-root">
      <style>{THEME_CSS}</style>
      <MagicalBackground />
      <Sidebar view={view} setView={setView} />
      <div className="md:pl-60" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative", zIndex: 1 }}>
        <MobileHeader view={view} setView={setView} />
        <main className="flex-1 px-4 py-6 md:px-10 md:py-10">{views[view]}</main>
      </div>
    </div>
  );
}


