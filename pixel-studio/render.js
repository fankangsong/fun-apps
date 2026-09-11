// =====================================================================
// render.js — 像素画板：主画布合成
//
// 渲染管线（每帧全量重绘，画布最大 256×256，开销可忽略）：
//   硬投影 -> 透明棋盘格 -> 洋葱皮(上一帧, 半透明) -> 当前帧像素
//          -> 像素网格 -> 选区虚线 -> 笔刷指示 -> 黑色描边
//
// 关键点：
//   - 主画布按 devicePixelRatio 放大实际像素，再 setTransform 回 CSS 坐标绘制（iPad 不糊）
//   - 帧数据写入 1:1 的离屏 ImageData，再以整数倍 drawImage 放大（imageSmoothingEnabled = false）
// =====================================================================

const Render = (function () {
  'use strict';

  var C = {
    cv: null,
    ctx: null,
    dpr: 1,
    cssW: 0,
    cssH: 0,
    px: 0,
    py: 0,
    off: null,        // 当前帧离屏画布（1:1 像素）
    offCtx: null,
    img: null,        // 复用的 ImageData
    onion: null,      // 洋葱皮离屏画布
    onionCtx: null,
    onionImg: null,
    checker: null,    // 棋盘格 pattern
    checkerCell: 0,   // 当前棋盘格的屏幕边长（用于判断是否需要重建）
    hover: null
  };

  function init(canvasEl) {
    C.cv = canvasEl;
    C.ctx = canvasEl.getContext('2d');
    C.off = document.createElement('canvas');
    C.offCtx = C.off.getContext('2d');
    C.onion = document.createElement('canvas');
    C.onionCtx = C.onion.getContext('2d');
  }

  // 透明棋盘格：每个格子固定代表 2 个画布像素（放得不大时用 4 个，避免过于细碎），
  // 由于格子边长 = 像素数 × 缩放倍数，格线永远落在像素边界上，放大缩小都严格对齐。
  function checkerFor(scale) {
    var cellPixels = scale >= 8 ? 2 : 4;
    var cell = Math.max(4, Math.round(cellPixels * scale));
    if (C.checkerCell === cell && C.checker) return C.checker;
    C.checkerCell = cell;
    var c = document.createElement('canvas');
    c.width = cell * 2;
    c.height = cell * 2;
    var x = c.getContext('2d');
    x.fillStyle = '#fffdf6';
    x.fillRect(0, 0, cell * 2, cell * 2);
    x.fillStyle = '#dbd5c8';
    x.fillRect(0, 0, cell, cell);
    x.fillRect(cell, cell, cell, cell);
    C.checker = C.ctx.createPattern(c, 'repeat');
    return C.checker;
  }

  // 视口尺寸变化（CSS px + 设备像素比）
  function resize(cssW, cssH, dpr) {
    C.cssW = Math.max(1, Math.round(cssW));
    C.cssH = Math.max(1, Math.round(cssH));
    C.dpr = dpr || 1;
    C.cv.width = Math.round(C.cssW * C.dpr);
    C.cv.height = Math.round(C.cssH * C.dpr);
    C.cv.style.width = C.cssW + 'px';
    C.cv.style.height = C.cssH + 'px';
  }

  // 把某一帧的像素写入指定 canvas（1:1），供缩略图 / 预览窗复用
  var paintCache = {};
  function paintFrame(idx, canvasEl) {
    var w = State.w, h = State.h;
    if (canvasEl.width !== w || canvasEl.height !== h) {
      canvasEl.width = w; canvasEl.height = h;
    }
    var cx = canvasEl.getContext('2d');
    var f = State.frameData(idx);
    if (!f) return;
    var key = w + 'x' + h;
    var img = paintCache[key];
    if (!img) {
      img = cx.createImageData(w, h);
      paintCache[key] = img;
    }
    img.data.set(f);
    cx.putImageData(img, 0, 0);
  }

  function frameCanvas(idx) {
    var c = document.createElement('canvas');
    c.width = State.w; c.height = State.h;
    paintFrame(idx, c);
    return c;
  }

  function syncOffscreen() {
    var w = State.w, h = State.h;
    if (C.off.width !== w || C.off.height !== h) {
      C.off.width = w; C.off.height = h;
      C.img = C.offCtx.createImageData(w, h);
    }
    var f = State.frameData();
    if (!f || !C.img) return;
    C.img.data.set(f);
    C.offCtx.putImageData(C.img, 0, 0);
  }

  function syncOnion(idx) {
    var w = State.w, h = State.h;
    if (C.onion.width !== w || C.onion.height !== h) {
      C.onion.width = w; C.onion.height = h;
      C.onionImg = C.onionCtx.createImageData(w, h);
    }
    var f = State.frameData(idx);
    if (!f || !C.onionImg) return false;
    C.onionImg.data.set(f);
    C.onionCtx.putImageData(C.onionImg, 0, 0);
    return true;
  }

  function draw(hover) {
    if (!C.ctx) return;
    var ctx = C.ctx;
    var dpr = C.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, C.cssW, C.cssH);
    ctx.imageSmoothingEnabled = false;

    var r = View.rect();
    var x = Math.round(r.x), y = Math.round(r.y);
    var w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));

    // 1) 硬投影（Memphis 彩影）
    ctx.fillStyle = '#2ec4b6';
    ctx.fillRect(x + 6, y + 6, w, h);

    // 2) 透明棋盘格：平移到画布左上角再填充，保证格线与像素边界对齐
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x, y);
    ctx.fillStyle = checkerFor(View.scale);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // 3) 洋葱皮：上一帧半透明残影
    var n = State.frameCount;
    if (State.onion && n > 1 && !State.playing) {
      var prev = (State.current - 1 + n) % n;
      if (syncOnion(prev)) {
        ctx.save();
        ctx.globalAlpha = 0.34;
        ctx.drawImage(C.onion, x, y, w, h);
        ctx.restore();
      }
    }

    // 4) 当前帧
    syncOffscreen();
    ctx.drawImage(C.off, x, y, w, h);

    // 5) 像素网格
    drawGrid(x, y, w, h, dpr);

    // 6) 选区虚线
    drawSelection(ctx, x, y, w, h, dpr);

    // 7) 笔刷指示
    if (hover) drawHover(ctx, hover, x, y);

    // 8) 黑色描边
    ctx.strokeStyle = '#161616';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
  }

  function drawGrid(x, y, w, h, dpr) {
    if (!State.grid || View.scale < 5) return;
    var ctx = C.ctx;
    var s = View.scale;
    ctx.save();
    ctx.strokeStyle = 'rgba(22,22,22,.18)';
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    for (var i = 1; i < State.w; i++) {
      var sx = Math.round(x + i * s) + 0.5 / dpr;
      ctx.moveTo(sx, y);
      ctx.lineTo(sx, y + h);
    }
    for (var j = 1; j < State.h; j++) {
      var sy = Math.round(y + j * s) + 0.5 / dpr;
      ctx.moveTo(x, sy);
      ctx.lineTo(x + w, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawSelection(ctx, x, y, w, h, dpr) {
    var sel = Tools.selection();
    if (!sel) return;
    var s = View.scale;
    var sx = Math.round(x + sel.x * s);
    var sy = Math.round(y + sel.y * s);
    var sw = Math.round(sel.w * s);
    var sh = Math.round(sel.h * s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fffdf6';
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = 5;
    ctx.strokeStyle = '#161616';
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
    ctx.restore();
  }

  function drawHover(ctx, hover, x, y) {
    var s = View.scale;
    var size = hover.size || State.brush;
    var off = (size - 1) >> 1;
    var sx = x + (hover.x - off) * s;
    var sy = y + (hover.y - off) * s;
    var sw = size * s;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(22,22,22,.75)';
    ctx.strokeRect(sx + 1, sy + 1, sw - 2, sw - 2);
    ctx.strokeStyle = 'rgba(255,253,246,.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sw - 1);
    ctx.restore();
  }

  function clear() {
    if (!C.ctx) return;
    C.ctx.setTransform(C.dpr, 0, 0, C.dpr, 0, 0);
    C.ctx.clearRect(0, 0, C.cssW, C.cssH);
  }

  return {
    init: init,
    resize: resize,
    draw: draw,
    clear: clear,
    paintFrame: paintFrame,
    frameCanvas: frameCanvas,
    invalidateOffscreen: function () {
      C.img = null;
      C.onionImg = null;
      paintCache = {};
    },
    get canvas() { return C.cv; }
  };
})();
