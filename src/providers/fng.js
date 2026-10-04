import { getJson, cached } from "../http.js";

const LABELS = {
  "Extreme Fear": "극단적 공포",
  Fear: "공포",
  Neutral: "중립",
  Greed: "탐욕",
  "Extreme Greed": "극단적 탐욕",
};

export async function fng() {
  const d = await cached("fng", 5 * 60_000, () => getJson("https://api.alternative.me/fng/?limit=2"));
  const [now, prev] = d.data ?? [];
  if (!now) throw new Error("공포탐욕지수 데이터 없음");
  const value = Number(now.value);
  return {
    id: "fng",
    title: "Crypto Fear & Greed Index",
    value,
    unit: "",
    decimals: 0,
    details: [
      { label: "분류", value: LABELS[now.value_classification] ?? now.value_classification },
      ...(prev ? [{ label: "전일", value: String(Number(prev.value)) }] : []),
    ],
    zones: [
      { max: 25, label: "극단적 공포", tone: "red" },
      { max: 45, label: "공포", tone: "orange" },
      { max: 55, label: "중립", tone: "yellow" },
      { max: 75, label: "탐욕", tone: "lime" },
      { max: null, label: "극단적 탐욕", tone: "green" },
    ],
    range: [0, 100],
    source: "alternative.me",
    updatedAt: new Date(Number(now.timestamp) * 1000).toISOString(),
    stale: d.stale,
  };
}

// 전체 이력(2018~). alternative.me 는 최신순으로 주므로 뒤집는다.
export async function fngHistory() {
  const d = await cached("fng-history", 30 * 60_000, () => getJson("https://api.alternative.me/fng/?limit=0"));
  const points = (d.data ?? [])
    .map((r) => [Number(r.timestamp), Number(r.value)])
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);
  if (!points.length) throw new Error("공포탐욕지수 이력 없음");
  return { id: "fng", decimals: 0, refs: [25, 75], points, source: "alternative.me", stale: d.stale };
}
