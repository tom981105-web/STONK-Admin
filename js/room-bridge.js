// js/room-bridge.js ─ STONK Admin ↔ rooms/{roomCode} 연동 (v1.4.0 Phase 2)
// ──────────────────────────────────────────────────────────────────────
// admin 이 battle 이 만든 rooms/{roomCode} 데이터를 직접 읽고, 변경분만
// 부분 update() 로 저장하기 위한 저수준 헬퍼. UI 는 market-admin.js 가 담당.
//
// 핵심 원칙
//  - 방의 정식 "회사" 저장소는 battle 이 만든 room.stocks (board/wiki 가 이걸 읽음).
//    → 회사 표시 필드(name/sector/ticker/basePrice/price)는 stocks/{id}/{field} 로 부분 저장.
//  - admin 고유 필드(growth/volatility/risk/status/oneLine/description/wiki/tags)는
//    stocks 스키마를 오염시키지 않도록 adminOverrides/companies/{id} 에 보관 +
//    표시에 필요한 description/wiki/oneLine 은 stocks 노드에도 additive 로 함께 저장.
//  - 뉴스/공시는 room 에 없던 노드이므로 rooms/{code}/news, /disclosures 에 additive 저장.
//  - 절대 rooms/{code} 전체를 set() 하지 않는다. 변경된 경로만 update().
(function () {
  "use strict";

  const STORAGE = {
    backupPrefix: "stonk:roomDataBackup:",
    legacyBackupPrefix: "marketBattle:roomDataBackup:",
    cachePrefix: "stonk:roomDataCache:",
  };

  const stat = {
    lastReadAt: null,
    lastWriteAt: null,
    lastBackupAt: null,
    lastBackupKey: "",
    lastError: "",
  };

  function db() {
    try { return window.firebase && window.firebase.database ? window.firebase.database() : null; }
    catch (e) { return null; }
  }

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  // ── rooms/{code} 읽기 ──
  async function loadRoom(code) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    const snap = await database.ref("rooms/" + code).once("value");
    stat.lastReadAt = Date.now();
    return snap.exists() ? snap.val() : null;
  }

  // ── room.stocks → admin company 배열 변환 ──
  // adminOverrides/companies/{id} 에 저장된 고유 필드가 있으면 덮어 적용한다.
  // 특수 자산(업종이 없는 battle 종목)의 업종 fallback — "업종 누락" 검증 오류 방지
  const TYPE_SECTOR = {
    etf: "ETF", inverse: "ETF", leverage: "ETF", bond: "채권",
    commodity: "원자재", reit: "리츠", spac: "SPAC", preferred: "우선주",
  };
  function sectorFallback(s) {
    return (s && s.sector) || (s && TYPE_SECTOR[s.type]) || "기타";
  }

  function roomToCompanies(room) {
    const stocks = (room && room.stocks) || {};
    const overrides = (room && room.adminOverrides && room.adminOverrides.companies) || {};
    return Object.entries(stocks).map(([id, s]) => {
      const ov = overrides[id] || {};
      const price = num(s.price, num(s.basePrice, 10000));
      const base = num(s.basePrice, price);
      return {
        id,
        name: ov.name != null ? ov.name : (s.name || id),
        ticker: ov.ticker != null ? ov.ticker : (s.ticker || ""),
        sector: ov.sector != null && ov.sector !== "" ? ov.sector : sectorFallback(s),
        basePrice: num(ov.basePrice, base),
        currentPrice: num(ov.currentPrice, price),
        risk: ov.risk || "보통",
        growth: num(ov.growth, 50),
        volatility: num(ov.volatility, num(s.volat, 40)),
        status: ov.status || s.role || "본게임 종목",
        oneLine: ov.oneLine != null ? ov.oneLine : (s.oneLine || s.news || ""),
        description: ov.description != null ? ov.description : (s.description || ""),
        wiki: ov.wiki != null ? ov.wiki : (s.wiki || ""),
        logoEmoji: ov.logoEmoji || s.logoEmoji || "",
        tags: Array.isArray(ov.tags) ? ov.tags : [],
        wikiId: ov.wikiId || "",
        _fromRoom: true,
      };
    });
  }

  function objToArray(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return obj.filter(Boolean);
    return Object.entries(obj).map(([id, v]) => (v && typeof v === "object" ? { id: v.id || id, ...v } : v)).filter(Boolean);
  }

  function roomToNews(room) {
    return objToArray(room && room.news).map((n) => ({
      id: n.id,
      title: n.title || "",
      body: n.body || n.text || "",
      type: n.type || "market",
      targetCompanyId: n.targetCompanyId || "",
      targetSector: n.targetSector || "",
      effect: n.effect || "mixed",
      impact: num(n.impact, 50),
      duration: num(n.duration, 1),
      visibility: n.visibility || "visible",
      priority: num(n.priority, 10),
      createdAt: n.createdAt || new Date().toISOString(),
      tags: Array.isArray(n.tags) ? n.tags : [],
      relatedWikiIds: Array.isArray(n.relatedWikiIds) ? n.relatedWikiIds : [],
    }));
  }

  function roomToDisclosures(room) {
    return objToArray(room && room.disclosures).map((d) => {
      const out = {
        id: d.id,
        title: d.title || "",
        body: d.body || d.content || "",
        type: d.type || "공시",
        targetCompanyId: d.targetCompanyId || d.companyId || "",
        source: d.source || "admin",
        createdAt: d.createdAt || new Date().toISOString(),
        updatedAt: d.updatedAt || d.createdAt || new Date().toISOString(),
      };
      if (d.hidden) out.hidden = true;
      if (d.deleted) out.deleted = true;
      return out;
    });
  }

  // adminOverrides 비교용 필드(updatedAt 제외) — 변경 없으면 재기록하지 않는다.
  const OVERRIDE_FIELDS = ["name", "ticker", "sector", "basePrice", "currentPrice", "risk", "growth", "volatility", "status", "oneLine", "description", "wiki", "tags", "wikiId", "logoEmoji"];

  function buildOverride(company) {
    return {
      name: company.name, ticker: company.ticker || "", sector: company.sector,
      basePrice: num(company.basePrice, 0), currentPrice: num(company.currentPrice, 0),
      risk: company.risk, growth: num(company.growth, 50), volatility: num(company.volatility, 40),
      status: company.status, oneLine: company.oneLine || "", description: company.description || "",
      wiki: company.wiki || "", tags: company.tags || [], wikiId: company.wikiId || "",
      logoEmoji: company.logoEmoji || "",
    };
  }

  function sameOverride(a, b) {
    if (!a || !b) return false;
    return OVERRIDE_FIELDS.every((f) => {
      const va = a[f], vb = b[f];
      if (Array.isArray(va) || Array.isArray(vb)) return JSON.stringify(va || []) === JSON.stringify(vb || []);
      return String(va == null ? "" : va) === String(vb == null ? "" : vb);
    });
  }

  // ── 회사 변경분만 stocks/{id} + adminOverrides 로 부분 update 경로 생성 ──
  // company 표시 필드는 stocks 에, 고유 필드는 adminOverrides 에 기록.
  // 실제로 바뀐 경로가 하나라도 있으면 true 반환(변경된 회사만 기록).
  function diffCompanyUpdates(updates, code, company, room) {
    const id = company.id;
    const stocks = (room && room.stocks) || {};
    const orig = stocks[id] || {};
    const isNew = !stocks[id];
    const sp = `rooms/${code}/stocks/${id}/`;
    let changed = isNew;
    const setIf = (field, value) => { if (value !== undefined && value !== orig[field]) { updates[sp + field] = value; changed = true; } };
    setIf("name", company.name);
    if (company.ticker) setIf("ticker", company.ticker);
    setIf("sector", company.sector);
    setIf("basePrice", num(company.basePrice, orig.basePrice));
    setIf("price", num(company.currentPrice, orig.price)); // 표시 현재가
    // additive 표시 필드 (battle 스키마에 없던 필드 — 안전)
    setIf("description", company.description || "");
    setIf("wiki", company.wiki || "");
    setIf("oneLine", company.oneLine || "");
    // 새 종목(방에 stocks 가 아예 없던 경우)이면 기본 시세 필드도 채운다
    if (isNew) {
      const price = num(company.currentPrice, num(company.basePrice, 10000));
      const base = num(company.basePrice, price);
      updates[sp + "type"] = "stock";
      updates[sp + "role"] = company.status || "관리자 추가";
      updates[sp + "previousPrice"] = base;
      updates[sp + "open"] = base;
      updates[sp + "high"] = Math.max(price, base);
      updates[sp + "low"] = Math.min(price, base);
      updates[sp + "changeRate"] = base ? Number((((price - base) / base) * 100).toFixed(2)) : 0;
      updates[sp + "volume"] = num(orig.volume, 0);
      updates[sp + "value"] = num(orig.value, 0);
    }
    // 고유 필드(adminOverrides)는 실제로 달라졌을 때만 재기록 — Firebase 쓰기 최소화
    const ov = buildOverride(company);
    const ovOld = (room && room.adminOverrides && room.adminOverrides.companies && room.adminOverrides.companies[id]) || null;
    if (!sameOverride(ov, ovOld)) {
      updates[`rooms/${code}/adminOverrides/companies/${id}`] = { ...ov, updatedAt: Date.now() };
      changed = true;
    }
    return changed;
  }

  // 노드(news/disclosure) 가 기존과 동일하면 재기록하지 않는다.
  function sameNode(a, b) {
    if (!b) return false;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  // ── 전체 dataset(회사/뉴스/공시)을 부분 update 경로로 변환 ──
  // 보존 대상(meta/players/market/orders/gameState/stocks의 게임 필드 등)은 건드리지 않는다.
  function buildUpdates(code, dataset, room) {
    const updates = {};
    const roomNews = (room && room.news) || {};
    const roomDisc = (room && room.disclosures) || {};
    let changed = 0;
    (dataset.companies || []).forEach((c) => { if (diffCompanyUpdates(updates, code, c, room)) changed++; });
    (dataset.news || []).forEach((n) => {
      const node = { ...n, text: n.body || n.title };
      if (sameNode(node, roomNews[n.id])) return; // 변경 없음 → skip
      updates[`rooms/${code}/news/${n.id}`] = node;
      updates[`rooms/${code}/adminOverrides/news/${n.id}`] = { id: n.id, title: n.title, updatedAt: Date.now() };
      changed++;
    });
    (dataset.disclosures || []).forEach((d) => {
      const node = { ...d };
      if (sameNode(node, roomDisc[d.id])) return;
      updates[`rooms/${code}/disclosures/${d.id}`] = node;
      changed++;
    });
    // 실제 변경이 있을 때만 meta 도 갱신 (불필요한 쓰기 방지)
    if (changed > 0) {
      updates[`rooms/${code}/meta/updatedAt`] = Date.now();
      updates[`rooms/${code}/meta/adminVersion`] = "1.4.0";
    }
    return updates;
  }

  // ── 저장 전 localStorage 백업 ──
  function backup(code, room, summary, mode) {
    try {
      const ts = Date.now();
      const key = STORAGE.backupPrefix + code + ":" + ts;
      const payload = {
        roomCode: code,
        savedAt: new Date(ts).toISOString(),
        summary: summary || "",
        storageMode: mode || "",
        roomData: room || null,
      };
      localStorage.setItem(key, JSON.stringify(payload));
      stat.lastBackupAt = ts;
      stat.lastBackupKey = key;
      pruneBackups(code, 10);
      return key;
    } catch (e) {
      stat.lastError = "backup 실패: " + (e && e.message);
      return "";
    }
  }

  function listBackups(code) {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(STORAGE.backupPrefix + code + ":") === 0) out.push(k);
      }
    } catch (e) {}
    return out.sort().reverse();
  }

  function pruneBackups(code, keep) {
    const keys = listBackups(code);
    keys.slice(keep).forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
  }

  function getBackup(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }

  // ── 변경분 부분 update() 실행 ──
  async function savePartial(code, dataset, room, opts) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    if (!code) throw new Error("roomCode 없음");
    const updates = buildUpdates(code, dataset, room);
    if (!Object.keys(updates).length) return { paths: 0 };
    // 저장 전 백업
    backup(code, room, (opts && opts.summary) || `회사 ${(dataset.companies || []).length} · 뉴스 ${(dataset.news || []).length} · 공시 ${(dataset.disclosures || []).length}`, "Firebase");
    await database.ref().update(updates);
    stat.lastWriteAt = Date.now();
    return { paths: Object.keys(updates).length };
  }

  // ── 임의 경로 부분 update (삭제 등) — 저장 전 백업 + 변경된 경로만 ──
  // battle 소유 stocks 는 호출 측에서 제외하고 admin 소유 노드만 넘긴다.
  async function applyRaw(code, updates, room, summary) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    if (!code) throw new Error("roomCode 없음");
    if (!updates || !Object.keys(updates).length) return { paths: 0 };
    backup(code, room, summary || "raw update", "Firebase");
    await database.ref().update(updates);
    stat.lastWriteAt = Date.now();
    return { paths: Object.keys(updates).length };
  }

  // ── 중간 참여 신청(joinRequests) ── (Phase 3)
  // admin 은 목록을 1회 읽고(once), 승인/거절은 필요한 필드만 update 한다.
  async function loadJoinRequests(code) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    const snap = await database.ref("rooms/" + code + "/joinRequests").once("value");
    stat.lastReadAt = Date.now();
    const val = snap.exists() ? snap.val() : {};
    return Object.entries(val || {}).map(([id, r]) => ({ id, ...(r || {}) }));
  }

  async function approveJoinRequest(code, requestId, adminId) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    const now = Date.now();
    await database.ref().update({
      [`rooms/${code}/joinRequests/${requestId}/status`]: "approved",
      [`rooms/${code}/joinRequests/${requestId}/approvedAt`]: now,
      [`rooms/${code}/joinRequests/${requestId}/approvedBy`]: adminId || "admin",
      [`rooms/${code}/meta/updatedAt`]: now,
    });
    stat.lastWriteAt = now;
  }

  async function rejectJoinRequest(code, requestId, adminId) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    const now = Date.now();
    await database.ref().update({
      [`rooms/${code}/joinRequests/${requestId}/status`]: "rejected",
      [`rooms/${code}/joinRequests/${requestId}/rejectedAt`]: now,
      [`rooms/${code}/joinRequests/${requestId}/rejectedBy`]: adminId || "admin",
      [`rooms/${code}/meta/updatedAt`]: now,
    });
    stat.lastWriteAt = now;
  }

  // ── 전체 방 목록 (admin 전용, 1회 읽기 + 수동 새로고침) ── (1.4.0 방 관리)
  // 전체 roomData 를 화면에 렌더하지 않고 요약만 추출한다.
  function summarizeRoom(code, r) {
    r = r || {};
    const meta = r.meta || {};
    const jr = r.joinRequests || {};
    const pending = Object.values(jr).filter((x) => x && x.status === "pending").length;
    const market = r.market || {};
    const lastTickAt = market.lastTickAt || r.marketTick || null;
    // history 캔들 보유 여부(첫 종목 기준 간단 점검)
    let historyCandles = 0;
    if (r.stocks) {
      for (const s of Object.values(r.stocks)) {
        const h = s && s.history;
        if (h) { for (const tk in h) historyCandles += Object.keys(h[tk] || {}).length; }
      }
    }
    return {
      code,
      status: meta.deleted ? "deleted" : (r.status || meta.status || "unknown"),
      rawStatus: r.status || "",
      deleted: !!meta.deleted,
      hostId: r.hostId || "",
      createdAt: r.createdAt || meta.createdAt || null,
      updatedAt: meta.updatedAt || null,
      deletedAt: meta.deletedAt || null,
      players: r.players ? Object.keys(r.players).length : 0,
      stocks: r.stocks ? Object.keys(r.stocks).length : 0,
      news: r.news ? Object.keys(r.news).length : 0,
      disclosures: r.disclosures ? Object.keys(r.disclosures).length : 0,
      pending,
      // 시장 경과/보정 상태 (1.4.x)
      lastTickAt,
      lastCatchupAt: market.lastCatchupAt || null,
      historyCandles,
      staleMin: lastTickAt ? Math.max(0, Math.round((Date.now() - lastTickAt) / 60000)) : null,
      // 개장/마감 시간 (없으면 기본 18~24)
      openHour: Number.isFinite(market.openHour) ? market.openHour : 18,
      closeHour: Number.isFinite(market.closeHour) ? market.closeHour : 24,
    };
  }

  // ── 개장/마감 시간 저장 (admin → rooms/{code}/market.openHour·closeHour) ──
  async function setMarketHours(code, openHour, closeHour) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    const clampH = (v) => Math.max(0, Math.min(24, Math.round(Number(v))));
    const oh = clampH(openHour), ch = clampH(closeHour);
    if (!Number.isFinite(oh) || !Number.isFinite(ch)) throw new Error("시간 값을 확인하세요 (0~24)");
    await database.ref().update({
      [`rooms/${code}/market/openHour`]: oh,
      [`rooms/${code}/market/closeHour`]: ch,
      [`rooms/${code}/meta/updatedAt`]: Date.now(),
    });
    return { code, oh, ch };
  }

  // ── 시장 경과 보정 실행 (관리자 수동, 부분 update) ──
  // 자동/주기 실행 금지. 버튼 클릭 시 1회. 공용 MarketHistory.runCatchUp 재사용.
  async function runCatchUp(code, adminId, opts) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    if (!window.MarketHistory || !window.MarketHistory.runCatchUp) throw new Error("MarketHistory 미로드");
    const room = await loadRoom(code);
    if (!room) throw new Error("방을 찾을 수 없습니다");
    const res = await window.MarketHistory.runCatchUp(database, code, room, adminId, opts || {});
    if (res && res.applied) stat.lastWriteAt = Date.now();
    return res;
  }

  async function loadAllRooms() {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    const snap = await database.ref("rooms").once("value");
    stat.lastReadAt = Date.now();
    const val = snap.exists() ? snap.val() : {};
    return Object.entries(val).map(([code, r]) => summarizeRoom(code, r));
  }

  // ── 방 soft delete (관리자 전용) ── meta 플래그만 부분 update, 삭제 전 백업 ──
  async function softDeleteRoom(code, adminId, roomSnapshot) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    if (!code) throw new Error("roomCode 없음");
    // 삭제 전 백업 (전달받은 스냅샷 없으면 1회 읽기)
    let snapData = roomSnapshot || null;
    if (!snapData) {
      try { const s = await database.ref("rooms/" + code).once("value"); snapData = s.val(); } catch (e) {}
    }
    backup(code, snapData, "soft delete (방 삭제 표시)", "Firebase");
    const now = Date.now();
    await database.ref().update({
      [`rooms/${code}/meta/deleted`]: true,
      [`rooms/${code}/meta/deletedAt`]: now,
      [`rooms/${code}/meta/deletedBy`]: adminId || "admin",
      [`rooms/${code}/meta/status`]: "deleted",
      [`rooms/${code}/meta/updatedAt`]: now,
    });
    stat.lastWriteAt = now;
    return { code, deletedAt: now };
  }

  // ── 방 hard delete (관리자 전용) ── 즉시 완전 삭제. 삭제 전 localStorage 백업 필수 ──
  async function hardDeleteRoom(code, adminId, roomSnapshot) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    if (!code) throw new Error("roomCode 없음");
    let snapData = roomSnapshot || null;
    if (!snapData) {
      try { const s = await database.ref("rooms/" + code).once("value"); snapData = s.val(); } catch (e) {}
    }
    // 복구 불가 작업이므로 반드시 백업 후 진행
    const key = backup(code, snapData, "hard delete (방 완전 삭제) by " + (adminId || "admin"), "Firebase");
    await database.ref("rooms/" + code).remove(); // 해당 방만 삭제 — 다른 방 무영향
    stat.lastWriteAt = Date.now();
    return { code, backupKey: key };
  }

  // ── 시장 (재)시작 ── 단일 방 운영: 종목/뉴스/로그/예약주문을 새로 만들고
  // 모든 플레이어 현금을 시작 자본으로 초기화한다(명단/닉네임/스킨은 유지). status=playing.
  // 방이 아예 없었다면 첫 시작으로 새로 만든다(이후 이용자는 battle 에서 자동 등록).
  async function resetMarket(code, adminId) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    if (!window.MarketSeed) throw new Error("MarketSeed(js/market-seed.js) 가 로드되지 않았습니다");
    code = code || "MAIN";
    const now = Date.now();
    // 기존 방 읽어 명단(players) 유지
    let room = null;
    try { const s = await database.ref("rooms/" + code).once("value"); room = s.val(); } catch (e) {}
    // 되돌릴 수 없는 초기화이므로 백업
    try { backup(code, room, "market reset (시장 재시작) by " + (adminId || "admin"), "Firebase"); } catch (e) {}

    const START = window.MarketSeed.START_CASH;
    const stocks = window.MarketSeed.generateStocks();
    const base = `rooms/${code}/`;
    const updates = {};
    updates[base + "status"] = "playing";
    updates[base + "startedAt"] = now;
    updates[base + "endsAt"] = null;
    updates[base + "stocks"] = stocks;          // 전체 교체(새 종목 + 빈 history)
    updates[base + "logs"] = null;
    updates[base + "latestNews"] = null;
    updates[base + "botFeed"] = null;
    updates[base + "orders"] = null;
    updates[base + "ipo"] = null;
    updates[base + "joinRequests"] = null;
    updates[base + "marketTick"] = now;
    updates[base + "market"] = { tickMs: 4000, lastTickAt: now, lastHistoryAt: now };
    // 명단 유지 + 자산만 초기화 (nickname/connected/equippedBackground 등 다른 필드는 보존)
    const players = (room && room.players) || {};
    for (const uid of Object.keys(players)) {
      updates[base + `players/${uid}/cash`] = START;
      updates[base + `players/${uid}/holdings`] = null;
      updates[base + `players/${uid}/avgCost`] = null;
      updates[base + `players/${uid}/totalAsset`] = START;
    }
    updates[base + "meta/updatedAt"] = now;
    updates[base + "meta/lastResetAt"] = now;
    updates[base + "meta/lastResetBy"] = adminId || "admin";
    updates[base + "meta/deleted"] = false; // 혹시 soft-delete 상태였다면 해제
    await database.ref().update(updates);
    stat.lastWriteAt = now;
    return { code, players: Object.keys(players).length, stocks: Object.keys(stocks).length };
  }

  // ── MAIN(유지할 방) 외 전체 방 완전 삭제 ── 단일 방 운영 정리용. 삭제 전 전체 백업.
  async function purgeOtherRooms(keepCode, adminId) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    keepCode = (keepCode || "MAIN").toUpperCase();
    const snap = await database.ref("rooms").once("value");
    const rooms = snap.exists() ? snap.val() : {};
    const codes = Object.keys(rooms).filter((c) => c !== keepCode);
    if (!codes.length) return { removed: 0, kept: keepCode, codes: [] };
    // 되돌릴 수 없으므로 전체 rooms 백업 1회
    try { backup("ALL_ROOMS", rooms, `purge other rooms (keep ${keepCode}) by ${adminId || "admin"}`, "Firebase"); } catch (e) {}
    const updates = {};
    for (const c of codes) updates[`rooms/${c}`] = null; // 각 방만 null → 완전 삭제
    await database.ref().update(updates);
    stat.lastWriteAt = Date.now();
    return { removed: codes.length, kept: keepCode, codes };
  }

  // 방 복구 (soft delete 취소) — meta 플래그만 제거성 update
  async function restoreRoom(code, adminId) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    if (!code) throw new Error("roomCode 없음");
    const now = Date.now();
    await database.ref().update({
      [`rooms/${code}/meta/deleted`]: false,
      [`rooms/${code}/meta/deletedAt`]: null,
      [`rooms/${code}/meta/deletedBy`]: null,
      [`rooms/${code}/meta/status`]: null,
      [`rooms/${code}/meta/restoredAt`]: now,
      [`rooms/${code}/meta/restoredBy`]: adminId || "admin",
      [`rooms/${code}/meta/updatedAt`]: now,
    });
    stat.lastWriteAt = now;
    return { code, restoredAt: now };
  }

  // ── 패치 후 강제 새로고침 브로드캐스트 ──
  // broadcast/reloadAt 에 현재 시각을 써서, 접속 중인 모든 battle 클라이언트가
  // 시장 데이터를 유지한 채 페이지만 새로고침하게 한다. (시장 재시작과 무관)
  async function forceReloadClients(adminId) {
    const database = db();
    if (!database) throw new Error("Firebase 미연결");
    const now = Date.now();
    // 단일 방 운영: 루트 broadcast 는 보안 규칙상 쓰기 거부 → rooms/MAIN 아래(쓰기 허용)로 신호를 쓴다.
    await database.ref().update({
      "rooms/MAIN/broadcast/reloadAt": now,
      "rooms/MAIN/broadcast/reloadBy": adminId || "admin",
    });
    stat.lastWriteAt = now;
    return { at: now };
  }

  // ── 캐시 (선택적) ──
  function cache(code, room) {
    try { localStorage.setItem(STORAGE.cachePrefix + code, JSON.stringify({ at: Date.now(), room })); } catch (e) {}
  }
  function getCache(code) {
    try { return JSON.parse(localStorage.getItem(STORAGE.cachePrefix + code) || "null"); } catch (e) { return null; }
  }

  function getStat() { return { ...stat }; }

  window.RoomBridge = {
    STORAGE,
    loadRoom,
    roomToCompanies,
    roomToNews,
    roomToDisclosures,
    buildUpdates,
    savePartial,
    applyRaw,
    loadJoinRequests,
    approveJoinRequest,
    rejectJoinRequest,
    loadAllRooms,
    runCatchUp,
    setMarketHours,
    softDeleteRoom,
    hardDeleteRoom,
    restoreRoom,
    resetMarket,
    purgeOtherRooms,
    forceReloadClients,
    backup,
    listBackups,
    getBackup,
    cache,
    getCache,
    getStat,
    hasFirebase: () => !!db(),
  };
})();
