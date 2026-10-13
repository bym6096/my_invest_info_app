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

## 포트폴리오 (보유 코인·입출금 기록)
`#portfolio` 탭. 데이터는 **이 기기의 브라우저(localStorage)에만** 저장된다(기기 간 동기화 없음).
- 보유 코인: 심볼, 수량, 투자원금(원). 평가금액은 업비트 원화 현재가(`/api/prices`) × 수량.
- 입출금 기록: 금액을 넣으면 "보유 코인의 현재 평가금액 비중대로 분배해서 반영할까요?"를 묻는다.
  - 예: 각 코인의 **투자원금만** 비중대로 증감하고, 코인별 기록에 "입금 배분/출금 배분"으로 남긴다. **수량은 바뀌지 않는다**(매수·매도로 처리하지 않음).
  - 아니오: 입금은 **미배분 현금**에 쌓고, 출금은 미배분 현금에서 뺀다(잔액 부족이면 불가).
- 미배분 현금 → "분배하기": 코인별 비율(현재 평가금액 비중)로 자동 분배하거나 특정 코인에 지정.
- 분배 출금으로 어떤 코인의 원금이 0 미만이 되면 적용하지 않고 이유를 알려준다. 마지막 기록 하나는 되돌릴 수 있다.
- 계산 로직은 `public/portfolio-core.js`(순수 함수, `test/portfolio.test.js`).

## 지표 추가
`src/providers/`에 `{id, title, value, unit, decimals, zones, ...}`를 반환하는 함수를 만들고 `src/providers/index.js`에 한 줄 추가하면 카드가 자동으로 생긴다. 지표별 실패는 격리되어 다른 카드에 영향을 주지 않는다.
