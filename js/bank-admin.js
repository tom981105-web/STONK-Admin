// js/bank-admin.js — STONK Bank 관리 패널 (v2.5)
// 자체 완결형 IIFE. window.firebase(compat) 직접 사용. 관리자만 접근(패널은 관리자 인증 후 노출됨).
// 모든 조정은 rooms/MAIN/adminLogs 와 대상 유저 거래내역/알림에 기록한다.
(function () {
  "use strict";
  const ROOM = "MAIN";
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const won = (v) => Math.trunc(num(v)).toLocaleString("ko-KR") + "원";
  const clamp = (s) => Math.max(0, Math.min(100, Math.round(num(s))));
  const grade = (s) => { s = clamp(s); return s >= 90 ? "S" : s >= 75 ? "A" : s >= 55 ? "B" : s >= 35 ? "C" : s >= 15 ? "D" : "F"; };
  const VIP_TIERS = ["NORMAL", "SILVER", "GOLD", "PLATINUM", "BLACK"];
  const VIP_MIN = { NORMAL: 0, SILVER: 30, GOLD: 55, PLATINUM: 78, BLACK: 92 };
  const VIP_LABEL = { NORMAL: "일반", SILVER: "실버", GOLD: "골드", PLATINUM: "플래티넘", BLACK: "블랙" };
  const vipTier = (sc) => { sc = clamp(sc); let t = "NORMAL"; VIP_TIERS.forEach((x) => { if (sc >= VIP_MIN[x]) t = x; }); return t; };
  const INS = {
    arcade: { title: "Arcade 손실 완화 보험", premium: 3000000, ms: 86400000 },
    gacha: { title: "Gacha 폭망 보호권", premium: 5000000, ms: 86400000 },
    loan: { title: "대출 유예권", premium: 2000000, ms: 86400000 },
  };

  function db() { return window.firebase && window.firebase.database ? window.firebase.database() : null; }
  function adminUid() { try { return (window.firebase.auth().currentUser || {}).uid || "admin"; } catch (_) { return "admin"; } }
  function fmtTime(t) { const d = new Date(num(t) || Date.now()); const p = (n) => (n < 10 ? "0" : "") + n; return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }

  let current = null; // { uid, bank, cash, tx, msgs }
  let msgEl = null;
  function notify(m, ok) { if (msgEl) { msgEl.textContent = m; msgEl.style.color = ok === false ? "#f2566a" : "#36d399"; } }

  async function adminLog(targetUid, action, before, after, memo) {
    try { await db().ref(`rooms/${ROOM}/adminLogs`).push({ adminUid: adminUid(), targetUid, action, before: before == null ? "" : String(before), after: after == null ? "" : String(after), memo: memo || "", createdAt: Date.now() }); } catch (_) {}
  }
  function bankTx(uid, o) { return db().ref(`rooms/${ROOM}/bank/${uid}/tx`).push(Object.assign({ beforeCash: 0, afterCash: 0, memo: "" }, o, { createdAt: Date.now() })); }
  function bankMsg(uid, o) { return db().ref(`rooms/${ROOM}/bank/${uid}/messages`).push({ type: o.type || "admin", title: o.title || "", body: o.body || "", amount: num(o.amount), relatedId: o.relatedId || "", read: false, actionLabel: "", actionUrl: "", createdAt: Date.now() }); }

  // UID 또는 닉네임으로 대상 유저 찾기
  async function resolveUid(q) {
    q = String(q || "").trim();
    if (!q) return "";
    const d = db(); if (!d) return "";
    // 1) UID 직접
    const b = await d.ref(`rooms/${ROOM}/bank/${q}`).once("value");
    if (b.exists()) return q;
    const p = await d.ref(`rooms/${ROOM}/players/${q}`).once("value");
    if (p.exists()) return q;
    // 2) 닉네임 스캔(bank → players)
    const lc = q.toLowerCase();
    const banks = (await d.ref(`rooms/${ROOM}/bank`).once("value")).val() || {};
    for (const [uid, v] of Object.entries(banks)) if (v && String(v.nickname || "").toLowerCase() === lc) return uid;
    const players = (await d.ref(`rooms/${ROOM}/players`).once("value")).val() || {};
    for (const [uid, v] of Object.entries(players)) if (v && String(v.nickname || "").toLowerCase() === lc) return uid;
    return "";
  }

  async function search(q) {
    notify("조회 중…");
    const uid = await resolveUid(q);
    if (!uid) { notify("해당 UID/닉네임을 찾을 수 없습니다.", false); current = null; renderBody(); return; }
    const d = db();
    const [bSnap, pSnap, tSnap, mSnap] = await Promise.all([
      d.ref(`rooms/${ROOM}/bank/${uid}`).once("value"),
      d.ref(`rooms/${ROOM}/players/${uid}`).once("value"),
      d.ref(`rooms/${ROOM}/bank/${uid}/tx`).orderByKey().limitToLast(15).once("value"),
      d.ref(`rooms/${ROOM}/bank/${uid}/messages`).orderByKey().limitToLast(15).once("value"),
    ]);
    const bank = bSnap.val() || {};
    const pv = pSnap.val() || {};
    const toArr = (s) => s.exists() ? Object.entries(s.val()).map(([id, x]) => Object.assign({ id }, x)).sort((a, b) => num(b.createdAt) - num(a.createdAt)) : [];
    current = { uid, bank, cash: num(pv.cash), nickname: pv.nickname || bank.nickname || "플레이어", tx: toArr(tSnap), msgs: toArr(mSnap) };
    notify("조회 완료: " + current.nickname);
    renderBody();
  }

  function row(k, v) { return `<div class="ba-row"><span>${k}</span><b>${v}</b></div>`; }
  function renderBody() {
    const body = $("#bankAdminBody");
    if (!body) return;
    if (!current) { body.innerHTML = `<p class="muted">UID 또는 닉네임으로 검색하세요.</p>`; return; }
    const b = current.bank;
    const fixedSum = Object.values(b.fixed || {}).reduce((a, f) => a + num(f && f.amount), 0);
    const inss = Object.values(b.insurances || {});
    const invs = Object.values(b.investments || {});
    const vTier = b.vipTier || vipTier(b.vipScore);
    body.innerHTML = `
      <div class="ba-card">
        <h3>${esc(current.nickname)} <small class="muted">${esc(current.uid)}</small></h3>
        <div class="ba-grid">
          ${row("보유 현금", won(current.cash))}
          ${row("자유예금", won(b.balance))}
          ${row("정기예금합", won(fixedSum))}
          ${row("대출원금", won(b.loanPrincipal))}
          ${row("대출이자", won(b.loanInterest))}
          ${row("신용점수/등급", `${clamp(b.creditScore)} · ${grade(b.creditScore)}`)}
          ${row("VIP 점수/등급", `${clamp(b.vipScore)} · ${VIP_LABEL[vTier] || vTier}`)}
          ${row("VIP 금고", won(b.vipVaultBalance))}
        </div>
      </div>

      <div class="ba-card">
        <h3>신용 / VIP 조정</h3>
        <div class="ba-actions">
          <input id="baCredit" type="number" placeholder="신용점수 ±" />
          <button class="button" data-ba="credit">신용점수 적용</button>
          <input id="baVip" type="number" placeholder="VIP점수 ±" />
          <button class="button" data-ba="vip">VIP점수 적용</button>
          <input id="baLoanInt" type="number" placeholder="대출이자 절대값" />
          <button class="button" data-ba="loanint">대출이자 설정</button>
        </div>
      </div>

      <div class="ba-card">
        <h3>보험 지급</h3>
        <div class="ba-actions">
          <select id="baIns">${Object.entries(INS).map(([k, v]) => `<option value="${k}">${esc(v.title)}</option>`).join("")}</select>
          <button class="button" data-ba="grantins">보험 지급(24h)</button>
        </div>
        <div class="ba-list">${inss.length ? inss.map((i) => `<div class="ba-li"><span>${esc(i.title)} · <b>${esc(i.status)}</b></span><button class="button ghost mini" data-ba="expireins" data-id="${esc(i.id)}">만료 처리</button></div>`).join("") : '<span class="muted">보험 없음</span>'}</div>
      </div>

      <div class="ba-card">
        <h3>투자상품</h3>
        <div class="ba-list">${invs.length ? invs.map((v) => `<div class="ba-li"><span>${esc(v.title)} · 원금 ${won(v.principal)} · <b>${esc(v.status)}</b></span><button class="button ghost mini" data-ba="cancelinv" data-id="${esc(v.id)}">취소(원금환급)</button></div>`).join("") : '<span class="muted">투자 없음</span>'}</div>
        <p class="muted" style="font-size:12px">강제 정산(수익 확정 지급)은 다음 패치로 분리. 현재는 취소(원금 환급)만 제공합니다.</p>
      </div>

      <div class="ba-card">
        <h3>알림 발송</h3>
        <div class="ba-actions">
          <input id="baMsgTitle" type="text" placeholder="제목" />
          <input id="baMsgBody" type="text" placeholder="내용" />
          <button class="button" data-ba="sendmsg">시스템 알림 발송</button>
          <button class="button ghost" data-ba="readall">알림 전체 읽음</button>
        </div>
      </div>

      <div class="ba-card">
        <h3>최근 거래내역</h3>
        <div class="ba-list">${current.tx.length ? current.tx.map((t) => `<div class="ba-li"><span>${esc(t.title || t.type)} <small class="muted">${fmtTime(t.createdAt)}</small></span><b>${num(t.amount) >= 0 ? "+" : "−"}${won(Math.abs(num(t.amount)))}</b></div>`).join("") : '<span class="muted">없음</span>'}</div>
      </div>`;
    body.querySelectorAll("[data-ba]").forEach((el) => el.addEventListener("click", () => onAction(el.dataset.ba, el.dataset.id)));
  }

  async function onAction(act, id) {
    if (!current) return;
    const uid = current.uid, b = current.bank, d = db();
    try {
      if (act === "credit") {
        const delta = num($("#baCredit").value); if (!delta) return notify("값을 입력하세요.", false);
        const before = clamp(b.creditScore), after = clamp(before + delta);
        await d.ref(`rooms/${ROOM}/bank/${uid}`).update({ creditScore: after, creditGrade: grade(after) });
        await bankTx(uid, { type: "admin_adjust", title: "관리자 신용점수 조정", amount: 0, memo: `${before} → ${after}` });
        await bankMsg(uid, { type: "admin", title: "신용점수 조정", body: `관리자에 의해 신용점수가 ${before} → ${after}로 조정되었습니다.` });
        await adminLog(uid, "credit_adjust", before, after, `Δ${delta}`);
      } else if (act === "vip") {
        const delta = num($("#baVip").value); if (!delta) return notify("값을 입력하세요.", false);
        const before = clamp(b.vipScore), after = clamp(before + delta), t = vipTier(after);
        await d.ref(`rooms/${ROOM}/bank/${uid}`).update({ vipScore: after, vipTier: t });
        await bankTx(uid, { type: "vip_tier_up", title: "관리자 VIP 점수 조정", amount: 0, memo: `${before} → ${after} (${t})` });
        await adminLog(uid, "vip_adjust", before, after, t);
      } else if (act === "loanint") {
        const v = Math.max(0, Math.trunc(num($("#baLoanInt").value)));
        const before = Math.trunc(num(b.loanInterest));
        await d.ref(`rooms/${ROOM}/bank/${uid}`).update({ loanInterest: v });
        await bankTx(uid, { type: "admin_adjust", title: "관리자 대출이자 조정", amount: 0, memo: `${before} → ${v}` });
        await adminLog(uid, "loaninterest_set", before, v, "");
      } else if (act === "grantins") {
        const k = $("#baIns").value, prod = INS[k]; if (!prod) return;
        const now = Date.now(), insId = "ins" + now.toString(36);
        await d.ref(`rooms/${ROOM}/bank/${uid}/insurances/${insId}`).set({ id: insId, type: k, title: prod.title, premium: 0, status: "active", startedAt: now, expiresAt: now + prod.ms, usedAt: 0, createdAt: now });
        await bankTx(uid, { type: "insurance_buy", title: `${prod.title} 관리자 지급`, amount: 0, memo: "관리자 지급" });
        await bankMsg(uid, { type: "insurance", title: "보험 지급", body: `관리자가 ${prod.title}을(를) 지급했습니다. (24시간)`, relatedId: "insbuy-" + insId });
        await adminLog(uid, "grant_insurance", "", k, prod.title);
      } else if (act === "expireins") {
        await d.ref(`rooms/${ROOM}/bank/${uid}/insurances/${id}/status`).set("expired");
        await adminLog(uid, "expire_insurance", "", "expired", id);
      } else if (act === "cancelinv") {
        const inv = (b.investments || {})[id]; if (!inv) return;
        const principal = Math.trunc(num(inv.principal));
        await d.ref(`rooms/${ROOM}/players/${uid}/cash`).transaction((c) => Math.trunc(num(c)) + principal);
        await d.ref(`rooms/${ROOM}/bank/${uid}/investments/${id}`).remove();
        await bankTx(uid, { type: "investment_cancel", title: `${inv.title} 관리자 취소(원금환급)`, amount: principal, memo: "관리자 취소" });
        await bankMsg(uid, { type: "investment", title: "투자 취소", body: `관리자에 의해 ${inv.title}이(가) 취소되어 원금 ${won(principal)}이 환급되었습니다.` });
        await adminLog(uid, "cancel_investment", id, "refunded", won(principal));
      } else if (act === "sendmsg") {
        const title = $("#baMsgTitle").value.trim(), body = $("#baMsgBody").value.trim();
        if (!title && !body) return notify("제목/내용을 입력하세요.", false);
        await bankMsg(uid, { type: "system", title: title || "관리자 안내", body });
        await adminLog(uid, "send_message", "", title, body);
      } else if (act === "readall") {
        const ms = (await d.ref(`rooms/${ROOM}/bank/${uid}/messages`).once("value")).val() || {};
        const u = {}; Object.keys(ms).forEach((k) => { if (!ms[k].read) u[`${k}/read`] = true; });
        if (Object.keys(u).length) await d.ref(`rooms/${ROOM}/bank/${uid}/messages`).update(u);
        await adminLog(uid, "mark_all_read", "", "", "");
      }
      notify("적용 완료. 새로고침합니다.");
      await search(uid);
    } catch (e) { notify("실패: " + ((e && e.message) || e), false); }
  }

  function init() {
    const panel = $("#bankAdmin");
    if (!panel) return;
    panel.innerHTML = `
      <div class="panel-head"><div><p class="eyebrow">Bank</p><h1>은행 관리</h1></div></div>
      <p class="room-notice" style="margin:0 0 12px">유저의 Bank 상태를 조회하고 신용·VIP·보험·투자·알림을 조정합니다. 모든 조정은 관리자 로그에 기록됩니다. (단일 방 MAIN) <b id="bankAdminMsg"></b></p>
      <div class="ba-search">
        <input id="bankAdminQuery" type="text" placeholder="UID 또는 닉네임" />
        <button id="bankAdminSearch" class="button" type="button">조회</button>
      </div>
      <div id="bankAdminBody"><p class="muted">UID 또는 닉네임으로 검색하세요.</p></div>`;
    msgEl = $("#bankAdminMsg");
    $("#bankAdminSearch").addEventListener("click", () => search($("#bankAdminQuery").value));
    $("#bankAdminQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") search($("#bankAdminQuery").value); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  window.BankAdmin = { search, init };
})();
