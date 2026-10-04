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
  card.append(el("h2", "", ind.title ?? ind.id));
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

// 지표별로 따로 요청해서, 느린 지표(MVRV-Z)가 다른 카드를 막지 않게 한다.
async function loadOne(meta, slot) {
  try {
    const res = await fetch(`/api/indicators/${meta.id}`);
    const ind = await res.json();
    slot.replaceWith(renderCard({ title: meta.title, ...ind }));
  } catch (e) {
    slot.replaceWith(renderCard({ ...meta, error: e.message }));
  }
}

async function load() {
  $("status").textContent = "불러오는 중…";
  try {
    const metas = await (await fetch("/api/indicators")).json();
    const slots = metas.map((m) => {
      const c = el("section", "card");
      c.append(el("h2", "", m.title), el("div", "foot", "불러오는 중…"));
      return c;
    });
    $("cards").replaceChildren(...slots);
    await Promise.all(metas.map((m, i) => loadOne(m, slots[i])));
    $("status").textContent = `업데이트 ${new Date().toLocaleTimeString("ko-KR")}`;
  } catch (e) {
    $("status").textContent = `서버 연결 실패: ${e.message}`;
  }
}

$("refresh").addEventListener("click", load);
load();
setInterval(load, 60_000);
