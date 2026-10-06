import { getJson, cached } from "../http.js";

// 김치프리미엄 = (업비트 USDT 원화가 / 달러-원 환율 - 1) * 100
async function upbitUsdt() {
  const [t] = await getJson("https://api.upbit.com/v1/ticker?markets=KRW-USDT");
  if (!t?.trade_price) throw new Error("업비트 USDT 시세 없음");
  return t.trade_price;
}

// USD/KRW 환율 소스 (모두 무료·키 불필요). 전부 동시에 조회해서 "가장 최근 시각"의 값을 고른다.
// 시각이 같거나 알 수 없으면 아래 순서가 우선한다.
// 1) 두나무(업비트 운영사) 외환 시세 — 업비트 앱이 보여주는 환율과 같은 값, 비공식 엔드포인트
// 2) Yahoo Finance(KRW=X) — 분 단위 갱신, 비공식 엔드포인트
// 3) exchangerate.fun — 1시간마다 갱신
// 4) open.er-api.com — 하루 1회 갱신 (한국 시간 오전 9시경)
// 5) frankfurter.app — ECB 일별 기준환율
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const FX_SOURCES = [
  {
    name: "Dunamu(업비트) 외환",
    short: "Dunamu",
    url: "https://quotation-api-cdn.dunamu.com/v1/forex/recent?codes=FRX.KRWUSD",
    parse: (d) => {
      const r = Array.isArray(d) ? d[0] : null;
      const ts = Number(r?.timestamp);
      return { rate: Number(r?.basePrice), asOf: Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : null };
    },
  },
  {
    name: "Yahoo Finance",
    short: "Yahoo",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1m&range=1d",
    headers: { "user-agent": BROWSER_UA },
    parse: (d) => {
      const m = d?.chart?.result?.[0]?.meta;
      return { rate: Number(m?.regularMarketPrice), asOf: m?.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null };
    },
  },
  {
    name: "exchangerate.fun",
    short: "fun",
    url: "https://api.exchangerate.fun/latest?base=USD",
    parse: (d) => ({ rate: Number(d?.rates?.KRW), asOf: d?.timestamp ? new Date(d.timestamp * 1000).toISOString() : null }),
  },
  {
    name: "open.er-api.com",
    short: "er-api",
    url: "https://open.er-api.com/v6/latest/USD",
    parse: (d) => ({ rate: Number(d?.rates?.KRW), asOf: d?.time_last_update_unix ? new Date(d.time_last_update_unix * 1000).toISOString() : null }),
  },
  {
    name: "frankfurter.app",
    short: "ECB",
    url: "https://api.frankfurter.app/latest?from=USD&to=KRW",
    parse: (d) => ({ rate: Number(d?.rates?.KRW), asOf: d?.date ? `${d.date}T00:00:00.000Z` : null }),
  },
];

// 엉뚱한 값(0, 단위 오류 등)을 걸러내는 상식적 범위
const plausible = (r) => Number.isFinite(r) && r > 500 && r < 5000;

export async function usdKrw(sources = FX_SOURCES) {
  const results = await Promise.allSettled(
    sources.map(async (src) => {
      const { rate, asOf } = src.parse(await getJson(src.url, { headers: src.headers }));
      if (!plausible(rate)) throw new Error("환율 값 이상");
      return { rate, asOf };
    }),
  );
  const candidates = results.map((r, i) => ({
    name: sources[i].name,
    short: sources[i].short ?? sources[i].name,
    ok: r.status === "fulfilled",
    ...(r.status === "fulfilled" ? r.value : { error: r.reason?.message ?? String(r.reason) }),
  }));
  const ts = (c) => (c.asOf ? Date.parse(c.asOf) : -Infinity);
  const best = candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.ok)
    .sort((a, b) => ts(b.c) - ts(a.c) || a.i - b.i)[0]?.c;
  if (!best) {
    throw new Error(`USD/KRW 환율 조회 실패 (${candidates.map((c) => `${c.name}: ${c.error}`).join(" / ")})`);
  }
  return { rate: best.rate, source: best.name, asOf: best.asOf, candidates };
}

// 소스 비교용 짧은 경과 시간 (예: "방금", "3시간", "2일", 시각 불명은 "?")
export function shortAge(asOf, now = Date.now()) {
  const t = asOf ? Date.parse(asOf) : NaN;
  if (!Number.isFinite(t)) return "?";
  const h = Math.max(0, (now - t) / 3600_000);
  return h < 1 ? "방금" : h < 48 ? `${Math.floor(h)}시간` : `${Math.floor(h / 24)}일`;
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
      { label: "소스별 시각", value: fx.candidates.map((c) => `${c.short} ${c.ok ? shortAge(c.asOf) : "실패"}`).join(" · ") },
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
