import { test } from "node:test";
import assert from "node:assert/strict";
import { calcPremium } from "../src/providers/kimchi.js";
import { computeZ } from "../src/providers/mvrvz.js";
import { loadAll } from "../src/server.js";

test("김치프리미엄 계산", () => {
  assert.equal(calcPremium(1400, 1400), 0);
  assert.ok(Math.abs(calcPremium(1442, 1400) - 3) < 1e-9);
  assert.ok(calcPremium(1380, 1400) < 0);
});

test("MVRV-Z 계산: (최종 시총 - 실현시총) / 시총 표준편차", () => {
  const rows = [100, 200, 300, 400].map((m, i) => ({ time: `2020-01-0${i + 1}T00:00:00Z`, CapMrktCurUSD: m, CapRealUSD: 250 }));
  const { value, date } = computeZ(rows);
  const std = Math.sqrt(((150) ** 2 + 50 ** 2 + 50 ** 2 + 150 ** 2) / 4);
  assert.ok(Math.abs(value - 150 / std) < 1e-9);
  assert.equal(date, "2020-01-04");
});

test("지표 하나가 실패해도 나머지는 반환 (네트워크 불가 환경: 전부 error 객체)", async () => {
  const list = await loadAll();
  assert.equal(list.length, 3);
  for (const i of list) assert.ok(i.id && (i.error || i.value !== undefined));
});
