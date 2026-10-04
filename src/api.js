import { providers } from "./providers/index.js";

// 로컬 서버와 Vercel 함수가 함께 쓰는 API 로직. { status, headers, body } 반환.
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export function listIndicators() {
  return {
    status: 200,
    headers: { ...JSON_HEADERS, "cache-control": "public, max-age=0, s-maxage=3600" },
    body: providers.map(({ id, title, history }) => ({ id, title, history: Boolean(history) })),
  };
}

export async function getIndicator(id) {
  const p = providers.find((x) => x.id === id);
  if (!p) return { status: 404, headers: JSON_HEADERS, body: { id, error: "알 수 없는 지표" } };
  try {
    const body = await p.load();
    // 실패(스테일 포함 아님)는 캐시하지 않고, 성공은 CDN에 두었다가 갱신 중에도 이전 값을 즉시 제공
    const cc = `public, max-age=0, s-maxage=${p.ttl}, stale-while-revalidate=${p.ttl * 5}`;
    return { status: 200, headers: { ...JSON_HEADERS, "cache-control": cc }, body };
  } catch (err) {
    return {
      status: 502,
      headers: { ...JSON_HEADERS, "cache-control": "no-store" },
      body: { id, title: p.title, error: err?.message ?? String(err) },
    };
  }
}

export async function getHistory(id) {
  const p = providers.find((x) => x.id === id);
  if (!p?.history) return { status: 404, headers: JSON_HEADERS, body: { id, error: "시계열 없음" } };
  try {
    const body = await p.history();
    const cc = `public, max-age=0, s-maxage=${p.historyTtl}, stale-while-revalidate=${p.historyTtl * 6}`;
    return { status: 200, headers: { ...JSON_HEADERS, "cache-control": cc }, body };
  } catch (err) {
    return {
      status: 502,
      headers: { ...JSON_HEADERS, "cache-control": "no-store" },
      body: { id, error: err?.message ?? String(err) },
    };
  }
}
