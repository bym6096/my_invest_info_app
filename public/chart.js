// 의존성 없는 SVG 라인 차트 (단일 시리즈). createChart(meta) → DOM 요소
import { clientMvrvzHistory } from "/mvrv-client.js";

const RANGES = [
  { key: "1m", label: "1개월", days: 30 },
  { key: "1y", label: "1년", days: 365 },
  { key: "max", label: "전체", days: null },
];
const DAY = 86400;
const SVG_NS = "http://www.w3.org/2000/svg";
const histCache = new Map(); // id -> { at, data }
let currentRange = "1y";
try { currentRange = localStorage.getItem("chartRange") || currentRange; } catch {}

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v / step) * step);
  return { ticks, step };
}

const fmtDate = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

function fmtAxisDate(ts, spanDays) {
  const d = new Date(ts * 1000);
  if (spanDays <= 45) return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  if (spanDays <= 800) return `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}`;
  return String(d.getUTCFullYear());
}

// 서버가 실패했거나 데이터가 짧을 때(partial) 브라우저에서 직접 계산하는 대체 경로
const CLIENT_FALLBACKS = { mvrvz: clientMvrvzHistory };

async function fetchFromServer(id) {
  const res = await fetch(`/api/history/${id}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function fetchHistory(id) {
  const hit = histCache.get(id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
  let data = null, serverErr = null;
  try {
    data = await fetchFromServer(id);
  } catch (e) {
    serverErr = e;
  }
  const fallback = CLIENT_FALLBACKS[id];
  if (fallback && (!data || data.partial)) {
    try {
      data = await fallback();
    } catch (e) {
      if (!data) throw new Error(`${serverErr.message} / 브라우저: ${e.message}`);
      data = { ...data, note: `전체 기간 불러오기 실패 (브라우저: ${e.message})` };
    }
  }
  if (!data) throw serverErr;
  histCache.set(id, { at: Date.now(), data });
  return data;
}

// 이진 탐색: x(시각)에 가장 가까운 점의 인덱스
function nearest(pts, t) {
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] < t) lo = mid; else hi = mid;
  }
  return Math.abs(pts[lo][0] - t) <= Math.abs(pts[hi][0] - t) ? lo : hi;
}

export function createChart(meta) {
  const root = document.createElement("div");
  root.className = "chart";
  const bar = document.createElement("div");
  bar.className = "chart-ranges";
  const plot = document.createElement("div");
  plot.className = "chart-plot";
  const stats = document.createElement("div");
  stats.className = "chart-stats";
  root.append(bar, plot, stats);

  let data = null;
  const buttons = RANGES.map((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = r.label;
    b.addEventListener("click", () => {
      currentRange = r.key;
      try { localStorage.setItem("chartRange", r.key); } catch {}
      document.dispatchEvent(new CustomEvent("chart-range"));
    });
    bar.append(b);
    return [r.key, b];
  });

  function draw() {
    for (const [k, b] of buttons) b.setAttribute("aria-pressed", String(k === currentRange));
    if (!data) return;
    plot.replaceChildren();
    const range = RANGES.find((r) => r.key === currentRange) ?? RANGES[1];
    const all = data.points;
    const lastT = all[all.length - 1][0];
    const pts = range.days ? all.filter((p) => p[0] >= lastT - range.days * DAY) : all;
    if (pts.length < 2) {
      plot.textContent = "표시할 데이터가 부족합니다";
      return;
    }
    const W = Math.max(240, plot.clientWidth || root.clientWidth || 300);
    const H = W >= 560 ? 280 : 190; // 넓은 화면에서는 세로도 키워 추세가 잘 보이게
    // logRatio: 값이 "기준 대비 %"일 때 배율(1 + v/100)의 로그 눈금으로 그린다 (버블기 +1000% 와 바닥 근처를 함께 보이게)
    const logRatio = Boolean(data.logRatio);
    const tf = logRatio ? (v) => Math.log10(Math.max(1 + v / 100, 1e-6)) : (v) => v;
    const m = { l: logRatio ? 46 : 36, r: 10, t: 10, b: 22 };
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    let lo = Infinity, hi = -Infinity;
    for (const [, v] of pts) { const u = tf(v); if (u < lo) lo = u; if (u > hi) hi = u; }
    const pad = (hi - lo || 1) * 0.08;
    lo -= pad; hi += pad;
    const x = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
    const Y = (u) => H - m.b - ((u - lo) / (hi - lo)) * (H - m.t - m.b); // 변환된 값 → 화면 y
    const y = (v) => Y(tf(v));
    const dec = data.decimals ?? 2;
    const unit = data.unit ?? "";
    const fmtV = (v) => `${unit === "%" && v > 0 ? "+" : ""}${v.toFixed(dec)}${unit}`;

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", tabindex: "0",
      "aria-label": `${meta.title} 추이, ${fmtDate(t0)}부터 ${fmtDate(t1)}까지` });
    svg.style.touchAction = "pan-y";

    // 구간 색칠(과열/침체 등): 현재 보이는 범위와 겹칠 때만 그린다. 가장 아래에 깔리도록 먼저 추가.
    for (const bd of data.bands ?? []) {
      const top = Math.min(bd.to === undefined ? Infinity : tf(bd.to), hi);
      const bottom = Math.max(bd.from === undefined ? -Infinity : tf(bd.from), lo);
      if (top <= bottom) continue;
      const y0 = Y(top), y1 = Y(bottom);
      svg.append(svgEl("rect", { x: m.l, y: y0, width: W - m.l - m.r, height: y1 - y0, class: `band t-${bd.tone}` }));
      if (y1 - y0 >= 18) {
        const atTop = bd.from !== undefined; // 위쪽 구간은 위쪽 가장자리, 아래쪽 구간은 아래쪽 가장자리에 라벨
        const t = svgEl("text", { x: m.l + 6, y: atTop ? y0 + 12 : y1 - 6, class: "band-label" });
        t.textContent = bd.label;
        svg.append(t);
      }
    }

    let ticks, yFmt;
    if (logRatio) {
      // 눈금은 보기 좋은 % 값 중 범위 안에 드는 것. 0% 를 먼저 두고, 이미 둔 눈금과 16px 이상 떨어진 것만 더한다.
      const nice = [0, -10, -25, -50, -75, -90, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
      ticks = [];
      for (const v of nice) {
        if (tf(v) <= lo || tf(v) >= hi) continue;
        if (ticks.every((u) => Math.abs(y(u) - y(v)) >= 16)) ticks.push(v);
      }
      ticks.sort((a, b) => a - b);
      yFmt = (v) => `${v > 0 ? "+" : ""}${v}%`;
    } else {
      const nt = niceTicks(lo, hi);
      ticks = nt.ticks;
      yFmt = (v) => v.toFixed(nt.step < 1 ? (nt.step < 0.5 ? 2 : 1) : 0);
    }
    for (const v of ticks) {
      svg.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "grid" }));
      const t = svgEl("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end", class: "tick" });
      t.textContent = yFmt(v);
      svg.append(t);
    }
    // 기준선(과열/침체 구간 경계 등): 표시 범위 안에 있을 때만
    for (const r of data.refs ?? []) {
      if (tf(r) <= lo || tf(r) >= hi || ticks.includes(r)) continue;
      svg.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: y(r), y2: y(r), class: "ref" }));
      if (ticks.some((v) => Math.abs(y(v) - y(r)) < 12)) continue; // 눈금 라벨과 겹치면 라벨 생략
      const t = svgEl("text", { x: m.l - 6, y: y(r) + 4, "text-anchor": "end", class: "tick" });
      t.textContent = logRatio ? yFmt(r) : String(r);
      svg.append(t);
    }
    const spanDays = (t1 - t0) / DAY;
    [[t0, "start"], [(t0 + t1) / 2, "middle"], [t1, "end"]].forEach(([t, anchor]) => {
      const e = svgEl("text", { x: x(t), y: H - 6, "text-anchor": anchor, class: "tick" });
      e.textContent = fmtAxisDate(t, spanDays);
      svg.append(e);
    });

    svg.append(svgEl("path", { d: "M" + pts.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("L"), class: "line" }));
    const last = pts[pts.length - 1];
    svg.append(svgEl("circle", { cx: x(last[0]), cy: y(last[1]), r: 4, class: "dot" }));

    const cross = svgEl("line", { y1: m.t, y2: H - m.b, class: "cross", visibility: "hidden" });
    const hover = svgEl("circle", { r: 4, class: "dot", visibility: "hidden" });
    svg.append(cross, hover);
    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    const tipVal = document.createElement("strong");
    const tipDate = document.createElement("span");
    tip.append(tipVal, tipDate);

    function show(i) {
      const [t, v] = pts[i];
      const px = x(t), py = y(v);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
      hover.setAttribute("cx", px); hover.setAttribute("cy", py); hover.setAttribute("visibility", "visible");
      tipVal.textContent = fmtV(v);
      tipDate.textContent = fmtDate(t);
      tip.hidden = false;
      const w = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(px - w / 2, 0), W - w)}px`;
      tip.style.top = "0px";
    }
    function hide() {
      cross.setAttribute("visibility", "hidden");
      hover.setAttribute("visibility", "hidden");
      tip.hidden = true;
    }
    let idx = pts.length - 1;
    const at = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const t = t0 + ((px - m.l) / (W - m.l - m.r)) * (t1 - t0);
      idx = nearest(pts, Math.min(Math.max(t, t0), t1));
      show(idx);
    };
    svg.addEventListener("pointermove", at);
    svg.addEventListener("pointerdown", at);
    svg.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") hide(); });
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      idx = Math.min(pts.length - 1, Math.max(0, idx + (ev.key === "ArrowLeft" ? -1 : 1)));
      show(idx);
      ev.preventDefault();
    });

    plot.append(svg, tip);
    const fmt = fmtV;
    const minV = Math.min(...pts.map((p) => p[1])), maxV = Math.max(...pts.map((p) => p[1]));
    stats.textContent = `구간 최저 ${fmt(minV)} · 최고 ${fmt(maxV)} · 현재 ${fmt(last[1])}`;
    const src = document.createElement("div");
    src.textContent = [`이력 출처: ${data.source}`, `${fmtDate(all[0][0])}부터`, data.note].filter(Boolean).join(" · ");
    stats.append(src);
  }

  document.addEventListener("chart-range", draw);
  let timer;
  new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(draw, 100); }).observe(root);

  plot.textContent = "그래프 불러오는 중…";
  fetchHistory(meta.id)
    .then((d) => { data = d; draw(); })
    .catch((e) => {
      plot.textContent = `그래프를 불러오지 못했습니다: ${e.message}`;
      plot.classList.add("err");
    });
  draw();
  return root;
}
