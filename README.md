# 내 투자 지표

투자 지표를 한 화면에서 보는 웹앱. 의존성 없는 Node(>=18) 서버 + 정적 프론트.

| 지표 | 계산/출처 |
|---|---|
| 김치프리미엄 | `(업비트 KRW-USDT / USD·KRW 환율 − 1) × 100` — Upbit, open.er-api.com(대체: frankfurter) |
| MVRV Z-Score | bitcoin-data.com (실패 시 CoinMetrics 원데이터로 직접 계산) |
| Fear & Greed | alternative.me |

```
npm start      # http://localhost:3000
npm test
```

## Vercel 배포 (서울 리전)
1. vercel.com에 GitHub로 가입 → Add New → Project → 이 저장소 Import
2. Framework Preset은 `Other`, Build/Output 설정은 비워둔다 (`public/`은 정적 파일로, `api/`는 서버리스 함수로 자동 인식)
3. 함수 실행 지역은 `vercel.json`의 `regions: ["icn1"]`(서울)로 고정되어 있다
4. 배포 후 `https://<프로젝트>.vercel.app` 를 열면 된다

API: `GET /api/indicators`(목록), `GET /api/indicators/<id>`(지표별), `GET /api/history/<id>`(시계열, MVRV-Z·공포탐욕만). 응답은 `s-maxage`로 CDN 캐시된다.
`npm start`로 로컬에서도 같은 API가 동작한다.

## 앱으로 설치 (PWA)
배포된 주소를 안드로이드 크롬에서 열고 메뉴 → "앱 설치"(또는 "홈 화면에 추가"). 아이콘은 `node scripts/make-icons.mjs`로 다시 만들 수 있다.
서비스 워커(`public/sw.js`)가 화면은 캐시 우선, API는 네트워크 우선으로 처리하고 오프라인이면 마지막 값을 "이전 값"으로 표시한다. `sw.js`를 바꿀 때는 `CACHE` 이름의 버전을 올린다.

## 지표 추가
`src/providers/`에 `{id, title, value, unit, decimals, zones, ...}`를 반환하는 함수를 만들고 `src/providers/index.js`에 한 줄 추가하면 카드가 자동으로 생긴다. 지표별 실패는 격리되어 다른 카드에 영향을 주지 않는다.
