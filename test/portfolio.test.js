import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyState, upsertHolding, removeHolding, splitByWeight, weightsByValue, planAllocation,
  applyEntry, undoLast, makeEntry, historyOf, summarize,
} from "../public/portfolio-core.js";

const base = () => {
  let s = emptyState();
  s = upsertHolding(s, { symbol: "btc", quantity: 0.1, cost: 8_000_000 });
  s = upsertHolding(s, { symbol: "ETH", quantity: 2, cost: 5_000_000 });
  return s;
};
const prices = { BTC: 100_000_000, ETH: 5_000_000 }; // BTC 1000만, ETH 1000만 → 50:50

test("정수 분배: 합계가 항상 금액과 정확히 같다", () => {
  const parts = splitByWeight(1_000_001, [{ symbol: "A", weight: 1 }, { symbol: "B", weight: 1 }, { symbol: "C", weight: 1 }]);
  assert.equal(parts.reduce((a, p) => a + p.amount, 0), 1_000_001);
  assert.deepEqual(parts.map((p) => p.amount), [333_334, 333_334, 333_333]);
});

test("비중은 현재 평가금액(수량×현재가) 기준", () => {
  const w = weightsByValue(base().holdings, { BTC: 100_000_000, ETH: 15_000_000 }); // 1000만 : 3000만
  assert.deepEqual(w.map((x) => +x.weight.toFixed(2)), [0.25, 0.75]);
  assert.throws(() => weightsByValue(base().holdings, { BTC: 1 }), /ETH 현재가/);
  assert.throws(() => weightsByValue([], {}), /보유 코인이 없어요/);
});

test("입금 분배 적용: 원금만 늘고 수량은 그대로, 코인별 기록이 입금 배분으로 남는다", () => {
  const s0 = base();
  const plan = planAllocation(s0, 1_000_000, prices);
  const e = makeEntry({ type: "deposit", amount: 1_000_000, mode: "allocated", allocations: plan.map(({ symbol, amount }) => ({ symbol, amount })) });
  const s1 = applyEntry(s0, e);
  assert.equal(s1.holdings[0].cost, 8_500_000);
  assert.equal(s1.holdings[1].cost, 5_500_000);
  assert.equal(s1.holdings[0].quantity, 0.1); // 포지션을 잡은 것처럼 수량을 바꾸지 않는다
  assert.equal(s1.cash, 0);
  assert.deepEqual(historyOf(s1, "BTC").map((h) => [h.type, h.amount]), [["deposit", 500_000]]);
});

test("출금 분배 적용: 원금이 줄고 기록은 음수, 원금보다 많이 빠지면 거부", () => {
  const s0 = base();
  const ok = applyEntry(s0, makeEntry({ type: "withdraw", amount: 1_000_000, mode: "allocated", allocations: [{ symbol: "BTC", amount: 500_000 }, { symbol: "ETH", amount: 500_000 }] }));
  assert.equal(ok.holdings[0].cost, 7_500_000);
  assert.equal(historyOf(ok, "ETH")[0].amount, -500_000);
  assert.throws(
    () => applyEntry(s0, makeEntry({ type: "withdraw", amount: 9_000_000, mode: "allocated", allocations: [{ symbol: "BTC", amount: 9_000_000 }] })),
    /BTC 원금/,
  );
});

test("'아니오' → 미배분 현금으로 보관, 출금은 잔액이 있어야 함", () => {
  const s0 = base();
  const s1 = applyEntry(s0, makeEntry({ type: "deposit", amount: 700_000, mode: "unallocated" }));
  assert.equal(s1.cash, 700_000);
  assert.equal(s1.holdings[0].cost, 8_000_000);
  assert.throws(() => applyEntry(s1, makeEntry({ type: "withdraw", amount: 800_000, mode: "unallocated" })), /부족/);
  assert.equal(applyEntry(s1, makeEntry({ type: "withdraw", amount: 200_000, mode: "unallocated" })).cash, 500_000);
});

test("미배분 현금 분배하기: 자동(비중대로) / 특정 코인", () => {
  let s = applyEntry(base(), makeEntry({ type: "deposit", amount: 700_000, mode: "unallocated" }));
  const plan = planAllocation(s, 400_000, prices);
  s = applyEntry(s, makeEntry({ type: "allocate", amount: 400_000, mode: "auto", allocations: plan.map(({ symbol, amount }) => ({ symbol, amount })) }));
  assert.equal(s.cash, 300_000);
  assert.deepEqual(s.holdings.map((h) => h.cost), [8_200_000, 5_200_000]);
  s = applyEntry(s, makeEntry({ type: "allocate", amount: 300_000, mode: "manual", allocations: [{ symbol: "ETH", amount: 300_000 }] }));
  assert.equal(s.cash, 0);
  assert.equal(s.holdings[1].cost, 5_500_000);
  assert.throws(() => applyEntry(s, makeEntry({ type: "allocate", amount: 1, mode: "manual", allocations: [{ symbol: "ETH", amount: 1 }] })), /부족/);
});

test("마지막 기록 되돌리기: 상태가 원래대로", () => {
  const s0 = base();
  const s1 = applyEntry(s0, makeEntry({ type: "deposit", amount: 700_000, mode: "unallocated" }));
  const s2 = applyEntry(s1, makeEntry({ type: "allocate", amount: 400_000, mode: "manual", allocations: [{ symbol: "BTC", amount: 400_000 }] }));
  assert.deepEqual(undoLast(s2), s1);
  assert.deepEqual(undoLast(s1), s0);
  assert.throws(() => undoLast(s0), /되돌릴 기록이 없어요/);
});

test("입력 검증과 요약", () => {
  assert.throws(() => upsertHolding(emptyState(), { symbol: "비트", quantity: 1, cost: 1 }), /심볼/);
  assert.throws(() => upsertHolding(emptyState(), { symbol: "BTC", quantity: -1, cost: 1 }), /수량/);
  assert.throws(() => applyEntry(base(), makeEntry({ type: "deposit", amount: 10.5, mode: "unallocated" })), /정수/);
  const sum = summarize(base(), prices);
  assert.equal(sum.value, 20_000_000);
  assert.equal(sum.cost, 13_000_000);
  assert.ok(Math.abs(sum.pnlRate - 7 / 13) < 1e-9);
  assert.equal(removeHolding(base(), "BTC").holdings.length, 1);
});
