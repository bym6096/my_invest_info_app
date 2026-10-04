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

## 지표 추가
`src/providers/`에 `{id, title, value, unit, decimals, zones, ...}`를 반환하는 함수를 만들고 `src/providers/index.js`에 한 줄 추가하면 카드가 자동으로 생긴다. 지표별 실패는 격리되어 다른 카드에 영향을 주지 않는다.
