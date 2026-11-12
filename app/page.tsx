"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

type VenueStatus = "available" | "full" | "maybe";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS & COURT DATA
// ═══════════════════════════════════════════════════════════════

const DAYS = [
  { date: "11/16", label: "週一", short: "一" },
  { date: "11/17", label: "週二", short: "二" },
  { date: "11/18", label: "週三", short: "三" },
  { date: "11/19", label: "週四", short: "四" },
  { date: "11/20", label: "週五", short: "五" },
  { date: "11/21", label: "週六", short: "六" },
  { date: "11/22", label: "週日", short: "日" },
];

const HOURS = Array.from({ length: 17 }, (_, i) => i + 7); // 7–23

// Pickle Space — VIP 包廂, 1 court. Listed = available.
const PS: Record<number, Set<number>> = {
  0: new Set([7, 8, 9, 10, 11, 12, 19, 22, 23]),
  1: new Set([7, 8, 9, 10, 11, 12, 13, 14, 17, 18, 22, 23]),
  2: new Set([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]),
  3: new Set([7, 8, 9, 10, 11, 12, 13, 14, 23]),
  4: new Set([7, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
  5: new Set([8, 9, 10, 11, 12, 16, 19, 20, 21, 22]),
  6: new Set([7, 8, 9, 10, 11, 13, 14, 16, 17, 18, 19, 22, 23]),
};

// Pick Le Mode — 4 courts, 07:00–23:00 (last slot 22:00).
// Listed = ALL 4 courts booked (everything else has ≥ 1 free).
const PLM_FULL: Record<number, Set<number>> = {
  0: new Set([10, 11, 13, 14, 15, 19]),
  1: new Set([13, 19, 20]),
  2: new Set([11, 19, 20]),
  3: new Set([19, 20]),
  4: new Set([10, 11, 13, 14, 15, 19, 20]),
  5: new Set(),
  6: new Set(),
};

// Maybe full — uncertain data (Mon & Sat had incomplete info)
const PLM_MAYBE: Record<number, Set<number>> = {
  0: new Set([18]),
  1: new Set(),
  2: new Set(),
  3: new Set(),
  4: new Set(),
  5: new Set([10, 16]),
  6: new Set(),
};

const PLM_LAST_HOUR = 22; // closes at 23:00

// ═══════════════════════════════════════════════════════════════
// VENUE HELPERS
// ═══════════════════════════════════════════════════════════════

function psAvail(d: number, h: number): boolean {
  return PS[d]?.has(h) ?? false;
}

function plmStatus(d: number, h: number): VenueStatus {
  if (h > PLM_LAST_HOUR) return "full";
  if (PLM_FULL[d]?.has(h)) return "full";
  if (PLM_MAYBE[d]?.has(h)) return "maybe";
  return "available";
}

function anyVenue(d: number, h: number): boolean {
  return psAvail(d, h) || plmStatus(d, h) !== "full";
}

function psPrice(h: number): number {
  if (h < 8) return 800;
  if (h < 13) return 1200;
  return 1600;
}

function plmPrice(d: number, h: number): number {
  if (d >= 5) return 1400; // weekend
  return h < 16 ? 1200 : 1400;
}

// ═══════════════════════════════════════════════════════════════
// URL ENCODING — compact bitfield in base64url
// 7 days × 17 hours = 119 bits → 15 bytes → ~20 chars
// ═══════════════════════════════════════════════════════════════

function encodeSlots(slots: Set<string>): string {
  const bytes = new Uint8Array(15);
  for (const key of slots) {
    const [d, h] = key.split("-").map(Number);
    const i = d * 17 + (h - 7);
    if (i >= 0 && i < 119) {
      bytes[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
    }
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeSlots(enc: string): Set<string> {
  try {
    const padded = enc.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (padded.length % 4)) % 4;
    const bin = atob(padded + "=".repeat(pad));
    const slots = new Set<string>();
    for (let i = 0; i < 119; i++) {
      const byteIdx = Math.floor(i / 8);
      if (byteIdx < bin.length && bin.charCodeAt(byteIdx) & (1 << (7 - (i % 8)))) {
        slots.add(`${Math.floor(i / 17)}-${(i % 17) + 7}`);
      }
    }
    return slots;
  } catch {
    return new Set();
  }
}

function serialize(participants: Map<string, Set<string>>): string {
  return Array.from(participants.entries())
    .map(([n, s]) => `${encodeURIComponent(n)}~${encodeSlots(s)}`)
    .join("|");
}

function parseHash(hash: string): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  if (!hash) return m;
  for (const part of hash.split("|")) {
    const sep = part.indexOf("~");
    if (sep < 1) continue;
    const name = decodeURIComponent(part.slice(0, sep));
    const enc = part.slice(sep + 1);
    if (name && enc) m.set(name, decodeSlots(enc));
  }
  return m;
}

// ═══════════════════════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════════════════════

function tooltip(d: number, h: number, who: string[]): string {
  const t = `${h.toString().padStart(2, "0")}:00–${(h + 1).toString().padStart(2, "0")}:00`;
  const lines = [`${DAYS[d].label} ${DAYS[d].date}  ${t}`];

  const ps = psAvail(d, h);
  lines.push(ps ? `✓ Pickle Space — NT$${psPrice(h).toLocaleString()}` : `✗ Pickle Space — 已預約`);

  const pm = plmStatus(d, h);
  if (pm === "available") lines.push(`✓ Pick Le Mode — NT$${plmPrice(d, h).toLocaleString()}`);
  else if (pm === "maybe") lines.push(`△ Pick Le Mode — NT$${plmPrice(d, h).toLocaleString()} (可能有空)`);
  else lines.push(`✗ Pick Le Mode — 已滿`);

  if (who.length > 0) lines.push(`👤 ${who.join(", ")}`);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// AVATAR COLORS
// ═══════════════════════════════════════════════════════════════

const AVATAR_COLORS = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-indigo-500",
];

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function Page() {
  const [nameInput, setNameInput] = useState("");
  const [currentName, setCurrentName] = useState("");
  const [joined, setJoined] = useState(false);
  const [mySlots, setMySlots] = useState<Set<string>>(new Set());
  const [others, setOthers] = useState<Map<string, Set<string>>>(new Map());
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragMode, setDragMode] = useState(true);

  // ── mount: parse hash + localStorage ──
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const parsed = parseHash(hash);
    const saved = localStorage.getItem("pkl-name") || "";

    if (saved && parsed.size > 0) {
      if (parsed.has(saved)) {
        setMySlots(new Set(parsed.get(saved)!));
        const o = new Map(parsed);
        o.delete(saved);
        setOthers(o);
      } else {
        setOthers(parsed);
        const s = localStorage.getItem("pkl-slots");
        if (s) setMySlots(decodeSlots(s));
      }
      setCurrentName(saved);
      setNameInput(saved);
      setJoined(true);
    } else if (saved) {
      setCurrentName(saved);
      setNameInput(saved);
      const s = localStorage.getItem("pkl-slots");
      if (s) setMySlots(decodeSlots(s));
      setJoined(true);
    } else {
      setOthers(parsed);
    }
  }, []);

  // ── persist to localStorage ──
  useEffect(() => {
    if (joined && currentName) {
      localStorage.setItem("pkl-name", currentName);
      localStorage.setItem("pkl-slots", encodeSlots(mySlots));
    }
  }, [mySlots, currentName, joined]);

  // ── global mouseup to end drag ──
  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
    };
  }, []);

  // ── handlers ──
  const handleJoin = useCallback(() => {
    const name = nameInput.trim();
    if (!name) return;
    if (others.has(name)) {
      setMySlots(new Set(others.get(name)!));
      const o = new Map(others);
      o.delete(name);
      setOthers(o);
    }
    setCurrentName(name);
    setJoined(true);
    localStorage.setItem("pkl-name", name);
  }, [nameInput, others]);

  const toggle = useCallback((key: string, val?: boolean) => {
    setMySlots((prev) => {
      const next = new Set(prev);
      const add = val !== undefined ? val : !next.has(key);
      if (add) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const onCellDown = useCallback(
    (key: string) => {
      if (!joined) return;
      const [d, h] = key.split("-").map(Number);
      if (!anyVenue(d, h)) return;
      const mode = !mySlots.has(key);
      setDragging(true);
      setDragMode(mode);
      toggle(key, mode);
    },
    [joined, mySlots, toggle],
  );

  const onCellEnter = useCallback(
    (key: string) => {
      if (!dragging || !joined) return;
      const [d, h] = key.split("-").map(Number);
      if (!anyVenue(d, h)) return;
      toggle(key, dragMode);
    },
    [dragging, joined, dragMode, toggle],
  );

  const handleShare = useCallback(async () => {
    const all = new Map(others);
    if (currentName) all.set(currentName, mySlots);
    const hash = serialize(all);
    window.history.replaceState(null, "", `#${hash}`);
    const url = `${window.location.origin}${window.location.pathname}#${hash}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [others, currentName, mySlots]);

  // ── derived ──
  const totalP = (joined ? 1 : 0) + others.size;

  const allNames = useMemo(() => {
    const names: string[] = [];
    if (joined && currentName) names.push(currentName);
    for (const n of others.keys()) names.push(n);
    return names;
  }, [joined, currentName, others]);

  // who's available at each slot
  const whoAt = useCallback(
    (key: string): string[] => {
      const who: string[] = [];
      if (joined && mySlots.has(key)) who.push(currentName);
      for (const [n, s] of others) {
        if (s.has(key)) who.push(n);
      }
      return who;
    },
    [joined, mySlots, currentName, others],
  );

  // best slots: everyone available + court available
  const bestSlots = useMemo(() => {
    if (!joined || mySlots.size === 0) return [];
    const results: {
      key: string;
      d: number;
      h: number;
      venues: { name: string; price: number; status: VenueStatus }[];
    }[] = [];

    for (let d = 0; d < 7; d++) {
      for (const h of HOURS) {
        const key = `${d}-${h}`;
        let count = mySlots.has(key) ? 1 : 0;
        for (const [, s] of others) if (s.has(key)) count++;
        if (count < totalP || count === 0) continue;

        const venues: (typeof results)[0]["venues"] = [];
        if (psAvail(d, h)) venues.push({ name: "Pickle Space", price: psPrice(h), status: "available" });
        const pm = plmStatus(d, h);
        if (pm !== "full") venues.push({ name: "Pick Le Mode", price: plmPrice(d, h), status: pm });
        if (venues.length > 0) results.push({ key, d, h, venues });
      }
    }
    return results;
  }, [mySlots, others, totalP, joined]);

  // ── cell style ──
  const cellCls = (d: number, h: number): string => {
    const key = `${d}-${h}`;
    if (!anyVenue(d, h)) return "bg-gray-100 border-gray-100";

    const sel = mySlots.has(key);
    let oc = 0;
    for (const [, s] of others) if (s.has(key)) oc++;
    const total = (sel ? 1 : 0) + oc;

    if (total === totalP && totalP > 1) {
      return sel
        ? "bg-emerald-200 border-emerald-400 ring-1 ring-emerald-400/50"
        : "bg-emerald-100 border-emerald-300";
    }
    if (sel) return oc > 0 ? "bg-sky-200 border-sky-400" : "bg-sky-100 border-sky-300";
    if (oc > 0) return oc > 1 ? "bg-violet-100 border-violet-300" : "bg-violet-50 border-violet-200";
    return "bg-white border-gray-200 hover:bg-gray-50";
  };

  // ═════════════════════════════ RENDER ═════════════════════════

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white pb-16">
      {/* ── Header ── */}
      <header className="text-center pt-8 pb-4 px-4">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          🏓 Pickleball 約課
        </h1>
        <p className="text-gray-500 mt-1">找出大家下週都有空的時間</p>
        <p className="text-sm text-gray-400 mt-0.5">
          2026 / 11 / 16 (一) – 11 / 22 (日)
        </p>
      </header>

      {/* ── Name Input / User Badge ── */}
      <div className="max-w-md mx-auto px-4 mb-5">
        {!joined ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="輸入你的名字"
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none text-gray-900 bg-white"
              autoFocus
            />
            <button
              onClick={handleJoin}
              disabled={!nameInput.trim()}
              className="px-5 py-2.5 rounded-xl bg-sky-500 text-white font-medium hover:bg-sky-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              加入
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-sky-500 text-white flex items-center justify-center font-medium text-sm">
                {currentName[0]}
              </div>
              <span className="font-medium text-gray-900">{currentName}</span>
              <span className="text-sm text-gray-400 hidden sm:inline">
                — 點擊或拖曳選取有空的時間
              </span>
            </div>
            <button
              onClick={() => setMySlots(new Set())}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              清除
            </button>
          </div>
        )}
      </div>

      {/* ── Participants ── */}
      {allNames.length > 1 && (
        <div className="max-w-4xl mx-auto px-4 mb-4">
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <span className="text-gray-400">參與者</span>
            {allNames.map((name, i) => (
              <div key={name} className="flex items-center gap-1.5">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium ${
                    name === currentName ? "bg-sky-500" : AVATAR_COLORS[i % AVATAR_COLORS.length]
                  }`}
                >
                  {name[0]}
                </div>
                <span className={name === currentName ? "font-medium text-gray-900" : "text-gray-600"}>
                  {name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Grid ── */}
      <div className="max-w-4xl mx-auto px-4 mb-4">
        <div className="overflow-x-auto -mx-4 px-4 pb-2">
          <div
            className="grid min-w-[560px] select-none"
            style={{ gridTemplateColumns: "52px repeat(7, 1fr)" }}
            onMouseLeave={() => setDragging(false)}
          >
            {/* header row */}
            <div />
            {DAYS.map((day, di) => (
              <div
                key={di}
                className="flex flex-col items-center justify-center py-2 text-sm"
              >
                <span className="font-semibold text-gray-800">{day.short}</span>
                <span className="text-[11px] text-gray-400">{day.date}</span>
              </div>
            ))}

            {/* time rows */}
            {HOURS.flatMap((h) => [
              <div
                key={`t${h}`}
                className="h-10 flex items-center justify-end pr-2 text-[11px] text-gray-400 tabular-nums"
              >
                {h.toString().padStart(2, "0")}:00
              </div>,
              ...DAYS.map((_, di) => {
                const key = `${di}-${h}`;
                const has = anyVenue(di, h);
                const ps = psAvail(di, h);
                const pm = plmStatus(di, h);
                const pmOk = pm !== "full";

                return (
                  <div
                    key={key}
                    className={`h-10 border relative transition-colors ${cellCls(di, h)} ${
                      has && joined ? "cursor-pointer" : has ? "cursor-default" : "cursor-not-allowed"
                    }`}
                    style={{ touchAction: "manipulation" }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onCellDown(key);
                    }}
                    onMouseEnter={() => onCellEnter(key)}
                    title={tooltip(di, h, whoAt(key))}
                  >
                    {has && (
                      <div className="absolute top-[3px] right-[3px] flex gap-[2px]">
                        {ps && <div className="w-[6px] h-[6px] rounded-full bg-amber-400" />}
                        {pmOk && (
                          <div
                            className={`w-[6px] h-[6px] rounded-full ${
                              pm === "maybe"
                                ? "bg-sky-300 ring-1 ring-sky-400/60"
                                : "bg-sky-500"
                            }`}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              }),
            ])}
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="max-w-4xl mx-auto px-4 mb-6">
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-[6px] h-[6px] rounded-full bg-amber-400" />
            Pickle Space
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-[6px] h-[6px] rounded-full bg-sky-500" />
            Pick Le Mode
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-[6px] h-[6px] rounded-full bg-sky-300 ring-1 ring-sky-400/60" />
            可能有空
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-sky-100 border border-sky-300" />
            你有空
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-violet-50 border border-violet-200" />
            別人有空
          </span>
          {totalP > 1 && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-emerald-200 border border-emerald-400" />
              大家都有空
            </span>
          )}
        </div>
      </div>

      {/* ── Instruction for visitors who haven't joined ── */}
      {!joined && (
        <div className="max-w-md mx-auto px-4 mb-6 text-center text-sm text-gray-400">
          ⬆ 先輸入你的名字，就可以選時段囉
        </div>
      )}

      {/* ── Share Button ── */}
      {joined && (
        <div className="max-w-md mx-auto px-4 mb-6">
          <button
            onClick={handleShare}
            className={`w-full py-3 rounded-xl font-medium transition-all ${
              copied ? "bg-emerald-500 text-white" : "bg-gray-900 text-white hover:bg-gray-800"
            }`}
          >
            {copied ? "✅ 已複製連結！" : "📋 複製連結分享給朋友"}
          </button>
          {mySlots.size > 0 && (
            <p className="text-center text-xs text-gray-400 mt-2">
              已選 {mySlots.size} 個時段
            </p>
          )}
        </div>
      )}

      {/* ── Best Slots ── */}
      {bestSlots.length > 0 && (
        <div className="max-w-md mx-auto px-4 mb-6">
          <div className="bg-emerald-50 rounded-2xl p-5 border border-emerald-200">
            <h3 className="font-semibold text-emerald-800 mb-3">
              {totalP > 1 ? `✨ ${totalP} 人都有空的時段` : "🏸 你有空且有場地的時段"}
            </h3>
            <div className="space-y-2">
              {bestSlots.map(({ key, d, h, venues }) => (
                <div key={key} className="text-sm flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-emerald-900">
                    {DAYS[d].label} {h.toString().padStart(2, "0")}:00
                  </span>
                  {venues.map((v) => (
                    <span key={v.name} className="text-emerald-600 text-xs">
                      {v.name} ${v.price.toLocaleString()}
                      {v.status === "maybe" ? " ⚠" : ""}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Venue Info ── */}
      <div className="max-w-md mx-auto px-4">
        <h3 className="text-sm font-medium text-gray-400 mb-3">📍 場地資訊</h3>
        <div className="space-y-3">
          <div className="bg-white rounded-xl p-4 border border-gray-200 text-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
              <span className="font-medium text-gray-900">Pickle Space</span>
              <span className="text-gray-400 text-xs">VIP 包廂 · 1 面</span>
            </div>
            <p className="text-gray-500 text-xs ml-4">
              07:00 前 $800 / 08–13 時 $1,200 / 13 時後 $1,600（每小時）
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200 text-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
              <span className="font-medium text-gray-900">Pick Le Mode</span>
              <span className="text-gray-400 text-xs">4 面 · 試營運</span>
            </div>
            <p className="text-gray-500 text-xs ml-4">
              平日 16 時前 $1,200 / 平日 16 時後及週末 $1,400（每小時）
            </p>
            <p className="text-gray-400 text-[11px] ml-4 mt-0.5">
              內湖區行愛路 141 巷 38 號 3 樓
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
