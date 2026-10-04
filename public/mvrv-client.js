// 서버(Vercel)에서 CoinMetrics 가 막힐 때, 브라우저가 직접 받아 MVRV-Z 시계열을 계산하는 대체 경로
import { COINMETRICS_URL, MVRVZ_META, computeZSeries, fromHistoryStart, toTs } from "/zscore.js";

const KEY = "mvrvzHistoryV1";
const TTL = 6 * 3600 * 1000;

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && Date.now() - c.at < TTL) return c.data;
  } catch {}
  return null;
}

export async function clientMvrvzHistory() {
  const cached = readCache();
  if (cached) return cached;
  const rows = [];
  let url = COINMETRICS_URL;
  for (let i = 0; url && i < 5; i++) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinMetrics HTTP ${res.status}`);
    const d = await res.json();
    rows.push(...(d.data ?? []).filter((r) => r.CapMrktCurUSD && r.CapRealUSD));
    url = d.next_page_url;
  }
  const points = fromHistoryStart(computeZSeries(rows).map((r) => [toTs(r.date), r.value]));
  if (points.length < 100) throw new Error("CoinMetrics 데이터 부족");
  const data = { ...MVRVZ_META, points, source: "CoinMetrics (브라우저에서 직접 계산)" };
  try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data })); } catch {}
  return data;
}
