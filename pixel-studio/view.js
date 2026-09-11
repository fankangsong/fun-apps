// =====================================================================
// view.js — 像素画板：视图变换（缩放 / 平移 / 坐标换算）
//
// 缩放约定：
//   scale >= 1 时强制取整（整数倍放大，像素边缘永远清晰不糊）
//   scale <  1 仅在「画布像素数 > 视口尺寸」时出现（如 256 画布放进 320 窄屏）
// =====================================================================

const View = (function () {
  'use strict';

  var V = {
    scale: 8,
    ox: 0,          // 画布左上角在视口中的位置（CSS px）
    oy: 0,
    vw: 0,          // 视口尺寸（CSS px）
    vh: 0,
    rw: 0,          // 右下角需要让出的空间（悬浮预览卡等，由 main.js 设置）
    rh: 0,
    auto: true      // 是否处于「自适应」状态（用户手动缩放后为 false）
  };

  function setReserve(w, h) {
    V.rw = Math.max(0, w || 0);
    V.rh = Math.max(0, h || 0);
  }

  function setViewport(w, h) {
    V.vw = Math.max(1, w);
    V.vh = Math.max(1, h);
  }

  function minScale() {
    if (!State.w || !State.h) return 1;
    var s = Math.min(V.vw / State.w, V.vh / State.h);
    return Math.min(1, Math.max(0.2, s * 0.9));
  }

  function maxScale() {
    return CONFIG.view.maxScale;
  }

  function clampScale(s) {
    s = Math.max(minScale(), Math.min(maxScale(), s));
    return s >= 1 ? Math.floor(s) : s;
  }

  // 给定视口与预留空间，算出会采用的缩放倍数（与 fit 同一公式，供外部试算）
  function scaleFor(vw, vh, rw, rh) {
    var pad = CONFIG.view.padding;
    var availW = Math.max(48, vw - pad * 2 - (rw || 0));
    var availH = Math.max(48, vh - pad * 2 - (rh || 0));
    var s = Math.min(availW / State.w, availH / State.h);
    var lo = Math.min(1, Math.max(0.2, Math.min(vw / State.w, vh / State.h) * 0.9));
    s = Math.max(lo, Math.min(maxScale(), s));
    return s >= 1 ? Math.floor(s) : s;
  }

  // 自适应：整数倍铺满可用区域（扣除右下角预留空间）
  function fit() {
    V.scale = scaleFor(V.vw, V.vh, V.rw, V.rh);
    center();
    V.auto = true;
    State.scale = V.scale;
    return V.scale;
  }

  // 先按视口居中；若与右下角预留区相交，再做最小必要的左上避让（避免整体偏移过多）
  function center() {
    var cw = State.w * V.scale;
    var ch = State.h * V.scale;
    V.ox = Math.round((V.vw - cw) / 2);
    V.oy = Math.round((V.vh - ch) / 2);
    if (V.rw > 0 || V.rh > 0) {
      // 预留量已含边距，这里留 4px 安全余量，保证画布绝不侵入预留区
      var limitX = V.vw - V.rw - 4;
      var limitY = V.vh - V.rh - 4;
      if (V.ox + cw > limitX) V.ox = Math.round(Math.min(V.ox, limitX - cw));
      if (V.oy + ch > limitY) V.oy = Math.round(Math.min(V.oy, limitY - ch));
    }
  }

  function clampPan() {
    var cw = State.w * V.scale, ch = State.h * V.scale;
    var mx = Math.max(36, V.vw * CONFIG.view.minVisible);
    var my = Math.max(36, V.vh * CONFIG.view.minVisible);
    V.ox = Math.round(Math.max(-cw + mx, Math.min(V.vw - mx, V.ox)));
    V.oy = Math.round(Math.max(-ch + my, Math.min(V.vh - my, V.oy)));
  }

  function pan(dx, dy) {
    if (!dx && !dy) return false;
    V.ox += dx;
    V.oy += dy;
    clampPan();
    V.auto = false;
    return true;
  }

  function zoomAt(sx, sy, factor) {
    var old = V.scale;
    var next = clampScale(old * factor);
    if (Math.abs(next - old) < 1e-6) return false;
    var px = (sx - V.ox) / old;
    var py = (sy - V.oy) / old;
    V.scale = next;
    V.ox = sx - px * next;
    V.oy = sy - py * next;
    clampPan();
    V.auto = false;
    State.scale = next;
    return true;
  }

  function toPixel(sx, sy) {
    return {
      x: Math.floor((sx - V.ox) / V.scale),
      y: Math.floor((sy - V.oy) / V.scale)
    };
  }

  function toScreen(px, py) {
    return { x: V.ox + px * V.scale, y: V.oy + py * V.scale };
  }

  function rect() {
    return { x: V.ox, y: V.oy, w: State.w * V.scale, h: State.h * V.scale };
  }

  // 画布是否已经大过视口（iPad 旋转 / 分屏后需要重新自适应，避免看不到全貌）
  function needsRefit() {
    var cw = State.w * V.scale, ch = State.h * V.scale;
    return cw > V.vw * 1.02 || ch > V.vh * 1.02;
  }

  function zoomLabel() {
    var s = V.scale;
    return (s >= 1 ? '×' + Math.round(s) : '×' + s.toFixed(2));
  }

  return {
    get scale() { return V.scale; },
    get ox() { return V.ox; },
    get oy() { return V.oy; },
    get auto() { return V.auto; },
    setViewport: setViewport,
    setReserve: setReserve,
    fit: fit,
    center: center,
    pan: pan,
    zoomAt: zoomAt,
    clampPan: clampPan,
    toPixel: toPixel,
    toScreen: toScreen,
    rect: rect,
    needsRefit: needsRefit,
    scaleFor: scaleFor,
    zoomLabel: zoomLabel,
    minScale: minScale,
    maxScale: maxScale
  };
})();
