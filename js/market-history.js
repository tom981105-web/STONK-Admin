// js/market-history.js — STONK 압축 캔들 히스토리 공용 유틸 (board/wiki/admin 공유, compat SDK)
// window.MarketHistory 로 노출.
//  - readSeries/bestSeries: rooms/{code}/stocks/{id}/history 의 캔들 읽기
//  - renderChart: 캔들 + 거래량 + 기간 + 호버 상세를 그리는 경량 차트(읽기 전용)
//  - needsCatchup: roomData 가 오래되었는지 판정(읽기)
//  - runCatchUp: (관리자 전용) compat db 로 부분 update 보정. board/wiki 는 호출하지 않음.
(function () {
  "use strict";

  var TIERS = [
    { key: "candles1m", win: 60000, cap: 240 },
    { key: "candles5m", win: 300000, cap: 288 },
    { key: "candles15m", win: 900000, cap: 192 },
    { key: "candles1h", win: 3600000, cap: 168 },
  ];
  var MIN_CATCHUP_MS = 2 * 60000;
  var LOCK_TTL_MS = 60000;
  var WRITE_BUDGET = 4500;
  var MIN_PRICE = 10;

  function bucketStart(t, win) { return Math.floor(t / win) * win; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function tickSize(p) {
    if (p < 2000) return 1; if (p < 5000) return 5; if (p < 20000) return 10;
    if (p < 50000) return 50; if (p < 200000) return 100; return 500;
  }
  function roundToTick(p) { var t = tickSize(p); return Math.round(p / t) * t; }
  function lowerLimit(base) { return Math.max(MIN_PRICE, Math.round(base * 0.7)); }
  function upperLimit(base) { return Math.round(base * 1.3); }
  function randn() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function fmtNum(n) { return Math.round(n || 0).toLocaleString("ko-KR"); }

  function readSeries(history, tierKey) {
    var obj = history && history[tierKey];
    if (!obj) return [];
    var out = [];
    for (var k in obj) {
      var c = obj[k];
      if (c && typeof c.t === "number") out.push(c);
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }
  function bestSeries(history) {
    for (var i = 0; i < TIERS.length; i++) {
      var s = readSeries(history, TIERS[i].key);
      if (s.length) return { tier: TIERS[i].key, candles: s };
    }
    return { tier: null, candles: [] };
  }

  function needsCatchup(roomData) {
    if (!roomData || roomData.status !== "playing") return false;
    var last = (roomData.market && roomData.market.lastTickAt) || roomData.marketTick || 0;
    if (!last) return false;
    return Date.now() - last >= MIN_CATCHUP_MS;
  }
  function staleMinutes(roomData) {
    var last = (roomData && ((roomData.market && roomData.market.lastTickAt) || roomData.marketTick)) || 0;
    if (!last) return 0;
    return Math.max(0, Math.round((Date.now() - last) / 60000));
  }

  // ===== 오프라인 시뮬레이션(관리자 보정용) =====
  // 실제 4초 tick 이 계속 돈 것처럼 변동을 누적(분산은 실제 tick 수에 비례). 평균회귀 없음,
  // 기준가 고정(±30% 밴드), 추세/과열/뉴스 충격 반영. battle src/history.js 와 동일 로직.
  function simulateStock(stock, fromT, toT, numSteps) {
    var stepMs = (toT - fromT) / numSteps;
    var ticksPerCandle = Math.max(1, stepMs / 4000);
    var volat = stock.volat || 1, activ = stock.activ || 1;
    var base = stock.basePrice || stock.price || MIN_PRICE; // 고정
    var price = stock.price || base;
    var trend = stock.trend || 0;
    var heat = stock.heat || 0;
    var isEquity = !stock.type || stock.type === "stock";
    var perTick = 0.00115 * volat * (isEquity ? 1 : 0.7); // 실시간 1틱 own 표준편차 근사
    var sub = 5;
    var candles = [];
    for (var i = 0; i < numSteps; i++) {
      var t0 = fromT + stepMs * i;
      var open = price;
      var tps = ticksPerCandle / sub;
      var hi = open, lo = open, cur = open;
      for (var k = 0; k < sub; k++) {
        // 추세(모멘텀): 완만한 OU 워크 — 방향성은 주되 한 방향 폭주는 막음
        trend = clamp(trend * Math.pow(0.99, tps) + randn() * 0.00028 * volat * Math.sqrt(tps), -0.0022, 0.0022);
        // 과열(테마) 가끔 발동 → 변동/거래 일시 확대
        if (Math.random() < 0.006 * tps) heat = clamp(heat + (0.3 + Math.random() * 0.7), 0, 1.8);
        heat *= Math.pow(0.94, tps);
        var effStd = perTick * (1 + heat * 0.6);
        // 변동 = 추세*틱수 + 랜덤워크(분산은 틱수 비례 → 경과시간만큼 누적·증가)
        var ret = trend * tps + randn() * effStd * Math.sqrt(tps);
        // 뉴스 한 방 충격(드물게)
        if (Math.random() < 0.004 * tps) ret += (Math.random() < 0.5 ? 1 : -1) * (0.008 + Math.random() * 0.028) * (isEquity ? 1 : 0.6);
        cur = cur * (1 + ret);
        cur = clamp(cur, lowerLimit(base), upperLimit(base)); // ±30% 하드 밴드(실시간과 동일)
        cur = Math.max(MIN_PRICE, cur);
        hi = Math.max(hi, cur); lo = Math.min(lo, cur);
      }
      var close = roundToTick(cur);
      candles.push({ t: t0, o: roundToTick(open), h: roundToTick(hi), l: roundToTick(lo), c: close, v: Math.round((300 + Math.random() * 2200) * activ * (1 + heat * 0.8) * clamp(ticksPerCandle / 15, 0.5, 40)) });
      price = close;
    }
    return { candles: candles, finalPrice: price, finalBase: base };
  }
  function mergeIntoTiers(stepCandles) {
    var tiers = {};
    for (var i = 0; i < TIERS.length; i++) tiers[TIERS[i].key] = {};
    for (var j = 0; j < stepCandles.length; j++) {
      var c = stepCandles[j];
      for (var t = 0; t < TIERS.length; t++) {
        var bs = bucketStart(c.t, TIERS[t].win);
        var m = tiers[TIERS[t].key];
        var ex = m[bs];
        if (!ex) m[bs] = { t: bs, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
        else { ex.h = Math.max(ex.h, c.h); ex.l = Math.min(ex.l, c.l); ex.c = c.c; ex.v += c.v; }
      }
    }
    return tiers;
  }

  // 관리자 수동 보정: compat db, rooms/{code} 부분 update. lock 으로 중복 방지.
  function runCatchUp(db, roomCode, roomData, uid, opts) {
    opts = opts || {};
    if (!roomData || !roomData.stocks) return Promise.resolve({ applied: false, reason: "no-stocks" });
    if (roomData.status !== "playing") return Promise.resolve({ applied: false, reason: "not-playing" });
    var now = Date.now();
    var lastTick = (roomData.market && roomData.market.lastTickAt) || roomData.marketTick || 0;
    var elapsed = now - lastTick;
    if (!opts.force && elapsed < MIN_CATCHUP_MS) return Promise.resolve({ applied: false, reason: "fresh", elapsed: elapsed });

    var lockRef = db.ref("rooms/" + roomCode + "/market/catchupLock");
    return lockRef.transaction(function (cur) {
      if (cur && cur.expiresAt && cur.expiresAt > now) return; // 유효 락 → 중단
      return { by: uid || "admin", at: now, expiresAt: now + LOCK_TTL_MS };
    }).then(function (res) {
      if (!res.committed && !opts.force) return { applied: false, reason: "locked" };
      var stocks = roomData.stocks;
      var ids = Object.keys(stocks);
      var perStock = clamp(Math.round(WRITE_BUDGET / ids.length), 30, 480);
      var byMinutes = Math.max(1, Math.round(elapsed / 60000));
      var numSteps = Math.min(perStock, byMinutes, 480);
      var updates = {};
      var candlesWritten = 0;
      ids.forEach(function (id) {
        var s = stocks[id];
        if (!s || typeof s.price !== "number") return;
        var sim = simulateStock(s, lastTick, now, numSteps);
        var tierObjs = mergeIntoTiers(sim.candles);
        var P = "stocks/" + id + "/";
        var hist = s.history || {};
        TIERS.forEach(function (tier) {
          var existing = hist[tier.key] || {};
          var merged = {};
          for (var ek in existing) merged[ek] = existing[ek];
          for (var bk in tierObjs[tier.key]) {
            var cd = tierObjs[tier.key][bk], prev = merged[bk];
            merged[bk] = prev ? { t: cd.t, o: prev.o, h: Math.max(prev.h, cd.h), l: Math.min(prev.l, cd.l), c: cd.c, v: (prev.v || 0) + cd.v } : cd;
          }
          var keysAsc = Object.keys(merged).map(Number).sort(function (a, b) { return a - b; });
          var overflow = keysAsc.length - tier.cap;
          if (overflow > 0) for (var i = 0; i < overflow; i++) updates[P + "history/" + tier.key + "/" + keysAsc[i]] = null;
          var floorKey = keysAsc[Math.max(0, overflow)];
          for (var bk2 in tierObjs[tier.key]) {
            if (Number(bk2) < floorKey) continue;
            updates[P + "history/" + tier.key + "/" + bk2] = merged[bk2];
            candlesWritten++;
          }
        });
        var base = sim.finalBase;
        var finalPrice = Math.max(MIN_PRICE, roundToTick(sim.finalPrice));
        var volSum = sim.candles.reduce(function (a, c) { return a + (c.v || 0); }, 0);
        updates[P + "previousPrice"] = s.price;
        updates[P + "price"] = finalPrice;
        updates[P + "currentPrice"] = finalPrice;
        updates[P + "changeRate"] = +(((finalPrice - base) / base) * 100).toFixed(2);
        updates[P + "volume"] = (s.volume || 0) + volSum;
        updates[P + "value"] = (s.value || 0) + volSum * finalPrice;
        if (finalPrice > (s.high || s.price)) updates[P + "high"] = finalPrice;
        if (finalPrice < (s.low || s.price)) updates[P + "low"] = finalPrice;
        if (s.heat) updates[P + "heat"] = 0;
        if (s.pressure) updates[P + "pressure"] = 0;
      });
      updates["market/tickMs"] = 4000;
      updates["market/lastTickAt"] = now;
      updates["market/lastHistoryAt"] = now;
      updates["market/lastCatchupAt"] = now;
      updates["market/catchupVersion"] = 1;
      updates["market/catchupBy"] = uid || "admin";
      updates["market/catchupLock"] = null;
      updates["marketTick"] = now;
      return db.ref("rooms/" + roomCode).update(updates).then(function () {
        return { applied: true, elapsed: elapsed, numSteps: numSteps, candlesWritten: candlesWritten, stocks: ids.length };
      });
    });
  }

  // ===== 경량 캔들 차트 (읽기 전용) =====
  // canvas 에 candles([{t,o,h,l,c,v}]) 를 그린다. opts.dark=true 면 다크 톤.
  function getCss(name, fallback) {
    try { var v = getComputedStyle(document.body).getPropertyValue(name).trim(); return v || fallback; } catch (e) { return fallback; }
  }
  function renderChart(canvas, candles, opts) {
    if (!canvas) return;
    opts = opts || {};
    var up = opts.up || getCss("--up", "#f23645");
    var down = opts.down || getCss("--down", "#1f6feb");
    var axisText = opts.axis || getCss("--muted", "#8b93a7");
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 600, cssH = canvas.clientHeight || 240;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!candles || !candles.length) {
      ctx.fillStyle = axisText; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("차트 데이터가 아직 없습니다", cssW / 2, cssH / 2);
      return null;
    }
    var RIGHT = 56, plotW = cssW - RIGHT, volH = cssH * 0.18, gap = cssH * 0.06, priceH = cssH - volH - gap;
    var hi = -Infinity, lo = Infinity, maxV = 0;
    candles.forEach(function (c) { hi = Math.max(hi, c.h); lo = Math.min(lo, c.l); maxV = Math.max(maxV, c.v || 0); });
    if (hi === lo) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.14; hi += pad; lo -= pad;
    var yP = function (p) { return priceH * (1 - (p - lo) / (hi - lo)); };
    ctx.font = "11px sans-serif"; ctx.textBaseline = "middle";
    for (var i = 0; i <= 4; i++) {
      var y = (priceH / 4) * i, price = hi - ((hi - lo) / 4) * i;
      ctx.strokeStyle = "rgba(130,140,165,0.14)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(plotW, Math.round(y) + 0.5); ctx.stroke();
      ctx.fillStyle = axisText; ctx.textAlign = "left";
      ctx.fillText(fmtNum(price), plotW + 6, Math.min(priceH - 6, Math.max(8, y)));
    }
    var n = Math.max(candles.length, 14), cw = plotW / n, bodyW = Math.max(2.5, Math.min(14, cw * 0.64));
    var hover = (opts.hover != null) ? opts.hover : -1;
    if (hover >= 0 && hover < candles.length) {
      var hx = hover * cw + cw / 2;
      ctx.strokeStyle = "rgba(130,145,180,0.6)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(hx) + 0.5, 0); ctx.lineTo(Math.round(hx) + 0.5, cssH); ctx.stroke(); ctx.setLineDash([]);
    }
    candles.forEach(function (c, idx) {
      var x = idx * cw + cw / 2, isUp = c.c >= c.o, color = isUp ? up : down;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, yP(c.h)); ctx.lineTo(Math.round(x) + 0.5, yP(c.l)); ctx.stroke();
      var yo = yP(c.o), yc = yP(c.c), top = Math.min(yo, yc), bh = Math.max(1.5, Math.abs(yc - yo));
      ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
      if (maxV > 0) { var vh = (volH - 4) * ((c.v || 0) / maxV); ctx.globalAlpha = 0.4; ctx.fillRect(x - bodyW / 2, cssH - vh, bodyW, vh); ctx.globalAlpha = 1; }
    });
    var last = candles[candles.length - 1].c;
    if (last <= hi && last >= lo) {
      var ly0 = yP(last), col = last >= (candles[0].o || last) ? up : down;
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(0, Math.round(ly0) + 0.5); ctx.lineTo(plotW, Math.round(ly0) + 0.5); ctx.stroke(); ctx.setLineDash([]);
    }
    // x축 시간 라벨(기간 지정 시) — 처음/중간/끝 3개, 실제 t 값 기준
    if (opts.period && candles.length >= 2) {
      ctx.font = "10px sans-serif"; ctx.fillStyle = axisText;
      var marks = [0, Math.floor((candles.length - 1) / 2), candles.length - 1];
      var seen = {};
      marks.forEach(function (mi) {
        if (seen[mi]) return; seen[mi] = 1;
        var label = fmtTime(candles[mi].t, opts.period);
        if (!label) return;
        var mx = mi * cw + cw / 2;
        ctx.textAlign = mi === 0 ? "left" : mi === candles.length - 1 ? "right" : "center";
        var tx = mi === 0 ? 2 : mi === candles.length - 1 ? plotW - 2 : mx;
        ctx.fillText(label, tx, cssH - 2);
      });
    }
    return { cw: cw, plotW: plotW, candles: candles, cssW: cssW, cssH: cssH, period: opts.period };
  }

  // 캔버스 + 기간버튼 + 호버 상세를 묶은 인터랙티브 차트 마운트(읽기 전용)
  // host: { canvas, periodsEl, tipEl }, getHistory: function(period)->candles
  function mountInteractive(host, getCandles, opts) {
    opts = opts || {};
    var geom = null, hover = -1;
    function draw(period) {
      var candles = getCandles(period);
      hover = -1;
      geom = renderChart(host.canvas, candles, opts);
      if (host.tipEl) host.tipEl.classList.add("hidden");
    }
    if (host.periodsEl) {
      host.periodsEl.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-period]");
        if (!btn) return;
        host.periodsEl.querySelectorAll("[data-period]").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        draw(btn.getAttribute("data-period"));
      });
    }
    function onMove(e) {
      if (!geom) return;
      var rect = host.canvas.getBoundingClientRect();
      var px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      var idx = Math.max(0, Math.min(geom.candles.length - 1, Math.floor(px / geom.cw)));
      if (idx === hover) return;
      hover = idx;
      geom = renderChart(host.canvas, geom.candles, Object.assign({}, opts, { hover: idx }));
      if (host.tipEl) showTip(host.tipEl, geom, idx);
    }
    function onLeave() { hover = -1; if (geom) geom = renderChart(host.canvas, geom.candles, opts); if (host.tipEl) host.tipEl.classList.add("hidden"); }
    host.canvas.addEventListener("mousemove", onMove);
    host.canvas.addEventListener("mouseleave", onLeave);
    host.canvas.addEventListener("touchstart", onMove, { passive: true });
    host.canvas.addEventListener("touchmove", onMove, { passive: true });
    host.canvas.addEventListener("touchend", onLeave);
    return { draw: draw, redraw: function () { if (geom) draw(opts.period || "1d"); } };
  }
  function showTip(tip, geom, idx) {
    var c = geom.candles[idx]; if (!c) return;
    var rate = c.o ? ((c.c - c.o) / c.o) * 100 : 0;
    var cls = rate > 0 ? "up" : rate < 0 ? "down" : "flat";
    var when = fmtFull(c.t) || ("구간 " + (idx + 1));
    tip.innerHTML = '<div class="tip-when">' + when + '</div>' +
      '<div class="tip-row"><span>시작</span><b>' + fmtNum(c.o) + '</b></div>' +
      '<div class="tip-row"><span>마지막</span><b>' + fmtNum(c.c) + '</b></div>' +
      '<div class="tip-row"><span>최고</span><b class="up">' + fmtNum(c.h) + '</b></div>' +
      '<div class="tip-row"><span>최저</span><b class="down">' + fmtNum(c.l) + '</b></div>' +
      '<div class="tip-row"><span>거래량</span><b>' + fmtNum(c.v) + '</b></div>' +
      '<div class="tip-row"><span>등락률</span><b class="' + cls + '">' + (rate >= 0 ? "+" : "") + rate.toFixed(2) + '%</b></div>';
    tip.classList.remove("hidden");
    var x = idx * geom.cw + geom.cw / 2;
    var right = x > geom.plotW * 0.6;
    tip.style.left = right ? "" : (x + 10) + "px";
    tip.style.right = right ? (geom.cssW - x + 10) + "px" : "";
    tip.style.top = "8px";
  }

  // 기간 → tier 매핑 + 보유개수 (STONK 게임 구조: 1틱/1일/3일/1주/1달/전체)
  //  1틱: 초단기(최근 캔들 주변) / 1일: 1m·5m / 3일: 5m·15m / 1주: 15m·1h / 1달: 1h·15m / 전체: 가장 넓게
  var PERIOD_MAP = {
    "tick": ["candles1m", "candles5m"],
    "1d": ["candles1m", "candles5m"],
    "3d": ["candles5m", "candles15m"],
    "1w": ["candles15m", "candles1h"],
    "1m": ["candles1h", "candles15m"],
    "all": ["candles1h", "candles15m", "candles5m", "candles1m"],
  };
  var PERIOD_COUNT = { "tick": 10, "1d": 240, "3d": 216, "1w": 224, "1m": 360, "all": 500 };
  function seriesFor(history, period, count) {
    var tiers = PERIOD_MAP[period] || PERIOD_MAP["1d"];
    var s = [];
    for (var i = 0; i < tiers.length; i++) { s = readSeries(history, tiers[i]); if (s.length) break; }
    if (!s.length) { var b = bestSeries(history); s = b.candles; }
    count = count || PERIOD_COUNT[period] || 240;
    if (s.length > count) s = s.slice(s.length - count);
    return s;
  }

  // ── 기간별 시간 표시 (브라우저 local time 기준 안정 처리) ──
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtTime(t, period) {
    if (!(t > 1e11)) return ""; // 합성 인덱스(실 timestamp 아님)면 비움
    var d = new Date(t);
    var hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    var md = (d.getMonth() + 1) + "/" + d.getDate();
    if (period === "tick" || period === "1d") return hm;        // 시:분
    if (period === "3d" || period === "1w") return md + " " + hm; // 월/일 시:분
    return md;                                                   // 1m/all: 월/일
  }
  function fmtFull(t) { // 상세박스용 정확한 날짜/시간
    if (!(t > 1e11)) return "";
    var d = new Date(t);
    return (d.getMonth() + 1) + "/" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  window.MarketHistory = {
    TIERS: TIERS,
    readSeries: readSeries,
    bestSeries: bestSeries,
    seriesFor: seriesFor,
    needsCatchup: needsCatchup,
    staleMinutes: staleMinutes,
    runCatchUp: runCatchUp,
    renderChart: renderChart,
    mountInteractive: mountInteractive,
    fmtNum: fmtNum,
    fmtTime: fmtTime,
    fmtFull: fmtFull,
  };
})();
