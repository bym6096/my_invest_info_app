import { getJson, cached } from "../http.js";

// 업비트 원화(KRW) 시장 현재가. 심볼 목록 → { prices: {BTC: 원}, unknown: [업비트 원화마켓에 없는 심볼] }
const SYMBOL = /^[A-Z0-9]{1,10}$/;
const MAX_SYMBOLS = 30;

async function krwMarkets() {
  return cached("upbit-markets", 60 * 60_000, async () => {
    const all = await getJson("https://api.upbit.com/v1/market/all");
    return { set: new Set(all.map((m) => m.market).filter((m) => m.startsWith("KRW-"))) };
  });
}

export async function getPrices(symbols) {
  const list = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
  if (!list.length) return { prices: {}, unknown: [], updatedAt: new Date().toISOString() };
  if (list.length > MAX_SYMBOLS || !list.every((s) => SYMBOL.test(s))) throw new Error("심볼 형식이 올바르지 않아요");
  const { set } = await krwMarkets();
  const known = list.filter((s) => set.has(`KRW-${s}`));
  const unknown = list.filter((s) => !set.has(`KRW-${s}`));
  const prices = {};
  if (known.length) {
    const markets = known.map((s) => `KRW-${s}`).join(",");
    const tickers = await cached(`ticker:${markets}`, 5_000, async () => ({
      rows: await getJson(`https://api.upbit.com/v1/ticker?markets=${markets}`),
    }));
    for (const t of tickers.rows) prices[t.market.slice(4)] = t.trade_price;
  }
  return { prices, unknown, updatedAt: new Date().toISOString() };
}
