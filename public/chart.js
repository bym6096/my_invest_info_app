// 의존성 없는 SVG 라인 차트 (단일 시리즈). createChart(meta) → DOM 요소
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

async function fetchHistory(id) {
  const hit = histCache.get(id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
  const res = await fetch(`/api/history/${id}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
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
    const H = 190;
    const m = { l: 36, r: 10, t: 10, b: 22 };
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    let lo = Infinity, hi = -Infinity;
    for (const [, v] of pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const pad = (hi - lo || 1) * 0.08;
    lo -= pad; hi += pad;
    const x = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
    const y = (v) => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
    const dec = data.decimals ?? 2;

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", tabindex: "0",
      "aria-label": `${meta.title} 추이, ${fmtDate(t0)}부터 ${fmtDate(t1)}까지` });
    svg.style.touchAction = "pan-y";

    const { ticks, step } = niceTicks(lo, hi);
    const yFmt = (v) => v.toFixed(step < 1 ? (step < 0.5 ? 2 : 1) : 0);
    for (const v of ticks) {
      svg.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "grid" }));
      const t = svgEl("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end", class: "tick" });
      t.textContent = yFmt(v);
      svg.append(t);
    }
    // 기준선(과열/침체 구간 경계 등): 표시 범위 안에 있을 때만
    for (const r of data.refs ?? []) {
      if (r <= lo || r >= hi || ticks.includes(r)) continue;
      svg.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: y(r), y2: y(r), class: "ref" }));
      if (ticks.some((v) => Math.abs(y(v) - y(r)) < 12)) continue; // 눈금 라벨과 겹치면 라벨 생략
      const t = svgEl("text", { x: m.l - 6, y: y(r) + 4, "text-anchor": "end", class: "tick" });
      t.textContent = String(r);
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
      tipVal.textContent = v.toFixed(dec);
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
    const fmt = (v) => v.toFixed(dec);
    const minV = Math.min(...pts.map((p) => p[1])), maxV = Math.max(...pts.map((p) => p[1]));
    stats.textContent = `구간 최저 ${fmt(minV)} · 최고 ${fmt(maxV)} · 현재 ${fmt(last[1])}`;
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
