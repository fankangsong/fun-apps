// =====================================================================
// main.js — 像素画板：应用装配
//
// 启动顺序：Render.init -> 读取本机存档(或新建) -> 布局 -> UI 构建 -> 输入绑定
// 帧循环：requestAnimationFrame 常驻，按 deltaTime 推进播放（禁止按帧累加），
//         切后台时暂停播放并在回到前台后重置时间基准，避免「瞬移」。
// =====================================================================

const App = (function () {
  'use strict';

  var board = null;
  var rafId = 0;
  var lastTs = 0;
  var playAcc = 0;
  var resizeTimer = 0;
  var pausedByHide = false;
  var booted = false;

  // ------------------------------------------------------------------
  // 启动
  // ------------------------------------------------------------------
  function init() {
    if (booted) return;
    booted = true;

    board = document.getElementById('board');
    Render.init(board);

    var restored = State.load();
    if (!restored) State.createProject(CONFIG.defaultW, CONFIG.defaultH);

    layout();
    UI.init();
    Input.bind(board);

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    Render.draw(Input.hover());
    UI.updateHud();

    rafId = requestAnimationFrame(loop);

    if (restored) {
      UI.toast('已恢复上次的作品（' + State.w + '×' + State.h + ' · ' + State.frameCount + ' 帧）');
    } else {
      UI.toast('双指捏合缩放 · 双指轻点撤销 · 长按手机上不会有菜单');
    }
  }

  // ------------------------------------------------------------------
  // 布局：画布随容器与 DPR 重算
  // ------------------------------------------------------------------
  function layout() {
    var stage = document.getElementById('stage');
    if (!stage) return;
    var r = stage.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    dpr = Math.max(1, Math.min(3, dpr));   // 限制到 3 以内，兼顾清晰度与性能
    var res = previewReserve(r.width, r.height);
    Render.resize(r.width, r.height, dpr);
    View.setViewport(r.width, r.height);
    View.setReserve(res.w, res.h);
    // 自适应状态下始终重排；用户手动缩放过则保留其视图，除非画布已经大过视口
    if (View.auto || View.needsRefit()) View.fit();
    else View.clampPan();
  }

  // 右下角悬浮预览卡需要让出的空间。
  // 判据是「几何上会不会真的压住画布」：先看不让位时的画布是否与卡片相交，
  // 不相交就不动画布；相交才让位；若让位后仍相交（卡片过大）再权衡画布大小。
  function previewReserve(vw, vh) {
    var card = document.getElementById('previewCard');
    if (!card || !State.w || !State.h) return { w: 0, h: 0 };
    var cr = card.getBoundingClientRect();
    if (!cr.width || !cr.height) return { w: 0, h: 0 };

    var w = Math.round(cr.width) + 20;
    var h = Math.round(cr.height) + 16;
    var s0 = View.scaleFor(vw, vh, 0, 0);
    var s1 = View.scaleFor(vw, vh, w, h);

    // 卡片占位（贴右下角，留 14px 边距）
    var cardL = vw - cr.width - 14;
    var cardT = vh - cr.height - 14;

    // 与 View.center() 同一套几何：居中 + 最小避让
    function overlaps(scale, rw, rh) {
      var cw = State.w * scale;
      var ch = State.h * scale;
      var ox = (vw - cw) / 2;
      var oy = (vh - ch) / 2;
      if (rw > 0 || rh > 0) {
        var limitX = vw - rw - 4;
        var limitY = vh - rh - 4;
        if (ox + cw > limitX) ox = Math.min(ox, limitX - cw);
        if (oy + ch > limitY) oy = Math.min(oy, limitY - ch);
      }
      return (ox + cw > cardL + 6) && (oy + ch > cardT + 6);
    }

    if (!overlaps(s0, 0, 0)) return { w: 0, h: 0 };       // 本来就不挡，画布不缩
    if (s1 < 4) return { w: 0, h: 0 };                    // 让位后画布太小，宁可轻微重叠
    if (!overlaps(s1, w, h)) return { w: w, h: h };       // 让位即可避开
    return s1 >= s0 * 0.55 ? { w: w, h: h } : { w: 0, h: 0 };
  }

  function onResize() {
    layout();
    Render.draw(Input.hover());
    UI.updateHud();
    clearTimeout(resizeTimer);
    // iPad 旋转 / 分屏拖动结束后再校准一次，避免中途尺寸残留
    resizeTimer = setTimeout(function () {
      layout();
      Render.draw(Input.hover());
      UI.updateHud();
    }, 200);
  }

  function onVisibility() {
    if (document.hidden) {
      if (State.playing) {
        pausedByHide = true;
        setPlaying(false);
      }
      lastTs = 0;
      playAcc = 0;
      State.saveNow();     // 后台前落盘一次
    } else {
      lastTs = 0;
      playAcc = 0;
      if (pausedByHide) {
        pausedByHide = false;
        setPlaying(true);
      }
    }
  }

  // ------------------------------------------------------------------
  // 帧循环
  // ------------------------------------------------------------------
  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (!lastTs) { lastTs = ts; return; }
    var dt = ts - lastTs;
    lastTs = ts;
    if (!(dt > 0) || dt > 600) dt = 0;   // 异常时间差直接跳过

    if (State.playing && State.frameCount > 1) {
      var per = 1000 / State.fps;
      playAcc += dt;
      var guard = 0;
      while (playAcc >= per && guard < 8) {
        playAcc -= per;
        guard++;
        State.gotoFrame((State.current + 1) % State.frameCount);
        Render.draw(null);
      }
    }
    UI.updatePreview();
  }

  // ------------------------------------------------------------------
  // 渲染调度
  // ------------------------------------------------------------------
  function invalidate() {
    Render.draw(Input.hover());
    State.markPixels(false);   // 节流刷新帧缩略图
  }

  function commit() {
    State.scheduleSave();
    UI.markPreview();
    UI.updatePreview();
  }

  function afterChange(full) {
    if (full) {
      UI.refreshAll();
      View.fit();
    }
    UI.markPreview();
    UI.updatePreview();
    Render.draw(Input.hover());
    UI.updateHud();
    State.scheduleSave();
  }

  // ------------------------------------------------------------------
  // 对外操作
  // ------------------------------------------------------------------
  function setTool(id) {
    State.setTool(id);
    invalidate();
  }

  function stepBrush(d) {
    var list = CONFIG.brushSizes;
    var i = list.indexOf(State.brush);
    if (i < 0) { State.setBrush(list[0]); return; }
    var ni = Math.max(0, Math.min(list.length - 1, i + d));
    if (ni === i) UI.toast(d > 0 ? CONFIG.text.brushMax : CONFIG.text.brushMin);
    else State.setBrush(list[ni]);
  }

  function undo() {
    if (!State.undo()) { UI.toast(CONFIG.text.undoEmpty); return; }
    afterChange(false);
  }

  function redo() {
    if (!State.redo()) { UI.toast(CONFIG.text.redoEmpty); return; }
    afterChange(false);
  }

  function addFrame(copy) {
    var i = State.addFrame(!!copy);
    if (i < 0) { UI.toast(CONFIG.text.maxFrames); return; }
    UI.toast(copy ? '已复制当前帧' : '已新增空白帧');
    afterChange(false);
  }

  function deleteFrame() {
    if (!State.deleteFrame()) { UI.toast(CONFIG.text.needOneFrame); return; }
    UI.toast(CONFIG.text.deleted);
    afterChange(false);
  }

  function clearFrame() {
    State.clearFrame();
    UI.toast('当前帧已清空（可撤销）');
    afterChange(false);
  }

  function moveFrameTo(from, to) {
    if (State.moveFrame(from, to)) afterChange(false);
  }

  function resize(w, h, keep) {
    if (!State.resize(w, h, keep)) { UI.toast('尺寸没有变化'); return; }
    Tools.reset();
    Render.invalidateOffscreen();
    View.fit();
    afterChange(false);
    UI.toast('画布已调整为 ' + State.w + '×' + State.h);
  }

  function setPlaying(v) {
    State.playing = !!v;
    playAcc = 0;
    lastTs = 0;
    UI.renderPlay();
    UI.markPreview();
  }

  function togglePlay() {
    setPlaying(!State.playing);
    if (State.playing && State.frameCount <= 1) UI.toast('只有一帧：点「＋」加帧就是动画了');
  }

  function pickPalette(n) {
    var pal = State.data.palette;
    var idx = (n === 0) ? 9 : (n - 1);
    if (idx >= 0 && idx < pal.length) {
      State.setColor(pal[idx]);
      invalidate();
    }
  }

  function toast(msg) { UI.toast(msg); }

  return {
    init: init,
    invalidate: invalidate,
    commit: commit,
    afterChange: afterChange,
    setTool: setTool,
    stepBrush: stepBrush,
    undo: undo,
    redo: redo,
    addFrame: addFrame,
    deleteFrame: deleteFrame,
    clearFrame: clearFrame,
    moveFrameTo: moveFrameTo,
    resize: resize,
    togglePlay: togglePlay,
    pickPalette: pickPalette,
    toast: toast
  };
})();

App.init();
