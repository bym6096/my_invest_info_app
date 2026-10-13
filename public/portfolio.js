// 포트폴리오 화면: 보유 코인, 입출금 기록(분배 여부 확인), 미배분 현금
import {
  emptyState, upsertHolding, removeHolding, planAllocation, applyEntry, undoLast, makeEntry, historyOf, summarize,
} from "/portfolio-core.js";

const KEY = "portfolio.v1";
let state = load();
let prices = {};
let unknownSymbols = [];
let priceError = "";
let storageOk = true;
let timer = null;
const root = () => document.getElementById("portfolio");

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.v === 1 && Array.isArray(s.holdings) && Array.isArray(s.ledger)) return s;
  } catch {}
  return emptyState();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; } catch { storageOk = false; }
}

// ---------- 작은 DOM 헬퍼 (모든 텍스트는 textContent) ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const krw = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("ko-KR")}원`;
const qty = (n) => n.toLocaleString("ko-KR", { maximumFractionDigits: 8 });
const pct = (x) => (x === null ? "-" : `${(x * 100).toFixed(1)}%`);
const when = (ts) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const TYPE_LABEL = { deposit: "입금 배분", withdraw: "출금 배분", allocate: "미배분 현금 배분" };

function field(label, input) {
  const wrap = el("label", "field");
  wrap.append(el("span", "", label), input);
  return wrap;
}
function input(attrs = {}) {
  const i = el("input");
  Object.assign(i, attrs);
  return i;
}
function btn(label, cls, onClick) {
  const b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

// ---------- 모달 ----------
function modal({ title, content, actions }) {
  const dlg = el("dialog", "modal");
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(el("h3", "", title), content);
  const bar = el("div", "modal-actions");
  for (const a of actions) {
    bar.append(btn(a.label, a.primary ? "primary" : "", () => a.onClick(close)));
  }
  dlg.append(bar);
  dlg.addEventListener("cancel", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return close;
}
const notify = (title, message) =>
  modal({ title, content: el("p", "", message), actions: [{ label: "확인", primary: true, onClick: (c) => c() }] });

function allocationTable(plan, sign) {
  const t = el("table", "alloc");
  const head = el("tr");
  ["코인", "비중", "반영 금액"].forEach((h) => head.append(el("th", "", h)));
  t.append(head);
  for (const p of plan) {
    const r = el("tr");
    r.append(el("td", "", p.symbol), el("td", "", pct(p.weight)), el("td", "", signed(sign * p.amount)));
    t.append(r);
  }
  return t;
}

// ---------- 가격 ----------
async function refreshPrices() {
  const symbols = state.holdings.map((h) => h.symbol);
  if (!symbols.length) { prices = {}; unknownSymbols = []; priceError = ""; return; }
  try {
    const res = await fetch(`/api/prices?symbols=${encodeURIComponent(symbols.join(","))}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    prices = data.prices;
    unknownSymbols = data.unknown;
    priceError = "";
  } catch (e) {
    priceError = `현재가를 가져오지 못했어요: ${e.message}`;
  }
}

// ---------- 입출금 기록 등록 ----------
async function onRecord(type, amount, note) {
  const sign = type === "deposit" ? 1 : -1;
  const verb = type === "deposit" ? "입금" : "출금";
  // 현재가가 아직 없으면(방금 등록했거나 로딩 중) 먼저 새로 불러온다
  if (state.holdings.some((h) => !(prices[h.symbol] > 0))) await refreshPrices();
  let plan = null, planErr = "";
  try { plan = planAllocation(state, amount, prices); } catch (e) { planErr = e.message; }

  const commit = (mode, allocations) => {
    try {
      state = applyEntry(state, makeEntry({ type, amount, mode, allocations, note }));
      save();
      render();
    } catch (e) {
      notify("적용할 수 없어요", e.message);
    }
  };
  const toCash = (close) => { close(); commit("unallocated", []); };

  if (!plan) {
    modal({
      title: `${verb} ${krw(amount)} 기록`,
      content: el("p", "", `보유 코인 비중대로 분배할 수 없어요 (${planErr}).${type === "deposit" ? " 미배분 현금으로 보관할까요?" : " 미배분 현금에서 출금할까요?"}`),
      actions: [
        { label: "취소", onClick: (c) => c() },
        { label: type === "deposit" ? "미배분 현금으로 보관" : "미배분 현금에서 출금", primary: true, onClick: toCash },
      ],
    });
    return;
  }
  const body = el("div");
  body.append(
    el("p", "", `${verb} ${krw(amount)}을(를) 보유 코인의 현재 평가금액 비중대로 분배해서 반영할까요?`),
    allocationTable(plan, sign),
    el("p", "hint", "입출금으로만 기록되고 수량은 바뀌지 않아요. 매수·매도로 처리하지 않습니다."),
    el("p", "hint", type === "deposit" ? "'아니오'를 누르면 미배분 현금으로 보관돼요." : "'아니오'를 누르면 미배분 현금에서 출금돼요."),
  );
  modal({
    title: `${verb} ${krw(amount)} 분배`,
    content: body,
    actions: [
      { label: "취소", onClick: (c) => c() },
      { label: "아니오", onClick: toCash },
      { label: "예, 분배 적용", primary: true, onClick: (close) => { close(); commit("allocated", plan.map(({ symbol, amount: a }) => ({ symbol, amount: a }))); } },
    ],
  });
}

// ---------- 미배분 현금 분배하기 ----------
function openAllocateCash() {
  const content = el("div");
  const modeAuto = input({ type: "radio", name: "alloc-mode", value: "auto", checked: true });
  const modeManual = input({ type: "radio", name: "alloc-mode", value: "manual" });
  const amountIn = input({ type: "number", inputMode: "numeric", min: "1", step: "1", value: String(state.cash) });
  const coinSel = el("select");
  state.holdings.forEach((h) => { const o = el("option", "", h.symbol); o.value = h.symbol; coinSel.append(o); });
  const preview = el("div");
  const r1 = el("label", "radio"); r1.append(modeAuto, el("span", "", "코인별 비율(현재 평가금액 비중)에 맞게 자동 분배"));
  const r2 = el("label", "radio"); r2.append(modeManual, el("span", "", "특정 코인에 적용"));
  const coinField = field("적용할 코인", coinSel);
  content.append(el("p", "", `미배분 현금 ${krw(state.cash)}`), r1, r2, field("분배할 금액(원)", amountIn), coinField, preview);

  const read = () => {
    const amount = Number(amountIn.value);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("금액은 1원 이상의 정수여야 해요");
    if (amount > state.cash) throw new Error(`미배분 현금(${krw(state.cash)})보다 클 수 없어요`);
    if (modeManual.checked) return { amount, mode: "manual", allocations: [{ symbol: coinSel.value, amount }], plan: null };
    const plan = planAllocation(state, amount, prices);
    return { amount, mode: "auto", allocations: plan.map(({ symbol, amount: a }) => ({ symbol, amount: a })), plan };
  };
  const update = () => {
    coinField.hidden = !modeManual.checked;
    preview.replaceChildren();
    try {
      const r = read();
      preview.append(r.plan ? allocationTable(r.plan, 1) : el("p", "hint", `${coinSel.value}에 ${krw(r.amount)} 반영`));
    } catch (e) {
      preview.append(el("p", "err", e.message));
    }
  };
  [modeAuto, modeManual, amountIn, coinSel].forEach((i) => i.addEventListener("input", update));
  update();

  modal({
    title: "미배분 현금 분배하기",
    content,
    actions: [
      { label: "취소", onClick: (c) => c() },
      {
        label: "분배 적용", primary: true,
        onClick: (close) => {
          try {
            const r = read();
            state = applyEntry(state, makeEntry({ type: "allocate", amount: r.amount, mode: r.mode, allocations: r.allocations }));
            save();
            close();
            render();
          } catch (e) {
            notify("적용할 수 없어요", e.message);
          }
        },
      },
    ],
  });
}

// ---------- 화면 ----------
function renderSummary(sum) {
  const card = el("section", "card");
  card.append(el("h2", "", "내 포트폴리오"));
  card.append(el("div", "value", sum.complete ? krw(sum.value) : "-"));
  const dl = el("dl");
  const row = (k, v) => { const r = el("div"); r.append(el("dt", "", k), el("dd", "", v)); dl.append(r); };
  row("총 투자원금", krw(sum.cost));
  row("평가손익", sum.complete ? `${signed(sum.pnl)} (${pct(sum.pnlRate)})` : "-");
  row("미배분 현금", krw(state.cash));
  card.append(dl);
  if (priceError) card.append(el("div", "err", priceError));
  if (unknownSymbols.length) card.append(el("div", "err", `업비트 원화마켓에 없는 코인: ${unknownSymbols.join(", ")}`));
  if (!storageOk) card.append(el("div", "err", "이 브라우저에서는 저장할 수 없어서 새로고침하면 사라져요"));
  card.append(el("div", "foot", "데이터는 이 기기의 브라우저에만 저장돼요. 평가금액은 업비트 원화 현재가 × 수량입니다."));
  return card;
}

function renderHoldings(sum) {
  const card = el("section", "card");
  card.append(el("h2", "", "보유 코인"));
  if (!sum.rows.length) card.append(el("p", "hint", "아래에서 보유 코인을 등록해 주세요."));
  for (const r of sum.rows) {
    const d = el("details", "coin");
    const s = el("summary");
    s.append(el("strong", "", r.symbol), el("span", "", r.value === null ? "-" : krw(r.value)), el("span", "w", pct(r.weight)));
    d.append(s);
    const dl = el("dl");
    const line = (k, v) => { const x = el("div"); x.append(el("dt", "", k), el("dd", "", v)); dl.append(x); };
    line("수량", qty(r.quantity));
    line("현재가", r.price === null ? "-" : krw(r.price));
    line("투자원금", krw(r.cost));
    line("수익률", r.value === null || r.cost <= 0 ? "-" : pct((r.value - r.cost) / r.cost));
    d.append(dl);
    const hist = historyOf(state, r.symbol);
    d.append(el("h4", "", "입출금 기록"));
    if (!hist.length) d.append(el("p", "hint", "아직 없어요"));
    for (const h of hist) {
      const li = el("div", "hist");
      li.append(el("span", "", `${when(h.ts)} ${TYPE_LABEL[h.type]}`), el("span", h.amount < 0 ? "neg" : "pos", signed(h.amount)));
      d.append(li);
    }
    const acts = el("div", "row-actions");
    acts.append(
      btn("수정", "", () => fillForm(r)),
      btn("삭제", "danger", () =>
        modal({
          title: `${r.symbol} 삭제`,
          content: el("p", "", "보유 코인에서 삭제할까요? 입출금 기록은 그대로 남아요."),
          actions: [
            { label: "취소", onClick: (c) => c() },
            { label: "삭제", primary: true, onClick: async (c) => { c(); state = removeHolding(state, r.symbol); save(); await refreshPrices(); render(); } },
          ],
        })),
    );
    d.append(acts);
    card.append(d);
  }
  return card;
}

let holdingForm = null;
function fillForm(r) {
  if (!holdingForm) return;
  holdingForm.sym.value = r.symbol;
  holdingForm.q.value = String(r.quantity);
  holdingForm.c.value = String(r.cost);
  holdingForm.sym.scrollIntoView({ block: "center" });
}

function renderHoldingForm() {
  const card = el("section", "card");
  card.append(el("h2", "", "보유 코인 등록·수정"));
  const sym = input({ placeholder: "BTC", maxLength: 10, autocapitalize: "characters" });
  const q = input({ type: "number", inputMode: "decimal", step: "any", min: "0", placeholder: "보유 수량(개)" });
  const c = input({ type: "number", inputMode: "numeric", step: "1", min: "0", placeholder: "투자원금(원)" });
  holdingForm = { sym, q, c };
  const msg = el("div", "err");
  const form = el("form", "form");
  form.append(field("코인 심볼", sym), field("수량", q), field("투자원금(원)", c), btn("저장", "primary", () => form.requestSubmit()), msg);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      state = upsertHolding(state, { symbol: sym.value, quantity: q.value, cost: c.value });
      save();
      await refreshPrices();
      render();
    } catch (e) {
      msg.textContent = e.message;
    }
  });
  card.append(form);
  return card;
}

function renderRecordForm() {
  const card = el("section", "card");
  card.append(el("h2", "", "입출금 기록"));
  const type = el("select");
  [["deposit", "입금"], ["withdraw", "출금"]].forEach(([v, l]) => { const o = el("option", "", l); o.value = v; type.append(o); });
  const amount = input({ type: "number", inputMode: "numeric", step: "1", min: "1", placeholder: "금액(원)" });
  const note = input({ placeholder: "메모(선택)", maxLength: 60 });
  const msg = el("div", "err");
  const form = el("form", "form");
  form.append(field("구분", type), field("금액(원)", amount), field("메모", note), btn("기록하기", "primary", () => form.requestSubmit()), msg);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const a = Number(amount.value);
    if (!Number.isInteger(a) || a <= 0) { msg.textContent = "금액은 1원 이상의 정수로 입력해 주세요"; return; }
    msg.textContent = "";
    onRecord(type.value, a, note.value);
    amount.value = "";
    note.value = "";
  });
  card.append(form);
  return card;
}

function renderCash() {
  const card = el("section", "card");
  card.append(el("h2", "", "미배분 현금"));
  card.append(el("div", "value", krw(state.cash)));
  card.append(el("p", "hint", "입출금 기록에서 '아니오'를 고르면 여기에 쌓여요. 나중에 코인별 비율대로 자동 분배하거나 특정 코인에 적용할 수 있어요."));
  const b = btn("분배하기", "primary", openAllocateCash);
  b.disabled = state.cash <= 0 || !state.holdings.length;
  card.append(b);
  return card;
}

function renderLedger() {
  const card = el("section", "card");
  card.append(el("h2", "", "전체 기록"));
  if (!state.ledger.length) card.append(el("p", "hint", "아직 기록이 없어요"));
  for (const e of [...state.ledger].reverse().slice(0, 30)) {
    const li = el("div", "hist");
    const mode = e.type === "allocate" ? (e.mode === "auto" ? "자동 분배" : "코인 지정") : e.mode === "allocated" ? "분배됨" : "미배분";
    const label = e.type === "allocate" ? "현금 분배" : e.type === "deposit" ? "입금" : "출금";
    li.append(el("span", "", `${when(e.ts)} ${label} · ${mode}${e.note ? ` · ${e.note}` : ""}`), el("span", e.type === "withdraw" ? "neg" : "pos", signed(e.type === "withdraw" ? -e.amount : e.amount)));
    card.append(li);
  }
  if (state.ledger.length) {
    card.append(btn("마지막 기록 되돌리기", "", () =>
      modal({
        title: "마지막 기록 되돌리기",
        content: el("p", "", "가장 최근 입출금/분배 기록 하나를 취소하고 원금·미배분 현금을 원래대로 돌려요."),
        actions: [
          { label: "취소", onClick: (c) => c() },
          { label: "되돌리기", primary: true, onClick: (c) => { try { state = undoLast(state); save(); c(); render(); } catch (err) { c(); notify("되돌릴 수 없어요", err.message); } } },
        ],
      })));
  }
  return card;
}

function render() {
  const host = root();
  if (!host) return;
  const sum = summarize(state, prices);
  host.replaceChildren(renderSummary(sum), renderHoldings(sum), renderHoldingForm(), renderRecordForm(), renderCash(), renderLedger());
}

export async function showPortfolio() {
  render();
  await refreshPrices();
  render();
  clearInterval(timer);
  timer = setInterval(async () => {
    // 입력 중인 폼/열린 모달을 방해하지 않도록 팝업이 없을 때만 갱신
    if (document.querySelector("dialog[open]") || document.activeElement?.closest?.("#portfolio form")) return;
    await refreshPrices();
    render();
  }, 30_000);
}
export function hidePortfolio() {
  clearInterval(timer);
}
