import { kimchi } from "./kimchi.js";
import { mvrvz, mvrvzHistory } from "./mvrvz.js";
import { fng, fngHistory } from "./fng.js";

// 새 지표 추가: providers/ 에 함수 파일을 만들고 아래 배열에 한 줄 추가하면 된다.
// ttl: CDN/브라우저 캐시 시간(초). history: 시계열 함수(선택, 있으면 카드에 그래프가 붙는다).
export const providers = [
  { id: "kimchi", title: "김치프리미엄 (USDT)", ttl: 10, load: kimchi },
  { id: "mvrvz", title: "BTC MVRV Z-Score", ttl: 3600, load: mvrvz, history: mvrvzHistory, historyTtl: 1800 },
  { id: "fng", title: "Crypto Fear & Greed Index", ttl: 300, load: fng, history: fngHistory, historyTtl: 900 },
];
