import { test } from "node:test";
import assert from "node:assert/strict";
import { calcPremium } from "../src/providers/kimchi.js";
import { computeZ, computeZSeries } from "../src/providers/mvrvz.js";
import { getHistory, getIndicator, listIndicators } from "../src/api.js";

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

test("MVRV-Z 시계열: 시점별 누적 표준편차, 마지막 값은 computeZ와 일치", () => {
  const rows = [100, 200, 300, 400].map((m, i) => ({ time: `2020-01-0${i + 1}T00:00:00Z`, CapMrktCurUSD: m, CapRealUSD: 250 }));
  const series = computeZSeries(rows);
  assert.equal(series.length, 3); // 첫 점은 표준편차 0 이라 제외
  assert.equal(series[0].date, "2020-01-02");
  // 2번째 점: mc=200, 표본 [100,200] 의 표준편차 50 → (200-250)/50 = -1
  assert.ok(Math.abs(series[0].value - -1) < 1e-9);
  assert.ok(Math.abs(series.at(-1).value - computeZ(rows).value) < 1e-9);
});

test("공포탐욕 시계열: 오름차순 정렬, kimchi 는 시계열 없음", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [{ timestamp: "200", value: "50" }, { timestamp: "100", value: "20" }] }),
  });
  try {
    const r = await getHistory("fng");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.points, [[100, 20], [200, 50]]);
    assert.match(r.headers["cache-control"], /s-maxage=900/);
    assert.equal((await getHistory("kimchi")).status, 404);
    assert.deepEqual(r.body.bands.map((b) => b.label), ["극단적 공포", "극단적 탐욕"]);
  } finally {
    globalThis.fetch = orig;
  }
});

test("목록에 history 플래그 포함", () => {
  const m = Object.fromEntries(listIndicators().body.map((x) => [x.id, x.history]));
  assert.deepEqual(m, { kimchi: false, mvrvz: true, fng: true });
});
