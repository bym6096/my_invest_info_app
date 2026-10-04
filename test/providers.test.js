import { test } from "node:test";
import assert from "node:assert/strict";
import { calcPremium } from "../src/providers/kimchi.js";
import { computeZ } from "../src/providers/mvrvz.js";
import { getIndicator, listIndicators } from "../src/api.js";

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

test("지표 목록과 알 수 없는 id 처리", async () => {
  assert.deepEqual(listIndicators().body.map((x) => x.id), ["kimchi", "mvrvz", "fng"]);
  const r = await getIndicator("nope");
  assert.equal(r.status, 404);
});

test("외부 API 실패는 502 + no-store 로 격리", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  try {
    const r = await getIndicator("fng");
    assert.equal(r.status, 502);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.ok(r.body.error);
  } finally {
    globalThis.fetch = orig;
  }
});

test("성공 시 CDN 캐시 헤더 (mock)", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [{ value: "30", value_classification: "Fear", timestamp: "1700000000" }] }),
  });
  try {
    const r = await getIndicator("fng");
    assert.equal(r.status, 200);
    assert.equal(r.body.value, 30);
    assert.match(r.headers["cache-control"], /s-maxage=300/);
  } finally {
    globalThis.fetch = orig;
  }
});
