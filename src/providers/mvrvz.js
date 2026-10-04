import { getJson, cached } from "../http.js";

// 1차: bitcoin-data.com (MVRV-Z 직접 제공, 무료 호출 제한 있음)
async function fromBitcoinData() {
  const d = await getJson("https://bitcoin-data.com/v1/mvrv-zscore/last");
  const value = Number(d?.mvrvZscore);
  if (!Number.isFinite(value)) throw new Error("bitcoin-data 응답 형식 오류");
  return { value, date: d.d, source: "bitcoin-data.com" };
}

// 그래프는 2014-01-01부터 보여준다 (그 이전은 값이 극단적으로 튀어 스케일을 망친다).
// 표준편차는 가장 이른 데이터부터 누적한 값을 쓰고, 표시할 때만 자른다.
const HISTORY_FROM = Date.UTC(2014, 0, 1) / 1000;
export const fromHistoryStart = (points) => points.filter(([t]) => t >= HISTORY_FROM);

const toTs = (iso) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 1000;

// MVRV-Z = (시가총액 - 실현시가총액) / 시가총액 표준편차(해당 시점까지의 전체 이력)
// 날짜별 시계열 [{date, value}] 로 계산한다 (표준편차는 Welford 방식으로 누적).
export function computeZSeries(rows) {
  const out = [];
  let n = 0, mean = 0, m2 = 0;
  for (const r of rows) {
    const mc = Number(r.CapMrktCurUSD);
    const rc = Number(r.CapRealUSD);
    if (!Number.isFinite(mc) || !Number.isFinite(rc)) continue;
    n++;
    const d = mc - mean;
    mean += d / n;
    m2 += d * (mc - mean);
    const std = Math.sqrt(m2 / n);
    if (std > 0) out.push({ date: r.time.slice(0, 10), value: (mc - rc) / std });
  }
  return out;
}

export function computeZ(rows) {
  const series = computeZSeries(rows);
  if (!series.length) throw new Error("CoinMetrics 데이터 부족");
  return series[series.length - 1];
}

async function coinMetricsRows() {
  const rows = [];
  let url =
    "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc" +
    "&metrics=CapMrktCurUSD,CapRealUSD&frequency=1d&start_time=2010-07-18&page_size=10000";
  for (let i = 0; url && i < 5; i++) {
    const d = await getJson(url, { timeoutMs: 20000 });
    rows.push(...(d.data ?? []).filter((r) => r.CapMrktCurUSD && r.CapRealUSD));
    url = d.next_page_url;
  }
  return rows;
}

// 2차: CoinMetrics 커뮤니티 API 원데이터로 직접 계산
async function fromCoinMetrics() {
  const z = computeZ(await coinMetricsRows());
  return { ...z, source: "CoinMetrics (직접 계산)" };
}

export async function mvrvz() {
  const r = await cached("mvrvz", 60 * 60_000, async () => {
    try {
      return await fromBitcoinData();
    } catch {
      return await fromCoinMetrics();
    }
  });
  return {
    id: "mvrvz",
    title: "BTC MVRV Z-Score",
    value: r.value,
    unit: "",
    decimals: 2,
    details: [{ label: "기준일", value: r.date ?? "-" }],
    // 통상 해석: 7 이상 고점권, 0 이하 저점권
    zones: [
      { max: 0, label: "저평가 (바닥권)", tone: "blue" },
      { max: 3, label: "중립", tone: "yellow" },
      { max: 7, label: "과열 주의", tone: "orange" },
      { max: null, label: "극단적 과열 (고점권)", tone: "red" },
    ],
    range: [-1, 10],
    source: r.source,
    updatedAt: r.date ? new Date(r.date).toISOString() : new Date().toISOString(),
    stale: r.stale,
  };
}

// 시계열: bitcoin-data.com 전체 이력 → 실패 시 CoinMetrics로 계산. points = [[unixSec, value], ...]
async function historyFromBitcoinData() {
  const rows = await getJson("https://bitcoin-data.com/v1/mvrv-zscore", { timeoutMs: 20000 });
  const points = (Array.isArray(rows) ? rows : [])
    .map((r) => [Number(r.unixTs) || toTs(String(r.d)), Number(r.mvrvZscore)])
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);
  // 2014년 초부터 데이터가 없으면 부족한 소스로 보고 CoinMetrics 계산으로 넘어간다
  if (!points.length || points[0][0] > HISTORY_FROM + 30 * 86400) throw new Error("bitcoin-data 시계열이 2014년 이후부터만 존재");
  return { points: fromHistoryStart(points), source: "bitcoin-data.com" };
}

async function historyFromCoinMetrics() {
  const series = computeZSeries(await coinMetricsRows());
  return { points: fromHistoryStart(series.map((r) => [toTs(r.date), r.value])), source: "CoinMetrics (직접 계산)" };
}

// 그래프에 색을 씌울 구간 (카드의 구간 정의와 같은 기준: 0 이하 저평가, 7 이상 극단적 과열)
const BANDS = [
  { to: 0, tone: "blue", label: "저평가" },
  { from: 7, tone: "red", label: "과열" },
];

export async function mvrvzHistory() {
  const r = await cached("mvrvz-history", 60 * 60_000, async () => {
    try {
      return await historyFromBitcoinData();
    } catch {
      return await historyFromCoinMetrics();
    }
  });
  return { id: "mvrvz", decimals: 2, refs: [0, 3, 7], bands: BANDS, points: r.points, source: r.source, stale: r.stale };
}
