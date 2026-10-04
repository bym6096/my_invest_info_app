const TITLES = { kimchi: "김치프리미엄 (USDT)", mvrvz: "BTC MVRV Z-Score", fng: "Crypto Fear & Greed Index" };
const $ = (id) => document.getElementById(id);

function zoneOf(ind) {
  return ind.zones.find((z) => z.max === null || ind.value < z.max) ?? ind.zones.at(-1);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderCard(ind) {
  const card = el("section", "card");
  card.append(el("h2", "", ind.title ?? TITLES[ind.id] ?? ind.id));
  if (ind.error) {
    card.append(el("div", "err", `불러오기 실패: ${ind.error}`));
    return card;
  }
  const zone = zoneOf(ind);
  const sign = ind.unit === "%" && ind.value > 0 ? "+" : "";
  card.append(el("div", "value", `${sign}${ind.value.toFixed(ind.decimals)}${ind.unit}`));
  card.append(el("span", `badge tone-${zone.tone}`, zone.label));
  if (ind.range) {
    const [lo, hi] = ind.range;
    const pct = Math.min(100, Math.max(0, ((ind.value - lo) / (hi - lo)) * 100));
    const bar = el("div", "bar");
    const mark = el("i");
    mark.style.left = `calc(${pct}% - 2px)`;
    bar.append(mark);
    card.append(bar);
  }
  const dl = el("dl");
  for (const d of ind.details ?? []) {
    const row = el("div");
    row.append(el("dt", "", d.label), el("dd", "", d.value));
    dl.append(row);
  }
  card.append(dl);
  const foot = el("div", "foot", `출처: ${ind.source}`);
  if (ind.stale) foot.append(el("span", "stale", " · 최신 갱신 실패, 이전 값 표시 중"));
  card.append(foot);
  return card;
}

async function load() {
  $("status").textContent = "불러오는 중…";
  try {
    const res = await fetch("/api/indicators");
    const list = await res.json();
    $("cards").replaceChildren(...list.map(renderCard));
    $("status").textContent = `업데이트 ${new Date().toLocaleTimeString("ko-KR")}`;
  } catch (e) {
    $("status").textContent = `서버 연결 실패: ${e.message}`;
  }
}

$("refresh").addEventListener("click", load);
load();
setInterval(load, 60_000);
