import { getJson, cached } from "../http.js";

// 1차: bitcoin-data.com (MVRV-Z 직접 제공, 무료 호출 제한 있음)
async function fromBitcoinData() {
  const d = await getJson("https://bitcoin-data.com/v1/mvrv-zscore/last");
  const value = Number(d?.mvrvZscore);
  if (!Number.isFinite(value)) throw new Error("bitcoin-data 응답 형식 오류");
  return { value, date: d.d, source: "bitcoin-data.com" };
}

// MVRV-Z = (시가총액 - 실현시가총액) / 시가총액 표준편차(전체 이력)
export function computeZ(rows) {
  const mc = rows.map((r) => Number(r.CapMrktCurUSD));
  const last = rows[rows.length - 1];
  const rc = Number(last.CapRealUSD);
  if (!mc.length || !Number.isFinite(rc)) throw new Error("CoinMetrics 데이터 부족");
  const mean = mc.reduce((a, b) => a + b, 0) / mc.length;
  const std = Math.sqrt(mc.reduce((a, b) => a + (b - mean) ** 2, 0) / mc.length);
  return { value: (mc[mc.length - 1] - rc) / std, date: last.time.slice(0, 10) };
}

// 2차: CoinMetrics 커뮤니티 API 원데이터로 직접 계산
async function fromCoinMetrics() {
  const rows = [];
  let url =
    "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc" +
    "&metrics=CapMrktCurUSD,CapRealUSD&frequency=1d&start_time=2011-01-01&page_size=10000";
  for (let i = 0; url && i < 5; i++) {
    const d = await getJson(url, { timeoutMs: 20000 });
    rows.push(...(d.data ?? []).filter((r) => r.CapMrktCurUSD && r.CapRealUSD));
    url = d.next_page_url;
  }
  const z = computeZ(rows);
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
      { max: 0, label: "저평가 (바닥권)", tone: "green" },
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
