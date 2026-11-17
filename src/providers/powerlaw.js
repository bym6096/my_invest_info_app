import { getJson, cached } from "../http.js";

// 비트코인 멱법칙 바닥선: log10(가격) = c + k·log10(제네시스 이후 일수)
// - 바닥선(1% 분위): 2011년 이후 날의 1%만 이 선 아래에 있었다
// - 지지선(5% 분위): 산토스타시가 밝힌 지지선 정의(5% 분위 회귀)
// - 적정가: 최소제곱(OLS) 추세선
// 회귀선은 CoinMetrics 일봉(확정 종가)으로 매번 다시 맞추고, 현재 위치는 실시간 가격으로 평가한다.

const GENESIS = Date.UTC(2009, 0, 3) / 1000;
const FIT_FROM = "2011-01-01"; // 2010년은 거래가 얇아 회귀에서 뺀다
const CM_URL =
  "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc" +
  `&metrics=PriceUSD&frequency=1d&start_time=${FIT_FROM}&page_size=10000`;
const CM_HEADERS = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };

export const xAt = (tsSec) => Math.log10((tsSec - GENESIS) / 86400);

// rows: [{time, PriceUSD}] → [{date, x, y}] (x = log10 일수, y = log10 가격)
export function toLogPoints(rows) {
  return rows
    .filter((r) => Number(r.PriceUSD) > 0)
    .map((r) => ({ date: r.time.slice(0, 10), x: xAt(Date.parse(r.time) / 1000), y: Math.log10(Number(r.PriceUSD)) }))
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

// 일봉으로 회귀선을 맞춘 모델. 현재 위치는 positionAt 으로 아무 시점·가격에서나 평가한다.
export function computePowerLaw(pts) {
  if (pts.length < 365) throw new Error("멱법칙 계산용 가격 데이터 부족");
  const floor = quantileFit(pts, 0.01);
  const fits = { floor, support: quantileFit(pts, 0.05), fair: olsFit(pts), top: quantileFit(pts, 0.95) };
  // 바닥선 기준 잔차(오름차순): "이보다 낮았던 날" 비율을 이진 탐색으로 구한다
  const residuals = Float64Array.from(pts, (p) => p.y - (floor.c + floor.k * p.x)).sort();
  const last = pts[pts.length - 1];
  return { fits, residuals, from: pts[0].date, date: last.date, closePrice: 10 ** last.y };
}

export function positionAt(model, price, x) {
  const { fits, residuals } = model;
  const cur = Math.log10(price) - (fits.floor.c + fits.floor.k * x);
  let lo = 0, hi = residuals.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (residuals[mid] < cur) lo = mid + 1; else hi = mid;
  }
  return {
    price,
    floor: lineAt(fits.floor, x),
    support: lineAt(fits.support, x),
    fair: lineAt(fits.fair, x),
    top: lineAt(fits.top, x),
    lowerShare: lo / residuals.length,
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

// 실시간 BTC/USD: Coinbase → Bitstamp → Kraken. 모두 실패하면 null (일봉 종가로 대체).
const LIVE_SOURCES = [
  ["Coinbase", "https://api.coinbase.com/v2/prices/BTC-USD/spot", (d) => d.data?.amount],
  ["Bitstamp", "https://www.bitstamp.net/api/v2/ticker/btcusd/", (d) => d.last],
  ["Kraken", "https://api.kraken.com/0/public/Ticker?pair=XBTUSD", (d) => Object.values(d.result ?? {})[0]?.c?.[0]],
];

export async function livePrice() {
  for (const [source, url, pick] of LIVE_SOURCES) {
    try {
      const price = Number(pick(await getJson(url, { timeoutMs: 5000 })));
      if (price > 0) return { price, source, at: Date.now() };
    } catch {}
  }
  return null;
}

const usd = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const pct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const kst = (ms) => {
  const d = new Date(ms + 9 * 3600_000).toISOString();
  return `${d.slice(5, 7)}/${d.slice(8, 10)} ${d.slice(11, 16)} KST`;
};

export async function powerlaw() {
  const [model, live] = await Promise.all([
    cached("powerlaw", 60 * 60_000, loadPrices),
    cached("btc-usd-live", 60_000, livePrice),
  ]);
  const at = live ? live.at : Date.parse(`${model.date}T00:00:00Z`);
  const r = positionAt(model, live ? live.price : model.closePrice, xAt(at / 1000));
  const rel = (line) => (line / r.floor - 1) * 100; // 구간 경계를 카드 값(바닥선 대비 %)의 단위로
  return {
    id: "powerlaw",
    title: "BTC 멱법칙 바닥선 대비",
    value: (r.price / r.floor - 1) * 100,
    unit: "%",
    decimals: 1,
    details: [
      {
        label: "BTC 가격",
        value: live ? `${usd(r.price)} (${live.source}, ${kst(live.at)})` : `${usd(r.price)} (${model.date} 종가, 실시간 조회 실패)`,
      },
      { label: "바닥선 (1% 분위)", value: usd(r.floor) },
      { label: "지지선 (5% 분위, 산토스타시)", value: `${usd(r.support)} (${pct(r.price / r.support - 1)})` },
      { label: "추세 적정가", value: `${usd(r.fair)} (${(r.price / r.fair).toFixed(2)}배)` },
      {
        label: `${model.from.slice(0, 4)}년 이후 이보다 낮았던 날`,
        value: r.lowerShare > 0 ? `${(r.lowerShare * 100).toFixed(1)}%` : "없음 (역대 최저 위치)",
      },
      { label: "회귀 데이터 (일봉)", value: `${model.from} ~ ${model.date}` },
    ],
    zones: [
      { max: 0, label: "바닥선 이탈", tone: "blue" },
      { max: rel(r.support), label: "매집 구간 (지지선 아래)", tone: "sky" },
      { max: rel(r.fair), label: "추세 아래", tone: "yellow" },
      { max: rel(r.top), label: "추세 위", tone: "orange" },
      { max: null, label: "과열권 (상위 5%)", tone: "red" },
    ],
    source: `CoinMetrics 일봉으로 분위 회귀 직접 계산 · 현재가 ${live ? live.source : "일봉 종가"}`,
    updatedAt: new Date(at).toISOString(),
    stale: model.stale,
  };
}
