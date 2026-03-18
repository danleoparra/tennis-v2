"use client";

import { useRef, useState, useEffect, useCallback } from "react";

// ─── Court constants ──────────────────────────────────────────────────────────
const REAL = { doublesWidth: 10.97, singlesWidth: 8.23, halfLength: 11.885, serviceLineFromNet: 6.4 };
const SCALE = 25;
const COURT_MARGIN = 100;
const OX = 80, OY_TOP = 100, OY_BOT = 80;

const CW = REAL.doublesWidth * SCALE;
const CH = REAL.halfLength * 2 * SCALE;
const SINGLES_INSET = ((REAL.doublesWidth - REAL.singlesWidth) / 2) * SCALE;
const NET_Y_LOCAL = REAL.halfLength * SCALE;
const SVC_OFFSET = REAL.serviceLineFromNet * SCALE;
const CENTER_X_LOCAL = CW / 2;

const PA = { x: OX, y: OY_TOP, w: CW, h: CH };
const SVG_W = CW + OX * 2;
const SVG_H = CH + OY_TOP + OY_BOT;

const DL_X = PA.x;
const DR_X = PA.x + CW;
const SL_X = PA.x + SINGLES_INSET;
const SR_X = PA.x + CW - SINGLES_INSET;
const BL_TOP_Y = PA.y;
const BL_BOT_Y = PA.y + CH;
const NET_Y = PA.y + NET_Y_LOCAL;
const TOP_SVC_Y = NET_Y - SVC_OFFSET;
const BOT_SVC_Y = NET_Y + SVC_OFFSET;
const CTR_SVC_X = PA.x + CENTER_X_LOCAL;

// ─── Tennis scoring ───────────────────────────────────────────────────────────
const POINT_LABELS = ["0", "15", "30", "40"];

function nextScore(score, side) {
  const us = side === "bottom" ? "bottom" : "top";
  const them = us === "bottom" ? "top" : "bottom";
  let { sets, games, points, serving } = JSON.parse(JSON.stringify(score));

  const bp = points[us];
  const tp = points[them];

  // Deuce logic
  if (bp >= 3 && tp >= 3) {
    if (bp === tp) { points[us] = 4; return { sets, games, points, serving }; }        // advantage
    if (bp === 4) { points[us] = 3; points[them] = 3; } // back to deuce — game won below
    else { points[us]++; return { sets, games, points, serving }; }
  }

  points[us]++;

  // Game won?
  const winGame = (points[us] >= 4 && points[us] > points[them] + 1) ||
    (points[us] === 4 && points[them] <= 2);

  if (!winGame) return { sets, games, points, serving };

  points = { bottom: 0, top: 0 };
  games[us]++;

  // Set won? (first to 6, win by 2, or tiebreak at 6-6 → 7-6)
  const winSet =
    (games[us] >= 6 && games[us] >= games[them] + 2) ||
    (games[us] === 7 && games[them] === 6);

  if (winSet) {
    sets.push({ bottom: games.bottom, top: games.top });
    games = { bottom: 0, top: 0 };
  }

  serving = serving === "bottom" ? "top" : "bottom";
  return { sets, games, points, serving };
}

const initScore = () => ({ sets: [], games: { bottom: 0, top: 0 }, points: { bottom: 0, top: 0 }, serving: "bottom" });

// ─── Voronoi helpers (Fortune's simple grid approach) ─────────────────────────
function buildVoronoiPaths(players, w, h) {
  const STEP = 6;
  const regions = {};
  players.forEach(p => { regions[p.id] = []; });

  for (let px = 0; px <= w; px += STEP) {
    for (let py = 0; py <= h; py += STEP) {
      let minDist = Infinity, closest = null;
      players.forEach(p => {
        const d = (p.x - (PA.x + px)) ** 2 + (p.y - (PA.y + py)) ** 2;
        if (d < minDist) { minDist = d; closest = p.id; }
      });
      if (closest !== null) regions[closest].push([PA.x + px, PA.y + py]);
    }
  }
  return regions;
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const clamp01 = v => clamp(v, 0, 1);
const rad2deg = r => r * 180 / Math.PI;
const interp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const extendThrough = (o, p, d) => {
  const dx = p.x - o.x, dy = p.y - o.y, len = Math.hypot(dx, dy) || 1;
  return { x: p.x + dx / len * d, y: p.y + dy / len * d };
};
const extendToEdge = (o, p) => {
  const dx = p.x - o.x, dy = p.y - o.y, len = Math.hypot(dx, dy) || 1;
  const big = Math.max(SVG_W, SVG_H) * 2;
  return { x: o.x + dx / len * big, y: o.y + dy / len * big };
};

// ─── Default players ──────────────────────────────────────────────────────────
const DEFAULT_PLAYERS = [
  { id: 1, name: "P1", side: "bottom", x: PA.x + CENTER_X_LOCAL - 60, y: NET_Y + 190, color: "#2563eb", reach: 110, active: true },
  { id: 2, name: "P2", side: "bottom", x: PA.x + CENTER_X_LOCAL + 60, y: NET_Y + 300, color: "#0891b2", reach: 110, active: false },
  { id: 3, name: "P3", side: "top",    x: PA.x + CENTER_X_LOCAL - 60, y: NET_Y - 190, color: "#dc2626", reach: 110, active: false },
  { id: 4, name: "P4", side: "top",    x: PA.x + CENTER_X_LOCAL + 60, y: NET_Y - 300, color: "#ea580c", reach: 110, active: false },
];

// ─── Tab definitions ──────────────────────────────────────────────────────────
const TABS = ["Angles", "Coverage", "Score", "Formations"];

export default function TennisVisualizer() {
  const svgRef = useRef(null);
  const [tab, setTab] = useState("Angles");
  const [players, setPlayers] = useState(DEFAULT_PLAYERS);
  const [ball, setBall] = useState({ x: PA.x + CENTER_X_LOCAL, y: NET_Y });
  const [draggingId, setDraggingId] = useState(null);
  const [showLayers, setShowLayers] = useState({ doubles: true, singles: true, service: true, trajectory: true });
  const [score, setScore] = useState(initScore);
  const [formations, setFormations] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tennis-v2-formations") || "[]"); } catch { return []; }
  });
  const [formName, setFormName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => {
    try { localStorage.setItem("tennis-v2-formations", JSON.stringify(formations)); } catch {}
  }, [formations]);

  const activePlayer = players.find(p => p.active) || players[0];

  // ─── Drag handling ──────────────────────────────────────────────────────────
  const getSvgPoint = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * SVG_W,
      y: ((e.clientY - r.top) / r.height) * SVG_H,
    };
  }, []);

  const getBounds = (player) => player.side === "top"
    ? { minX: PA.x - COURT_MARGIN, maxX: PA.x + PA.w + COURT_MARGIN, minY: PA.y - COURT_MARGIN, maxY: NET_Y }
    : { minX: PA.x - COURT_MARGIN, maxX: PA.x + PA.w + COURT_MARGIN, minY: NET_Y, maxY: PA.y + PA.h + COURT_MARGIN };

  const handlePointerDown = (id) => (e) => { e.preventDefault(); setDraggingId(id); };

  const handlePointerMove = useCallback((e) => {
    if (draggingId === null) return;
    const pt = getSvgPoint(e);
    if (!pt) return;
    if (draggingId === "ball") {
      setBall({ x: clamp(pt.x, PA.x - COURT_MARGIN, PA.x + PA.w + COURT_MARGIN), y: clamp(pt.y, PA.y - COURT_MARGIN, PA.y + PA.h + COURT_MARGIN) });
    } else {
      setPlayers(prev => prev.map(p => {
        if (p.id !== draggingId) return p;
        const b = getBounds(p);
        return { ...p, x: clamp(pt.x, b.minX, b.maxX), y: clamp(pt.y, b.minY, b.maxY) };
      }));
    }
  }, [draggingId, getSvgPoint]);

  const handlePointerUp = useCallback(() => setDraggingId(null), []);

  // ─── Angle calculations ─────────────────────────────────────────────────────
  const courtCX = PA.x + CENTER_X_LOCAL;
  const halfCW = CW / 2;
  const baseExt = 0.6 * SCALE;
  const distToNetNorm = clamp01(Math.abs(activePlayer.y - NET_Y) / NET_Y_LOCAL);
  const netProx = 1 - distToNetNorm;
  const lateralNorm = (activePlayer.x - courtCX) / halfCW;
  const activeSide = lateralNorm < 0 ? "left" : "right";
  const isTop = activePlayer.side === "top";

  const pOutL = Math.max(0, SL_X - activePlayer.x);
  const pOutR = Math.max(0, activePlayer.x - SR_X);
  const netBoost = netProx * 1.2 * SCALE;
  const netWiden = netProx * netProx * 3.5 * SCALE;
  const leftWiden  = activeSide === "left"  ? 0 : netWiden;
  const rightWiden = activeSide === "right" ? 0 : netWiden;

  const tBaseY = isTop ? BL_BOT_Y + baseExt : BL_TOP_Y - baseExt;
  const tSvcY  = isTop ? BOT_SVC_Y : TOP_SVC_Y;

  const slBL = { x: SL_X - leftWiden,  y: tBaseY };
  const srBL = { x: SR_X + rightWiden, y: tBaseY };
  const slSC = { x: SL_X - leftWiden,  y: tSvcY  };
  const srSC = { x: SR_X + rightWiden, y: tSvcY  };
  const cSC  = { x: CTR_SVC_X, y: tSvcY };

  const lAnchor = activeSide === "left"
    ? interp(slBL, slSC, netProx)
    : { x: SL_X - leftWiden  - (pOutR + netBoost), y: tBaseY };
  const rAnchor = activeSide === "right"
    ? interp(srBL, srSC, netProx)
    : { x: SR_X + rightWiden + (pOutL + netBoost), y: tBaseY };

  const vCarry = 1.8 * SCALE;
  const lSinglesT = activeSide === "left"  ? extendThrough(activePlayer, lAnchor, vCarry) : lAnchor;
  const rSinglesT = activeSide === "right" ? extendThrough(activePlayer, rAnchor, vCarry) : rAnchor;

  const target = {
    dlW: { x: DL_X - leftWiden,  y: tBaseY },
    drW: { x: DR_X + rightWiden, y: tBaseY },
    slW: lSinglesT,
    srW: rSinglesT,
    svcL: slSC,
    svcC: cSC,
    svcR: srSC,
  };

  const ang = (t) => Math.atan2(t.y - activePlayer.y, t.x - activePlayer.x);
  const opening = (a, b) => { let d = Math.abs(rad2deg(b - a)); if (d > 180) d = 360 - d; return d; };

  const angles = { dlW: ang(target.dlW), drW: ang(target.drW), slW: ang(target.slW), srW: ang(target.srW), svcL: ang(target.svcL), svcC: ang(target.svcC), svcR: ang(target.svcR) };
  const openings = {
    doubles: opening(angles.dlW, angles.drW),
    singles: opening(angles.slW, angles.srW),
    svcFull: opening(angles.svcL, angles.svcR),
    svcAd:   opening(angles.svcL, angles.svcC),
    svcDeuce:opening(angles.svcC, angles.svcR),
  };

  const slEnd = extendToEdge(activePlayer, target.slW);
  const srEnd = extendToEdge(activePlayer, target.srW);
  const svcLEnd = extendToEdge(activePlayer, target.svcL);
  const svcCEnd = extendToEdge(activePlayer, target.svcC);
  const svcREnd = extendToEdge(activePlayer, target.svcR);

  // ─── Voronoi ────────────────────────────────────────────────────────────────
  const voronoiRegions = tab === "Coverage" ? buildVoronoiPaths(players, CW, CH) : {};

  // ─── Formations ─────────────────────────────────────────────────────────────
  const saveFormation = () => {
    const name = formName.trim() || `Formation ${formations.length + 1}`;
    setFormations(prev => [{ id: Date.now(), name, players: players.map(p => ({...p})), ball: {...ball} }, ...prev]);
    setFormName("");
  };
  const loadFormation = (f) => { setPlayers(f.players); setBall(f.ball); };
  const deleteFormation = (id) => { setFormations(prev => prev.filter(f => f.id !== id)); setConfirmDeleteId(null); };

  // ─── Score helpers ──────────────────────────────────────────────────────────
  const addPoint = (side) => setScore(s => nextScore(s, side));
  const resetScore = () => setScore(initScore());
  const pointLabel = (n) => n >= 4 ? "Ad" : POINT_LABELS[n] || "0";

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100 px-3 py-4 sm:p-6 flex flex-col items-center gap-4 sm:gap-6">
      <div className="max-w-6xl w-full text-center px-2">
        <h1 className="text-xl sm:text-3xl font-bold text-slate-900">Tennis Visualizer <span className="text-blue-600">2.0</span></h1>
        <p className="text-slate-500 mt-1 text-sm">Drag players and ball · Analyze angles · Track the match</p>
      </div>

      <div className="w-full max-w-7xl grid lg:grid-cols-[1fr_380px] gap-4 sm:gap-6 items-start">

        {/* ── Court SVG ── */}
        <div className="bg-white rounded-3xl shadow-xl p-3 sm:p-4 overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full h-auto rounded-2xl touch-none select-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            {/* Background */}
            <rect x="0" y="0" width={SVG_W} height={SVG_H} fill="#dbe4ea" />
            <rect x={PA.x - COURT_MARGIN} y={PA.y - COURT_MARGIN} width={PA.w + COURT_MARGIN * 2} height={PA.h + COURT_MARGIN * 2} rx="16" fill="#7c9a6d" />
            <rect x={PA.x} y={PA.y} width={CW} height={CH} fill="#256c3a" rx="10" />

            {/* Voronoi coverage */}
            {tab === "Coverage" && players.map(p => (
              voronoiRegions[p.id]?.map(([vx, vy], i) => (
                <rect key={i} x={vx} y={vy} width={6} height={6} fill={p.color} opacity="0.22" />
              ))
            ))}

            {/* Court lines */}
            <rect x={PA.x} y={PA.y} width={CW} height={CH} fill="none" stroke="white" strokeWidth="3" />
            <line x1={SL_X} y1={PA.y} x2={SL_X} y2={PA.y + CH} stroke="white" strokeWidth="2.5" />
            <line x1={SR_X} y1={PA.y} x2={SR_X} y2={PA.y + CH} stroke="white" strokeWidth="2.5" />
            <line x1={PA.x} y1={NET_Y} x2={PA.x + CW} y2={NET_Y} stroke="#f8fafc" strokeWidth="5" />
            <line x1={SL_X} y1={TOP_SVC_Y} x2={SR_X} y2={TOP_SVC_Y} stroke="white" strokeWidth="2.5" />
            <line x1={SL_X} y1={BOT_SVC_Y} x2={SR_X} y2={BOT_SVC_Y} stroke="white" strokeWidth="2.5" />
            <line x1={CTR_SVC_X} y1={TOP_SVC_Y} x2={CTR_SVC_X} y2={BOT_SVC_Y} stroke="white" strokeWidth="2.5" />

            {/* Angle layers (only in Angles tab) */}
            {tab === "Angles" && (
              <>
                {showLayers.doubles && (
                  <>
                    <polygon points={`${activePlayer.x},${activePlayer.y} ${target.dlW.x},${target.dlW.y} ${target.drW.x},${target.drW.y}`} fill="#60a5fa" opacity="0.08" />
                    <line x1={activePlayer.x} y1={activePlayer.y} x2={target.dlW.x} y2={target.dlW.y} stroke="#60a5fa" strokeWidth="2.5" strokeDasharray="7 5" />
                    <line x1={activePlayer.x} y1={activePlayer.y} x2={target.drW.x} y2={target.drW.y} stroke="#60a5fa" strokeWidth="2.5" strokeDasharray="7 5" />
                  </>
                )}
                {showLayers.singles && (
                  <>
                    <polygon points={`${activePlayer.x},${activePlayer.y} ${target.slW.x},${target.slW.y} ${target.srW.x},${target.srW.y}`} fill="#f59e0b" opacity="0.10" />
                    <line x1={activePlayer.x} y1={activePlayer.y} x2={slEnd.x} y2={slEnd.y} stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="7 5" />
                    <line x1={activePlayer.x} y1={activePlayer.y} x2={srEnd.x} y2={srEnd.y} stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="7 5" />
                  </>
                )}
                {showLayers.service && (
                  <>
                    <polygon points={`${activePlayer.x},${activePlayer.y} ${target.svcL.x},${target.svcL.y} ${target.svcC.x},${target.svcC.y}`} fill="#a855f7" opacity="0.10" />
                    <polygon points={`${activePlayer.x},${activePlayer.y} ${target.svcC.x},${target.svcC.y} ${target.svcR.x},${target.svcR.y}`} fill="#22c55e" opacity="0.10" />
                    <line x1={activePlayer.x} y1={activePlayer.y} x2={svcLEnd.x} y2={svcLEnd.y} stroke="#a855f7" strokeWidth="2" strokeDasharray="7 5" />
                    <line x1={activePlayer.x} y1={activePlayer.y} x2={svcCEnd.x} y2={svcCEnd.y} stroke="#22c55e" strokeWidth="2" strokeDasharray="7 5" />
                    <line x1={activePlayer.x} y1={activePlayer.y} x2={svcREnd.x} y2={svcREnd.y} stroke="#a855f7" strokeWidth="2" strokeDasharray="7 5" />
                  </>
                )}
                <circle cx={activePlayer.x} cy={activePlayer.y} r={activePlayer.reach} fill={activePlayer.color} opacity="0.08" stroke={activePlayer.color} strokeWidth="2" strokeDasharray="8 6" />
              </>
            )}

            {/* Trajectory line: active player → ball */}
            {showLayers.trajectory && (
              <line
                x1={activePlayer.x} y1={activePlayer.y}
                x2={ball.x} y2={ball.y}
                stroke={activePlayer.color}
                strokeWidth="2.5"
                strokeDasharray="10 6"
                opacity="0.85"
              />
            )}

            {/* Players */}
            {players.map(player => (
              <g key={player.id}>
                <circle cx={player.x} cy={player.y} r="13" fill={player.color} stroke={player.active ? "#f8fafc" : "white"} strokeWidth={player.active ? "4" : "3"} />
                <text x={player.x} y={player.y - 20} textAnchor="middle" fontSize="13" fontWeight="700" fill="white" style={{ pointerEvents: "none" }}>{player.name}</text>
                <circle cx={player.x} cy={player.y} r="28" fill="transparent" className="cursor-grab active:cursor-grabbing" onPointerDown={handlePointerDown(player.id)} />
              </g>
            ))}

            {/* Ball */}
            <circle cx={ball.x} cy={ball.y} r="9" fill="#ccff00" stroke="#888" strokeWidth="1.5" />
            <circle cx={ball.x} cy={ball.y} r="3" fill="#999" opacity="0.5" />
            <circle cx={ball.x} cy={ball.y} r="26" fill="transparent" className="cursor-grab active:cursor-grabbing" onPointerDown={handlePointerDown("ball")} />

            {/* Score overlay on court */}
            {tab === "Score" && (
              <>
                <rect x={PA.x + CW / 2 - 70} y={NET_Y - 22} width="140" height="44" rx="10" fill="rgba(0,0,0,0.55)" />
                <text x={PA.x + CW / 2} y={NET_Y - 4} textAnchor="middle" fontSize="13" fill="#94a3b8" fontWeight="600">SCORE</text>
                <text x={PA.x + CW / 2 - 30} y={NET_Y + 14} textAnchor="middle" fontSize="16" fill="#60a5fa" fontWeight="800">
                  {pointLabel(score.points.bottom)}
                </text>
                <text x={PA.x + CW / 2} y={NET_Y + 14} textAnchor="middle" fontSize="14" fill="white" fontWeight="400">–</text>
                <text x={PA.x + CW / 2 + 30} y={NET_Y + 14} textAnchor="middle" fontSize="16" fill="#f87171" fontWeight="800">
                  {pointLabel(score.points.top)}
                </text>
              </>
            )}
          </svg>
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-4">

          {/* Tab bar */}
          <div className="bg-white rounded-2xl shadow-md p-1.5 flex gap-1">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 rounded-xl py-2 text-sm font-semibold transition ${tab === t ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}>
                {t}
              </button>
            ))}
          </div>

          {/* Players card (always visible) */}
          <div className="bg-white rounded-2xl shadow-md p-4">
            <h2 className="font-semibold text-slate-900 mb-3">Players</h2>
            {["bottom", "top"].map(side => (
              <div key={side} className="mb-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">{side} side</p>
                <div className="space-y-2">
                  {players.filter(p => p.side === side).map(player => (
                    <div key={player.id} className="flex items-center gap-2">
                      <button
                        onClick={() => setPlayers(prev => prev.map(p => ({ ...p, active: p.id === player.id })))}
                        className={`w-10 h-10 rounded-xl border-2 flex-shrink-0 transition ${player.active ? "border-slate-900 shadow-md scale-110" : "border-transparent opacity-70"}`}
                        style={{ backgroundColor: player.color }}
                      />
                      <input
                        type="text" value={player.name} maxLength={12}
                        onChange={e => setPlayers(prev => prev.map(p => p.id === player.id ? { ...p, name: e.target.value } : p))}
                        className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-base text-slate-800 focus:outline-none focus:border-slate-400"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* ── Tab: Angles ── */}
          {tab === "Angles" && (
            <>
              <div className="bg-white rounded-2xl shadow-md p-4">
                <h2 className="font-semibold text-slate-900 mb-3">Layers</h2>
                <div className="space-y-2">
                  {[
                    { key: "doubles",    label: "Doubles window",   color: "bg-blue-500" },
                    { key: "singles",    label: "Singles window",   color: "bg-amber-500" },
                    { key: "service",    label: "Service boxes",    color: "bg-purple-500" },
                    { key: "trajectory", label: "Shot trajectory",  color: "bg-lime-500" },
                  ].map(({ key, label, color }) => (
                    <button key={key}
                      onClick={() => setShowLayers(prev => ({ ...prev, [key]: !prev[key] }))}
                      className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 border text-sm font-medium transition ${showLayers[key] ? "border-slate-200 bg-slate-50 text-slate-800" : "border-slate-100 text-slate-400"}`}>
                      <span className={`w-3 h-3 rounded-full flex-shrink-0 ${showLayers[key] ? color : "bg-slate-200"}`} />
                      {label}
                      <span className="ml-auto text-xs">{showLayers[key] ? "ON" : "OFF"}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-md p-4">
                <h2 className="font-semibold text-slate-900 mb-2">Shot window angles</h2>
                <div className="text-sm text-slate-700 space-y-1.5 leading-6">
                  {[
                    ["Doubles window", openings.doubles],
                    ["Singles window", openings.singles],
                    ["Service (full)", openings.svcFull],
                    ["Ad service box", openings.svcAd],
                    ["Deuce service box", openings.svcDeuce],
                  ].map(([label, val]) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-slate-500">{label}</span>
                      <span className="font-semibold text-slate-900">{val.toFixed(1)}°</span>
                    </div>
                  ))}
                  <div className="border-t border-slate-100 mt-2 pt-2 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Position (from left)</span>
                      <span className="font-semibold text-slate-900">{((activePlayer.x - PA.x) / SCALE).toFixed(2)} m</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Position (from baseline)</span>
                      <span className="font-semibold text-slate-900">{((activePlayer.y - PA.y) / SCALE).toFixed(2)} m</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Tab: Coverage ── */}
          {tab === "Coverage" && (
            <div className="bg-white rounded-2xl shadow-md p-4">
              <h2 className="font-semibold text-slate-900 mb-2">Coverage zones</h2>
              <p className="text-sm text-slate-500 mb-4">Each colored area shows which player is closest to that part of the court (Voronoi).</p>
              <div className="space-y-2">
                {players.map(p => (
                  <div key={p.id} className="flex items-center gap-3 text-sm">
                    <span className="w-4 h-4 rounded flex-shrink-0" style={{ backgroundColor: p.color, opacity: 0.7 }} />
                    <span className="text-slate-700 font-medium">{p.name}</span>
                    <span className="text-slate-400 ml-auto">{p.side} side</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Tab: Score ── */}
          {tab === "Score" && (
            <div className="bg-white rounded-2xl shadow-md p-4 space-y-4">
              <h2 className="font-semibold text-slate-900">Score Tracker</h2>

              {/* Sets */}
              {score.sets.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Sets</p>
                  <div className="flex gap-2 flex-wrap">
                    {score.sets.map((s, i) => (
                      <div key={i} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700">
                        <span className="text-blue-600">{s.bottom}</span>–<span className="text-red-500">{s.top}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Games */}
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Current set — Games</p>
                <div className="flex items-center justify-center gap-6 py-2">
                  <span className="text-4xl font-black text-blue-600">{score.games.bottom}</span>
                  <span className="text-slate-300 text-2xl">–</span>
                  <span className="text-4xl font-black text-red-500">{score.games.top}</span>
                </div>
              </div>

              {/* Points */}
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Current game — Points</p>
                <div className="flex items-center justify-center gap-6 py-2">
                  <span className="text-3xl font-black text-blue-600">{pointLabel(score.points.bottom)}</span>
                  <span className="text-slate-300 text-xl">–</span>
                  <span className="text-3xl font-black text-red-500">{pointLabel(score.points.top)}</span>
                </div>
              </div>

              {/* Serving indicator */}
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span className="w-2 h-2 rounded-full bg-lime-400" />
                Serving: <span className="font-semibold text-slate-700 capitalize">{score.serving} side</span>
              </div>

              {/* Point buttons */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { side: "bottom", label: players.find(p => p.id === 1)?.name || "Bottom", color: "bg-blue-600 hover:bg-blue-700" },
                  { side: "top",    label: players.find(p => p.id === 3)?.name || "Top",    color: "bg-red-500 hover:bg-red-600" },
                ].map(({ side, label, color }) => (
                  <button key={side} onClick={() => addPoint(side)}
                    className={`${color} text-white rounded-xl py-3 font-semibold text-sm transition`}>
                    +Point {label}
                  </button>
                ))}
              </div>

              <button onClick={resetScore} className="w-full border border-slate-200 text-slate-500 rounded-xl py-2.5 text-sm font-medium hover:bg-slate-50 transition">
                Reset score
              </button>
            </div>
          )}

          {/* ── Tab: Formations ── */}
          {tab === "Formations" && (
            <div className="bg-white rounded-2xl shadow-md p-4 space-y-4">
              <h2 className="font-semibold text-slate-900">Formations</h2>

              <div className="flex gap-2">
                <input
                  type="text" value={formName} maxLength={24}
                  onChange={e => setFormName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && saveFormation()}
                  placeholder="Formation name…"
                  className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800 focus:outline-none focus:border-slate-400"
                />
                <button onClick={saveFormation} className="px-4 py-2 bg-slate-900 text-white text-sm rounded-lg font-medium hover:bg-slate-700 transition flex-shrink-0">
                  Save
                </button>
              </div>

              {formations.length === 0
                ? <p className="text-sm text-slate-400 text-center py-4">No formations saved yet.<br />Set up a position and hit Save.</p>
                : (
                  <div className="space-y-2">
                    {formations.map(f => (
                      <div key={f.id} className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2.5 hover:border-slate-300 transition">
                        <button onClick={() => loadFormation(f)} className="flex-1 text-left text-sm font-medium text-slate-800 truncate">
                          {f.name}
                        </button>
                        {confirmDeleteId === f.id ? (
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => deleteFormation(f.id)} className="text-xs px-2 py-1 bg-red-500 text-white rounded-lg">Delete</button>
                            <button onClick={() => setConfirmDeleteId(null)} className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-lg">Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(f.id)} className="text-slate-300 hover:text-red-400 transition text-xl leading-none flex-shrink-0 px-1">×</button>
                        )}
                      </div>
                    ))}
                  </div>
                )
              }
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
