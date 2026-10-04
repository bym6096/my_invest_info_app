// 외부 API 호출 공통 유틸: 타임아웃 + JSON 파싱 + 간단한 TTL 캐시
export async function getJson(url, { timeoutMs = 10000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "my-invest-info-app", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} 응답 오류 (HTTP ${res.status})`);
  return res.json();
}

const cache = new Map();

// 성공값을 ttl 동안 재사용. 갱신 실패 시 staleTtl 이내의 이전 값을 반환(stale: true).
export async function cached(key, ttlMs, loader, staleTtlMs = ttlMs * 10) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value;
  try {
    const value = await loader();
    cache.set(key, { at: now, value });
    return value;
  } catch (err) {
    if (hit && now - hit.at < staleTtlMs) return { ...hit.value, stale: true };
    throw err;
  }
}

export function clearCache() {
  cache.clear();
}
