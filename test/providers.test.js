import { test } from "node:test";
import assert from "node:assert/strict";
import { calcPremium, describeFxAge, usdKrw } from "../src/providers/kimchi.js";
import { computeZ, computeZSeries, fromHistoryStart, loadMvrvzHistory } from "../src/providers/mvrvz.js";
import { realizedCap } from "../public/zscore.js";
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

test("MVRV-Z 시계열은 2014-01-01부터만 표시", () => {
  const ts = (d) => Date.parse(`${d}T00:00:00Z`) / 1000;
  const pts = [[ts("2013-12-31"), 9], [ts("2014-01-01"), 5], [ts("2020-01-01"), 2]];
  assert.deepEqual(fromHistoryStart(pts).map((p) => p[1]), [5, 2]);
});

test("MVRV-Z 이력: 두 소스가 모두 실패하면 두 사유를 함께 보고", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: false, status: String(url).includes("coinmetrics") ? 403 : 429 });
  try {
    await assert.rejects(loadMvrvzHistory(), /bitcoin-data.*429.*CoinMetrics.*403/s);
  } finally {
    globalThis.fetch = orig;
  }
});

test("MVRV-Z 이력: bitcoin-data 가 2014년 이후부터만 있고 CoinMetrics 가 막히면 있는 데이터로 표시", async () => {
  const orig = globalThis.fetch;
  const rows = Array.from({ length: 200 }, (_, i) => ({ unixTs: String(1500000000 + i * 86400), mvrvZscore: String(i / 100) }));
  globalThis.fetch = async (url) =>
    String(url).includes("coinmetrics") ? { ok: false, status: 403 } : { ok: true, json: async () => rows };
  try {
    const r = await loadMvrvzHistory();
    assert.equal(r.points.length, 200);
    assert.match(r.source, /2014년 이전 데이터 없음/);
  } finally {
    globalThis.fetch = orig;
  }
});

test("실현시가총액은 CapRealUSD 가 없으면 시가총액 / MVRV 비율로 역산", () => {
  assert.equal(realizedCap({ CapMrktCurUSD: "300", CapMVRVCur: "1.5" }), 200);
  assert.equal(realizedCap({ CapMrktCurUSD: "300", CapRealUSD: "250", CapMVRVCur: "1.5" }), 250);
  const rows = [100, 200, 300, 400].map((m, i) => ({ time: `2020-01-0${i + 1}T00:00:00Z`, CapMrktCurUSD: m, CapMVRVCur: m / 250 }));
  const viaRatio = computeZSeries(rows).at(-1).value;
  const viaCap = computeZSeries(rows.map((r) => ({ ...r, CapRealUSD: 250 }))).at(-1).value;
  assert.ok(Math.abs(viaRatio - viaCap) < 1e-9);
});

function mockFetch(routes) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k));
    if (!hit || hit[1] === null) return { ok: false, status: 500 };
    return { ok: true, json: async () => hit[1] };
  };
  return () => { globalThis.fetch = orig; };
}

test("환율: 두나무 외환을 1순위로 사용", async () => {
  const restore = mockFetch({ "dunamu.com": [{ basePrice: 1350.5, timestamp: 1759500000000 }], "exchangerate.fun": { rates: { KRW: 1300 } } });
  try {
    const r = await usdKrw();
    assert.equal(r.rate, 1350.5);
    assert.match(r.source, /Dunamu/);
    assert.equal(r.asOf, new Date(1759500000000).toISOString());
  } finally { restore(); }
});

test("환율: 1순위 실패/이상값이면 다음 소스로 폴백", async () => {
  const restore = mockFetch({ "dunamu.com": [{ basePrice: 0 }], "exchangerate.fun": { timestamp: 1759500000, rates: { KRW: 1349.9 } } });
  try {
    const r = await usdKrw();
    assert.equal(r.rate, 1349.9);
    assert.equal(r.source, "exchangerate.fun");
  } finally { restore(); }
});

test("환율: 모든 소스 실패 시 사유를 모아서 오류", async () => {
  const restore = mockFetch({});
  try {
    await assert.rejects(usdKrw(), /Dunamu.*exchangerate\.fun.*open\.er-api.*frankfurter/s);
  } finally { restore(); }
});

test("환율 시각: KST 변환과 경과 시간, 6시간 초과 시 휴장/지연 표시", () => {
  const asOf = "2026-10-02T06:30:00.000Z"; // KST 10/02 15:30
  assert.equal(describeFxAge(asOf, Date.parse("2026-10-02T06:40:00Z")), "10/02 15:30 KST (방금 전)");
  assert.equal(describeFxAge(asOf, Date.parse("2026-10-02T09:40:00Z")), "10/02 15:30 KST (3시간 전)");
  assert.equal(describeFxAge(asOf, Date.parse("2026-10-04T06:30:00Z")), "10/02 15:30 KST (2일 전) · 휴장/지연");
  assert.equal(describeFxAge(null), "");
});
