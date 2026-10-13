import { getJson, cached } from "../http.js";
import { COINMETRICS_URL, HISTORY_FROM, MVRVZ_META, computeZ, computeZSeries, fromHistoryStart, toTs, usableRow } from "../../public/zscore.js";

export { computeZ, computeZSeries, fromHistoryStart };

// 클라우드 IP/비브라우저 UA 를 막는 경우가 있어 일반 브라우저 UA 로 요청한다
const CM_HEADERS = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };

async function coinMetricsRows() {
  const rows = [];
  let url = COINMETRICS_URL;
  for (let i = 0; url && i < 5; i++) {
    const d = await getJson(url, { timeoutMs: 20000, headers: CM_HEADERS });
    rows.push(...(d.data ?? []).filter(usableRow));
    url = d.next_page_url;
  }
  return rows;
}

const fmtDate = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

// 카드의 현재 값은 그래프와 같은 시계열의 마지막 점이다 (두 숫자가 항상 일치).
export async function mvrvz() {
  const r = await cached("mvrvz-history", 60 * 60_000, loadMvrvzHistory);
  const [ts, value] = r.points[r.points.length - 1];
  return {
    id: "mvrvz",
    title: "BTC MVRV Z-Score",
    value,
    unit: "",
    decimals: 2,
    details: [{ label: "기준일", value: fmtDate(ts) }],
    // 통상 해석: 7 이상 고점권, 0 이하 저점권
    zones: [
      { max: 0, label: "저평가 (바닥권)", tone: "blue" },
      { max: 3, label: "중립", tone: "yellow" },
      { max: 7, label: "과열 주의", tone: "orange" },
      { max: null, label: "극단적 과열 (고점권)", tone: "red" },
    ],
    range: [-1, 10],
    source: r.source,
    updatedAt: new Date(ts * 1000).toISOString(),
    stale: r.stale,
  };
}

// 시계열: CoinMetrics 원데이터로 계산(2014~, bitcoin-data.com 과 평균 오차 0.01 미만) → 실패하면 bitcoin-data.com 이력.
// points = [[unixSec, value], ...]
async function historyFromBitcoinData() {
  const rows = await getJson("https://bitcoin-data.com/v1/mvrv-zscore", { timeoutMs: 20000 });
  const points = (Array.isArray(rows) ? rows : [])
    .map((r) => [Number(r.unixTs) || toTs(String(r.d)), Number(r.mvrvZscore)])
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);
  if (!points.length) throw new Error("bitcoin-data 시계열 데이터 없음");
  return {
    points: fromHistoryStart(points),
    // 2014년 초 이전 데이터가 없는 소스는 CoinMetrics 가 되면 그쪽을 우선한다
    startsLate: points[0][0] > HISTORY_FROM + 30 * 86400,
    source: "bitcoin-data.com",
  };
}

async function historyFromCoinMetrics() {
  const series = computeZSeries(await coinMetricsRows());
  return { points: fromHistoryStart(series.map((r) => [toTs(r.date), r.value])), source: "CoinMetrics (직접 계산)" };
}

const errMsg = (e) => e?.message ?? String(e);

export async function loadMvrvzHistory() {
  let cmErr;
  try {
    return await historyFromCoinMetrics();
  } catch (e) {
    cmErr = e;
  }
  try {
    const bd = await historyFromBitcoinData();
    // bitcoin-data 무료 이력은 최근 4년뿐이라 2014년부터가 아니면 부분 데이터로 표시한다
    return bd.startsLate ? { ...bd, partial: true, source: "bitcoin-data.com (2014년 이전 데이터 없음)" } : bd;
  } catch (bdErr) {
    throw new Error(`CoinMetrics: ${errMsg(cmErr)} / bitcoin-data: ${errMsg(bdErr)}`);
  }
}

export async function mvrvzHistory() {
  const r = await cached("mvrvz-history", 60 * 60_000, loadMvrvzHistory);
  return { ...MVRVZ_META, points: r.points, source: r.source, partial: r.partial, stale: r.stale };
}
