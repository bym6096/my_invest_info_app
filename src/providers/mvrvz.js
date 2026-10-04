import { getJson, cached } from "../http.js";
import { COINMETRICS_URL, HISTORY_FROM, MVRVZ_META, computeZ, computeZSeries, fromHistoryStart, toTs } from "../../public/zscore.js";

export { computeZ, computeZSeries, fromHistoryStart };

// 1차: bitcoin-data.com (MVRV-Z 직접 제공, 무료 호출 제한 있음)
async function fromBitcoinData() {
  const d = await getJson("https://bitcoin-data.com/v1/mvrv-zscore/last");
  const value = Number(d?.mvrvZscore);
  if (!Number.isFinite(value)) throw new Error("bitcoin-data 응답 형식 오류");
  return { value, date: d.d, source: "bitcoin-data.com" };
}

// 클라우드 IP/비브라우저 UA 를 막는 경우가 있어 일반 브라우저 UA 로 요청한다
const CM_HEADERS = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };

async function coinMetricsRows() {
  const rows = [];
  let url = COINMETRICS_URL;
  for (let i = 0; url && i < 5; i++) {
    const d = await getJson(url, { timeoutMs: 20000, headers: CM_HEADERS });
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

// 시계열: bitcoin-data.com 전체 이력 → 2014년부터 없거나 실패하면 CoinMetrics 로 계산.
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
  let bd, bdErr;
  try {
    bd = await historyFromBitcoinData();
    if (!bd.startsLate) return bd;
  } catch (e) {
    bdErr = e;
  }
  try {
    return await historyFromCoinMetrics();
  } catch (cmErr) {
    // CoinMetrics 가 막혀도 bitcoin-data 데이터가 있으면 (짧더라도) 그것을 보여준다
    if (bd) return { ...bd, partial: true, source: "bitcoin-data.com (2014년 이전 데이터 없음)" };
    throw new Error(`bitcoin-data: ${errMsg(bdErr)} / CoinMetrics: ${errMsg(cmErr)}`);
  }
}

export async function mvrvzHistory() {
  const r = await cached("mvrvz-history", 60 * 60_000, loadMvrvzHistory);
  return { ...MVRVZ_META, points: r.points, source: r.source, partial: r.partial, stale: r.stale };
}
