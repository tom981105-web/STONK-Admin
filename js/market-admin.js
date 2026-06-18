(function () {
  "use strict";

  const D = window.MarketAdminData;
  if (!D) return;

  // 편집 가능한 컬렉션(레거시 4종 + 방 전용 공시). 레거시 저장 루프는 D.COLLECTIONS 만 사용.
  const EDIT_COLLECTIONS = [...D.COLLECTIONS, "disclosures"];

  const state = {
    dataset: D.createEmptyDataset(),
    selected: { companies: null, news: null, sectors: null, wikiDocs: null, disclosures: null },
    creating: { companies: false, news: false, sectors: false, wikiDocs: false, disclosures: false },
    filters: {
      companies: { query: "", value: "" },
      news: { query: "", value: "" },
      sectors: { query: "", value: "" },
      wikiDocs: { query: "", value: "" },
      disclosures: { query: "", value: "" }
    },
    previewMode: "companies",
    previewQuery: "",
    validation: null,
    db: null,
    auth: null,
    user: null,
    admin: false,
    firebaseReady: false,
    storageMode: "localStorage",
    activeTab: "rooms",
    // Phase 2: rooms/{roomCode} 연동
    roomCode: "",
    roomData: null,      // 마지막으로 읽은 원본 room (부분 update diff 기준)
    roomMode: false,     // true 면 저장 대상이 rooms/{code}, false 면 레거시 marketAdmin/*
    roomLoaded: false,
    // 1.4.0 방 관리
    allRooms: [],        // 전체 방 요약 캐시 (수동 새로고침)
    dbAdmin: false       // /admins/{uid}=true 로 확인된 관리자
  };

  let pendingDeleteCode = "";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindEvents();
    renderPathList();
    loadLocalDataset();
    state.roomCode = detectRoomCode();
    const roomInput = $("#roomCodeInput");
    if (roomInput && state.roomCode) roomInput.value = state.roomCode;
    ensureSelections();
    renderAll();
    renderRoomStatus();
    showAuthGate("관리자 인증 확인 중");
    if (isDevAdmin()) {
      allowAdmin("개발 관리자");
    }
    void initFirebase();
  }

  // roomCode 인식 우선순위: URL room/roomCode/roomId → 입력값 → stonk:lastRoomCode → 레거시
  function detectRoomCode() {
    const SC = window.SiteConfig;
    let code = "";
    if (SC) code = SC.getUrlRoomCode() || "";
    if (!code) {
      const inputVal = $("#roomCodeInput") && $("#roomCodeInput").value;
      code = SC ? SC.normalizeRoomCode(inputVal) : String(inputVal || "").trim().toUpperCase();
    }
    if (!code && SC) code = SC.getLastRoomCode() || "";
    return code;
  }

  function bindEvents() {
    $$(".tab-button").forEach((button) => {
      button.addEventListener("click", () => activateTab(button.dataset.tab));
    });

    document.addEventListener("click", (event) => {
      const newButton = event.target.closest("[data-new]");
      if (newButton) {
        beginCreate(newButton.dataset.new);
        return;
      }

      const editButton = event.target.closest("[data-edit]");
      if (editButton) {
        selectItem(editButton.dataset.collection, editButton.dataset.edit);
        return;
      }

      const deleteButton = event.target.closest("[data-delete]");
      if (deleteButton) {
        void deleteItem(deleteButton.dataset.collection, deleteButton.dataset.delete);
        return;
      }

      const deleteFormButton = event.target.closest("[data-delete-form]");
      if (deleteFormButton) {
        const collection = deleteFormButton.dataset.deleteForm;
        const id = state.selected[collection];
        if (id) void deleteItem(collection, id);
        return;
      }

      const resetButton = event.target.closest("[data-reset-form]");
      if (resetButton) {
        renderForm(resetButton.dataset.resetForm);
      }
    });

    document.addEventListener("submit", (event) => {
      const form = event.target.closest("[data-form]");
      if (form) {
        event.preventDefault();
        void saveItem(form.dataset.form);
      }
    });

    $$("[data-search]").forEach((input) => {
      input.addEventListener("input", () => {
        state.filters[input.dataset.search].query = input.value;
        renderList(input.dataset.search);
      });
    });

    $$("[data-filter]").forEach((select) => {
      select.addEventListener("change", () => {
        state.filters[select.dataset.filter].value = select.value;
        renderList(select.dataset.filter);
      });
    });

    $("#reloadData").addEventListener("click", () => {
      void reloadData();
    });
    $("#saveAll").addEventListener("click", () => {
      void saveAllData();
    });
    $("#validateFromDashboard").addEventListener("click", () => {
      runValidation();
      activateTab("dashboard");
    });
    $("#createSamples").addEventListener("click", () => {
      void createSamples();
    });
    $("#validateData").addEventListener("click", runValidation);
    $("#exportData").addEventListener("click", exportData);
    $("#copyExport").addEventListener("click", () => {
      void copyExport();
    });
    $("#importData").addEventListener("click", () => {
      void importDataFromText();
    });
    $("#importFile").addEventListener("change", importDataFromFile);

    $("#previewMode").addEventListener("change", (event) => {
      state.previewMode = event.target.value;
      renderPreview();
    });
    $("#previewSearch").addEventListener("input", (event) => {
      state.previewQuery = event.target.value;
      renderPreview();
    });

    // Phase 2: 방 연동 버튼
    const loadRoomBtn = $("#loadRoomBtn");
    if (loadRoomBtn) loadRoomBtn.addEventListener("click", () => { void onLoadRoomClick(); });
    const saveRoomBtn = $("#saveRoomBtn");
    if (saveRoomBtn) saveRoomBtn.addEventListener("click", () => { void saveRoomDataset({ manual: true }); });
    const roomInput = $("#roomCodeInput");
    if (roomInput) {
      roomInput.addEventListener("input", () => {
        const SC = window.SiteConfig;
        roomInput.value = SC ? SC.normalizeRoomCode(roomInput.value) : roomInput.value.toUpperCase();
      });
      roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void onLoadRoomClick(); } });
    }
    const refreshBackups = $("#refreshBackups");
    if (refreshBackups) refreshBackups.addEventListener("click", renderBackups);
    const exportRoomBtn = $("#exportRoomBtn");
    if (exportRoomBtn) exportRoomBtn.addEventListener("click", exportRoom);
    const copyRoomExport = $("#copyRoomExport");
    if (copyRoomExport) copyRoomExport.addEventListener("click", () => { void copyRoomExportText(); });
    const refreshDebug = $("#refreshDebug");
    if (refreshDebug) refreshDebug.addEventListener("click", renderDebug);
    const refreshJoin = $("#refreshJoinRequests");
    if (refreshJoin) refreshJoin.addEventListener("click", () => { void renderJoinRequests(); });

    // 1.4.0 전체 방 관리
    const refreshRoomsBtn = $("#refreshRooms");
    if (refreshRoomsBtn) refreshRoomsBtn.addEventListener("click", () => { void renderRooms(); });
    const resetMarketBtn = $("#resetMarketBtn");
    if (resetMarketBtn) resetMarketBtn.addEventListener("click", () => { void resetMarketNow(); });
    const purgeRoomsBtn = $("#purgeRoomsBtn");
    if (purgeRoomsBtn) purgeRoomsBtn.addEventListener("click", () => { void purgeOtherRoomsNow(); });
    const roomsSearch = $("#roomsSearch");
    if (roomsSearch) roomsSearch.addEventListener("input", renderRoomsList);
    const roomsFilter = $("#roomsStatusFilter");
    if (roomsFilter) roomsFilter.addEventListener("change", renderRoomsList);
    // 방 삭제 모달
    const delCancel = $("#deleteRoomCancel");
    if (delCancel) delCancel.addEventListener("click", closeDeleteModal);
    const delConfirm = $("#deleteRoomConfirm");
    if (delConfirm) delConfirm.addEventListener("click", () => { void confirmDeleteRoom(); });
    const delHard = $("#deleteRoomHard");
    if (delHard) delHard.addEventListener("click", () => { void confirmHardDeleteRoom(); });
    const delInput = $("#deleteRoomConfirmInput");
    if (delInput) delInput.addEventListener("input", () => {
      const v = (delInput.value || "").trim().toUpperCase();
      const match = !!(v && v === pendingDeleteCode);
      const sBtn = $("#deleteRoomConfirm"); if (sBtn) sBtn.disabled = !match;
      const hBtn = $("#deleteRoomHard"); if (hBtn) hBtn.disabled = !match;
    });
    const delOverlay = $("#deleteRoomModal");
    if (delOverlay) delOverlay.addEventListener("click", (e) => { if (e.target === delOverlay) closeDeleteModal(); });
    // 관리자 UID 칩 / 권한없음 게이트
    const uidChip = $("#adminUidChip");
    if (uidChip) uidChip.addEventListener("click", () => { void copyText(adminUid()); });
    const denyCopy = $("#denyCopyUid");
    if (denyCopy) denyCopy.addEventListener("click", () => { void copyText((state.user && state.user.uid) || ""); });
    const denySignOut = $("#denySignOut");
    if (denySignOut) denySignOut.addEventListener("click", () => { if (state.auth) state.auth.signOut(); });

    $("#authForm").addEventListener("submit", (event) => {
      event.preventDefault();
      void signIn();
    });
    $("#devAdminButton").addEventListener("click", () => {
      localStorage.setItem(D.STORAGE_KEYS.devAdmin, "true");
      allowAdmin("개발 관리자");
      toast("개발 관리자 모드가 활성화되었습니다.", "ok");
    });
  }

  function activateTab(tab) {
    state.activeTab = tab;
    $$(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
    if (tab === "preview") renderPreview();
    if (tab === "backup") renderBackups();
    if (tab === "debug") renderDebug();
    if (tab === "disclosures") renderDisclosuresHint();
    if (tab === "joinRequests") void renderJoinRequests();
    if (tab === "rooms") void renderRooms();
  }

  function showAuthGate(message) {
    $("#authGate").classList.remove("hidden");
    $("#authMessage").textContent = message || "관리자 로그인이 필요합니다.";
    setAdminBadge("warn", "권한 필요");
  }

  function hideAuthGate() {
    $("#authGate").classList.add("hidden");
  }

  function allowAdmin(label) {
    state.admin = true;
    hideAuthGate();
    hideDenied();
    setAdminBadge("ok", label || "관리자");
    updateAdminUidChip();
    if (state.activeTab === "rooms") void renderRooms();
  }

  function hideDenied() {
    const dg = $("#denyGate");
    if (dg) dg.classList.add("hidden");
  }

  // 권한 게이팅: 개발모드 → 하드코딩 관리자 → /admins/{uid}=true 순. 모두 아니면 차단.
  async function resolveAndGate(user) {
    state.user = user || null;
    if (isDevAdmin()) { allowAdmin("개발 관리자"); void loadActiveDataset(); return; }
    if (isAdminUser(user)) { allowAdmin("Firebase 관리자"); void loadActiveDataset(); return; }
    if (user && state.db) {
      try {
        const snap = await state.db.ref("admins/" + user.uid).once("value");
        if (snap.val() === true) {
          state.dbAdmin = true;
          allowAdmin("관리자(admins)");
          void loadActiveDataset();
          return;
        }
      } catch (e) {}
    }
    state.admin = false;
    state.dbAdmin = false;
    if (user) showDenied(user.uid);            // 로그인했지만 관리자 아님
    else showAuthGate("관리자 계정으로 로그인하세요."); // 미로그인
  }

  function showDenied(uid) {
    hideAuthGate();
    const dg = $("#denyGate");
    if (dg) dg.classList.remove("hidden");
    const u = $("#denyUid");
    if (u) u.textContent = uid || "(없음)";
    setAdminBadge("warn", "권한 없음");
    updateAdminUidChip();
    const SC = window.SiteConfig;
    if (SC) {
      const code = state.roomCode || (SC.getCurrentRoomCode ? SC.getCurrentRoomCode() : "");
      const set = (id, url) => { const a = $("#" + id); if (a) a.href = url; };
      set("denyNavBattle", SC.buildBattleUrl(code));
      set("denyNavBoard", SC.buildBoardUrl(code));
      set("denyNavWiki", SC.buildWikiUrl(code, ""));
    }
  }

  function adminUid() {
    return (state.user && state.user.uid) || (isDevAdmin() ? "devAdmin" : "");
  }

  function updateAdminUidChip() {
    const chip = $("#adminUidChip");
    if (!chip) return;
    const uid = adminUid();
    if (!uid) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = "UID " + uid.slice(0, 8) + "…";
    chip.title = "관리자 UID: " + uid + " (클릭하여 복사)";
  }

  async function copyText(text) {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast("복사했습니다.", "ok"); }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast("복사했습니다.", "ok"); } catch (e2) {}
      ta.remove();
    }
  }

  function isAdminUser(user) {
    return Boolean(user && D.ADMIN_UIDS.includes(user.uid));
  }

  function isDevAdmin() {
    return localStorage.getItem(D.STORAGE_KEYS.devAdmin) === "true";
  }

  async function initFirebase() {
    const forceFirebase = new URLSearchParams(location.search).get("firebase") === "1";
    if (location.protocol === "file:" && !forceFirebase && !(window.firebase && window.firebase.database)) {
      state.storageMode = "localStorage";
      setConnectionBadge("warn", "file localStorage fallback");
      if (isDevAdmin()) {
        allowAdmin("개발 관리자");
      } else {
        showAuthGate("파일 접속은 localStorage fallback으로 실행됩니다.");
      }
      return;
    }
    setConnectionBadge("warn", "Firebase 연결 중");
    try {
      for (const src of D.FIREBASE_SDK) {
        await loadScript(src);
      }
      if (!window.firebase || !window.firebase.auth || !window.firebase.database) {
        throw new Error("Firebase SDK unavailable");
      }
      if (!window.firebase.apps.length) {
        window.firebase.initializeApp(D.FIREBASE_CONFIG);
      }
      state.db = window.firebase.database();
      state.auth = window.firebase.auth();
      state.firebaseReady = true;
      state.storageMode = "Firebase";
      setConnectionBadge("ok", "Firebase 연결됨");
      state.auth.onAuthStateChanged((user) => {
        state.user = user || null;
        void resolveAndGate(user);
      });
    } catch (error) {
      state.db = null;
      state.auth = null;
      state.firebaseReady = false;
      state.storageMode = "localStorage";
      setConnectionBadge("warn", "localStorage fallback");
      if (isDevAdmin()) {
        allowAdmin("개발 관리자");
      } else {
        showAuthGate("Firebase 연결 실패. 개발 모드 또는 로그인 필요.");
      }
      toast("Firebase 연결에 실패해 localStorage fallback을 사용합니다.", "warn");
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
          return;
        }
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("script load failed")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.loaded = "false";
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve();
      }, { once: true });
      script.addEventListener("error", () => reject(new Error("script load failed")), { once: true });
      document.head.appendChild(script);
    });
  }

  async function signIn() {
    if (!state.auth) {
      $("#authMessage").textContent = "Firebase 인증 모듈을 사용할 수 없습니다.";
      return;
    }
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    if (!email || !password) {
      $("#authMessage").textContent = "이메일과 비밀번호를 입력하세요.";
      return;
    }
    $("#authMessage").textContent = "로그인 확인 중";
    try {
      const credential = await state.auth.signInWithEmailAndPassword(email, password);
      if (!isAdminUser(credential.user)) {
        await state.auth.signOut();
        $("#authMessage").textContent = "관리자 UID가 아닙니다.";
      }
    } catch (error) {
      $("#authMessage").textContent = "로그인 실패. 계정을 확인하세요.";
    }
  }

  function trimPath(path) {
    return String(path || "").replace(/^\/+/, "");
  }

  function toFirebaseMap(list) {
    const map = {};
    (list || []).forEach((item) => {
      map[item.id] = item;
    });
    return Object.keys(map).length ? map : null;
  }

  async function loadFirebaseDataset() {
    if (!state.db || !state.admin) return;
    try {
      const snaps = await Promise.all([
        state.db.ref(trimPath(D.PATHS.companies)).once("value"),
        state.db.ref(trimPath(D.PATHS.news)).once("value"),
        state.db.ref(trimPath(D.PATHS.sectors)).once("value"),
        state.db.ref(trimPath(D.PATHS.wikiDocs)).once("value"),
        state.db.ref(trimPath(D.PATHS.meta)).once("value")
      ]);
      const remote = {
        companies: snaps[0].val(),
        news: snaps[1].val(),
        sectors: snaps[2].val(),
        wikiDocs: snaps[3].val(),
        meta: snaps[4].val()
      };
      const hasRemote = D.COLLECTIONS.some((collection) => {
        const value = remote[collection];
        return value && (Array.isArray(value) ? value.length : Object.keys(value).length);
      });
      if (hasRemote) {
        state.dataset = D.normalizeDataset(remote);
        state.storageMode = "Firebase";
        saveLocalDataset();
        resetCreateState();
        ensureSelections();
        renderAll();
        toast("Firebase 데이터를 불러왔습니다.", "ok");
      }
    } catch (error) {
      state.storageMode = "localStorage";
      setConnectionBadge("warn", "localStorage fallback");
      toast("Firebase 읽기 실패. localStorage 데이터를 유지합니다.", "warn");
    }
  }

  // ===== Phase 2: rooms/{roomCode} 연동 =====
  function loadActiveDataset() {
    if (state.roomCode && window.RoomBridge && window.RoomBridge.hasFirebase()) {
      return loadRoomDataset();
    }
    return loadFirebaseDataset();
  }

  async function onLoadRoomClick() {
    const SC = window.SiteConfig;
    const input = $("#roomCodeInput");
    const code = SC ? SC.normalizeRoomCode(input && input.value) : String((input && input.value) || "").trim().toUpperCase();
    if (!code) { toast("방 코드를 입력하세요.", "warn"); return; }
    state.roomCode = code;
    if (SC) SC.setLastRoomCode(code);
    await loadRoomDataset();
  }

  async function loadRoomDataset() {
    const code = state.roomCode;
    const RB = window.RoomBridge;
    if (!code) { setRoomNotice("방 코드가 없습니다. 상단에서 방 코드를 입력하세요.", "warn"); return; }
    if (!RB || !RB.hasFirebase()) {
      state.roomMode = false;
      setRoomNotice("Firebase 미연결 — 방 연동은 Firebase가 필요합니다. 레거시 marketAdmin/* 데이터로 표시합니다.", "warn");
      await loadFirebaseDataset();
      renderRoomStatus();
      return;
    }
    try {
      const room = await RB.loadRoom(code);
      if (!room) {
        state.roomMode = false;
        state.roomLoaded = false;
        state.roomData = null;
        const legacy = hasLegacyMarketAdmin();
        setRoomNotice(
          `rooms/${code} 데이터가 없습니다. (새로 만들지 않음) ` +
          (legacy ? "레거시 marketAdmin/* 데이터가 있어 fallback으로 표시합니다." : "표시할 데이터가 없습니다."),
          "warn"
        );
        await loadFirebaseDataset();
        renderRoomStatus();
        toast(`'${code}' 방 데이터 없음.`, "warn");
        return;
      }
      state.roomData = room;
      state.roomMode = true;
      state.roomLoaded = true;
      RB.cache(code, room);
      // room → admin dataset (회사/뉴스/공시는 room 기준, 업종/Wiki문서는 레거시 유지)
      state.dataset.companies = RB.roomToCompanies(room).map((c) => D.normalizeItem("companies", c));
      state.dataset.news = RB.roomToNews(room).map((n) => D.normalizeItem("news", n));
      state.dataset.disclosures = RB.roomToDisclosures(room);
      mergeRoomSectors(); // 방 업종을 업종 관리 목록에 자동 보강 → 검증 경고 정리
      resetCreateState();
      ensureSelections();
      saveLocalDataset();
      renderAll();
      renderRoomStatus();
      setRoomNotice("", "");
      toast(`rooms/${code} 로드 완료 · 회사 ${state.dataset.companies.length} · 뉴스 ${state.dataset.news.length}`, "ok");
    } catch (error) {
      state.roomMode = false;
      setRoomNotice("방 데이터 로드 실패: " + (error && error.message), "error");
      toast("방 데이터 로드 실패.", "error");
    }
  }

  async function saveRoomDataset(opts = {}) {
    if (!state.admin) { showAuthGate("저장하려면 관리자 권한이 필요합니다."); return false; }
    const code = state.roomCode;
    const RB = window.RoomBridge;
    if (!code) { toast("방 코드가 없어 저장하지 않았습니다.", "error"); return false; }
    if (!RB) { toast("room-bridge 미로드.", "error"); return false; }
    // normalizeDataset 은 disclosures 를 모르므로 보존했다가 복원
    const keepDisclosures = Array.isArray(state.dataset.disclosures) ? state.dataset.disclosures : [];
    state.dataset = D.normalizeDataset(state.dataset);
    state.dataset.disclosures = keepDisclosures;
    saveLocalDataset();
    if (!RB.hasFirebase()) {
      // Firebase 불가 — 백업만 생성하고 안내
      RB.backup(code, state.roomData, "Firebase 미연결 저장 시도", "localStorage");
      state.storageMode = "localStorage";
      setConnectionBadge("warn", "localStorage fallback");
      toast("Firebase 미연결 — 백업만 생성했습니다. 연결 후 다시 저장하세요.", "warn");
      renderRoomStatus();
      return false;
    }
    try {
      const res = await RB.savePartial(code, state.dataset, state.roomData, {
        summary: `회사 ${state.dataset.companies.length} · 뉴스 ${state.dataset.news.length} · 공시 ${(state.dataset.disclosures || []).length}`,
      });
      // 저장 후 baseline 갱신 (다음 diff 정확도) — tick 과 무관한 1회 읽기
      state.roomData = await RB.loadRoom(code);
      RB.cache(code, state.roomData);
      state.storageMode = "Firebase";
      setConnectionBadge("ok", "Firebase 저장됨");
      renderRoomStatus();
      renderDebug();
      if (!opts.quiet) toast(`rooms/${code} 저장 완료 (${res.paths}개 경로 update).`, "ok");
      return true;
    } catch (error) {
      state.storageMode = "localStorage";
      setConnectionBadge("warn", "localStorage fallback");
      toast("Firebase 저장 실패 — 직전 백업이 보존되어 있습니다.", "error");
      renderRoomStatus();
      return false;
    }
  }

  function hasLegacyMarketAdmin() {
    return D.COLLECTIONS.some((c) => (state.dataset[c] || []).length);
  }

  function setRoomNotice(text, type) {
    const el = $("#roomNotice");
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ""; el.className = "room-notice"; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = "room-notice " + (type || "");
  }

  function renderRoomStatus() {
    const SC = window.SiteConfig;
    const code = state.roomCode || "";
    const counts = countMap();
    const el = $("#roomStatus");
    if (el) {
      el.innerHTML = [
        chip(code ? "방 " + code : "방 미지정", code ? "ok" : "warn"),
        chip(state.roomMode ? "rooms/" + code : "레거시 marketAdmin/*", state.roomMode ? "ok" : "muted"),
        chip("저장소 " + state.storageMode, state.storageMode === "Firebase" ? "ok" : "warn"),
        chip("회사 " + counts.companies, "muted"),
        chip("뉴스 " + counts.news, "muted"),
        chip("공시 " + ((state.dataset.disclosures || []).length), "muted"),
      ].join("");
    }
    // 상단 바 roomBadge + 사이트 이동 링크 갱신
    const rb = $("#roomBadge");
    if (rb) rb.textContent = "방: " + (code || "미지정");
    if (SC) {
      const setHref = (id, url) => { const a = $("#" + id); if (a) a.href = url; };
      setHref("navBattle", SC.buildBattleUrl(code));
      setHref("navBoard", SC.buildBoardUrl(code));
      setHref("navWiki", SC.buildWikiUrl(code, ""));
    }
  }

  function chip(text, type) {
    return `<span class="status-badge ${type || "muted"}">${esc(text)}</span>`;
  }

  function renderBackups() {
    const root = $("#backupList");
    if (!root) return;
    const RB = window.RoomBridge;
    const code = state.roomCode;
    if (!RB || !code) { root.innerHTML = `<div class="activity-item">방 코드를 먼저 지정하세요.</div>`; return; }
    const keys = RB.listBackups(code);
    if (!keys.length) { root.innerHTML = `<div class="activity-item">백업이 없습니다.</div>`; return; }
    root.innerHTML = keys.map((k) => {
      const b = RB.getBackup(k) || {};
      return `<div class="activity-item"><strong>${esc(b.savedAt || k)}</strong><div class="item-meta">${esc(b.summary || "")} · ${esc(b.storageMode || "")}</div>
        <button class="button small" type="button" data-view-backup="${escAttr(k)}">JSON 보기</button></div>`;
    }).join("");
    root.querySelectorAll("[data-view-backup]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const b = RB.getBackup(btn.dataset.viewBackup);
        const ta = $("#roomExportJson");
        if (ta) ta.value = JSON.stringify(b, null, 2);
        activateTab("backup");
        toast("백업 JSON을 내보내기 영역에 표시했습니다.", "ok");
      });
    });
  }

  function exportRoom() {
    const RB = window.RoomBridge;
    const code = state.roomCode;
    const bundle = {
      roomCode: code,
      exportedAt: D.nowISO(),
      roomMode: state.roomMode,
      roomData: state.roomData,
      pendingUpdates: RB && code ? RB.buildUpdates(code, state.dataset, state.roomData) : null,
    };
    const ta = $("#roomExportJson");
    if (ta) ta.value = JSON.stringify(bundle, null, 2);
    toast("현재 방 데이터를 내보냈습니다.", "ok");
  }

  async function copyRoomExportText() {
    const ta = $("#roomExportJson");
    if (!ta) return;
    if (!ta.value) exportRoom();
    try { await navigator.clipboard.writeText(ta.value); toast("복사했습니다.", "ok"); }
    catch (e) { ta.focus(); ta.select(); document.execCommand("copy"); toast("복사했습니다.", "ok"); }
  }

  function renderDebug() {
    const root = $("#debugList");
    if (!root) return;
    const SC = window.SiteConfig;
    const RB = window.RoomBridge;
    const st = RB ? RB.getStat() : {};
    const code = state.roomCode || "";
    const counts = countMap();
    const rows = [
      ["siteName", "STONK Admin"],
      ["roomCode", code || "(미지정)"],
      ["storageMode", state.storageMode],
      ["roomMode", state.roomMode ? "rooms/{code} 직접 저장" : "레거시 marketAdmin/*"],
      ["Firebase 연결", (RB && RB.hasFirebase()) ? "가능" : "불가"],
      ["roomData 존재", state.roomData ? "있음" : "없음"],
      ["companies", String(counts.companies)],
      ["news", String(counts.news)],
      ["disclosures", String((state.dataset.disclosures || []).length)],
      ["마지막 Firebase 읽기", fmtTime(st.lastReadAt)],
      ["마지막 Firebase 쓰기", fmtTime(st.lastWriteAt)],
      ["마지막 localStorage 백업", fmtTime(st.lastBackupAt)],
      ["마지막 백업 key", st.lastBackupKey || "(없음)"],
      ["admin base URL", location.origin + location.pathname],
      ["rooms 경로", code ? "rooms/" + code : "(미지정)"],
      ["legacy marketAdmin/*", hasLegacyMarketAdmin() ? "데이터 있음" : "없음"],
      ["battle URL", SC ? SC.buildBattleUrl(code) : "-"],
      ["board URL", SC ? SC.buildBoardUrl(code) : "-"],
      ["wiki URL", SC ? SC.buildWikiUrl(code, "") : "-"],
      ["admin URL", SC ? SC.buildAdminUrl(code) : "-"],
    ];
    root.innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
  }

  function fmtTime(ms) {
    if (!ms) return "(없음)";
    try { return new Date(ms).toLocaleString("ko-KR"); } catch (e) { return String(ms); }
  }

  function setNoticeEl(el, text, type) {
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ""; el.className = "room-notice"; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = "room-notice " + (type || "");
  }

  // ===== Phase 3: 공시 탭 안내 =====
  function renderDisclosuresHint() {
    const el = $("#disclosuresRoomHint");
    if (!el) return;
    if (state.roomMode && state.roomCode) {
      setNoticeEl(el, `rooms/${state.roomCode}/disclosures 에 저장됩니다. 저장 시 변경된 공시만 부분 update 됩니다.`, "");
    } else {
      setNoticeEl(el, "공시는 방(rooms/{code}) 전용입니다. 상단에서 방을 먼저 불러오세요. (방 미연결 시 로컬에만 보관)", "warn");
    }
  }

  // ===== Phase 3: 중간 참여 신청 승인 =====
  async function renderJoinRequests() {
    const root = $("#joinRequestsList");
    const notice = $("#joinRequestsNotice");
    const countBadge = $("#joinPendingCount");
    if (!root) return;
    const RB = window.RoomBridge;
    const code = state.roomCode;
    if (!code) {
      setNoticeEl(notice, "방 코드를 먼저 지정하세요. 상단에서 방을 불러오면 해당 방의 신청을 봅니다.", "warn");
      root.innerHTML = "";
      if (countBadge) countBadge.textContent = "승인 대기 0";
      return;
    }
    if (!RB || !RB.hasFirebase()) {
      setNoticeEl(notice, "Firebase 미연결 — 참여 승인은 Firebase가 필요합니다.", "warn");
      root.innerHTML = "";
      return;
    }
    setNoticeEl(notice, "", "");
    let list;
    try {
      list = await RB.loadJoinRequests(code);
    } catch (e) {
      setNoticeEl(notice, "신청 목록 로드 실패: " + (e && e.message), "error");
      return;
    }
    const order = { pending: 0, approved: 1, joined: 2, rejected: 3, cancelled: 4 };
    list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (b.requestedAt || 0) - (a.requestedAt || 0));
    const pending = list.filter((r) => r.status === "pending").length;
    if (countBadge) countBadge.textContent = `승인 대기 ${pending}`;
    if (!list.length) {
      root.innerHTML = `<div class="activity-item">참여 신청이 없습니다.</div>`;
      return;
    }
    root.innerHTML = list.map((r) => joinRow(r)).join("");
    root.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => { void handleJoinDecision(b.dataset.approve, "approve"); }));
    root.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => { void handleJoinDecision(b.dataset.reject, "reject"); }));
  }

  function joinRow(r) {
    const statusLabel = { pending: "승인 대기", approved: "승인됨", joined: "참여 완료", rejected: "거절됨", cancelled: "취소됨" }[r.status] || r.status || "-";
    const statusType = r.status === "pending" ? "warn" : (r.status === "approved" || r.status === "joined") ? "ok" : "muted";
    const actions = r.status === "pending"
      ? `<button class="button small" type="button" data-approve="${escAttr(r.id)}">승인</button>
         <button class="button danger small" type="button" data-reject="${escAttr(r.id)}">거절</button>`
      : `<span class="muted small">처리 ${fmtTime(r.approvedAt || r.rejectedAt || r.joinedAt)}</span>`;
    return `<div class="activity-item">
      <strong>${esc(r.name || "(이름 없음)")}</strong> <span class="status-badge ${statusType}">${esc(statusLabel)}</span>
      <div class="item-meta">신청자 uid ${esc(String(r.uid || "").slice(0, 12))} · playerId ${esc(String(r.playerId || "").slice(0, 12))} · 신청 ${fmtTime(r.requestedAt)} · 요청 턴 ${esc(String(r.requestedTurn ?? "-"))}</div>
      <div class="item-actions">${actions}</div>
    </div>`;
  }

  async function handleJoinDecision(requestId, kind) {
    const RB = window.RoomBridge;
    const code = state.roomCode;
    if (!RB || !code || !requestId) return;
    const adminId = (state.user && state.user.uid) || "devAdmin";
    try {
      if (kind === "approve") {
        await RB.approveJoinRequest(code, requestId, adminId);
        toast("참여를 승인했습니다. 신청자가 확인 후 입장합니다.", "ok");
      } else {
        await RB.rejectJoinRequest(code, requestId, adminId);
        toast("참여를 거절했습니다.", "ok");
      }
      await renderJoinRequests();
      renderDebug();
    } catch (e) {
      toast((kind === "approve" ? "승인" : "거절") + " 실패: " + (e && e.message), "error");
    }
  }

  // ===== 1.4.0: 전체 방 관리 =====
  // 단일 방(MAIN) 시장 (재)시작 — 종목/뉴스/로그 새로 생성 + 플레이어 자산 초기화(명단 유지)
  async function resetMarketNow() {
    const RB = window.RoomBridge;
    const msg = $("#resetMarketMsg");
    if (!state.admin) { if (msg) msg.textContent = "관리자만 사용할 수 있습니다."; return; }
    if (!RB || !RB.resetMarket || !RB.hasFirebase()) { if (msg) msg.textContent = "Firebase 미연결 또는 RoomBridge 미로드"; return; }
    const ok = window.confirm(
      "단일 방(MAIN) 시장을 재시작합니다.\n\n· 새 종목·뉴스로 시장이 다시 시작됩니다\n· 모든 플레이어의 현금이 시작 자본으로 초기화됩니다 (보유 주식 정리)\n· 참가자 명단/닉네임은 유지됩니다\n\n진행할까요?"
    );
    if (!ok) return;
    if (msg) msg.textContent = "시장 재시작 중…";
    try {
      const res = await RB.resetMarket("MAIN", adminUid());
      if (msg) msg.textContent = `✅ 재시작 완료 — 종목 ${res.stocks}개 · 플레이어 ${res.players}명 초기화 (${new Date().toLocaleTimeString("ko-KR")})`;
      await renderRooms();
    } catch (e) {
      if (msg) msg.textContent = "❌ 실패: " + (e && e.message ? e.message : e);
    }
  }

  // MAIN 외 전체 방 완전 삭제
  async function purgeOtherRoomsNow() {
    const RB = window.RoomBridge;
    const msg = $("#resetMarketMsg");
    if (!state.admin) { if (msg) msg.textContent = "관리자만 사용할 수 있습니다."; return; }
    if (!RB || !RB.purgeOtherRooms || !RB.hasFirebase()) { if (msg) msg.textContent = "Firebase 미연결 또는 RoomBridge 미로드"; return; }
    const ok = window.confirm(
      "MAIN 방만 남기고 나머지 방을 모두 완전 삭제합니다.\n\n· 되돌릴 수 없습니다 (삭제 전 localStorage 백업은 생성)\n· MAIN 방의 데이터는 그대로 유지됩니다\n\n진행할까요?"
    );
    if (!ok) return;
    if (msg) msg.textContent = "방 정리 중…";
    try {
      const res = await RB.purgeOtherRooms("MAIN", adminUid());
      if (msg) msg.textContent = `✅ 완료 — MAIN 외 ${res.removed}개 방 삭제 (${new Date().toLocaleTimeString("ko-KR")})`;
      await renderRooms();
    } catch (e) {
      if (msg) msg.textContent = "❌ 실패: " + (e && e.message ? e.message : e);
    }
  }

  async function renderRooms() {
    const root = $("#roomsList");
    const notice = $("#roomsNotice");
    if (!root) return;
    if (!state.admin) { setNoticeEl(notice, "관리자만 사용할 수 있습니다.", "warn"); root.innerHTML = ""; return; }
    const RB = window.RoomBridge;
    if (!RB || !RB.hasFirebase()) { setNoticeEl(notice, "Firebase 미연결 — 전체 방 목록은 Firebase가 필요합니다.", "warn"); root.innerHTML = ""; return; }
    setNoticeEl(notice, "방 목록을 불러오는 중...", "");
    let rooms;
    try { rooms = await RB.loadAllRooms(); }
    catch (e) { setNoticeEl(notice, "방 목록 로드 실패: " + (e && e.message), "error"); return; }
    state.allRooms = rooms;
    setNoticeEl(notice, "", "");
    renderRoomsStats(rooms);
    renderRoomsList();
    renderDebug();
  }

  function renderRoomsStats(rooms) {
    const el = $("#roomsStats");
    if (!el) return;
    const live = rooms.filter((r) => !r.deleted);
    const playing = live.filter((r) => ["playing", "active", "running"].includes(r.status)).length;
    const waiting = live.filter((r) => r.status === "waiting").length;
    const ended = live.filter((r) => ["ended", "closed", "finished"].includes(r.status)).length;
    const deleted = rooms.filter((r) => r.deleted).length;
    const players = live.reduce((a, r) => a + r.players, 0);
    const pending = live.reduce((a, r) => a + r.pending, 0);
    el.innerHTML = [
      statCard("전체 방", rooms.length),
      statCard("진행 중", playing),
      statCard("대기 중", waiting),
      statCard("종료", ended),
      statCard("삭제", deleted),
      statCard("참여자", players),
      statCard("승인대기", pending),
    ].join("");
  }

  function renderRoomsList() {
    const root = $("#roomsList");
    if (!root) return;
    const q = ($("#roomsSearch") && $("#roomsSearch").value || "").trim().toUpperCase();
    const f = ($("#roomsStatusFilter") && $("#roomsStatusFilter").value) || "active";
    let rows = (state.allRooms || []).slice().filter((r) => {
      if (q && r.code.indexOf(q) < 0) return false;
      if (f === "all") return true;
      if (f === "deleted") return r.deleted;
      if (r.deleted) return false; // 기본/기타 필터에서는 삭제된 방 숨김
      if (f === "active") return ["waiting", "playing", "active", "running"].includes(r.status);
      if (f === "playing") return ["playing", "active", "running"].includes(r.status);
      if (f === "waiting") return r.status === "waiting";
      if (f === "ended") return ["ended", "closed", "finished"].includes(r.status);
      return true;
    });
    rows.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    const countBadge = $("#roomsCount");
    if (countBadge) countBadge.textContent = "방 " + rows.length;
    if (!rows.length) { root.innerHTML = `<div class="activity-item">표시할 방이 없습니다.</div>`; return; }
    root.innerHTML = rows.map(roomRow).join("");
    root.querySelectorAll("[data-room-select]").forEach((b) => b.addEventListener("click", () => { void selectRoom(b.dataset.roomSelect); }));
    root.querySelectorAll("[data-room-delete]").forEach((b) => b.addEventListener("click", () => openDeleteModal(b.dataset.roomDelete)));
    root.querySelectorAll("[data-room-restore]").forEach((b) => b.addEventListener("click", () => { void restoreRoomAction(b.dataset.roomRestore); }));
    root.querySelectorAll("[data-room-catchup]").forEach((b) => b.addEventListener("click", () => { void catchUpAction(b.dataset.roomCatchup, b); }));
  }

  function roomRow(r) {
    const SC = window.SiteConfig;
    const sel = r.code === state.roomCode ? " selected" : "";
    const statusType = r.deleted ? "muted" : ["playing", "active", "running"].includes(r.status) ? "ok" : r.status === "waiting" ? "warn" : "muted";
    const battle = SC ? SC.buildBattleUrl(r.code) : "#";
    const board = SC ? SC.buildBoardUrl(r.code) : "#";
    const wiki = SC ? SC.buildWikiUrl(r.code, "") : "#";
    const tail = r.deleted
      ? `<button class="button small" type="button" data-room-restore="${escAttr(r.code)}">복구</button>`
      : `<button class="button danger small" type="button" data-room-delete="${escAttr(r.code)}">삭제</button>`;
    // 시장 경과/보정 상태
    const isPlaying = ["playing", "active", "running"].includes(r.status);
    const staleTxt = r.lastTickAt
      ? (r.staleMin >= 2 ? `<span class="status-badge warn">${r.staleMin}분 정지</span>` : `<span class="status-badge ok">실시간</span>`)
      : `<span class="status-badge muted">tick 기록 없음</span>`;
    const catchBtn = (!r.deleted && isPlaying && r.staleMin >= 2)
      ? `<button class="button small" type="button" data-room-catchup="${escAttr(r.code)}">시장 경과 보정 실행</button>`
      : "";
    return `<article class="room-card${sel}">
      <div class="room-card-head">
        <button class="room-code-btn" type="button" data-room-select="${escAttr(r.code)}">${esc(r.code)}</button>
        <span class="status-badge ${statusType}">${esc(r.deleted ? "삭제됨" : r.status)}</span>
        ${isPlaying ? staleTxt : ""}
        ${r.pending ? `<span class="status-badge warn">승인대기 ${r.pending}</span>` : ""}
        ${r.code === state.roomCode ? `<span class="status-badge ok">선택됨</span>` : ""}
      </div>
      <div class="room-card-meta">참여 ${r.players} · 종목 ${r.stocks} · 뉴스 ${r.news} · 공시 ${r.disclosures} · 캔들 ${r.historyCandles}</div>
      <div class="room-card-meta muted">host ${esc((r.hostId || "-").slice(0, 8))} · 생성 ${esc(fmtTime(r.createdAt))} · 수정 ${esc(fmtTime(r.updatedAt))}</div>
      <div class="room-card-meta muted">최근 tick ${esc(fmtTime(r.lastTickAt))} · 최근 보정 ${esc(fmtTime(r.lastCatchupAt))}</div>
      <div class="room-card-actions">
        <button class="button small" type="button" data-room-select="${escAttr(r.code)}">선택·로드</button>
        <a class="button small" href="${escAttr(battle)}" target="_blank" rel="noopener">주식시장</a>
        <a class="button small" href="${escAttr(board)}" target="_blank" rel="noopener">주식소식</a>
        <a class="button small" href="${escAttr(wiki)}" target="_blank" rel="noopener">주식정보</a>
        ${catchBtn}
        ${tail}
      </div>
    </article>`;
  }

  // 보정 결과를 '전용 영구 영역'(#catchupResult)에 표시 — renderRooms 가 지우지 않는다.
  function showCatchupResult(code, res) {
    res = res || {};
    const el = $("#catchupResult");
    const n = (v) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
    const at = new Date().toLocaleTimeString("ko-KR", { hour12: false });
    let level, text;
    if (res.applied) {
      level = "ok";
      text = `✅ [${code}] 보정 완료 · 경과 ${n(res.elapsedMinutes)}분 · 변경 종목 ${n(res.changedStocks)}개 · 생성 캔들 ${n(res.generatedCandles)}개 · 갱신 ${at}`;
    } else if (res.skipped) {
      level = res.skippedReason === "locked" ? "error" : "warn";
      text = `⚠ [${code}] ${res.message || "보정 생략"} · 변경 종목 ${n(res.changedStocks)}개 · 생성 캔들 ${n(res.generatedCandles)}개`;
    } else {
      level = "error";
      text = `⛔ [${code}] 보정 실패 · ${res.message || res.reason || "알 수 없음"}`;
    }
    if (el) { el.hidden = false; el.className = "catchup-result " + level; el.textContent = text; }
    toast(text, level);
    return text;
  }

  async function catchUpAction(code, btn) {
    if (!code) return;
    const RB = window.RoomBridge;
    if (!RB || !RB.runCatchUp) { showCatchupResult(code, { message: "보정 기능 미로드 (market-history.js 확인)" }); return; }
    if (!confirm(`'${code}' 방의 시장 경과를 보정할까요?\n사람이 없던 시간을 압축 캔들로 반영하고 최종 가격을 갱신합니다.`)) return;
    if (btn) { btn.disabled = true; btn.textContent = "보정 중..."; }
    try {
      const res = await RB.runCatchUp(code, adminUid(), {});
      console.debug("[admin] runCatchUp 결과", code, res); // 디버그: 결과 객체 전체 출력
      await renderRooms();          // 목록 갱신 먼저(roomsNotice 는 비워짐)
      showCatchupResult(code, res); // 그 다음 영구 영역에 결과 표시 — 사라지지 않음
    } catch (e) {
      console.debug("[admin] runCatchUp 예외", code, e);
      const msg = e && /permission|denied/i.test(e.message || "") ? "권한 없음 (관리자 /admins 등록 또는 방장만 가능)" : (e && e.message) || "알 수 없는 오류";
      await renderRooms();
      showCatchupResult(code, { applied: false, success: false, skipped: false, message: msg });
      if (btn) { btn.disabled = false; btn.textContent = "시장 경과 보정 실행"; }
    }
  }

  async function selectRoom(code) {
    if (!code) return;
    state.roomCode = code;
    const input = $("#roomCodeInput");
    if (input) input.value = code;
    const SC = window.SiteConfig;
    if (SC) SC.setLastRoomCode(code);
    try { const u = new URL(location.href); u.searchParams.set("room", code); history.replaceState(null, "", u); } catch (e) {}
    await loadRoomDataset();
    renderRoomsList();
    toast(`방 ${code} 선택 · 데이터 로드`, "ok");
  }

  async function restoreRoomAction(code) {
    if (!state.admin || !code) return;
    if (!window.confirm(`방 ${code} 을(를) 복구할까요? (삭제 표시 해제)`)) return;
    const RB = window.RoomBridge;
    try {
      await RB.restoreRoom(code, adminUid());
      toast(`방 ${code} 복구 완료.`, "ok");
      await renderRooms();
    } catch (e) { toast("복구 실패: " + (e && e.message), "error"); }
  }

  // ----- 방 삭제 모달 (roomCode 재입력 필수) -----
  function openDeleteModal(code) {
    if (!state.admin) { toast("관리자만 삭제할 수 있습니다.", "error"); return; }
    pendingDeleteCode = code;
    const codeEl = $("#deleteRoomCode"); if (codeEl) codeEl.textContent = code;
    const input = $("#deleteRoomConfirmInput"); if (input) input.value = "";
    const confirm = $("#deleteRoomConfirm"); if (confirm) confirm.disabled = true;
    const hard = $("#deleteRoomHard"); if (hard) hard.disabled = true;
    const msg = $("#deleteRoomMsg"); if (msg) msg.textContent = "";
    const modal = $("#deleteRoomModal"); if (modal) modal.classList.remove("hidden");
    setTimeout(() => { if (input) input.focus(); }, 50);
  }

  function closeDeleteModal() {
    const modal = $("#deleteRoomModal"); if (modal) modal.classList.add("hidden");
    pendingDeleteCode = "";
  }

  async function confirmDeleteRoom() {
    if (!state.admin) { toast("관리자만 삭제할 수 있습니다.", "error"); return; }
    const code = pendingDeleteCode;
    const v = ($("#deleteRoomConfirmInput") && $("#deleteRoomConfirmInput").value || "").trim().toUpperCase();
    const msg = $("#deleteRoomMsg");
    if (!code || v !== code) { if (msg) msg.textContent = "방 코드가 일치하지 않습니다."; return; }
    const RB = window.RoomBridge;
    try {
      await RB.softDeleteRoom(code, adminUid(), null);
      toast(`방 ${code} 삭제 표시(soft delete) 완료. 백업 생성됨.`, "ok");
      closeDeleteModal();
      await renderRooms();
    } catch (e) {
      if (msg) msg.textContent = "삭제 실패: " + (e && e.message);
    }
  }

  async function confirmHardDeleteRoom() {
    if (!state.admin) { toast("관리자만 삭제할 수 있습니다.", "error"); return; }
    const code = pendingDeleteCode;
    const v = ($("#deleteRoomConfirmInput") && $("#deleteRoomConfirmInput").value || "").trim().toUpperCase();
    const msg = $("#deleteRoomMsg");
    if (!code || v !== code) { if (msg) msg.textContent = "방 코드가 일치하지 않습니다."; return; }
    if (!window.confirm(`방 ${code} 을(를) 완전 삭제합니다. 되돌릴 수 없습니다. 진행할까요?`)) return;
    const RB = window.RoomBridge;
    try {
      const res = await RB.hardDeleteRoom(code, adminUid(), null);
      toast(`방 ${code} 완전 삭제 완료. 백업: ${res && res.backupKey ? "생성됨" : "시도"}.`, "ok");
      closeDeleteModal();
      await renderRooms();
    } catch (e) {
      if (msg) msg.textContent = "완전 삭제 실패: " + (e && e.message);
    }
  }

  async function saveAllData(options = {}) {
    if (!state.admin) {
      showAuthGate("저장하려면 관리자 권한이 필요합니다.");
      toast("관리자 권한이 없어 저장하지 않았습니다.", "error");
      return false;
    }
    touchMeta();
    state.dataset = D.normalizeDataset(state.dataset);
    saveLocalDataset();
    if (!state.db) {
      state.storageMode = "localStorage";
      setConnectionBadge("warn", "localStorage fallback");
      if (!options.quiet) toast("localStorage에 저장했습니다.", "ok");
      renderAll();
      return true;
    }
    try {
      const meta = {
        ...state.dataset.meta,
        version: D.VERSION,
        updatedAt: D.nowISO(),
        counts: countMap(),
        localStorageFallbackKey: D.STORAGE_KEYS.dataset,
        compatRoomPath: D.PATHS.compatRoom
      };
      const compatRoom = {
        ...D.roomCompat(state.dataset),
        roomCode: "ADMIN1",
        marketAdminUpdatedAt: meta.updatedAt
      };
      const updates = {
        [trimPath(D.PATHS.companies)]: toFirebaseMap(state.dataset.companies),
        [trimPath(D.PATHS.news)]: toFirebaseMap(state.dataset.news),
        [trimPath(D.PATHS.sectors)]: toFirebaseMap(state.dataset.sectors),
        [trimPath(D.PATHS.wikiDocs)]: toFirebaseMap(state.dataset.wikiDocs),
        [trimPath(D.PATHS.meta)]: meta,
        [trimPath(D.PATHS.compatRoom)]: compatRoom
      };
      await state.db.ref().update(updates);
      state.dataset.meta = meta;
      state.storageMode = "Firebase";
      saveLocalDataset();
      setConnectionBadge("ok", "Firebase 저장됨");
      if (!options.quiet) toast("Firebase에 저장했습니다.", "ok");
      renderAll();
      return true;
    } catch (error) {
      state.storageMode = "localStorage";
      setConnectionBadge("warn", "localStorage fallback");
      if (!options.quiet) toast("Firebase 저장 실패. localStorage에 저장했습니다.", "warn");
      renderAll();
      return true;
    }
  }

  async function reloadData() {
    if (state.db && state.admin) {
      await loadFirebaseDataset();
      return;
    }
    loadLocalDataset();
    ensureSelections();
    renderAll();
    toast("localStorage 데이터를 다시 불러왔습니다.", "ok");
  }

  function loadLocalDataset() {
    try {
      const raw = localStorage.getItem(D.STORAGE_KEYS.dataset);
      state.dataset = raw ? D.normalizeDataset(JSON.parse(raw)) : D.createEmptyDataset();
      state.storageMode = raw ? "localStorage" : state.storageMode;
    } catch (error) {
      state.dataset = D.createEmptyDataset();
      state.storageMode = "localStorage";
    }
  }

  function saveLocalDataset() {
    try {
      localStorage.setItem(D.STORAGE_KEYS.dataset, JSON.stringify(state.dataset));
      localStorage.setItem(D.STORAGE_KEYS.meta, JSON.stringify({
        savedAt: D.nowISO(),
        version: D.VERSION,
        counts: countMap()
      }));
    } catch (error) {
      toast("localStorage 저장 공간을 확인하세요.", "error");
    }
  }

  function touchMeta() {
    state.dataset.meta = {
      ...(state.dataset.meta || {}),
      version: D.VERSION,
      updatedAt: D.nowISO(),
      source: "Market Admin"
    };
  }

  function countMap() {
    return {
      companies: state.dataset.companies.length,
      news: state.dataset.news.length,
      sectors: state.dataset.sectors.length,
      wikiDocs: state.dataset.wikiDocs.length
    };
  }

  function ensureSelections() {
    if (!Array.isArray(state.dataset.disclosures)) state.dataset.disclosures = [];
    EDIT_COLLECTIONS.forEach((collection) => {
      if (state.creating[collection]) return;
      const list = state.dataset[collection] || [];
      if (!list.some((item) => item.id === state.selected[collection])) {
        state.selected[collection] = list[0]?.id || null;
      }
    });
  }

  function resetCreateState() {
    EDIT_COLLECTIONS.forEach((collection) => {
      state.creating[collection] = false;
    });
  }

  function renderAll() {
    renderDatalists();
    renderFilters();
    EDIT_COLLECTIONS.forEach((collection) => {
      renderList(collection);
      renderForm(collection);
    });
    renderDashboard();
    renderPreview();
    renderValidationSummary();
    renderDisclosuresHint();
  }

  function renderDatalists() {
    upsertDatalist("sectorOptions", unique([
      ...state.dataset.sectors.map((sector) => sector.name),
      ...state.dataset.companies.map((company) => company.sector),
      ...state.dataset.news.map((news) => news.targetSector)
    ]));
    upsertDatalist("wikiOptions", state.dataset.wikiDocs.map((doc) => doc.id));
  }

  function upsertDatalist(id, values) {
    let list = document.getElementById(id);
    if (!list) {
      list = document.createElement("datalist");
      list.id = id;
      document.body.appendChild(list);
    }
    list.innerHTML = values.filter(Boolean).map((value) => `<option value="${escAttr(value)}"></option>`).join("");
  }

  function renderFilters() {
    EDIT_COLLECTIONS.forEach((collection) => {
      const select = $(`#${collection}Filter`);
      if (!select) return;
      const current = state.filters[collection].value;
      const options = filterOptions(collection);
      select.innerHTML = options.map((item) => optionHTML(item.value, item.label, item.value === current)).join("");
      select.value = options.some((item) => item.value === current) ? current : "";
      state.filters[collection].value = select.value;
    });
  }

  function filterOptions(collection) {
    const all = [{ value: "", label: "전체" }];
    if (collection === "companies") {
      const sectors = unique(state.dataset.companies.map((item) => item.sector)).map((value) => ({ value: `sector:${value}`, label: `업종: ${value}` }));
      const statuses = unique(state.dataset.companies.map((item) => item.status)).map((value) => ({ value: `status:${value}`, label: `상태: ${value}` }));
      return all.concat(sectors, statuses);
    }
    if (collection === "news") {
      return all
        .concat(["company", "sector", "market", "rumor"].map((value) => ({ value: `type:${value}`, label: `유형: ${value}` })))
        .concat(["up", "down", "mixed", "volatility"].map((value) => ({ value: `effect:${value}`, label: `효과: ${value}` })))
        .concat(["visible", "draft", "hidden", "scheduled"].map((value) => ({ value: `visibility:${value}`, label: `상태: ${value}` })));
    }
    if (collection === "sectors") {
      return all.concat(unique(state.dataset.sectors.flatMap((item) => item.tags || [])).map((value) => ({ value: `tag:${value}`, label: `태그: ${value}` })));
    }
    if (collection === "disclosures") {
      const types = unique((state.dataset.disclosures || []).map((item) => item.type)).map((value) => ({ value: `type:${value}`, label: `유형: ${value}` }));
      const sources = [{ value: "source:admin", label: "출처: admin" }, { value: "source:system", label: "출처: system" }];
      return all.concat(types, sources);
    }
    return all.concat(["company", "sector", "term", "guide", "event"].map((value) => ({ value: `category:${value}`, label: `분류: ${value}` })));
  }

  function renderList(collection) {
    const root = $(`#${collection}List`);
    if (!root) return;
    const rows = getFilteredList(collection);
    if (!rows.length) {
      root.innerHTML = `<div class="activity-item">표시할 ${esc(D.LABELS[collection])} 데이터가 없습니다.</div>`;
      return;
    }
    root.innerHTML = rows.map((item) => {
      const active = !state.creating[collection] && item.id === state.selected[collection] ? " active" : "";
      return `
        <article class="item-card${active}">
          <button class="item-main plain-button" type="button" data-edit="${escAttr(item.id)}" data-collection="${escAttr(collection)}">
            <span class="item-title">${esc(itemTitle(collection, item))}</span>
            <span class="item-meta">${esc(itemMeta(collection, item))}</span>
            <span class="item-id">${esc(item.id)}</span>
          </button>
          <div class="item-actions">
            <button class="button small" type="button" data-edit="${escAttr(item.id)}" data-collection="${escAttr(collection)}">편집</button>
            <button class="button danger small" type="button" data-delete="${escAttr(item.id)}" data-collection="${escAttr(collection)}">삭제</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function getFilteredList(collection) {
    const filter = state.filters[collection];
    const query = normalizeText(filter.query);
    return (state.dataset[collection] || [])
      .filter((item) => !query || normalizeText(JSON.stringify(item)).includes(query))
      .filter((item) => matchesFilter(collection, item, filter.value));
  }

  function matchesFilter(collection, item, filterValue) {
    if (!filterValue) return true;
    const [key, value] = filterValue.split(":");
    if (key === "sector") return item.sector === value;
    if (key === "status") return item.status === value;
    if (key === "type") return item.type === value;
    if (key === "effect") return item.effect === value;
    if (key === "visibility") return item.visibility === value;
    if (key === "tag") return (item.tags || []).includes(value);
    if (key === "category") return item.category === value;
    if (key === "source") return (item.source || "admin") === value;
    return true;
  }

  function itemTitle(collection, item) {
    if (collection === "companies") return item.name;
    if (collection === "news") return item.title;
    if (collection === "sectors") return item.name;
    if (collection === "disclosures") return item.title;
    return item.title;
  }

  function itemMeta(collection, item) {
    if (collection === "companies") return `${item.sector || "업종 없음"} · ${item.status || "상태 없음"} · ${formatNumber(item.currentPrice)}원`;
    if (collection === "news") return `${item.type} · ${item.effect} · ${item.visibility} · ${formatDate(item.createdAt)}`;
    if (collection === "sectors") return `민감도 ${item.marketSensitivity} · 변동성 ${item.defaultVolatility}`;
    if (collection === "disclosures") {
      const company = state.dataset.companies.find((c) => c.id === item.targetCompanyId);
      const flag = item.deleted ? " · 삭제표시" : item.hidden ? " · 숨김" : "";
      return `${item.type || "공시"} · ${company ? company.name : (item.targetCompanyId || "회사 미지정")} · ${item.source || "admin"}${flag} · ${formatDate(item.updatedAt || item.createdAt)}`;
    }
    return `${item.category} · ${formatDate(item.updatedAt)}`;
  }

  function beginCreate(collection) {
    state.creating[collection] = true;
    state.selected[collection] = null;
    renderList(collection);
    renderForm(collection);
    const form = $(`#${collection}Form`);
    if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function selectItem(collection, id) {
    state.creating[collection] = false;
    state.selected[collection] = id;
    renderList(collection);
    renderForm(collection);
  }

  function currentFormItem(collection) {
    if (state.creating[collection]) return D.DEFAULTS[collection];
    return state.dataset[collection].find((item) => item.id === state.selected[collection]) || D.DEFAULTS[collection];
  }

  function renderForm(collection) {
    const form = $(`#${collection}Form`);
    if (!form) return;
    const item = currentFormItem(collection);
    const isNew = state.creating[collection] || !state.selected[collection];
    const title = $(`#${collection}FormTitle`);
    if (title) title.textContent = `${D.LABELS[collection]} ${isNew ? "추가" : "편집"}`;
    form.innerHTML = D.FIELD_DEFS[collection].map((field) => fieldHTML(collection, field, item[field.name])).join("") + `
      <div class="form-footer">
        <button class="button primary" type="submit">${isNew ? "추가 저장" : "수정 저장"}</button>
        <button class="button ghost" type="button" data-reset-form="${escAttr(collection)}">되돌리기</button>
        <button class="button danger" type="button" data-delete-form="${escAttr(collection)}" ${isNew ? "disabled" : ""}>삭제</button>
      </div>
    `;
  }

  function fieldHTML(collection, field, value) {
    const id = `${collection}-${field.name}`;
    const required = field.required ? " required" : "";
    const span = field.span === 2 || field.type === "textarea" || field.type === "tags" ? " span-2" : "";
    const label = `<label for="${escAttr(id)}">${esc(field.label)}${field.required ? " *" : ""}</label>`;
    let control = "";
    if (field.type === "textarea") {
      control = `<textarea id="${escAttr(id)}" name="${escAttr(field.name)}" rows="${field.rows || 4}"${required}>${esc(value || "")}</textarea>`;
    } else if (field.type === "select") {
      control = `<select id="${escAttr(id)}" name="${escAttr(field.name)}"${required}>${(field.options || []).map((option) => optionHTML(option, option, option === value)).join("")}</select>`;
    } else if (field.type === "company") {
      const options = [{ id: "", name: "선택 없음" }].concat(state.dataset.companies);
      control = `<select id="${escAttr(id)}" name="${escAttr(field.name)}"${required}>${options.map((company) => optionHTML(company.id, company.name || company.id, company.id === value)).join("")}</select>`;
    } else if (field.type === "sector") {
      control = `<input id="${escAttr(id)}" name="${escAttr(field.name)}" type="text" list="sectorOptions" value="${escAttr(value || "")}"${required} />`;
    } else if (field.type === "wiki") {
      control = `<input id="${escAttr(id)}" name="${escAttr(field.name)}" type="text" list="wikiOptions" value="${escAttr(value || "")}"${required} />`;
    } else if (field.type === "tags") {
      control = `<input id="${escAttr(id)}" name="${escAttr(field.name)}" type="text" value="${escAttr((value || []).join(", "))}" placeholder="쉼표로 구분" />`;
    } else if (field.type === "datetime") {
      control = `<input id="${escAttr(id)}" name="${escAttr(field.name)}" type="datetime-local" value="${escAttr(toDatetimeLocal(value))}"${required} />`;
    } else if (field.type === "number") {
      control = `<input id="${escAttr(id)}" name="${escAttr(field.name)}" type="number" value="${escAttr(value ?? "")}" min="${field.min ?? ""}" max="${field.max ?? ""}" step="${field.step ?? "1"}"${required} />`;
    } else {
      control = `<input id="${escAttr(id)}" name="${escAttr(field.name)}" type="text" value="${escAttr(value || "")}" placeholder="${escAttr(field.placeholder || "")}"${required} />`;
    }
    return `<div class="form-field${span}">${label}${control}</div>`;
  }

  function collectForm(collection) {
    const form = $(`#${collection}Form`);
    const raw = {};
    D.FIELD_DEFS[collection].forEach((field) => {
      const input = form.elements[field.name];
      let value = input ? input.value : "";
      if (field.type === "number") value = value === "" ? D.DEFAULTS[collection][field.name] : Number(value);
      if (field.type === "tags") value = D.toTags(value);
      if (field.type === "datetime") value = value ? new Date(value).toISOString() : "";
      raw[field.name] = value;
    });
    if (!raw.id) raw.id = D.slug(raw.name || raw.title || "");
    return D.normalizeItem(collection, raw);
  }

  async function saveItem(collection) {
    if (!state.admin) {
      showAuthGate("저장하려면 관리자 권한이 필요합니다.");
      return;
    }
    const previousId = state.selected[collection];
    const item = collectForm(collection);
    const basicErrors = validateItem(collection, item, previousId);
    if (basicErrors.length) {
      toast(basicErrors[0], "error");
      return;
    }
    const list = state.dataset[collection] || [];
    const index = previousId ? list.findIndex((entry) => entry.id === previousId) : -1;
    if (index >= 0) list[index] = item;
    else list.unshift(item);
    state.dataset[collection] = list;
    state.creating[collection] = false;
    state.selected[collection] = item.id;
    touchMeta();
    saveLocalDataset();
    ensureSelections();
    renderAll();
    if (state.roomMode) {
      // 방 모드: rooms/{code} 에 변경분만 부분 update (board/wiki 즉시 반영)
      const ok = await saveRoomDataset({ quiet: true });
      toast(
        ok ? `${D.LABELS[collection]} 저장 → rooms/${state.roomCode} 부분 반영` : `${D.LABELS[collection]} 로컬 저장됨 (방 반영 실패)`,
        ok ? "ok" : "warn"
      );
    } else {
      // 레거시 모드: marketAdmin/* 저장
      await saveAllData({ quiet: true });
      toast(`${D.LABELS[collection]} 데이터를 저장했습니다.`, "ok");
    }
  }

  async function deleteItem(collection, id) {
    if (!state.admin) {
      showAuthGate("삭제하려면 관리자 권한이 필요합니다.");
      return;
    }
    const item = state.dataset[collection].find((entry) => entry.id === id);
    if (!item) return;
    const label = itemTitle(collection, item);
    if (!window.confirm(`${label} 데이터를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    state.dataset[collection] = state.dataset[collection].filter((entry) => entry.id !== id);
    if (state.selected[collection] === id) state.selected[collection] = null;
    state.creating[collection] = false;
    touchMeta();
    saveLocalDataset();
    ensureSelections();
    renderAll();
    if (state.roomMode) {
      await deleteFromRoom(collection, id);
    } else {
      await saveAllData({ quiet: true });
      toast(`${D.LABELS[collection]} 데이터를 삭제했습니다.`, "ok");
    }
  }

  // 방 모드 삭제: battle 소유 stocks 는 절대 건드리지 않는다.
  // - news/disclosures: 해당 노드 + adminOverrides 제거
  // - companies: adminOverrides 만 제거(시세/종목 자체는 battle 데이터로 보존)
  // - sectors/wikiDocs: 방에 없는 admin 전용 → 로컬에서만 제거
  async function deleteFromRoom(collection, id) {
    const RB = window.RoomBridge;
    const code = state.roomCode;
    const updates = {};
    if (collection === "news") {
      updates[`rooms/${code}/news/${id}`] = null;
      updates[`rooms/${code}/adminOverrides/news/${id}`] = null;
    } else if (collection === "disclosures") {
      // admin 소유 공시는 완전 삭제, 그 외(system/engine)는 hidden/deleted 플래그만
      const orig = (state.roomData && state.roomData.disclosures && state.roomData.disclosures[id]) || null;
      const source = orig ? (orig.source || "admin") : "admin";
      if (source === "admin") {
        updates[`rooms/${code}/disclosures/${id}`] = null;
      } else {
        updates[`rooms/${code}/disclosures/${id}/hidden`] = true;
        updates[`rooms/${code}/disclosures/${id}/deleted`] = true;
      }
    } else if (collection === "companies") {
      updates[`rooms/${code}/adminOverrides/companies/${id}`] = null;
    }
    if (RB && RB.hasFirebase() && code && Object.keys(updates).length) {
      try {
        await RB.applyRaw(code, updates, state.roomData, `삭제 ${collection}/${id}`);
        state.roomData = await RB.loadRoom(code);
        RB.cache(code, state.roomData);
        renderRoomStatus();
        renderDebug();
      } catch (error) {
        toast("방 삭제 반영 실패 — 로컬에서만 제거했습니다.", "warn");
        return;
      }
    }
    if (collection === "companies") {
      toast("회사 표시는 제거했지만 battle 종목 시세 데이터는 보존됩니다.", "warn");
    } else {
      toast(`${D.LABELS[collection]} 삭제를 방에 반영했습니다.`, "ok");
    }
  }

  function validateItem(collection, item, previousId) {
    const errors = [];
    D.FIELD_DEFS[collection].filter((field) => field.required).forEach((field) => {
      if (!String(item[field.name] || "").trim()) {
        errors.push(`${field.label}은 필수입니다.`);
      }
    });
    const duplicate = state.dataset[collection].some((entry) => entry.id === item.id && entry.id !== previousId);
    if (duplicate) errors.push(`이미 존재하는 ID입니다: ${item.id}`);
    return errors;
  }

  function renderDashboard() {
    const counts = countMap();
    $("#dashboardStats").innerHTML = [
      statCard("회사", counts.companies),
      statCard("뉴스", counts.news),
      statCard("업종", counts.sectors),
      statCard("Wiki", counts.wikiDocs)
    ].join("");

    const recent = [
      ...state.dataset.news.map((item) => ({ title: item.title, meta: `뉴스 · ${formatDate(item.createdAt)}`, time: item.createdAt })),
      ...state.dataset.wikiDocs.map((item) => ({ title: item.title, meta: `Wiki · ${formatDate(item.updatedAt)}`, time: item.updatedAt })),
      ...state.dataset.companies.map((item) => ({ title: item.name, meta: `회사 · ${item.sector}`, time: state.dataset.meta?.updatedAt })),
      ...state.dataset.sectors.map((item) => ({ title: item.name, meta: "업종", time: state.dataset.meta?.updatedAt }))
    ].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0)).slice(0, 8);

    $("#recentItems").innerHTML = recent.length
      ? recent.map((item) => `<div class="activity-item"><strong>${esc(item.title)}</strong><div class="item-meta">${esc(item.meta)}</div></div>`).join("")
      : `<div class="activity-item">아직 데이터가 없습니다.</div>`;
  }

  function statCard(label, value) {
    return `<article class="stat-card"><span>${esc(label)}</span><strong>${esc(String(value))}</strong></article>`;
  }

  function renderPreview() {
    const mode = state.previewMode;
    const root = $("#previewGrid");
    if (!root) return;
    $("#previewMode").value = mode;
    const query = normalizeText(state.previewQuery);
    if (mode === "room") {
      const room = D.roomCompat(state.dataset);
      root.innerHTML = [
        previewCard("방 호환 스냅샷", `stocks ${Object.keys(room.stocks).length}개 · news ${Object.keys(room.news).length}개`, ["rooms/ADMIN1", "STONK Board", "STONK Wiki"]),
        previewCard("최신 뉴스", room.latestNews?.text || "표시할 뉴스 없음", ["latestNews"]),
        previewCard("저장 모드", `${state.storageMode} · ${formatDate(state.dataset.meta?.updatedAt)}`, ["fallback", "compat"])
      ].join("");
      return;
    }
    const rows = (state.dataset[mode] || []).filter((item) => !query || normalizeText(JSON.stringify(item)).includes(query));
    root.innerHTML = rows.length
      ? rows.map((item) => previewItem(mode, item)).join("")
      : `<article class="preview-card"><h3>데이터 없음</h3><p>현재 조건에 맞는 미리보기 데이터가 없습니다.</p></article>`;
  }

  function previewItem(collection, item) {
    if (collection === "companies") {
      return previewCard(item.name, `${item.oneLine || item.description || "설명 없음"} 현재가 ${formatNumber(item.currentPrice)}원`, [item.sector, item.risk, item.status].concat(item.tags || []));
    }
    if (collection === "news") {
      return previewCard(item.title, item.body || "본문 없음", [item.type, item.effect, item.visibility].concat(item.tags || []));
    }
    if (collection === "sectors") {
      return previewCard(item.name, item.description || "설명 없음", [`민감도 ${item.marketSensitivity}`, `변동성 ${item.defaultVolatility}`].concat(item.tags || []));
    }
    return previewCard(item.title, item.summary || item.content || "본문 없음", [item.category].concat(item.tags || []));
  }

  function previewCard(title, body, chips) {
    return `
      <article class="preview-card">
        <h3>${esc(title)}</h3>
        <p>${esc(body)}</p>
        <div class="chip-row">${(chips || []).filter(Boolean).map((chip) => `<span class="chip">${esc(chip)}</span>`).join("")}</div>
      </article>
    `;
  }

  function createSamples() {
    const hasData = D.COLLECTIONS.some((collection) => state.dataset[collection].length);
    if (hasData && !window.confirm("현재 데이터를 샘플 데이터로 교체할까요?")) return Promise.resolve();
    state.dataset = D.createSampleData();
    resetCreateState();
    ensureSelections();
    saveLocalDataset();
    renderAll();
    toast("샘플 데이터를 생성했습니다.", "ok");
    return saveAllData({ quiet: true });
  }

  function exportData() {
    const bundle = D.exportBundle(state.dataset);
    $("#exportJson").value = JSON.stringify(bundle, null, 2);
    toast("JSON 내보내기를 생성했습니다.", "ok");
  }

  async function copyExport() {
    const value = $("#exportJson").value || JSON.stringify(D.exportBundle(state.dataset), null, 2);
    $("#exportJson").value = value;
    try {
      await navigator.clipboard.writeText(value);
      toast("내보내기 JSON을 복사했습니다.", "ok");
    } catch (error) {
      $("#exportJson").focus();
      $("#exportJson").select();
      document.execCommand("copy");
      toast("내보내기 JSON을 복사했습니다.", "ok");
    }
  }

  async function importDataFromText() {
    const raw = $("#importJson").value.trim();
    if (!raw) {
      toast("가져올 JSON을 입력하세요.", "warn");
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      await importDataset(parsed);
    } catch (error) {
      toast("JSON 형식이 올바르지 않습니다.", "error");
    }
  }

  function importDataFromFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      $("#importJson").value = String(reader.result || "");
      void importDataFromText();
    };
    reader.onerror = () => toast("파일을 읽지 못했습니다.", "error");
    reader.readAsText(file, "utf-8");
    event.target.value = "";
  }

  async function importDataset(input) {
    if (!window.confirm("현재 STONK Admin 데이터를 가져온 JSON으로 교체할까요?")) return;
    state.dataset = D.normalizeDataset(input);
    touchMeta();
    resetCreateState();
    ensureSelections();
    saveLocalDataset();
    renderAll();
    await saveAllData({ quiet: true });
    toast("JSON 데이터를 가져왔습니다.", "ok");
  }

  function runValidation() {
    state.validation = validateDataset();
    renderValidationSummary();
    renderValidationOutput();
    toast(state.validation.errors ? "검증 오류가 있습니다." : "데이터 검증을 완료했습니다.", state.validation.errors ? "error" : "ok");
  }

  // 기본 업종 목록 — 방 종목이 자주 쓰는 업종(검증에서 정상 인식)
  const DEFAULT_SECTORS = [
    "반도체", "IT", "바이오", "자동차", "금융", "게임", "엔터", "유통", "에너지", "조선",
    "화학", "통신", "건설", "식품", "항공", "리츠", "ETF", "채권", "원자재", "SPAC",
    "우선주", "기타", "AI·전자", "2차전지", "인터넷·게임", "제약", "신규상장", "바이오·제약",
  ];

  // 방 종목의 업종을 '업종 관리' 목록에 자동 보강(중복/빈값 제외). 비파괴적: 자동분만 _auto 표시.
  function mergeRoomSectors() {
    if (!Array.isArray(state.dataset.sectors)) return 0;
    const existing = new Set(state.dataset.sectors.map((s) => s.name));
    const names = new Set();
    (state.dataset.companies || []).forEach((c) => {
      const s = (c.sector || "").trim();
      if (s) names.add(s);
    });
    let added = 0;
    names.forEach((name) => {
      if (existing.has(name)) return;
      const id = "sector-auto-" + name.replace(/[^\w가-힣]+/g, "-");
      state.dataset.sectors.push(D.normalizeItem("sectors", {
        id, name, description: "방 종목에서 자동 인식된 업종입니다.", _auto: true,
      }));
      existing.add(name);
      added++;
    });
    return added;
  }

  function validateDataset() {
    const issues = [];
    D.COLLECTIONS.forEach((collection) => {
      const seen = new Set();
      state.dataset[collection].forEach((item) => {
        if (seen.has(item.id)) addIssue("error", `${D.LABELS[collection]} 중복 ID: ${item.id}`);
        seen.add(item.id);
        D.FIELD_DEFS[collection].filter((field) => field.required).forEach((field) => {
          if (!String(item[field.name] || "").trim()) addIssue("error", `${D.LABELS[collection]} ${item.id}: ${field.label} 누락`);
        });
      });
    });

    const companyIds = new Set(state.dataset.companies.map((item) => item.id));
    // 업종 인식 대상: 업종 관리 목록 + 기본 업종 + 방 종목에 실제 존재하는 업종(자동 인식)
    //  → 방에서 만들어진 반도체/바이오 등이 '없는 업종' 경고로 도배되지 않게 한다.
    const sectorNames = new Set([
      ...state.dataset.sectors.map((item) => item.name),
      ...DEFAULT_SECTORS,
      ...state.dataset.companies.map((c) => (c.sector || "").trim()).filter(Boolean),
    ]);
    const newsIds = new Set(state.dataset.news.map((item) => item.id));
    const wikiIds = new Set(state.dataset.wikiDocs.map((item) => item.id));

    state.dataset.companies.forEach((company) => {
      if (company.wikiId && !wikiIds.has(company.wikiId)) addIssue("warn", `회사 ${company.id}: 연결 Wiki ID가 없습니다 (${company.wikiId}).`);
      if (company.sector && !sectorNames.has(company.sector)) addIssue("warn", `회사 ${company.id}: 업종 관리에 없는 업종입니다 (${company.sector}).`);
      ["basePrice", "currentPrice", "growth", "volatility"].forEach((key) => {
        if (!Number.isFinite(Number(company[key]))) addIssue("error", `회사 ${company.id}: ${key} 숫자 오류`);
      });
    });

    state.dataset.news.forEach((news) => {
      if (news.targetCompanyId && !companyIds.has(news.targetCompanyId)) addIssue("warn", `뉴스 ${news.id}: 대상 회사가 없습니다 (${news.targetCompanyId}).`);
      if (news.targetSector && !sectorNames.has(news.targetSector)) addIssue("warn", `뉴스 ${news.id}: 대상 업종이 업종 관리에 없습니다 (${news.targetSector}).`);
      (news.relatedWikiIds || []).forEach((id) => {
        if (!wikiIds.has(id)) addIssue("warn", `뉴스 ${news.id}: 관련 Wiki ID가 없습니다 (${id}).`);
      });
      if (news.createdAt && Number.isNaN(new Date(news.createdAt).getTime())) addIssue("error", `뉴스 ${news.id}: createdAt 날짜 오류`);
    });

    state.dataset.sectors.forEach((sector) => {
      if (sector.wikiId && !wikiIds.has(sector.wikiId)) addIssue("warn", `업종 ${sector.id}: 연결 Wiki ID가 없습니다 (${sector.wikiId}).`);
    });

    state.dataset.wikiDocs.forEach((doc) => {
      (doc.relatedCompanyIds || []).forEach((id) => {
        if (!companyIds.has(id)) addIssue("warn", `Wiki ${doc.id}: 관련 회사 ID가 없습니다 (${id}).`);
      });
      (doc.relatedNewsIds || []).forEach((id) => {
        if (!newsIds.has(id)) addIssue("warn", `Wiki ${doc.id}: 관련 뉴스 ID가 없습니다 (${id}).`);
      });
      (doc.relatedSectors || []).forEach((name) => {
        if (!sectorNames.has(name)) addIssue("warn", `Wiki ${doc.id}: 관련 업종이 없습니다 (${name}).`);
      });
    });

    if (!issues.length) addIssue("ok", "검증 오류가 없습니다.");
    const errors = issues.filter((item) => item.type === "error").length;
    const warnings = issues.filter((item) => item.type === "warn").length;
    return { issues, errors, warnings };

    function addIssue(type, message) {
      issues.push({ type, message });
    }
  }

  function renderValidationSummary() {
    const root = $("#validationSummary");
    if (!root) return;
    const validation = state.validation || validateDataset();
    const type = validation.errors ? "error" : validation.warnings ? "warn" : "ok";
    root.innerHTML = `
      <div class="validation-item ${type}">
        오류 ${validation.errors}개 · 경고 ${validation.warnings}개
      </div>
      ${validation.issues.slice(0, 4).map((issue) => `<div class="validation-item ${issue.type}">${esc(issue.message)}</div>`).join("")}
    `;
  }

  function renderValidationOutput() {
    const root = $("#validationOutput");
    if (!root) return;
    const validation = state.validation || validateDataset();
    root.innerHTML = validation.issues.map((issue) => `<div class="validation-item ${issue.type}">${esc(issue.message)}</div>`).join("");
  }

  function renderPathList() {
    const root = $("#pathList");
    if (!root) return;
    const rows = Object.entries(D.PATHS).map(([key, value]) => [key, value])
      .concat(Object.entries(D.STORAGE_KEYS).map(([key, value]) => [`local:${key}`, value]));
    root.innerHTML = rows.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join("");
  }

  function setConnectionBadge(type, text) {
    const badge = $("#connectionBadge");
    badge.className = `status-badge ${type || "muted"}`;
    badge.textContent = text;
  }

  function setAdminBadge(type, text) {
    const badge = $("#adminBadge");
    badge.className = `status-badge ${type || "muted"}`;
    badge.textContent = text;
  }

  function toast(message, type = "ok") {
    const rack = $("#toastRack");
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.textContent = message;
    rack.appendChild(item);
    setTimeout(() => item.remove(), 3600);
  }

  function optionHTML(value, label, selected) {
    return `<option value="${escAttr(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escAttr(value) {
    return esc(value);
  }

  function unique(values) {
    return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko-KR"));
  }

  function normalizeText(value) {
    return String(value || "").toLocaleLowerCase("ko-KR");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ko-KR").format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return "날짜 없음";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "날짜 오류";
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }

  function toDatetimeLocal(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }
})();
