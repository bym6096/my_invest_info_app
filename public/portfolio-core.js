// 포트폴리오 계산 로직 (순수 함수, 브라우저/Node 공용)
//
// 상태: { v, holdings: [{symbol, quantity, cost}], cash, ledger: [entry] }
//  - quantity: 보유 수량(코인 개수), cost: 투자원금(KRW), cash: 미배분 현금(KRW)
// 입출금은 매수/매도가 아니라 "원금 증감 기록"이다. 수량은 절대 바뀌지 않는다.
//
// entry: { id, ts, type: "deposit"|"withdraw"|"allocate", amount, mode, allocations: [{symbol, amount}], note }
//  - deposit  + allocated   : 각 코인 원금 +, 미배분 현금 변화 없음
//  - deposit  + unallocated : 미배분 현금 +
//  - withdraw + allocated   : 각 코인 원금 -
//  - withdraw + unallocated : 미배분 현금 - (잔액 부족이면 불가)
//  - allocate (auto|manual) : 미배분 현금 -, 각 코인 원금 +

export const emptyState = () => ({ v: 1, holdings: [], cash: 0, ledger: [] });

const clone = (s) => JSON.parse(JSON.stringify(s));

export function normalizeSymbol(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(s)) throw new Error("코인 심볼은 영문/숫자 10자 이내로 입력해 주세요 (예: BTC)");
  return s;
}

export function upsertHolding(state, { symbol, quantity, cost }) {
  const sym = normalizeSymbol(symbol);
  const q = Number(quantity), c = Number(cost);
  if (!Number.isFinite(q) || q < 0) throw new Error("수량은 0 이상의 숫자여야 해요");
  if (!Number.isFinite(c) || c < 0) throw new Error("투자원금은 0 이상의 숫자여야 해요");
  const next = clone(state);
  const h = next.holdings.find((x) => x.symbol === sym);
  if (h) { h.quantity = q; h.cost = c; } else next.holdings.push({ symbol: sym, quantity: q, cost: c });
  return next;
}

export function removeHolding(state, symbol) {
  const next = clone(state);
  next.holdings = next.holdings.filter((h) => h.symbol !== symbol);
  return next;
}

// 합계가 정확히 amount 가 되도록 정수(원) 단위로 비례 분배 (최대 잔여분 방식)
export function splitByWeight(amount, weights) {
  const total = weights.reduce((a, w) => a + w.weight, 0);
  if (!(total > 0)) throw new Error("분배할 비중이 없어요");
  const raw = weights.map((w) => ({ symbol: w.symbol, exact: (amount * w.weight) / total }));
  const out = raw.map((r) => ({ symbol: r.symbol, amount: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let rest = amount - out.reduce((a, o) => a + o.amount, 0);
  [...out.keys()].sort((a, b) => out[b].frac - out[a].frac || a - b).forEach((i) => { if (rest > 0) { out[i].amount += 1; rest--; } });
  return out.map(({ symbol, amount: a }) => ({ symbol, amount: a }));
}

// 현재 평가금액(수량 × 현재가) 기준 비중
export function weightsByValue(holdings, prices) {
  if (!holdings.length) throw new Error("등록된 보유 코인이 없어요");
  const rows = holdings.map((h) => {
    const p = Number(prices?.[h.symbol]);
    if (!Number.isFinite(p) || p <= 0) throw new Error(`${h.symbol} 현재가를 가져오지 못했어요`);
    return { symbol: h.symbol, value: h.quantity * p };
  });
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (!(total > 0)) throw new Error("평가금액이 0원이라 비중을 계산할 수 없어요");
  return rows.map((r) => ({ symbol: r.symbol, value: r.value, weight: r.value / total }));
}

// 금액을 현재 평가금액 비중대로 나눈 결과 미리보기 (상태는 바꾸지 않음)
export function planAllocation(state, amount, prices) {
  const w = weightsByValue(state.holdings, prices);
  const parts = splitByWeight(amount, w);
  return w.map((x, i) => ({ symbol: x.symbol, weight: x.weight, amount: parts[i].amount }));
}

const ensureAmount = (a) => {
  if (!Number.isInteger(a) || a <= 0) throw new Error("금액은 1원 이상의 정수여야 해요");
};

// entry 를 적용한 새 상태를 돌려준다. 불가능하면 Error.
export function applyEntry(state, entry) {
  ensureAmount(entry.amount);
  const next = clone(state);
  const costOf = (sym) => {
    const h = next.holdings.find((x) => x.symbol === sym);
    if (!h) throw new Error(`${sym} 은(는) 보유 코인에 없어요`);
    return h;
  };
  const sum = (entry.allocations ?? []).reduce((a, x) => a + x.amount, 0);
  const needAlloc = entry.type === "allocate" || entry.mode === "allocated";
  if (needAlloc && sum !== entry.amount) throw new Error("분배 합계가 금액과 달라요");

  if (entry.type === "deposit") {
    if (entry.mode === "allocated") for (const a of entry.allocations) costOf(a.symbol).cost += a.amount;
    else next.cash += entry.amount;
  } else if (entry.type === "withdraw") {
    if (entry.mode === "allocated") {
      for (const a of entry.allocations) {
        const h = costOf(a.symbol);
        if (h.cost - a.amount < 0) throw new Error(`${a.symbol} 원금(${h.cost.toLocaleString("ko-KR")}원)보다 많이 빠져서 적용할 수 없어요`);
        h.cost -= a.amount;
      }
    } else {
      if (next.cash < entry.amount) throw new Error(`미배분 현금(${next.cash.toLocaleString("ko-KR")}원)이 부족해요`);
      next.cash -= entry.amount;
    }
  } else if (entry.type === "allocate") {
    if (next.cash < entry.amount) throw new Error(`미배분 현금(${next.cash.toLocaleString("ko-KR")}원)이 부족해요`);
    next.cash -= entry.amount;
    for (const a of entry.allocations) costOf(a.symbol).cost += a.amount;
  } else {
    throw new Error("알 수 없는 기록 종류");
  }
  next.ledger.push(entry);
  return next;
}

// 가장 최근 기록 하나를 되돌린다.
export function undoLast(state) {
  const entry = state.ledger.at(-1);
  if (!entry) throw new Error("되돌릴 기록이 없어요");
  const next = clone(state);
  next.ledger.pop();
  const h = (sym) => next.holdings.find((x) => x.symbol === sym);
  const minus = (a) => {
    const x = h(a.symbol);
    if (!x) return; // 이미 삭제된 코인은 건너뜀
    if (x.cost - a.amount < 0) throw new Error(`${a.symbol} 원금이 모자라 되돌릴 수 없어요`);
    x.cost -= a.amount;
  };
  const plus = (a) => { const x = h(a.symbol); if (x) x.cost += a.amount; };
  if (entry.type === "deposit") {
    if (entry.mode === "allocated") entry.allocations.forEach(minus);
    else {
      if (next.cash < entry.amount) throw new Error("미배분 현금이 모자라 되돌릴 수 없어요");
      next.cash -= entry.amount;
    }
  } else if (entry.type === "withdraw") {
    if (entry.mode === "allocated") entry.allocations.forEach(plus);
    else next.cash += entry.amount;
  } else if (entry.type === "allocate") {
    entry.allocations.forEach(minus);
    next.cash += entry.amount;
  }
  return next;
}

export function makeEntry({ type, amount, mode, allocations = [], note = "" }, now = Date.now()) {
  return { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, ts: now, type, amount, mode, allocations, note: String(note).slice(0, 60) };
}

// 코인별 기록 (그 코인에 영향을 준 기록만)
export function historyOf(state, symbol) {
  return state.ledger
    .map((e) => ({ e, a: (e.allocations ?? []).find((x) => x.symbol === symbol) }))
    .filter(({ a }) => a)
    .map(({ e, a }) => ({ ts: e.ts, type: e.type, amount: e.type === "withdraw" ? -a.amount : a.amount, note: e.note }))
    .reverse();
}

export function summarize(state, prices) {
  let value = 0, cost = 0;
  const rows = state.holdings.map((h) => {
    const p = Number(prices?.[h.symbol]);
    const v = Number.isFinite(p) ? h.quantity * p : null;
    if (v !== null) value += v;
    cost += h.cost;
    return { ...h, price: Number.isFinite(p) ? p : null, value: v };
  });
  const priced = rows.filter((r) => r.value !== null);
  rows.forEach((r) => { r.weight = r.value !== null && value > 0 ? r.value / value : null; });
  const costPriced = priced.reduce((a, r) => a + r.cost, 0);
  return { rows, value, cost, pnl: value - costPriced, pnlRate: costPriced > 0 ? (value - costPriced) / costPriced : null, complete: priced.length === rows.length };
}
