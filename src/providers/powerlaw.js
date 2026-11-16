import { getJson, cached } from "../http.js";

// 비트코인 멱법칙 바닥선: log10(가격) = c + k·log10(제네시스 이후 일수)
// - 바닥선(1% 분위): 2011년 이후 날의 1%만 이 선 아래에 있었다
// - 지지선(5% 분위): 산토스타시가 밝힌 지지선 정의(5% 분위 회귀)
// - 적정가: 최소제곱(OLS) 추세선
// 계수는 고정하지 않고 받은 데이터 전체로 매번 다시 맞춘다.

const GENESIS = Date.UTC(2009, 0, 3) / 1000;
const FIT_FROM = "2011-01-01"; // 2010년은 거래가 얇아 회귀에서 뺀다
const CM_URL =
  "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc" +
  `&metrics=PriceUSD&frequency=1d&start_time=${FIT_FROM}&page_size=10000`;
const CM_HEADERS = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };

// rows: [{time, PriceUSD}] → [{date, x, y}] (x = log10 일수, y = log10 가격)
export function toLogPoints(rows) {
  return rows
    .filter((r) => Number(r.PriceUSD) > 0)
    .map((r) => {
      const days = (Date.parse(r.time) / 1000 - GENESIS) / 86400;
      return { date: r.time.slice(0, 10), x: Math.log10(days), y: Math.log10(Number(r.PriceUSD)) };
    })
    .filter((p) => Number.isFinite(p.x) && p.date >= FIT_FROM);
}

export function olsFit(pts) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { x, y } of pts) { n++; sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const k = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { k, c: (sy - k * sx) / n };
}

// 기울기 k 가 정해지면 손실을 최소화하는 절편은 잔차(y - kx)의 q 분위수다.
function profile(pts, q, k) {
  const r = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i++) r[i] = pts[i].y - k * pts[i].x;
  r.sort();
  const c = r[Math.min(r.length - 1, Math.floor(q * r.length))];
  let loss = 0;
  for (const v of r) loss += v >= c ? q * (v - c) : (q - 1) * (v - c);
  return { k, c, loss };
}

// 분위 회귀: 손실(pinball)이 k 에 대해 볼록하므로 황금분할 탐색으로 k 를 찾는다.
export function quantileFit(pts, q) {
  let a = 3, b = 9;
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a), x2 = a + g * (b - a);
  let f1 = profile(pts, q, x1), f2 = profile(pts, q, x2);
  while (b - a > 1e-5) {
    if (f1.loss < f2.loss) { b = x2; x2 = x1; f2 = f1; x1 = b - g * (b - a); f1 = profile(pts, q, x1); }
    else { a = x1; x1 = x2; f1 = f2; x2 = a + g * (b - a); f2 = profile(pts, q, x2); }
  }
  const { k, c } = f1.loss < f2.loss ? f1 : f2;
  return { k, c };
}

const lineAt = ({ c, k }, x) => 10 ** (c + k * x);

export function computePowerLaw(pts) {
  if (pts.length < 365) throw new Error("멱법칙 계산용 가격 데이터 부족");
  const fair = olsFit(pts);
  const floor = quantileFit(pts, 0.01);
  const support = quantileFit(pts, 0.05);
  const top = quantileFit(pts, 0.95);
  const last = pts[pts.length - 1];
  const res = (p) => p.y - (floor.c + floor.k * p.x);
  const cur = res(last);
  return {
    date: last.date,
    price: 10 ** last.y,
    floor: lineAt(floor, last.x),
    support: lineAt(support, last.x),
    fair: lineAt(fair, last.x),
    top: lineAt(top, last.x),
    // 바닥선 기준으로 지금보다 더 낮은 위치였던 날의 비율
    lowerShare: pts.filter((p) => res(p) < cur).length / pts.length,
    fits: { floor, support, fair, top },
    from: pts[0].date,
  };
}

async function loadPrices() {
  const rows = [];
  let url = CM_URL;
  for (let i = 0; url && i < 5; i++) {
    const d = await getJson(url, { timeoutMs: 20000, headers: CM_HEADERS });
    rows.push(...(d.data ?? []));
    url = d.next_page_url;
  }
  return computePowerLaw(toLogPoints(rows));
}

const usd = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const pct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

export async function powerlaw() {
  const r = await cached("powerlaw", 60 * 60_000, loadPrices);
  const vsFloor = r.price / r.floor - 1;
  const rel = (line) => (line / r.floor - 1) * 100; // 구간 경계를 카드 값(바닥선 대비 %)의 단위로
  return {
    id: "powerlaw",
    title: "BTC 멱법칙 바닥선 대비",
    value: vsFloor * 100,
    unit: "%",
    decimals: 1,
    details: [
      { label: "기준일", value: r.date },
      { label: "BTC 가격", value: usd(r.price) },
      { label: "바닥선 (1% 분위)", value: usd(r.floor) },
      { label: "지지선 (5% 분위, 산토스타시)", value: `${usd(r.support)} (${pct(r.price / r.support - 1)})` },
      { label: "추세 적정가", value: `${usd(r.fair)} (${(r.price / r.fair).toFixed(2)}배)` },
      {
        label: `${r.from.slice(0, 4)}년 이후 이보다 낮았던 날`,
        value: r.lowerShare > 0 ? `${(r.lowerShare * 100).toFixed(1)}%` : "없음 (역대 최저 위치)",
      },
    ],
    zones: [
      { max: 0, label: "바닥선 이탈", tone: "blue" },
      { max: rel(r.support), label: "매집 구간 (지지선 아래)", tone: "sky" },
      { max: rel(r.fair), label: "추세 아래", tone: "yellow" },
      { max: rel(r.top), label: "추세 위", tone: "orange" },
      { max: null, label: "과열권 (상위 5%)", tone: "red" },
    ],
    source: `CoinMetrics 가격, ${r.from.slice(0, 4)}년~ 분위 회귀 직접 계산 (매일 재계산)`,
    updatedAt: new Date(`${r.date}T00:00:00Z`).toISOString(),
    stale: r.stale,
  };
}
