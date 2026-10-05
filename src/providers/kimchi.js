import { getJson, cached } from "../http.js";

// 김치프리미엄 = (업비트 USDT 원화가 / 달러-원 환율 - 1) * 100
async function upbitUsdt() {
  const [t] = await getJson("https://api.upbit.com/v1/ticker?markets=KRW-USDT");
  if (!t?.trade_price) throw new Error("업비트 USDT 시세 없음");
  return t.trade_price;
}

// USD/KRW 환율 소스 (모두 무료·키 불필요). 위에서부터 시도하고 실패하면 다음으로 넘어간다.
// 1) 두나무(업비트 운영사) 외환 시세 — 업비트 앱이 보여주는 환율과 같은 값, 원화 기준 고시환율
// 2) exchangerate.fun — 1시간마다 갱신
// 3) open.er-api.com — 하루 1회 갱신
// 4) frankfurter.app — ECB 일별 기준환율
const FX_SOURCES = [
  {
    name: "Dunamu(업비트) 외환",
    url: "https://quotation-api-cdn.dunamu.com/v1/forex/recent?codes=FRX.KRWUSD",
    parse: (d) => {
      const r = Array.isArray(d) ? d[0] : null;
      const ts = Number(r?.timestamp);
      return { rate: Number(r?.basePrice), asOf: Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : null };
    },
  },
  {
    name: "exchangerate.fun",
    url: "https://api.exchangerate.fun/latest?base=USD",
    parse: (d) => ({ rate: Number(d?.rates?.KRW), asOf: d?.timestamp ? new Date(d.timestamp * 1000).toISOString() : null }),
  },
  {
    name: "open.er-api.com",
    url: "https://open.er-api.com/v6/latest/USD",
    parse: (d) => ({ rate: Number(d?.rates?.KRW), asOf: d?.time_last_update_unix ? new Date(d.time_last_update_unix * 1000).toISOString() : null }),
  },
  {
    name: "frankfurter.app",
    url: "https://api.frankfurter.app/latest?from=USD&to=KRW",
    parse: (d) => ({ rate: Number(d?.rates?.KRW), asOf: d?.date ? `${d.date}T00:00:00.000Z` : null }),
  },
];

// 엉뚱한 값(0, 단위 오류 등)을 걸러내는 상식적 범위
const plausible = (r) => Number.isFinite(r) && r > 500 && r < 5000;

export async function usdKrw(sources = FX_SOURCES) {
  const errors = [];
  for (const src of sources) {
    try {
      const { rate, asOf } = src.parse(await getJson(src.url));
      if (!plausible(rate)) throw new Error("환율 값 이상");
      return { rate, source: src.name, asOf };
    } catch (e) {
      errors.push(`${src.name}: ${e?.message ?? e}`);
    }
  }
  throw new Error(`USD/KRW 환율 조회 실패 (${errors.join(" / ")})`);
}

// 환율 기준 시각을 한국 시간으로, 얼마나 묵은 값인지와 함께 표시한다.
// 6시간 넘게 묵었으면 주말/휴장이거나 소스 갱신이 지연된 것이다.
export function describeFxAge(asOf, now = Date.now()) {
  if (!asOf) return "";
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return "";
  const kst = new Date(t + 9 * 3600_000).toISOString().slice(5, 16).replace("-", "/").replace("T", " ");
  const hours = Math.max(0, (now - t) / 3600_000);
  const age = hours < 1 ? "방금 전" : hours < 48 ? `${Math.floor(hours)}시간 전` : `${Math.floor(hours / 24)}일 전`;
  return `${kst} KST (${age})${hours > 6 ? " · 휴장/지연" : ""}`;
}

export function calcPremium(usdtKrw, fx) {
  return (usdtKrw / fx - 1) * 100;
}

export async function kimchi() {
  const [usdt, fx] = await Promise.all([
    cached("upbit-usdt", 10_000, upbitUsdt),
    cached("usdkrw", 60_000, () => usdKrw()),
  ]);
  const fxRate = fx.rate;
  return {
    id: "kimchi",
    title: "김치프리미엄 (USDT)",
    value: calcPremium(usdt, fxRate),
    unit: "%",
    decimals: 2,
    details: [
      { label: "업비트 USDT", value: `${usdt.toLocaleString("ko-KR")} 원` },
      { label: "USD/KRW 환율", value: `${fxRate.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} 원` },
      { label: "환율 출처", value: fx.source },
      ...(fx.asOf ? [{ label: "환율 시각", value: describeFxAge(fx.asOf) }] : []),
    ],
    // 구간: 음수=역프리미엄, 0~1 정상, 1~3 약간 높음, 3 이상 과열
    zones: [
      { max: 0, label: "역프리미엄", tone: "blue" },
      { max: 1, label: "정상", tone: "green" },
      { max: 3, label: "약간 높음", tone: "yellow" },
      { max: null, label: "과열", tone: "red" },
    ],
    source: `Upbit · ${fx.source}`,
    updatedAt: new Date().toISOString(),
  };
}
