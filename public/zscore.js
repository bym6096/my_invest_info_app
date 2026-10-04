// MVRV-Z 계산 (서버와 브라우저가 함께 쓰는 순수 함수)

// 그래프는 2014-01-01부터 보여준다 (그 이전은 값이 극단적으로 튀어 스케일을 망친다).
// 표준편차는 가장 이른 데이터부터 누적한 값을 쓰고, 표시할 때만 자른다.
export const HISTORY_FROM = Date.UTC(2014, 0, 1) / 1000;
export const fromHistoryStart = (points) => points.filter(([t]) => t >= HISTORY_FROM);

export const toTs = (iso) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 1000;

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

export const COINMETRICS_URL =
  "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc" +
  "&metrics=CapMrktCurUSD,CapRealUSD&frequency=1d&start_time=2010-07-18&page_size=10000";

// 그래프 메타 (카드의 구간 정의와 같은 기준: 0 이하 저평가, 7 이상 극단적 과열)
export const MVRVZ_META = {
  id: "mvrvz",
  decimals: 2,
  refs: [0, 3, 7],
  bands: [
    { to: 0, tone: "blue", label: "저평가" },
    { from: 7, tone: "red", label: "과열" },
  ],
};
