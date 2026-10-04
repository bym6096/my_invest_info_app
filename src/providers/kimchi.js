import { getJson, cached } from "../http.js";

// 김치프리미엄 = (업비트 USDT 원화가 / 달러-원 환율 - 1) * 100
async function upbitUsdt() {
  const [t] = await getJson("https://api.upbit.com/v1/ticker?markets=KRW-USDT");
  if (!t?.trade_price) throw new Error("업비트 USDT 시세 없음");
  return t.trade_price;
}

async function usdKrw() {
  try {
    const d = await getJson("https://open.er-api.com/v6/latest/USD");
    if (d?.rates?.KRW) return { rate: d.rates.KRW, source: "open.er-api.com" };
  } catch {
    /* 아래 대체 소스 사용 */
  }
  const d = await getJson("https://api.frankfurter.app/latest?from=USD&to=KRW");
  if (!d?.rates?.KRW) throw new Error("USD/KRW 환율 없음");
  return { rate: d.rates.KRW, source: "frankfurter.app" };
}

export function calcPremium(usdtKrw, fx) {
  return (usdtKrw / fx - 1) * 100;
}

export async function kimchi() {
  const [usdt, fx] = await Promise.all([
    cached("upbit-usdt", 10_000, upbitUsdt),
    cached("usdkrw", 10 * 60_000, usdKrw),
  ]);
  const fxRate = fx.rate ?? fx;
  return {
    id: "kimchi",
    title: "김치프리미엄 (USDT)",
    value: calcPremium(usdt, fxRate),
    unit: "%",
    decimals: 2,
    details: [
      { label: "업비트 USDT", value: `${usdt.toLocaleString("ko-KR")} 원` },
      { label: "USD/KRW 환율", value: `${fxRate.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} 원` },
    ],
    // 구간: 음수=역프리미엄, 0~1 정상, 1~3 약간 높음, 3 이상 과열
    zones: [
      { max: 0, label: "역프리미엄", tone: "blue" },
      { max: 1, label: "정상", tone: "green" },
      { max: 3, label: "약간 높음", tone: "yellow" },
      { max: null, label: "과열", tone: "red" },
    ],
    source: `Upbit · ${fx.source ?? "FX"}`,
    updatedAt: new Date().toISOString(),
  };
}
