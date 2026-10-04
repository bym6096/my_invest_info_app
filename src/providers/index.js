import { kimchi } from "./kimchi.js";
import { mvrvz } from "./mvrvz.js";
import { fng } from "./fng.js";

// 새 지표 추가: providers/ 에 함수 파일을 만들고 아래 배열에 한 줄 추가하면 된다.
// ttl: CDN/브라우저 캐시 시간(초). 지표가 바뀌는 속도에 맞춘다.
export const providers = [
  { id: "kimchi", title: "김치프리미엄 (USDT)", ttl: 10, load: kimchi },
  { id: "mvrvz", title: "BTC MVRV Z-Score", ttl: 3600, load: mvrvz },
  { id: "fng", title: "Crypto Fear & Greed Index", ttl: 300, load: fng },
];
