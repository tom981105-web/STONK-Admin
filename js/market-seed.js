// js/market-seed.js ─ STONK Admin 전용 시장 시드 생성기
// ──────────────────────────────────────────────────────────────────
// 단일 방(MAIN) 운영: 관리자가 "시장 재시작"을 누르면 새 종목 풀을 생성한다.
// battle 의 src/game.js generateStocks 와 동일한 규격을 vanilla 로 포팅한 것.
// (battle 은 ESM, admin 은 전역 스크립트라 import 가 어려워 동일 로직을 복제한다.)
(function () {
  "use strict";

  const START_CASH = 5_000_000; // 시작 자본 500만원 (battle game.js 와 동일)
  const MIN_PRICE = 10;

  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function rand(min, max) { return Math.random() * (max - min) + min; }

  function tickSize(price) {
    if (price < 2000) return 1;
    if (price < 5000) return 5;
    if (price < 20000) return 10;
    if (price < 50000) return 50;
    if (price < 200000) return 100;
    return 500;
  }
  function roundToTick(price) {
    const t = tickSize(price);
    return Math.round(price / t) * t;
  }

  // 업종 구성 (battle src/game.js 와 동일) — 업종 10개 × 14 + 자산 10 ≈ 150종목
  const SECTORS = [
    { key: "semi", name: "반도체", leader: "은하반도체", suffixes: ["반도체", "전자", "소자", "머티리얼즈", "시스템", "테크", "세미콘"] },
    { key: "bio", name: "바이오", leader: "별빛바이오", suffixes: ["바이오", "제약", "파마", "셀", "진단", "메디", "테라퓨틱스"] },
    { key: "battery", name: "2차전지", leader: "번개배터리", suffixes: ["배터리", "에너지", "케미칼", "머티리얼", "파워", "솔라", "ESS"] },
    { key: "net", name: "인터넷·게임", leader: "구름소프트", suffixes: ["소프트", "게임즈", "네트웍스", "플랫폼", "AI", "클라우드", "데이터"] },
    { key: "auto", name: "자동차", leader: "번개모빌리티", suffixes: ["모빌리티", "오토", "모터스", "전장", "부품", "타이어", "카"] },
    { key: "fin", name: "금융", leader: "도토리금융", suffixes: ["금융", "은행", "증권", "캐피탈", "보험", "카드", "홀딩스"] },
    { key: "chem", name: "화학·소재", leader: "포근화학", suffixes: ["화학", "소재", "케미칼", "폴리머", "정밀화학", "유화", "첨단소재"] },
    { key: "steel", name: "철강·중공업", leader: "고래물산", suffixes: ["중공업", "철강", "스틸", "메탈", "기계", "플랜트", "조선"] },
    { key: "food", name: "식품·유통", leader: "바다식품", suffixes: ["식품", "유통", "푸드", "리테일", "생활건강", "마트", "F&B"] },
    { key: "ent", name: "엔터·미디어", leader: "새벽엔터", suffixes: ["엔터", "미디어", "뮤직", "픽처스", "콘텐츠", "방송", "스튜디오"] },
    { key: "build", name: "건설·부동산", leader: "돌담건설", suffixes: ["건설", "산업개발", "주택", "엔지니어링", "건자재", "개발", "토건"] },
    { key: "air", name: "항공·운송", leader: "무지개항공", suffixes: ["항공", "에어", "로지스", "택배", "해운", "운송", "익스프레스"] },
    { key: "telecom", name: "통신", leader: "파도텔레콤", suffixes: ["텔레콤", "통신", "모바일", "네트워크", "브로드밴드", "컴즈", "텔레시스"] },
    { key: "energy", name: "에너지·전력", leader: "초록에너지", suffixes: ["에너지", "전력", "발전", "가스", "수소", "태양광", "그린파워"] },
    { key: "health", name: "헬스케어", leader: "민들레제약", suffixes: ["헬스케어", "의료기기", "메디컬", "케어", "바이탈", "진단기", "웰니스"] },
    { key: "defense", name: "우주·방산", leader: "미르항공우주", suffixes: ["항공우주", "방산", "디펜스", "에어로", "스페이스", "중방위", "시스템즈"] },
  ];
  const NAME_PREFIX = [
    "별빛", "달빛", "은하", "구름", "번개", "바다", "초록", "솜사탕", "무지개", "도토리",
    "한입", "포근", "두근", "새벽", "고래", "민들레", "노을", "단비", "햇살", "모래",
    "안개", "서리", "물결", "바람", "이슬", "구슬", "파도", "돌담", "오름", "나래",
    "미르", "해솔", "가람", "마루", "아라", "여울", "보라", "수풀", "겨울", "봄날",
    "푸른", "하늘", "산들", "늘봄", "다온", "라온", "미리내", "슬기", "윤슬", "한솔",
    "가온", "누리", "도담", "새론", "시나브로", "아토", "잔디", "초롱", "하랑", "해담",
    "별하", "달가람", "온새미", "빛솔", "다래", "벼리", "소담", "이든", "터울", "한별",
  ];

  function makeStock(name, price, opts) {
    opts = opts || {};
    const type = opts.type || "stock";
    const role = opts.role || null;
    price = roundToTick(Math.max(MIN_PRICE, price));
    let volat = 1, activ = 1;
    if (type === "stock") {
      if (role === "leader") { volat = rand(0.8, 1.4); activ = rand(2.0, 3.0); }
      else if (role === "sub") { volat = rand(0.9, 1.6); activ = rand(1.2, 2.2); }
      else if (role === "related") { volat = rand(0.7, 2.0); activ = rand(0.6, 1.8); }
      else { volat = rand(0.5, 2.4); activ = rand(0.3, 1.2); }
    } else if (type === "preferred") { volat = rand(0.4, 0.8); activ = rand(0.5, 1.1); }
    else if (type === "etf") { volat = rand(0.5, 0.8); activ = rand(1.5, 2.5); }
    else if (type === "reit") { volat = rand(0.35, 0.7); activ = rand(0.6, 1.2); }
    else if (type === "bond") { volat = rand(0.2, 0.45); activ = rand(0.8, 1.4); }
    else if (type === "spac") { volat = rand(0.2, 0.5); activ = rand(0.4, 0.9); }
    else if (type === "commodity") { volat = rand(0.9, 1.8); activ = rand(1.0, 2.0); }
    else if (type === "inverse" || type === "leverage") { volat = 1.0; activ = rand(1.5, 2.5); }

    return {
      name, type, role: role || "", sector: opts.sector || "", link: opts.link || "",
      price, previousPrice: price, basePrice: price, open: price, high: price, low: price,
      changeRate: 0, volume: 0, value: 0, pressure: 0, trend: 0,
      volat: +volat.toFixed(2), activ: +activ.toFixed(2), heat: 0, news: "",
    };
  }

  // 시작 종목 생성: 업종별 13종목 + 다양한 자산 (battle generateStocks 와 동일)
  function generateStocks() {
    const stocks = {};
    const used = new Set();
    const pickName = (suffix) => {
      for (let t = 0; t < 50; t++) {
        const n = NAME_PREFIX[randInt(0, NAME_PREFIX.length - 1)] + suffix;
        if (!used.has(n)) { used.add(n); return n; }
      }
      return NAME_PREFIX[randInt(0, NAME_PREFIX.length - 1)] + suffix + randInt(1, 99);
    };
    let n = 0;
    const add = (price, opts) => { const id = "s" + n++; stocks[id] = makeStock(opts.name, price, opts); return id; };

    // 가격대 다양화: 동전주(100원대) ~ 황제주(수백만원) (battle game.js 와 동일)
    const leaderPrice = () => { let p = randInt(120000, 900000); if (Math.random() < 0.4) p = Math.round(p * rand(2, 4)); return p; };
    const subPrice = () => randInt(40000, 280000);
    const relatedPrice = () => { const r = Math.random(); return r < 0.15 ? randInt(800, 4000) : randInt(4000, 90000); };
    const normalPrice = () => { const r = Math.random(); if (r < 0.3) return randInt(100, 900); if (r < 0.65) return randInt(900, 6000); return randInt(6000, 30000); };

    SECTORS.forEach((sec) => {
      used.add(sec.leader);
      const sfx = () => sec.suffixes[randInt(0, sec.suffixes.length - 1)];
      const leaderId = add(leaderPrice(), { name: sec.leader, type: "stock", role: "leader", sector: sec.name });
      for (let i = 0; i < 2; i++) add(subPrice(), { name: pickName(sec.suffixes[0]), type: "stock", role: "sub", sector: sec.name });
      for (let i = 0; i < 8; i++) add(relatedPrice(), { name: pickName(sfx()), type: "stock", role: "related", sector: sec.name });
      for (let i = 0; i < 4; i++) add(normalPrice(), { name: pickName(sfx()), type: "stock", role: "normal", sector: sec.name });
      add(Math.round(stocks[leaderId].price * 0.8), { name: sec.leader + "우", type: "preferred", sector: sec.name, link: leaderId });
    });

    add(10000, { name: "조스피 지수 ETF", type: "etf", link: "index" });
    add(10000, { name: "마켓 인버스 ETF", type: "inverse", link: "index" });
    add(10000, { name: "마켓 레버리지2X ETF", type: "leverage", link: "index" });
    add(10000, { name: "국채 3년 채권 ETF", type: "bond" });
    add(20000, { name: "골드 원자재 ETF", type: "commodity" });
    add(15000, { name: "원유 원자재 ETF", type: "commodity" });
    add(5000, { name: "도심 리츠 REITs", type: "reit" });
    add(5000, { name: "물류 리츠 REITs", type: "reit" });
    add(2000, { name: "미래합병1호 SPAC", type: "spac" });
    add(2000, { name: "성장합병2호 SPAC", type: "spac" });
    return stocks;
  }

  window.MarketSeed = { START_CASH, MIN_PRICE, generateStocks, makeStock, roundToTick, tickSize };
})();
