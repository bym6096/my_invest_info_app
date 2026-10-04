import { kimchi } from "./kimchi.js";
import { mvrvz } from "./mvrvz.js";
import { fng } from "./fng.js";

// 새 지표 추가: providers/ 에 함수 파일을 만들고 아래 배열에 한 줄 추가하면 된다.
export const providers = [
  { id: "kimchi", load: kimchi },
  { id: "mvrvz", load: mvrvz },
  { id: "fng", load: fng },
];
