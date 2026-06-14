// js/site-config.js  ─ STONK 공통 사이트 설정 / roomCode 유틸 (v1.4.0)
// ───────────────────────────────────────────────────────────────────
// 목적: battle / board / wiki / admin 4개 사이트가 서로 다른 GitHub Pages
//       주소에 배포돼도 같은 roomCode 를 유지하며 이동할 수 있게 한다.
//
// ★ 배포 주소를 바꾸려면 아래 SITE_URLS 한 곳만 수정하면 됩니다. ★
//   (정확한 주소를 모르면 그대로 두세요. 로컬/같은 폴더 실행 시에는
//    자동으로 형제 폴더 상대경로 fallback 을 사용합니다.)
//
// 이 파일은 4개 사이트에 동일 내용으로 복제됩니다. (board/js, wiki/js, admin/js)
// battle 은 ES 모듈 버전(src/siteConfig.js)을 별도로 둡니다.
(function () {
  "use strict";
  if (window.SiteConfig) return; // 중복 로드 방지

  // ★★ 배포 후 실제 GitHub Pages 주소로 바꾸세요 ★★
  const SITE_URLS = {
    battle: "https://tom981105-web.github.io/STONK-Battle/",
    board:  "https://tom981105-web.github.io/STONK-Board/",
    wiki:   "https://tom981105-web.github.io/STONK-Wiki/",
    admin:  "https://tom981105-web.github.io/STONK-Admin/market-admin.html",
  };

  // 로컬 개발(파일 직접 열기 / localhost)에서 쓸 형제 폴더 상대경로 fallback
  const LOCAL_FALLBACK = {
    battle: "../Market-battle/index.html",
    board:  "../Market-Board/index.html",
    wiki:   "../Market-Wiki/index.html",
    admin:  "../Market-Admin/market-admin.html",
  };

  const LAST_ROOM_KEY = "stonk:lastRoomCode";
  // 기존 사이트별 키 (하위호환 읽기용)
  const LEGACY_ROOM_KEYS = ["mb-board-room", "wiki-room"];

  function isLocal() {
    return location.protocol === "file:" ||
      /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  }

  function getSiteConfig() {
    return { urls: { ...SITE_URLS }, local: isLocal() };
  }

  // roomCode 정규화: 대문자 + 영숫자만. (battle 은 6자리, 그 외 4자 이상 허용)
  function normalizeRoomCode(code) {
    return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  // URL 쿼리에서 방 코드 읽기 (?room= / ?roomCode= 둘 다 지원)
  function getUrlRoomCode() {
    try {
      const p = new URLSearchParams(location.search);
      return normalizeRoomCode(p.get("room") || p.get("roomCode") || p.get("roomId") || "");
    } catch (e) { return ""; }
  }

  // URL 쿼리에서 회사 id 읽기 (?company= / ?companyId=)
  function getUrlCompanyId() {
    try {
      const p = new URLSearchParams(location.search);
      return String(p.get("company") || p.get("companyId") || "").trim();
    } catch (e) { return ""; }
  }

  function setLastRoomCode(code) {
    const c = normalizeRoomCode(code);
    if (!c) return;
    try { localStorage.setItem(LAST_ROOM_KEY, c); } catch (e) {}
  }

  function getLastRoomCode() {
    try {
      const c = normalizeRoomCode(localStorage.getItem(LAST_ROOM_KEY));
      if (c) return c;
      for (const k of LEGACY_ROOM_KEYS) {
        const v = normalizeRoomCode(localStorage.getItem(k));
        if (v) return v;
      }
    } catch (e) {}
    return "";
  }

  // URL → lastRoomCode 순으로 현재 방 코드 결정
  function getCurrentRoomCode() {
    return getUrlRoomCode() || getLastRoomCode();
  }

  function baseUrl(site) {
    const configured = SITE_URLS[site];
    // 로컬이고 configured 가 github.io 면 형제 폴더 상대경로 사용
    if (isLocal() && /github\.io/.test(configured || "")) {
      return LOCAL_FALLBACK[site];
    }
    return configured || LOCAL_FALLBACK[site];
  }

  // siteName 으로 roomCode/companyId 를 유지한 이동 URL 생성
  function buildSiteUrl(site, params) {
    const url = baseUrl(site);
    const qs = [];
    const room = normalizeRoomCode(params && params.room);
    if (room) qs.push("room=" + encodeURIComponent(room));
    const company = params && (params.company || params.companyId);
    if (company) qs.push("company=" + encodeURIComponent(company));
    if (!qs.length) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + qs.join("&");
  }

  function buildBattleUrl(room) { return buildSiteUrl("battle", { room }); }
  function buildBoardUrl(room)  { return buildSiteUrl("board",  { room }); }
  function buildWikiUrl(room, companyId) { return buildSiteUrl("wiki", { room, company: companyId }); }
  function buildAdminUrl(room)  { return buildSiteUrl("admin",  { room }); }

  window.SiteConfig = {
    VERSION: "1.4.0",
    getSiteConfig,
    normalizeRoomCode,
    getUrlRoomCode,
    getUrlCompanyId,
    getCurrentRoomCode,
    setLastRoomCode,
    getLastRoomCode,
    buildSiteUrl,
    buildBattleUrl,
    buildBoardUrl,
    buildWikiUrl,
    buildAdminUrl,
    LAST_ROOM_KEY,
  };
})();
