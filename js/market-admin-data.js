(function () {
  "use strict";

  const VERSION = "1.3.0";

  // Front-end UID checks only control this admin UI. Real protection must be enforced by Firebase Realtime Database rules.
  const ADMIN_UIDS = ["yaV8N60yIiUggaWNpNF2VhkCwxb2"];

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyARFa-vzKVmIdxP5xDRXVzasL2ui94eZ-w",
    authDomain: "market-6e66a.firebaseapp.com",
    databaseURL: "https://market-6e66a-default-rtdb.firebaseio.com",
    projectId: "market-6e66a",
    storageBucket: "market-6e66a.firebasestorage.app",
    messagingSenderId: "402312269082",
    appId: "1:402312269082:web:cf304afc54057ea162b0a3"
  };

  const FIREBASE_SDK = [
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"
  ];

  const PATHS = {
    root: "/marketAdmin",
    companies: "/marketAdmin/companies",
    news: "/marketAdmin/news",
    sectors: "/marketAdmin/sectors",
    wikiDocs: "/marketAdmin/wikiDocs",
    meta: "/marketAdmin/meta",
    compatRoom: "/rooms/ADMIN1"
  };

  const STORAGE_KEYS = {
    dataset: "market-admin-data-v1",
    meta: "market-admin-meta-v1",
    devAdmin: "devAdmin"
  };

  const COLLECTIONS = ["companies", "news", "sectors", "wikiDocs"];

  const LABELS = {
    companies: "회사",
    news: "뉴스",
    sectors: "업종",
    wikiDocs: "Wiki",
    disclosures: "공시"
  };

  // 공시는 방(rooms/{code}/disclosures) 전용 — 레거시 COLLECTIONS 에는 포함하지 않는다.
  const DISCLOSURE_TYPES = ["공시", "실적", "거래정지", "IPO", "상장폐지 심사", "유상증자", "기타"];

  const FIELD_DEFS = {
    companies: [
      { name: "id", label: "ID", type: "text", required: true, placeholder: "neko" },
      { name: "name", label: "회사명", type: "text", required: true },
      { name: "sector", label: "업종", type: "sector", required: true },
      { name: "basePrice", label: "기준가", type: "number", min: 0, step: 1 },
      { name: "currentPrice", label: "현재가", type: "number", min: 0, step: 1 },
      { name: "risk", label: "위험도", type: "select", options: ["낮음", "보통", "높음", "매우 높음"] },
      { name: "growth", label: "성장성", type: "number", min: 0, max: 100, step: 1 },
      { name: "volatility", label: "변동성", type: "number", min: 0, max: 100, step: 1 },
      { name: "status", label: "상태", type: "select", options: ["정상", "주의", "관찰", "본게임 종목", "IPO 후보", "비활성"] },
      { name: "oneLine", label: "한 줄 설명", type: "text", span: 2 },
      { name: "description", label: "상세 설명", type: "textarea", rows: 5, span: 2 },
      { name: "logoEmoji", label: "로고 이모지", type: "text" },
      { name: "tags", label: "태그", type: "tags", span: 2 },
      { name: "wikiId", label: "연결 Wiki ID", type: "wiki" }
    ],
    news: [
      { name: "id", label: "ID", type: "text", required: true, placeholder: "news-ai-chip-order" },
      { name: "title", label: "제목", type: "text", required: true, span: 2 },
      { name: "body", label: "본문", type: "textarea", rows: 6, span: 2 },
      { name: "type", label: "유형", type: "select", options: ["company", "sector", "market", "rumor"] },
      { name: "targetCompanyId", label: "대상 회사", type: "company" },
      { name: "targetSector", label: "대상 업종", type: "sector" },
      { name: "effect", label: "효과", type: "select", options: ["up", "down", "mixed", "volatility"] },
      { name: "impact", label: "영향도", type: "number", min: 0, max: 100, step: 1 },
      { name: "duration", label: "지속 라운드", type: "number", min: 0, step: 1 },
      { name: "visibility", label: "공개 상태", type: "select", options: ["visible", "draft", "hidden", "scheduled"] },
      { name: "priority", label: "우선순위", type: "number", min: 0, step: 1 },
      { name: "createdAt", label: "생성일", type: "datetime" },
      { name: "tags", label: "태그", type: "tags", span: 2 },
      { name: "relatedWikiIds", label: "관련 Wiki ID", type: "tags", span: 2 }
    ],
    sectors: [
      { name: "id", label: "ID", type: "text", required: true, placeholder: "ai-electronics" },
      { name: "name", label: "업종명", type: "text", required: true },
      { name: "description", label: "설명", type: "textarea", rows: 5, span: 2 },
      { name: "marketSensitivity", label: "시장 민감도", type: "number", min: 0, max: 100, step: 1 },
      { name: "defaultVolatility", label: "기본 변동성", type: "number", min: 0, max: 100, step: 1 },
      { name: "tags", label: "태그", type: "tags", span: 2 },
      { name: "wikiId", label: "연결 Wiki ID", type: "wiki" }
    ],
    wikiDocs: [
      { name: "id", label: "ID", type: "text", required: true, placeholder: "wiki-neko" },
      { name: "title", label: "문서 제목", type: "text", required: true, span: 2 },
      { name: "category", label: "분류", type: "select", options: ["company", "sector", "term", "guide", "event"] },
      { name: "summary", label: "요약", type: "textarea", rows: 3, span: 2 },
      { name: "content", label: "본문", type: "textarea", rows: 8, span: 2 },
      { name: "relatedCompanyIds", label: "관련 회사 ID", type: "tags", span: 2 },
      { name: "relatedSectors", label: "관련 업종", type: "tags", span: 2 },
      { name: "relatedNewsIds", label: "관련 뉴스 ID", type: "tags", span: 2 },
      { name: "tags", label: "태그", type: "tags", span: 2 },
      { name: "updatedAt", label: "수정일", type: "datetime" }
    ],
    disclosures: [
      { name: "id", label: "ID", type: "text", required: true, placeholder: "disc-neko-1" },
      { name: "title", label: "공시 제목", type: "text", required: true, span: 2 },
      { name: "targetCompanyId", label: "대상 회사", type: "company" },
      { name: "type", label: "공시 유형", type: "select", options: DISCLOSURE_TYPES },
      { name: "body", label: "공시 본문", type: "textarea", rows: 6, span: 2 },
      { name: "source", label: "출처", type: "select", options: ["admin", "system"] },
      { name: "createdAt", label: "생성일", type: "datetime" },
      { name: "updatedAt", label: "수정일", type: "datetime" }
    ]
  };

  const DEFAULTS = {
    companies: {
      id: "",
      name: "",
      sector: "",
      basePrice: 10000,
      currentPrice: 10000,
      risk: "보통",
      growth: 50,
      volatility: 40,
      status: "정상",
      oneLine: "",
      description: "",
      logoEmoji: "M",
      tags: [],
      wikiId: ""
    },
    news: {
      id: "",
      title: "",
      body: "",
      type: "market",
      targetCompanyId: "",
      targetSector: "",
      effect: "mixed",
      impact: 50,
      duration: 1,
      visibility: "visible",
      priority: 10,
      createdAt: "",
      tags: [],
      relatedWikiIds: []
    },
    sectors: {
      id: "",
      name: "",
      description: "",
      marketSensitivity: 50,
      defaultVolatility: 40,
      tags: [],
      wikiId: ""
    },
    wikiDocs: {
      id: "",
      title: "",
      category: "term",
      summary: "",
      content: "",
      relatedCompanyIds: [],
      relatedSectors: [],
      relatedNewsIds: [],
      tags: [],
      updatedAt: ""
    },
    disclosures: {
      id: "",
      title: "",
      targetCompanyId: "",
      type: "공시",
      body: "",
      source: "admin",
      createdAt: "",
      updatedAt: ""
    }
  };

  function nowISO() {
    return new Date().toISOString();
  }

  function createEmptyDataset() {
    return {
      companies: [],
      news: [],
      sectors: [],
      wikiDocs: [],
      disclosures: [], // 방(rooms/{code}) 전용 — 레거시 COLLECTIONS 밖
      meta: {
        version: VERSION,
        updatedAt: nowISO(),
        source: "Market Admin",
        compatibility: {
          marketBoard: "catalog/news-compatible export",
          marketWiki: "catalog/wiki-compatible export",
          roomPath: "/rooms/{code}"
        }
      }
    };
  }

  function createSampleData() {
    const at = nowISO();
    return normalizeDataset({
      companies: [
        {
          id: "neko",
          name: "네코전자",
          sector: "AI·전자",
          basePrice: 10000,
          currentPrice: 11250,
          risk: "보통",
          growth: 88,
          volatility: 54,
          status: "정상",
          oneLine: "생활형 AI 단말과 감정 인식 칩을 만드는 성장주.",
          description: "공공 단말 수요와 부품 수급에 따라 기대감이 크게 흔들리는 전자 기업입니다. AI 테마가 강할 때 가장 먼저 거래가 몰립니다.",
          logoEmoji: "N",
          tags: ["AI", "전자", "성장주"],
          wikiId: "wiki-neko"
        },
        {
          id: "bana",
          name: "바나나항공",
          sector: "항공",
          basePrice: 8200,
          currentPrice: 7740,
          risk: "높음",
          growth: 46,
          volatility: 72,
          status: "주의",
          oneLine: "섬 노선과 야간 화물편에 특화된 항공사.",
          description: "유류비와 교통 정책 변화에 취약하지만 성수기 수요가 붙으면 빠르게 회복합니다.",
          logoEmoji: "B",
          tags: ["항공", "유류비", "고변동"],
          wikiId: "wiki-bana"
        },
        {
          id: "moon",
          name: "달빛식품",
          sector: "식품",
          basePrice: 6400,
          currentPrice: 6580,
          risk: "낮음",
          growth: 58,
          volatility: 28,
          status: "정상",
          oneLine: "야식 키트와 냉동 디저트를 파는 방어형 소비 기업.",
          description: "원재료 가격과 편의점 발주가 중요하며 시장이 불안할 때 방어주처럼 주목받습니다.",
          logoEmoji: "M",
          tags: ["식품", "방어주", "편의점"],
          wikiId: "wiki-moon"
        }
      ],
      news: [
        {
          id: "news-neko-order",
          title: "네코전자, 교실용 AI 단말 공급 계약 기대",
          body: "공공 단말 교체 수요가 다시 언급되며 네코전자에 우호적인 기대가 붙고 있습니다. 다만 부품 수급이 늦어지면 실제 매출 반영은 지연될 수 있습니다.",
          type: "company",
          targetCompanyId: "neko",
          targetSector: "AI·전자",
          effect: "up",
          impact: 72,
          duration: 2,
          visibility: "visible",
          priority: 90,
          createdAt: at,
          tags: ["계약", "AI"],
          relatedWikiIds: ["wiki-neko"]
        },
        {
          id: "news-air-fuel",
          title: "유류비 부담 재부각, 항공 업종 변동성 확대",
          body: "단기 유가 상승과 노선 조정 이슈가 겹치며 항공 업종의 가격 변동성이 커졌습니다.",
          type: "sector",
          targetCompanyId: "bana",
          targetSector: "항공",
          effect: "volatility",
          impact: 65,
          duration: 1,
          visibility: "visible",
          priority: 70,
          createdAt: at,
          tags: ["유류비", "항공"],
          relatedWikiIds: ["wiki-airline-sector"]
        }
      ],
      sectors: [
        {
          id: "ai-electronics",
          name: "AI·전자",
          description: "AI 칩과 전자 단말 업종입니다. 테마 강세 때 가장 먼저 움직이지만 공급 병목에도 민감합니다.",
          marketSensitivity: 82,
          defaultVolatility: 58,
          tags: ["성장", "테마"],
          wikiId: "wiki-ai-sector"
        },
        {
          id: "airline",
          name: "항공",
          description: "여객과 화물 운송 업종입니다. 유류비, 환율, 운항 규제에 크게 흔들립니다.",
          marketSensitivity: 76,
          defaultVolatility: 70,
          tags: ["경기민감", "유류비"],
          wikiId: "wiki-airline-sector"
        },
        {
          id: "food",
          name: "식품",
          description: "간편식과 급식 중심의 소비 업종입니다. 원가 부담은 있지만 방어 성격이 있습니다.",
          marketSensitivity: 38,
          defaultVolatility: 30,
          tags: ["방어", "소비"],
          wikiId: "wiki-food-sector"
        }
      ],
      wikiDocs: [
        {
          id: "wiki-neko",
          title: "네코전자",
          category: "company",
          summary: "생활형 AI 단말과 감정 인식 칩을 만드는 성장 기업.",
          content: "네코전자는 AI 단말 수요가 커질 때 주목받는 회사입니다. 높은 성장성과 기술 기대가 장점이지만 부품 공급과 선반영 가격 부담을 같이 봐야 합니다.",
          relatedCompanyIds: ["neko"],
          relatedSectors: ["AI·전자"],
          relatedNewsIds: ["news-neko-order"],
          tags: ["AI", "전자"],
          updatedAt: at
        },
        {
          id: "wiki-airline-sector",
          title: "항공 업종",
          category: "sector",
          summary: "유류비와 규제에 민감한 경기민감 업종.",
          content: "항공 업종은 수요 회복이 빠르면 상승 탄력이 크지만 비용 구조가 가벼운 편은 아닙니다. 유류비, 환율, 노선 정책을 함께 확인해야 합니다.",
          relatedCompanyIds: ["bana"],
          relatedSectors: ["항공"],
          relatedNewsIds: ["news-air-fuel"],
          tags: ["항공", "유류비"],
          updatedAt: at
        }
      ],
      meta: {
        version: VERSION,
        updatedAt: at,
        source: "Market Admin sample"
      }
    });
  }

  function normalizeDataset(input) {
    const base = createEmptyDataset();
    const data = input && typeof input === "object" ? input.marketAdmin || input.data || input : {};
    COLLECTIONS.forEach((collection) => {
      base[collection] = asArray(data[collection]).map((item) => normalizeItem(collection, item));
    });
    // 공시는 COLLECTIONS 밖이지만 dataset 에서 보존 (room 전용)
    base.disclosures = asArray(data.disclosures).map((item) => normalizeItem("disclosures", item));
    base.meta = {
      ...base.meta,
      ...(data.meta && typeof data.meta === "object" ? data.meta : {}),
      version: data.meta?.version || VERSION,
      updatedAt: data.meta?.updatedAt || nowISO()
    };
    return base;
  }

  function normalizeItem(collection, input) {
    const source = input && typeof input === "object" ? input : {};
    const item = { ...DEFAULTS[collection], ...source };
    FIELD_DEFS[collection].forEach((field) => {
      if (field.type === "number") item[field.name] = numberOr(DEFAULTS[collection][field.name], item[field.name]);
      if (field.type === "tags") item[field.name] = toTags(item[field.name]);
      if (field.type === "datetime") item[field.name] = toISOOrEmpty(item[field.name]);
      if (field.type !== "number" && field.type !== "tags") item[field.name] = item[field.name] == null ? "" : item[field.name];
    });
    item.id = slug(item.id || item.name || item.title || collection);
    if (collection === "news" && !item.createdAt) item.createdAt = nowISO();
    if (collection === "wikiDocs" && !item.updatedAt) item.updatedAt = nowISO();
    if (collection === "disclosures") {
      if (!item.createdAt) item.createdAt = nowISO();
      item.updatedAt = nowISO();
      if (!item.source) item.source = "admin";
    }
    return item;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === "object") return Object.values(value).filter(Boolean);
    return [];
  }

  function toTags(value) {
    if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
    return String(value || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function toISOOrEmpty(value) {
    if (!value) return "";
    if (typeof value === "number") return new Date(value).toISOString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function slug(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ._-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "item-" + Math.random().toString(36).slice(2, 8);
  }

  function numberOr(fallback, value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function tickerFromName(name, id) {
    const source = String(id || name || "MARK").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (source.length >= 4) return source.slice(0, 4);
    const chars = [...String(name || id || "MARK")].map((char) => char.charCodeAt(0).toString(36).slice(-1).toUpperCase());
    return (source + chars.join("")).padEnd(4, "X").slice(0, 4);
  }

  function growthLabel(value) {
    const score = Number(value) || 0;
    if (score >= 85) return "매우 높음";
    if (score >= 68) return "높음";
    if (score <= 35) return "낮음";
    return "보통";
  }

  function directionFromEffect(effect) {
    return {
      up: "상승",
      down: "하락",
      mixed: "혼조",
      volatility: "변동성"
    }[effect] || "혼조";
  }

  function findCompany(dataset, id) {
    return (dataset.companies || []).find((company) => company.id === id) || null;
  }

  function boardCompany(company) {
    const price = numberOr(company.basePrice || 0, company.currentPrice);
    const base = numberOr(price, company.basePrice);
    const growth = clamp(company.growth, 0, 100);
    const volatility = clamp(company.volatility, 0, 100);
    return {
      id: company.id,
      name: company.name,
      ticker: tickerFromName(company.name, company.id),
      sector: company.sector,
      ceo: "",
      business: company.oneLine || company.description || "",
      risk: company.risk || "보통",
      growthLabel: growthLabel(growth),
      dividendLabel: "보통",
      listingStatus: company.status || "정상",
      description: company.description || company.oneLine || "",
      hidden: {
        growth,
        debt: clamp(70 - growth * 0.35 + volatility * 0.25, 5, 95),
        cashFlow: clamp(90 - volatility * 0.5, 5, 95),
        reputation: clamp(45 + growth * 0.25, 5, 95),
        innovation: clamp(growth + 5, 5, 98),
        legalRisk: clamp(volatility * 0.5, 5, 95),
        management: clamp(55 + growth * 0.2 - volatility * 0.1, 5, 95)
      },
      basePrice: base,
      currentPrice: price,
      price,
      oneLine: company.oneLine,
      logoEmoji: company.logoEmoji,
      tags: company.tags || [],
      wikiId: company.wikiId || ""
    };
  }

  function boardNews(news, dataset) {
    const company = findCompany(dataset, news.targetCompanyId);
    return {
      id: news.id,
      source: "market-admin",
      kind: "news",
      date: (news.createdAt || "").slice(0, 10),
      company: company?.name || "",
      ticker: company ? tickerFromName(company.name, company.id) : "",
      sector: news.targetSector || company?.sector || "",
      direction: directionFromEffect(news.effect),
      type: news.type,
      title: news.title,
      summary: news.body,
      body: news.body,
      impactStrength: String(news.impact || ""),
      priority: news.priority,
      visibility: news.visibility,
      tags: news.tags || [],
      relatedWikiIds: news.relatedWikiIds || []
    };
  }

  function sectorMeta(sector) {
    return {
      id: sector.id,
      name: sector.name,
      blurb: sector.description,
      description: sector.description,
      marketSensitivity: sector.marketSensitivity,
      defaultVolatility: sector.defaultVolatility,
      tags: sector.tags || [],
      wikiId: sector.wikiId || ""
    };
  }

  function roomCompat(dataset) {
    const stocks = {};
    (dataset.companies || []).forEach((company) => {
      const price = numberOr(company.basePrice || 0, company.currentPrice);
      const base = numberOr(price, company.basePrice);
      const changeRate = base ? Number((((price - base) / base) * 100).toFixed(2)) : 0;
      const latest = (dataset.news || [])
        .filter((item) => item.visibility === "visible" && (item.targetCompanyId === company.id || item.targetSector === company.sector))
        .sort((a, b) => numberOr(0, b.priority) - numberOr(0, a.priority))[0];
      stocks[company.id] = {
        name: company.name,
        ticker: tickerFromName(company.name, company.id),
        sector: company.sector,
        type: "stock",
        role: company.status || "정상",
        price,
        basePrice: base,
        previousPrice: base,
        open: base,
        high: Math.max(price, base),
        low: Math.min(price, base),
        changeRate,
        volume: 0,
        value: 0,
        volat: company.volatility || 0,
        news: latest?.title || company.oneLine || ""
      };
    });

    const visibleNews = (dataset.news || []).filter((item) => item.visibility === "visible");
    const news = {};
    visibleNews.forEach((item) => {
      news[item.id] = {
        id: item.id,
        title: item.title,
        text: item.body || item.title,
        createdAt: item.createdAt,
        stockName: findCompany(dataset, item.targetCompanyId)?.name || "",
        scope: item.targetSector || item.type,
        effect: item.effect,
        impact: item.impact
      };
    });
    const topNews = [...visibleNews].sort((a, b) => numberOr(0, b.priority) - numberOr(0, a.priority))[0];

    return {
      status: "playing",
      source: "Market Admin",
      marketTick: Date.now(),
      createdAt: dataset.meta?.updatedAt || nowISO(),
      stocks,
      news,
      latestNews: topNews ? { text: topNews.title, time: topNews.createdAt || Date.now() } : null
    };
  }

  function exportBundle(dataset) {
    const normalized = normalizeDataset(dataset);
    const boardCompanies = normalized.companies.map(boardCompany);
    const boardNewsItems = normalized.news.map((item) => boardNews(item, normalized));
    const wikiSectors = normalized.sectors.map(sectorMeta);
    return {
      patch: "Version 1.3.0 - Market Admin",
      version: VERSION,
      exportedAt: nowISO(),
      firebasePaths: PATHS,
      localStorageKeys: STORAGE_KEYS,
      marketAdmin: normalized,
      compatibility: {
        marketBoard: {
          companies: boardCompanies,
          news: boardNewsItems,
          sectors: wikiSectors
        },
        marketWiki: {
          companies: boardCompanies,
          news: boardNewsItems,
          sectors: wikiSectors,
          wikiDocs: normalized.wikiDocs
        },
        room: {
          recommendedCode: "ADMIN1",
          path: PATHS.compatRoom,
          data: roomCompat(normalized)
        }
      }
    };
  }

  window.MarketAdminData = {
    VERSION,
    ADMIN_UIDS,
    FIREBASE_CONFIG,
    FIREBASE_SDK,
    PATHS,
    STORAGE_KEYS,
    COLLECTIONS,
    LABELS,
    FIELD_DEFS,
    DEFAULTS,
    createEmptyDataset,
    createSampleData,
    normalizeDataset,
    normalizeItem,
    exportBundle,
    roomCompat,
    boardCompany,
    boardNews,
    sectorMeta,
    toTags,
    slug,
    nowISO
  };
})();
