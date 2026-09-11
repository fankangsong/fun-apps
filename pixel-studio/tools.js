// =====================================================================
// tools.js — 像素画板：绘制算法与工具状态机
//
// 生命周期（由 input.js 驱动）：
//   Tools.begin(x, y, opt) -> [Tools.move(x, y, opt) ...] -> Tools.end()
//   中途被手势打断时调用 Tools.cancel()（input 层负责回滚历史）
//
// 约定：本模块只修改 State 中的数据，不直接触发重绘；
//       调用方在每次 begin/move/end 后调用 App.invalidate()。
// =====================================================================

const Tools = (function () {
  'use strict';

  var stroke = null;      // 当前笔画
  var selection = null;   // 选区 { x, y, w, h }

  // ------------------------------------------------------------------
  // 基础绘制原语
  // ------------------------------------------------------------------
  function plotBrush(x, y, size, rgba) {
    if (size <= 1) {
      State.setPixelMirrored(x, y, rgba);
      return;
    }
    var off = (size - 1) >> 1;
    for (var j = 0; j < size; j++) {
      for (var i = 0; i < size; i++) {
        State.setPixelMirrored(x - off + i, y - off + j, rgba);
      }
    }
  }

  // Bresenham 连线，保证快速划动不断点
  function line(x0, y0, x1, y1, size, rgba) {
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy, e2;
    for (;;) {
      plotBrush(x0, y0, size, rgba);
      if (x0 === x1 && y0 === y1) break;
      e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function rectShape(x0, y0, x1, y1, fill, size, rgba) {
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    var ay = Math.min(y0, y1), by = Math.max(y0, y1);
    if (fill) {
      for (var y = ay; y <= by; y++) {
        for (var x = ax; x <= bx; x++) State.setPixelMirrored(x, y, rgba);
      }
      return;
    }
    line(ax, ay, bx, ay, size, rgba);
    line(ax, by, bx, by, size, rgba);
    line(ax, ay, ax, by, size, rgba);
    line(bx, ay, bx, by, size, rgba);
  }

  function ellipseShape(x0, y0, x1, y1, fill, size, rgba) {
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    var ay = Math.min(y0, y1), by = Math.max(y0, y1);
    var w = bx - ax + 1, h = by - ay + 1;
    var cxp = ax + w / 2, cyp = ay + h / 2;   // 像素中心坐标系下的圆心
    var rx = w / 2, ry = h / 2;
    var x, y, v, t, cxm, cym, xa, xb, ya, yb;

    if (fill) {
      for (y = ay; y <= by; y++) {
        v = (y + 0.5 - cyp) / ry;
        t = 1 - v * v;
        if (t < 0) continue;
        xa = Math.round(cxp - Math.sqrt(t) * rx - 0.5);
        xb = Math.round(cxp + Math.sqrt(t) * rx - 0.5);
        for (x = Math.max(ax, xa); x <= Math.min(bx, xb); x++) State.setPixelMirrored(x, y, rgba);
      }
      return;
    }
    cxm = cxp - 0.5; cym = cyp - 0.5;
    // 逐行取左右端点
    for (y = ay; y <= by; y++) {
      v = (y - cym) / ry;
      t = 1 - v * v;
      if (t < 0) continue;
      xa = Math.round(cxm - Math.sqrt(t) * rx);
      xb = Math.round(cxm + Math.sqrt(t) * rx);
      plotBrush(xa, y, size, rgba);
      plotBrush(xb, y, size, rgba);
    }
    // 逐列取上下端点，补齐上下弧
    for (x = ax; x <= bx; x++) {
      v = (x - cxm) / rx;
      t = 1 - v * v;
      if (t < 0) continue;
      ya = Math.round(cym - Math.sqrt(t) * ry);
      yb = Math.round(cym + Math.sqrt(t) * ry);
      plotBrush(x, ya, size, rgba);
      plotBrush(x, yb, size, rgba);
    }
  }

  // 4 连通洪水填充（迭代栈，避免深递归）
  function bucket(px, py, rgba) {
    var w = State.w, h = State.h;
    var f = State.frameData();
    if (!f || !State.inBounds(px, py)) return false;
    var start = (py * w + px) * 4;
    var t = [f[start], f[start + 1], f[start + 2], f[start + 3]];
    if (t[0] === rgba[0] && t[1] === rgba[1] && t[2] === rgba[2] && t[3] === rgba[3]) return false;

    var visited = new Uint8Array(w * h);
    var stack = [py * w + px];
    var changed = false;
    while (stack.length) {
      var p = stack.pop();
      if (visited[p]) continue;
      visited[p] = 1;
      var i = p * 4;
      if (f[i] !== t[0] || f[i + 1] !== t[1] || f[i + 2] !== t[2] || f[i + 3] !== t[3]) continue;
      f[i] = rgba[0]; f[i + 1] = rgba[1]; f[i + 2] = rgba[2]; f[i + 3] = rgba[3];
      State.bumpChange();
      changed = true;
      var x = p % w, y = (p / w) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w);
      if (y < h - 1) stack.push(p + w);
    }
    // 镜像填充：对镜像位置再填一次（两侧区域可能不同）
    if (State.mirrorX || State.mirrorY) {
      var mx = State.mirrorX ? w - 1 - px : px;
      var my = State.mirrorY ? h - 1 - py : py;
      if (mx !== px || my !== py) bucket(mx, my, rgba);
    }
    return changed;
  }

  // ------------------------------------------------------------------
  // 选区
  // ------------------------------------------------------------------
  function selNormalize(x0, y0, x1, y1) {
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    var ay = Math.min(y0, y1), by = Math.max(y0, y1);
    ax = Math.max(0, ax); ay = Math.max(0, ay);
    bx = Math.min(State.w - 1, bx); by = Math.min(State.h - 1, by);
    if (bx < ax || by < ay) return null;
    return { x: ax, y: ay, w: bx - ax + 1, h: by - ay + 1 };
  }

  function inSelection(x, y) {
    return !!selection &&
      x >= selection.x && y >= selection.y &&
      x < selection.x + selection.w && y < selection.y + selection.h;
  }

  function copyRegion(rect) {
    var w = State.w;
    var f = State.frameData();
    var buf = new Uint8ClampedArray(rect.w * rect.h * 4);
    for (var y = 0; y < rect.h; y++) {
      var src = ((rect.y + y) * w + rect.x) * 4;
      buf.set(f.subarray(src, src + rect.w * 4), (y * rect.w) * 4);
    }
    return buf;
  }

  function clearRegion(rect) {
    var w = State.w;
    var f = State.frameData();
    for (var y = 0; y < rect.h; y++) {
      var off = ((rect.y + y) * w + rect.x) * 4;
      f.fill(0, off, off + rect.w * 4);
    }
  }

  function pasteRegion(rect, buf) {
    var w = State.w, h = State.h;
    var f = State.frameData();
    for (var y = 0; y < rect.h; y++) {
      var dy = rect.y + y;
      if (dy < 0 || dy >= h) continue;
      for (var x = 0; x < rect.w; x++) {
        var dx = rect.x + x;
        if (dx < 0 || dx >= w) continue;
        var si = (y * rect.w + x) * 4;
        var di = (dy * w + dx) * 4;
        f[di] = buf[si]; f[di + 1] = buf[si + 1]; f[di + 2] = buf[si + 2]; f[di + 3] = buf[si + 3];
      }
    }
  }

  function stampSelection(px, py, opt) {
    var rect = stroke.selRect;
    var dx = px - stroke.grabX, dy = py - stroke.grabY;
    var target = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
    var f = State.frameData();
    f.set(stroke.base);                       // 回到拖动前
    clearRegion(rect);                        // 清空原位置
    pasteRegion(target, stroke.buf);          // 粘贴到新位置
    State.bumpChange();
    stroke.curTarget = target;
    if (opt && opt.snap) selection = target;
  }

  // ------------------------------------------------------------------
  // 工具入口
  // ------------------------------------------------------------------
  function begin(x, y, opt) {
    opt = opt || {};
    var rgba = State.currentRgba();
    var tool = State.tool;
    var size = brushSize(opt.pressure);

    stroke = {
      tool: tool,
      rgba: rgba,
      size: size,
      lastX: x,
      lastY: y,
      startX: x,
      startY: y,
      base: null,
      selRect: null,
      buf: null,
      grabX: 0,
      grabY: 0,
      curTarget: null
    };

    switch (tool) {
      case 'pencil':
      case 'eraser':
        State.beginEdit();
        plotBrush(x, y, size, rgba);
        return true;

      case 'bucket':
        State.beginEdit();
        bucket(x, y, rgba);
        return true;

      case 'picker': {
        var p = State.getPixel(x, y);
        if (p && p[3] > 0) {
          State.setColor(State.rgbToHex(p[0], p[1], p[2]));
          return true;
        }
        return false;
      }

      case 'line':
      case 'rect':
      case 'ellipse':
        State.beginEdit();
        stroke.base = new Uint8ClampedArray(State.frameData());
        drawShape(x, y);
        return true;

      case 'select': {
        if (inSelection(x, y)) {
          // 拖动已有选区内容
          State.beginEdit();
          stroke.selRect = { x: selection.x, y: selection.y, w: selection.w, h: selection.h };
          stroke.base = new Uint8ClampedArray(State.frameData());
          stroke.buf = copyRegion(stroke.selRect);
          stroke.grabX = x;
          stroke.grabY = y;
          stroke.curTarget = stroke.selRect;
          return true;
        }
        // 新建选区
        stroke.selRect = null;
        stroke.newFrom = { x: x, y: y };
        selection = selNormalize(x, y, x, y);
        return true;
      }
    }
    return false;
  }

  function move(x, y, opt) {
    if (!stroke) return false;
    opt = opt || {};
    var size = brushSize(opt.pressure);

    switch (stroke.tool) {
      case 'pencil':
      case 'eraser':
        line(stroke.lastX, stroke.lastY, x, y, size, stroke.rgba);
        stroke.lastX = x; stroke.lastY = y; stroke.size = size;
        return true;

      case 'line':
      case 'rect':
      case 'ellipse':
        State.frameData().set(stroke.base);
        stroke.lastX = x; stroke.lastY = y; stroke.size = size;
        drawShape(x, y);
        return true;

      case 'select':
        if (stroke.newFrom) {
          selection = selNormalize(stroke.newFrom.x, stroke.newFrom.y, x, y);
          return true;
        }
        if (stroke.buf) {
          stroke.lastX = x; stroke.lastY = y;
          stampSelection(x, y, null);
          return true;
        }
        return false;
    }
    return false;
  }

  function end() {
    if (!stroke) return false;
    var changed = true;
    if (stroke.tool === 'select') {
      if (stroke.newFrom) {
        if (!selection || selection.w < 2 || selection.h < 2) selection = null;
      } else if (stroke.buf && stroke.curTarget) {
        selection = stroke.curTarget;
      }
    }
    if (stroke.tool === 'picker') changed = false;
    stroke = null;
    return changed;
  }

  function cancel() {
    stroke = null;
  }

  function drawShape(x, y) {
    var fill = State.shapeFill && stroke.tool !== 'line';
    if (stroke.tool === 'line') {
      line(stroke.startX, stroke.startY, x, y, stroke.size, stroke.rgba);
    } else if (stroke.tool === 'rect') {
      rectShape(stroke.startX, stroke.startY, x, y, fill, stroke.size, stroke.rgba);
    } else if (stroke.tool === 'ellipse') {
      ellipseShape(stroke.startX, stroke.startY, x, y, fill, stroke.size, stroke.rgba);
    }
  }

  // 压感 -> 笔刷边长：压力越大越粗，上界为当前笔刷设置（需开启「压感」开关）
  function brushSize(pressure) {
    var max = State.brush;
    if (!State.pressureOn || max <= 1) return max;
    if (pressure === undefined || pressure === null || pressure <= 0) return max;
    var cfg = CONFIG.penPressure;
    var t = (pressure - cfg.min) / (cfg.max - cfg.min);
    t = Math.max(0, Math.min(1, t));
    return Math.max(1, Math.round(1 + t * (max - 1)));
  }

  function reset() {
    stroke = null;
    selection = null;
  }

  function clearSelection() {
    selection = null;
  }

  return {
    begin: begin,
    move: move,
    end: end,
    cancel: cancel,
    reset: reset,
    bucket: bucket,
    selection: function () { return selection; },
    inSelection: inSelection,
    hasSelection: function () { return !!selection; },
    clearSelection: clearSelection,
    brushSize: brushSize,
    activeStroke: function () { return !!stroke; }
  };
})();
