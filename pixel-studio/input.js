// =====================================================================
// input.js — 像素画板：指针 / 手势 / 键盘输入
//
// iPad 与 Apple Pencil 适配要点：
//   1. 全部走 Pointer Events，按 pointerId 跟踪，up / cancel 对称清理
//   2. 笔优先：笔正在画时，落下的手掌（touch）直接忽略，绝不中断笔画
//   3. 「仅笔绘制」开关：手指只平移画布，实现手掌防误触
//   4. 笔迹精度：pen 取 getCoalescedEvents() 的全部采样点，配合 Bresenham 补齐
//   5. 手势：双指捏合缩放 / 双指拖动平移 / 两指轻点撤销 / 三指轻点重做
//   6. 画笔中途落下第二根手指 -> 回滚该笔画（避免误触留下杂线）
// =====================================================================

const Input = (function () {
  'use strict';

  var C = { cv: null, rect: null };

  var P = {
    pointers: new Map(),   // pointerId -> { x, y, sx, sy, type, pressure, moved }
    ignored: {},           // 被忽略的手掌指针 id
    mode: 'idle',          // idle | draw | pan | pinch
    drawId: -1,
    strokeBefore: 0,
    panLast: null,
    pinch: null,
    hover: null,
    space: false,
    tap: null
  };

  // ------------------------------------------------------------------
  // 绑定
  // ------------------------------------------------------------------
  function bind(canvasEl) {
    C.cv = canvasEl;

    canvasEl.addEventListener('pointerdown', onDown, { passive: false });
    canvasEl.addEventListener('pointermove', onMove, { passive: false });
    canvasEl.addEventListener('pointerup', onUp);
    canvasEl.addEventListener('pointercancel', onCancel);
    canvasEl.addEventListener('pointerout', onOut);
    canvasEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvasEl.addEventListener('wheel', onWheel, { passive: false });

    // iOS Safari 手势兜底（touch-action: none 之外的保险）
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) {
      canvasEl.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false });
    });
    // 长按不弹系统菜单
    canvasEl.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () { P.space = false; });
  }

  function local(e) {
    if (!C.rect) C.rect = C.cv.getBoundingClientRect();
    return { x: e.clientX - C.rect.left, y: e.clientY - C.rect.top };
  }

  function refreshRect() {
    C.rect = C.cv.getBoundingClientRect();
  }

  function penActive() {
    var found = false;
    P.pointers.forEach(function (r) { if (r.type === 'pen') found = true; });
    return found;
  }

  function drawType() {
    var r = P.pointers.get(P.drawId);
    return r ? r.type : null;
  }

  // ------------------------------------------------------------------
  // 笔画
  // ------------------------------------------------------------------
  function startStroke(lx, ly, pressure, type) {
    var p = View.toPixel(lx, ly);
    P.strokeBefore = State.changeCount();
    State.pushUndo();
    Tools.begin(p.x, p.y, { pressure: type === 'pen' ? pressure : undefined });
    P.hover = State.inBounds(p.x, p.y) ? { x: p.x, y: p.y, size: State.brush } : null;
    App.invalidate();
  }

  function pumpStroke(ev) {
    var pts = [], i;
    if (ev.getCoalescedEvents && ev.pointerType === 'pen') {
      var list = ev.getCoalescedEvents();
      for (i = 0; i < list.length; i++) pts.push(list[i]);
    }
    if (!pts.length) pts.push(ev);
    var last = null;
    for (i = 0; i < pts.length; i++) {
      var lp = local(pts[i]);
      var p = View.toPixel(lp.x, lp.y);
      Tools.move(p.x, p.y, { pressure: pts[i].pointerType === 'pen' ? pts[i].pressure : undefined });
      last = p;
    }
    if (last && State.inBounds(last.x, last.y)) {
      P.hover = { x: last.x, y: last.y, size: Tools.brushSize(ev.pressure) };
    }
    App.invalidate();
  }

  function endStroke() {
    if (P.drawId === -1) return;
    Tools.end();
    if (State.changeCount() === P.strokeBefore) State.dropLastUndo();
    P.drawId = -1;
    App.invalidate();
    App.commit();
  }

  // 手势打断 / 系统打断：回滚这一笔
  function abortStroke() {
    if (P.drawId === -1) return;
    Tools.cancel();
    if (State.changeCount() !== P.strokeBefore) State.revertStroke();
    else State.dropLastUndo();
    P.drawId = -1;
    App.invalidate();
    App.commit();
  }

  // ------------------------------------------------------------------
  // 指针事件
  // ------------------------------------------------------------------
  function onDown(e) {
    refreshRect();
    var lp = local(e);

    // 手掌防误触：笔正在绘制时落下的触摸一律忽略
    if (e.pointerType === 'touch' && P.drawId !== -1 && drawType() === 'pen') {
      P.ignored[e.pointerId] = true;
      e.preventDefault();
      return;
    }

    var rec = {
      x: lp.x, y: lp.y, sx: lp.x, sy: lp.y,
      type: e.pointerType,
      pressure: e.pressure,
      moved: false
    };
    P.pointers.set(e.pointerId, rec);
    try { C.cv.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    e.preventDefault();

    if (!P.tap) P.tap = { max: 1, moved: false, t: performance.now() };
    else P.tap.max = Math.max(P.tap.max, P.pointers.size);

    // 第二根手指落下 -> 进入手势，中断进行中的笔画
    if (P.pointers.size >= 2) {
      abortStroke();
      P.mode = 'pinch';
      P.pinch = null;
      P.panLast = null;
      return;
    }

    // 笔优先：若当前工具在画，再来一支笔也接管为绘制（触摸不会走到这里）
    var wantPan = false;
    if (e.pointerType === 'mouse') {
      wantPan = (e.button === 1) || P.space;
    } else if (e.pointerType === 'touch') {
      wantPan = State.penOnly || penActive();
    }
    if (wantPan) {
      P.mode = 'pan';
      P.panLast = { x: lp.x, y: lp.y };
      return;
    }

    P.mode = 'draw';
    P.drawId = e.pointerId;
    startStroke(lp.x, lp.y, e.pressure, e.pointerType);
  }

  function onMove(e) {
    if (P.ignored[e.pointerId]) return;

    var rec = P.pointers.get(e.pointerId);
    if (!rec) {
      // 未按下的悬停（鼠标 / Apple Pencil 悬停）
      if ((e.pointerType === 'mouse' || e.pointerType === 'pen') && !e.buttons) {
        var lp0 = local(e);
        var p0 = View.toPixel(lp0.x, lp0.y);
        var prev = P.hover;
        P.hover = State.inBounds(p0.x, p0.y) ? { x: p0.x, y: p0.y, size: State.brush } : null;
        if (!prev !== !P.hover || (prev && (prev.x !== P.hover.x || prev.y !== P.hover.y))) App.invalidate();
      }
      return;
    }

    e.preventDefault();
    var lp = local(e);
    rec.x = lp.x; rec.y = lp.y;
    if (Math.abs(lp.x - rec.sx) > CONFIG.gesture.multiTapDist ||
        Math.abs(lp.y - rec.sy) > CONFIG.gesture.multiTapDist) {
      rec.moved = true;
      if (P.tap) P.tap.moved = true;
    }

    if (P.mode === 'draw' && e.pointerId === P.drawId) {
      pumpStroke(e);
    } else if (P.mode === 'pan' && P.panLast) {
      View.pan(lp.x - P.panLast.x, lp.y - P.panLast.y);
      P.panLast = { x: lp.x, y: lp.y };
      P.hover = null;
      App.invalidate();
    } else if (P.mode === 'pinch') {
      pinchUpdate();
    }
  }

  function onUp(e) {
    if (P.ignored[e.pointerId]) { delete P.ignored[e.pointerId]; return; }
    P.pointers.delete(e.pointerId);
    try { C.cv.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }

    if (e.pointerId === P.drawId) endStroke();

    if (P.pointers.size === 0) {
      checkMultiTap();
      P.mode = 'idle';
      P.pinch = null;
      P.panLast = null;
    } else if (P.pointers.size === 1) {
      // 双指变单指：转为平移
      var rest = null;
      P.pointers.forEach(function (r) { rest = r; });
      P.mode = 'pan';
      P.pinch = null;
      if (rest) P.panLast = { x: rest.x, y: rest.y };
    }
  }

  function onCancel(e) {
    if (P.ignored[e.pointerId]) { delete P.ignored[e.pointerId]; return; }
    P.pointers.delete(e.pointerId);
    if (e.pointerId === P.drawId) abortStroke();
    if (P.pointers.size === 0) {
      P.mode = 'idle';
      P.pinch = null;
      P.panLast = null;
      P.tap = null;
    }
  }

  function onOut(e) {
    if (e.pointerType === 'mouse' && P.hover) {
      P.hover = null;
      App.invalidate();
    }
  }

  // ------------------------------------------------------------------
  // 多指手势
  // ------------------------------------------------------------------
  function twoPoints() {
    var arr = [];
    P.pointers.forEach(function (r) { arr.push(r); });
    return arr;
  }

  function pinchUpdate() {
    var pts = twoPoints();
    if (pts.length < 2) return;
    var a = pts[0], b = pts[1];
    var d = Math.max(6, Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)));
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (P.pinch) {
      var factor = 1 + (d / P.pinch.d - 1) * CONFIG.view.pinchGain;
      View.zoomAt(mx, my, factor);
      View.pan(mx - P.pinch.mx, my - P.pinch.my);
      P.pinch.d = d; P.pinch.mx = mx; P.pinch.my = my;
    } else {
      P.pinch = { d: d, mx: mx, my: my };
    }
    P.hover = null;
    App.invalidate();
  }

  function checkMultiTap() {
    var tap = P.tap;
    P.tap = null;
    if (!tap || tap.moved) return;
    if (performance.now() - tap.t > CONFIG.gesture.multiTapMs) return;
    if (tap.max >= 3 && CONFIG.gesture.threeFingerRedo) {
      if (State.redo()) { App.toast('已重做'); App.invalidate(); App.commit(); }
    } else if (tap.max === 2 && CONFIG.gesture.twoFingerUndo) {
      if (State.undo()) { App.toast('已撤销'); App.invalidate(); App.commit(); }
    }
  }

  // ------------------------------------------------------------------
  // 滚轮 / 键盘
  // ------------------------------------------------------------------
  function onWheel(e) {
    e.preventDefault();
    refreshRect();
    var lp = local(e);
    var step = CONFIG.view.wheelStep;
    View.zoomAt(lp.x, lp.y, e.deltaY < 0 ? step : 1 / step);
    App.invalidate();
  }

  var TOOL_KEYS = {
    b: 'pencil', e: 'eraser', g: 'bucket', l: 'line',
    r: 'rect', o: 'ellipse', i: 'picker', m: 'select'
  };

  function onKeyDown(e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var k = e.key;
    var meta = e.ctrlKey || e.metaKey;

    if (meta && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      var ok = e.shiftKey ? State.redo() : State.undo();
      if (ok) { App.toast(e.shiftKey ? '已重做' : '已撤销'); App.invalidate(); App.commit(); }
      return;
    }
    if (meta && (k === 'y' || k === 'Y')) {
      e.preventDefault();
      if (State.redo()) { App.toast('已重做'); App.invalidate(); App.commit(); }
      return;
    }
    if (meta) return;

    var low = k.length === 1 ? k.toLowerCase() : k;
    if (TOOL_KEYS[low]) {
      e.preventDefault();
      App.setTool(TOOL_KEYS[low]);
      return;
    }
    switch (k) {
      case ' ':
        e.preventDefault();
        P.space = true;
        if (C.cv) C.cv.style.cursor = 'grab';
        break;
      case '[':
        e.preventDefault();
        App.stepBrush(-1);
        break;
      case ']':
        e.preventDefault();
        App.stepBrush(1);
        break;
      case 'ArrowLeft': e.preventDefault(); View.pan(48, 0); App.invalidate(); break;
      case 'ArrowRight': e.preventDefault(); View.pan(-48, 0); App.invalidate(); break;
      case 'ArrowUp': e.preventDefault(); View.pan(0, 48); App.invalidate(); break;
      case 'ArrowDown': e.preventDefault(); View.pan(0, -48); App.invalidate(); break;
      case '+': case '=':
        e.preventDefault();
        View.zoomAt(View.rect().x + View.rect().w / 2, View.rect().y + View.rect().h / 2, 1.25);
        App.invalidate();
        break;
      case '-': case '_':
        e.preventDefault();
        View.zoomAt(View.rect().x + View.rect().w / 2, View.rect().y + View.rect().h / 2, 0.8);
        App.invalidate();
        break;
      case 'k': case 'K':
        e.preventDefault();
        App.togglePlay();
        break;
      case 'n': case 'N':
        e.preventDefault();
        App.addFrame(false);
        break;
      case 'Delete': case 'Backspace':
        e.preventDefault();
        App.deleteFrame();
        break;
      case 'Escape':
        e.preventDefault();
        Tools.clearSelection();
        App.invalidate();
        break;
      case '0': case '1': case '2': case '3': case '4':
      case '5': case '6': case '7': case '8': case '9':
        e.preventDefault();
        App.pickPalette(Number(k));
        break;
    }
  }

  function onKeyUp(e) {
    if (e.key === ' ') {
      P.space = false;
      if (C.cv) C.cv.style.cursor = '';
    }
  }

  return {
    bind: bind,
    hover: function () { return P.hover; },
    isDrawing: function () { return P.drawId !== -1; },
    isGesturing: function () { return P.mode === 'pinch'; }
  };
})();
