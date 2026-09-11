// =====================================================================
// ui.js — 像素画板：面板构建与事件绑定
//
// 职责：
//   - 构建工具按钮 / 笔刷档位 / 调色板 / 帧列表（数据变化时按事件增量刷新）
//   - 顶部操作条与四个弹窗（尺寸 / 导入 / 导出 / 结果 / 手势）
//   - 窄屏底部工具条与「颜色 · 帧 · 动画」抽屉
//   - toast 提示与保存状态显示
//
// 与业务层的关系：UI 只调用 State / Exporter / App 的公开方法，不直接改像素数据。
// =====================================================================

const UI = (function () {
  "use strict";

  var el = {};
  var toastTimer = 0;
  var resultUrl = null;
  var lastResult = null;
  var dragFrom = -1;
  var dragOver = null;
  var expCfg = { format: "png", scale: 4, loop: true, trans: true, cols: 4 };
  var previewDirty = true;

  function $(id) {
    return document.getElementById(id);
  }

  function isIOS() {
    var ua = navigator.userAgent || "";
    if (/iP(hone|ad|od)/.test(ua)) return true;
    return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  }

  // ------------------------------------------------------------------
  // 初始化
  // ------------------------------------------------------------------
  function init() {
    cacheEls();
    buildTools();
    buildBrush();
    buildSizePresets();
    bindTop();
    bindFileMenu();
    bindTools();
    bindPalette();
    bindFrames();
    bindAnim();
    bindDrawer();
    bindSheets();
    bindStateEvents();
    refreshAll();
  }

  function cacheEls() {
    var ids = [
      "sizeLabel",
      "btnSize",
      "btnImport",
      "btnExport",
      "btnHelp",
      "saveState",
      "btnQuickUndo",
      "btnQuickRedo",
      "btnQuickClear",
      "btnFileMenu",
      "fileMenuPop",
      "toolGrid",
      "brushGrid",
      "tgMirrorX",
      "tgMirrorY",
      "tgShapeFill",
      "tgPen",
      "tgPressure",
      "zoomTip",
      "preview",
      "btnPlay",
      "btnGrid2",
      "swatches",
      "btnPalette",
      "paletteGrid",
      "colorInput",
      "btnColorAdd",
      "btnColorRemove",
      "btnPaletteClose",
      "ovPalette",
      "frameList",
      "frameCount",
      "fps",
      "fpsVal",
      "btnPlay2",
      "btnOnion2",
      "btnImport2",
      "btnHelp2",
      "btnDrawer",
      "drawerVeil",
      "ovSize",
      "sizePresets",
      "cusW",
      "cusH",
      "keepContent",
      "btnSizeCancel",
      "btnSizeOk",
      "ovImport",
      "btnPickImage",
      "btnPickProject",
      "btnImportCancel",
      "fileImport",
      "fileProject",
      "ovExport",
      "expFormats",
      "expScales",
      "gifOpts",
      "gifLoop",
      "gifTrans",
      "sheetOptRow",
      "sheetCols",
      "expProgress",
      "expBar",
      "btnExportCancel",
      "btnExportOk",
      "ovResult",
      "resultImg",
      "resultHint",
      "btnResultClose",
      "btnResultSave",
      "ovHelp",
      "btnHelpClose",
      "toast",
    ];
    ids.forEach(function (id) {
      el[id] = $(id);
    });
  }

  // ------------------------------------------------------------------
  // 构建
  // ------------------------------------------------------------------
  function buildTools() {
    var html = CONFIG.tools
      .map(function (t) {
        return (
          '<button class="icon-btn" data-tool="' +
          t.id +
          '" aria-pressed="false" ' +
          'aria-label="' +
          t.name +
          "（快捷键 " +
          t.key +
          '）" title="' +
          t.name +
          " · " +
          t.key +
          '" style="--tc:' +
          t.tc +
          '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" ' +
          'stroke-linecap="round" stroke-linejoin="round">' +
          t.svg +
          "</svg>" +
          '<span class="kb">' +
          t.key +
          "</span></button>"
        );
      })
      .join("");
    html +=
      '<button class="icon-btn" id="btnUndo" aria-label="撤销" title="撤销 · Ctrl+Z" style="--tc:var(--blue)">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4.5 10.5h10a4.5 4.5 0 0 1 0 9H9"/><path d="M8.5 6l-4 4.5 4 4.5"/></svg></button>';
    html +=
      '<button class="icon-btn" id="btnRedo" aria-label="重做" title="重做 · Ctrl+Shift+Z" style="--tc:var(--blue)">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M19.5 10.5h-10a4.5 4.5 0 0 0 0 9H15"/><path d="M15.5 6l4 4.5-4 4.5"/></svg></button>';
    el.toolGrid.innerHTML = html;
  }

  function buildBrush() {
    // 每个 chips 里按真实 px 画一个圆点，直观展示笔刷粗细
    el.brushGrid.innerHTML = CONFIG.brushSizes
      .map(function (n) {
        var d = Math.min(n, 30);
        return (
          '<button class="chip" data-brush="' + n + '" aria-pressed="false" ' +
          'title="' + n + ' px 笔刷" aria-label="' + n + ' 像素笔刷">' +
          '<i class="dot" style="width:' + d + "px;height:" + d + 'px"></i></button>'
        );
      })
      .join("");
  }

  function buildSizePresets() {
    var html = CONFIG.sizePresets
      .map(function (n) {
        return '<button data-preset="' + n + '">' + n + "×" + n + "</button>";
      })
      .join("");
    html += '<button data-preset="160x144">160×144</button>';
    html += '<button data-preset="0">自定义</button>';
    el.sizePresets.innerHTML = html;
  }

  // ------------------------------------------------------------------
  // 顶栏
  // ------------------------------------------------------------------
  function bindTop() {
    el.btnSize.addEventListener("click", openSizeSheet);
    el.btnImport.addEventListener("click", function () {
      open(el.ovImport);
    });
    el.btnImport2.addEventListener("click", function () {
      document.body.classList.remove("side-open");
      open(el.ovImport);
    });
    el.btnExport.addEventListener("click", function () {
      expCfg.scale = CONFIG.export.defaultScale;
      syncExportSheet();
      open(el.ovExport);
    });
    el.btnHelp.addEventListener("click", function () {
      open(el.ovHelp);
    });
    el.btnHelp2.addEventListener("click", function () {
      document.body.classList.remove("side-open");
      open(el.ovHelp);
    });
    // 顶栏快捷操作：撤销 / 重做 / 清空当前画布
    el.btnQuickUndo.addEventListener("click", function () {
      App.undo();
    });
    el.btnQuickRedo.addEventListener("click", function () {
      App.redo();
    });
    el.btnQuickClear.addEventListener("click", function () {
      App.clearFrame();
    });
  }

  // 顶栏「文件」下拉菜单：点触发钮开合，点外部 / Esc / 点菜单项后收起
  function bindFileMenu() {
    var btn = el.btnFileMenu;
    var pop = el.fileMenuPop;
    if (!btn || !pop) return;

    function setOpen(v) {
      pop.hidden = !v;
      btn.setAttribute("aria-expanded", v ? "true" : "false");
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      setOpen(pop.hidden);
    });
    document.addEventListener("pointerdown", function (e) {
      if (pop.hidden) return;
      var inMenu = e.target.closest ? e.target.closest(".file-menu") : null;
      if (!inMenu) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !pop.hidden) setOpen(false);
    });
    pop.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".btn")) setOpen(false);
    });
  }

  // ------------------------------------------------------------------
  // 工具 / 笔刷 / 开关
  // ------------------------------------------------------------------
  function bindTools() {
    el.toolGrid.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-tool]") : null;
      if (t) {
        App.setTool(t.dataset.tool);
        return;
      }
      if (e.target.closest && e.target.closest("#btnUndo")) {
        App.undo();
        return;
      }
      if (e.target.closest && e.target.closest("#btnRedo")) {
        App.redo();
        return;
      }
    });

    el.brushGrid.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-brush]") : null;
      if (b) {
        State.setBrush(Number(b.dataset.brush));
        App.invalidate(); // 刷新画布上的笔刷光标预览
      }
    });

    bindToggle(el.btnGrid2, "grid");
    bindToggle(el.tgMirrorX, "mirrorX");
    bindToggle(el.tgMirrorY, "mirrorY");
    bindToggle(el.tgShapeFill, "shapeFill");
    bindToggle(el.tgPen, "penOnly");
    bindToggle(el.tgPressure, "pressureOn");
    el.btnOnion2.addEventListener("click", function () {
      State.toggleFlag("onion");
    });
  }

  function bindToggle(btn, flag) {
    if (!btn) return;
    btn.addEventListener("click", function () {
      var v = State.toggleFlag(flag);
      if (flag === "penOnly")
        App.toast(v ? "手指将只用于平移画布" : "手指恢复绘制");
      if (flag === "pressureOn")
        App.toast(v ? "笔压开始控制笔刷粗细" : "笔压已关闭，笔刷固定");
      App.invalidate();
    });
  }

  // ------------------------------------------------------------------
  // 调色板
  // ------------------------------------------------------------------
  function bindPalette() {
    function pick(e) {
      var b = e.target.closest ? e.target.closest("[data-hex]") : null;
      if (!b) return;
      State.setColor(b.dataset.hex);
      App.invalidate();
    }
    el.swatches.addEventListener("click", pick);
    el.paletteGrid.addEventListener("click", pick);

    el.colorInput.addEventListener("input", function () {
      State.setColor(el.colorInput.value);
      App.invalidate();
    });
    el.btnPalette.addEventListener("click", function () {
      open(el.ovPalette);
    });
    el.btnPaletteClose.addEventListener("click", function () {
      close(el.ovPalette);
    });
    el.btnColorAdd.addEventListener("click", function () {
      var hex = String(el.colorInput.value).toLowerCase();
      if (State.addPaletteColor(hex)) App.toast("已存入色板 " + hex);
      else App.toast("这个颜色已经在色板里了");
      State.setColor(hex);
      App.invalidate();
    });
    el.btnColorRemove.addEventListener("click", function () {
      var hex = State.color.toLowerCase();
      if (State.removePaletteColor(hex)) App.toast("已从色板移除 " + hex);
      else App.toast("内置颜色不可移除");
      App.invalidate();
    });
  }

  function swatchHtml(hex, active) {
    return (
      '<button class="swatch" data-hex="' +
      hex +
      '" style="--c:' +
      hex +
      '" ' +
      'aria-pressed="' +
      (active ? "true" : "false") +
      '" aria-label="颜色 ' +
      hex +
      '" title="' +
      hex +
      '"></button>'
    );
  }

  function renderPalette() {
    var cur = State.color.toLowerCase();
    // 右栏只保留一行常用色：「最近使用」排在前面，不足一行时用内置色补齐
    var quick = State.data.recent.slice(0, CONFIG.recentMax);
    if (quick.length < CONFIG.recentMax) {
      State.palette.forEach(function (h) {
        if (quick.length < CONFIG.recentMax && quick.indexOf(h) < 0)
          quick.push(h);
      });
    }
    el.swatches.innerHTML = quick
      .map(function (h) {
        return swatchHtml(h, h.toLowerCase() === cur);
      })
      .join("");
    // 完整色板放在浮层对话框里
    el.paletteGrid.innerHTML = State.palette
      .map(function (h) {
        return swatchHtml(h, h.toLowerCase() === cur);
      })
      .join("");
    el.colorInput.value = /^#[0-9a-fA-F]{6}$/.test(State.color)
      ? State.color
      : "#ff6b6b";
  }

  // ------------------------------------------------------------------
  // 帧列表
  // ------------------------------------------------------------------
  function bindFrames() {
    el.frameList.addEventListener("click", function (e) {
      var del = e.target.closest ? e.target.closest(".del") : null;
      if (del) {
        e.stopPropagation();
        App.deleteFrame(Number(del.dataset.del));
        return;
      }
      var dup = e.target.closest ? e.target.closest(".dup") : null;
      if (dup) {
        e.stopPropagation();
        App.duplicateFrame(Number(dup.dataset.dup));
        return;
      }
      var tile = e.target.closest ? e.target.closest(".add-tile") : null;
      if (tile) {
        App.addFrame(false);
        return;
      }
      var b = e.target.closest ? e.target.closest(".frame") : null;
      if (!b) return;
      State.gotoFrame(Number(b.dataset.i));
      App.invalidate();
    });

    // 桌面端拖拽排序
    el.frameList.addEventListener("dragstart", function (e) {
      var b = e.target.closest ? e.target.closest(".frame") : null;
      if (!b) return;
      dragFrom = Number(b.dataset.i);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", String(dragFrom));
        } catch (err) {
          /* 忽略 */
        }
      }
    });
    el.frameList.addEventListener("dragover", function (e) {
      var b = e.target.closest ? e.target.closest(".frame") : null;
      if (!b) return;
      e.preventDefault();
      if (dragOver && dragOver !== b) dragOver.classList.remove("dragover");
      dragOver = b;
      b.classList.add("dragover");
    });
    el.frameList.addEventListener("dragleave", function () {
      if (dragOver) dragOver.classList.remove("dragover");
      dragOver = null;
    });
    el.frameList.addEventListener("drop", function (e) {
      var b = e.target.closest ? e.target.closest(".frame") : null;
      if (!b || dragFrom < 0) return;
      e.preventDefault();
      if (dragOver) dragOver.classList.remove("dragover");
      dragOver = null;
      var to = Number(b.dataset.i);
      if (to !== dragFrom) App.moveFrameTo(dragFrom, to);
      dragFrom = -1;
    });
    el.frameList.addEventListener("dragend", function () {
      if (dragOver) dragOver.classList.remove("dragover");
      dragOver = null;
      dragFrom = -1;
    });
  }

  function renderFrames() {
    var n = State.frameCount;
    var html = "";
    for (var i = 0; i < n; i++) {
      html +=
        '<button class="frame" data-i="' +
        i +
        '" draggable="true" ' +
        'aria-pressed="' +
        (i === State.current ? "true" : "false") +
        '" ' +
        'aria-label="第 ' +
        (i + 1) +
        ' 帧"><canvas></canvas><span class="idx">' +
        (i + 1) +
        "</span>" +
        (n > 1
          ? '<span class="del" data-del="' +
            i +
            '" title="删除此帧" aria-hidden="true">×</span>'
          : "") +
        '<span class="dup" data-dup="' +
        i +
        '" title="复制此帧" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M5.5 15.5V6.5a1 1 0 0 1 1-1h9"/></svg>' +
        "</span>" +
        "</button>";
    }
    // 末尾新建磁贴
    html +=
      '<button class="add-tile" title="新建空白帧" aria-label="新建空白帧">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
      "<span>新建</span></button>";
    el.frameList.innerHTML = html;
    for (var k = 0; k < n; k++) {
      var cv = el.frameList.children[k].querySelector("canvas");
      if (cv) Render.paintFrame(k, cv);
    }
    el.frameCount.textContent = n + ' 帧';
    scrollFrameIntoView();
  }

  function updateThumb() {
    var node = el.frameList.children[State.current];
    if (!node) return;
    var cv = node.querySelector("canvas");
    if (cv) Render.paintFrame(State.current, cv);
  }

  function highlightFrame() {
    var kids = el.frameList.children;
    for (var i = 0; i < kids.length; i++) {
      if (!kids[i].dataset.i) continue; // 末尾的新建磁贴不是帧
      kids[i].setAttribute(
        "aria-pressed",
        Number(kids[i].dataset.i) === State.current ? "true" : "false",
      );
    }
    scrollFrameIntoView();
    updateHud();
  }

  function scrollFrameIntoView() {
    var node = el.frameList.children[State.current];
    if (node && node.scrollIntoView) {
      try {
        node.scrollIntoView({ block: "nearest", inline: "nearest" });
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  // ------------------------------------------------------------------
  // 动画
  // ------------------------------------------------------------------
  function bindAnim() {
    el.fps.addEventListener("input", function () {
      State.setFps(Number(el.fps.value));
    });
    el.btnPlay.addEventListener("click", function () {
      App.togglePlay();
    });
    el.btnPlay2.addEventListener("click", function () {
      App.togglePlay();
    });
  }

  function renderFps() {
    el.fps.value = String(State.fps);
    el.fpsVal.textContent = State.fps + " fps";
  }

  function renderPlay() {
    var t = State.playing ? "⏸ 暂停" : "▶ 播放";
    if (el.btnPlay) el.btnPlay.textContent = t;
    if (el.btnPlay2) el.btnPlay2.textContent = t;
    el.btnPlay2.classList.toggle("teal", !State.playing);
    el.btnPlay2.classList.toggle("coral", State.playing);
  }

  // ------------------------------------------------------------------
  // 窄屏抽屉
  // ------------------------------------------------------------------
  function bindDrawer() {
    el.btnDrawer.addEventListener("click", function () {
      document.body.classList.toggle("side-open");
    });
    el.drawerVeil.addEventListener("click", function () {
      document.body.classList.remove("side-open");
    });
  }

  // ------------------------------------------------------------------
  // 弹窗
  // ------------------------------------------------------------------
  function open(sheet) {
    if (sheet) sheet.hidden = false;
  }
  function close(sheet) {
    if (sheet) sheet.hidden = true;
  }

  function bindSheets() {
    [
      el.ovSize,
      el.ovImport,
      el.ovExport,
      el.ovResult,
      el.ovHelp,
      el.ovPalette,
    ].forEach(function (ov) {
      if (!ov) return;
      ov.addEventListener("click", function (e) {
        if (e.target === ov) close(ov);
        if (e.target === el.drawerVeil) close(ov);
      });
    });

    // --- 尺寸 ---
    el.sizePresets.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-preset]") : null;
      if (!b) return;
      var v = b.dataset.preset;
      if (v === "0") {
        el.cusW.focus();
        return;
      }
      var parts = v.split("x");
      el.cusW.value = parts[0];
      el.cusH.value = parts[1] || parts[0];
      markPreset();
    });
    [el.cusW, el.cusH].forEach(function (inp) {
      inp.addEventListener("input", markPreset);
    });
    el.btnSizeCancel.addEventListener("click", function () {
      close(el.ovSize);
    });
    el.btnSizeOk.addEventListener("click", function () {
      var w = State.clampSize(parseInt(el.cusW.value, 10));
      var h = State.clampSize(parseInt(el.cusH.value, 10));
      App.resize(w, h, el.keepContent.checked);
      close(el.ovSize);
    });

    // --- 导入 ---
    el.btnPickImage.addEventListener("click", function () {
      el.fileImport.click();
    });
    el.btnPickProject.addEventListener("click", function () {
      el.fileProject.click();
    });
    el.btnImportCancel.addEventListener("click", function () {
      close(el.ovImport);
    });
    el.fileImport.addEventListener("change", onImagePicked);
    el.fileProject.addEventListener("change", onProjectPicked);

    // --- 导出 ---
    el.expFormats.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-fmt]") : null;
      if (!b) return;
      expCfg.format = b.dataset.fmt;
      syncExportSheet();
    });
    el.expScales.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-s]") : null;
      if (!b) return;
      expCfg.scale = Number(b.dataset.s);
      syncExportSheet();
    });
    el.gifLoop.addEventListener("change", function () {
      expCfg.loop = el.gifLoop.checked;
    });
    el.gifTrans.addEventListener("change", function () {
      expCfg.trans = el.gifTrans.checked;
    });
    el.sheetCols.addEventListener("change", function () {
      var v = parseInt(el.sheetCols.value, 10);
      expCfg.cols = Math.max(1, Math.min(16, v || CONFIG.export.sheetCols));
      el.sheetCols.value = expCfg.cols;
    });
    el.btnExportCancel.addEventListener("click", function () {
      close(el.ovExport);
    });
    el.btnExportOk.addEventListener("click", doExport);

    // --- 结果 ---
    el.btnResultClose.addEventListener("click", function () {
      close(el.ovResult);
    });
    el.btnResultSave.addEventListener("click", function () {
      if (!lastResult) return;
      Exporter.download(lastResult.blob, lastResult.name);
      App.toast("已开始保存 " + lastResult.name);
    });

    // --- 手势 ---
    el.btnHelpClose.addEventListener("click", function () {
      close(el.ovHelp);
    });
  }

  function markPreset() {
    var w = parseInt(el.cusW.value, 10);
    var h = parseInt(el.cusH.value, 10);
    var kids = el.sizePresets.children;
    for (var i = 0; i < kids.length; i++) {
      var v = kids[i].dataset.preset;
      if (!v || v === "0") {
        kids[i].setAttribute("aria-pressed", "false");
        continue;
      }
      var parts = v.split("x");
      var pw = Number(parts[0]),
        ph = Number(parts[1] || parts[0]);
      kids[i].setAttribute(
        "aria-pressed",
        pw === w && ph === h ? "true" : "false",
      );
    }
  }

  function openSizeSheet() {
    el.cusW.value = State.w;
    el.cusH.value = State.h;
    markPreset();
    open(el.ovSize);
  }

  function syncExportSheet() {
    var f = expCfg.format;
    // 格式高亮
    Array.prototype.forEach.call(el.expFormats.children, function (b) {
      b.setAttribute("aria-pressed", b.dataset.fmt === f ? "true" : "false");
    });
    Array.prototype.forEach.call(el.expScales.children, function (b) {
      b.setAttribute(
        "aria-pressed",
        Number(b.dataset.s) === expCfg.scale ? "true" : "false",
      );
    });
    el.gifOpts.hidden = f !== "gif";
    el.sheetOptRow.hidden = f !== "sheet";
    var scaleBox = el.expScales.parentNode;
    scaleBox.hidden = f === "json";
    el.btnExportOk.textContent = f === "json" ? "导出工程" : "生成文件";
  }

  // ------------------------------------------------------------------
  // 导入 / 导出
  // ------------------------------------------------------------------
  function onImagePicked() {
    var f = el.fileImport.files && el.fileImport.files[0];
    el.fileImport.value = "";
    if (!f) return;
    close(el.ovImport);
    Exporter.readImage(f)
      .then(function () {
        App.toast(CONFIG.text.imported);
        App.afterChange();
      })
      .catch(function (err) {
        App.toast((err && err.message) || CONFIG.text.importFail);
      });
  }

  function onProjectPicked() {
    var f = el.fileProject.files && el.fileProject.files[0];
    el.fileProject.value = "";
    if (!f) return;
    close(el.ovImport);
    Exporter.readProject(f)
      .then(function () {
        App.toast("工程已恢复");
        App.afterChange(true);
      })
      .catch(function (err) {
        App.toast((err && err.message) || "工程文件读取失败");
      });
  }

  function doExport() {
    var opts = {
      format: expCfg.format,
      scale: expCfg.scale,
      loop: expCfg.loop,
      transparent: expCfg.trans,
      cols: expCfg.cols,
    };
    el.expProgress.hidden = false;
    el.expBar.style.width = "0%";
    el.btnExportOk.disabled = true;

    function cleanup() {
      el.expProgress.hidden = true;
      el.btnExportOk.disabled = false;
    }

    Exporter.run(opts, function (p) {
      el.expBar.style.width =
        Math.max(0, Math.min(100, Math.round(p * 100))) + "%";
    }).then(
      function (res) {
        lastResult = res;
        if (expCfg.format !== "json") showResult(res);
        else Exporter.download(res.blob, res.name);
        close(el.ovExport);
        cleanup();
      },
      function (err) {
        cleanup();
        App.toast((err && err.message) || "导出失败");
      },
    );
  }

  function showResult(res) {
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      resultUrl = null;
    }
    resultUrl = URL.createObjectURL(res.blob);
    el.resultImg.src = resultUrl;
    el.resultImg.alt = res.name;

    var hint;
    if (isIOS()) {
      hint =
        res.kind === "gif"
          ? "点「保存文件」存到「文件」App；也可以长按图片保存（相册里只会显示第一帧）"
          : "点「保存文件」，或长按图片选择「存储到照片」";
    } else {
      hint = "点「保存文件」下载；文件名为 " + res.name;
    }
    el.resultHint.textContent = hint;
    open(el.ovResult);
  }

  // ------------------------------------------------------------------
  // 状态事件 -> 增量刷新
  // ------------------------------------------------------------------
  function bindStateEvents() {
    State.on("tool", renderToolState);
    State.on("brush", renderBrushState);
    State.on("color", renderPalette);
    State.on("palette", renderPalette);
    State.on("flags", renderFlags);
    State.on("fps", renderFps);
    State.on("frames", renderFrames);
    State.on("frame", function () {
      highlightFrame();
      markPreview();
    });
    State.on("pixels", function () {
      updateThumb();
      updateHud();
      markPreview();
    });
    State.on("size", function () {
      updateHud();
      el.sizeLabel.textContent = State.w + "×" + State.h;
      markPreview();
    });
    State.on("history", renderHistory);
    State.on("saving", function () {
      setSave("保存中…", false);
    });
    State.on("saved", function (ok) {
      setSave(ok ? CONFIG.text.saved : CONFIG.text.storageFull, !ok);
    });
  }

  function refreshAll() {
    renderToolState();
    renderBrushState();
    renderPalette();
    renderFlags();
    renderFps();
    renderPlay();
    renderFrames();
    renderHistory();
    el.sizeLabel.textContent = State.w + "×" + State.h;
    updateHud();
  }

  function renderToolState() {
    var cur = State.tool;
    Array.prototype.forEach.call(
      el.toolGrid.querySelectorAll("[data-tool]"),
      function (b) {
        b.setAttribute(
          "aria-pressed",
          b.dataset.tool === cur ? "true" : "false",
        );
      },
    );
  }

  function renderBrushState() {
    var cur = State.brush;
    Array.prototype.forEach.call(
      el.brushGrid.querySelectorAll("[data-brush]"),
      function (b) {
        b.setAttribute(
          "aria-pressed",
          Number(b.dataset.brush) === cur ? "true" : "false",
        );
      },
    );
  }

  function renderFlags() {
    var f = State.data;
    setPressed(el.btnGrid2, f.grid);
    setPressed(el.tgMirrorX, f.mirrorX);
    setPressed(el.tgMirrorY, f.mirrorY);
    setPressed(el.tgShapeFill, f.shapeFill);
    setPressed(el.tgPen, f.penOnly);
    setPressed(el.tgPressure, f.pressureOn);
    setPressed(el.btnOnion2, f.onion);
    updateHud(); // 镜像等状态要同步显示在画布提示上
  }

  function setPressed(node, v) {
    if (node) node.setAttribute("aria-pressed", v ? "true" : "false");
  }

  function renderHistory() {
    var u = el.toolGrid.querySelector("#btnUndo");
    var r = el.toolGrid.querySelector("#btnRedo");
    if (u) u.disabled = !State.canUndo();
    if (r) r.disabled = !State.canRedo();
    // 顶栏快捷按钮同步禁用态
    if (el.btnQuickUndo) el.btnQuickUndo.disabled = !State.canUndo();
    if (el.btnQuickRedo) el.btnQuickRedo.disabled = !State.canRedo();
  }

  function updateHud() {
    var marks = [];
    if (State.mirrorX) marks.push("⇋");
    if (State.mirrorY) marks.push("↕");
    el.zoomTip.innerHTML =
      "<b>" +
      View.zoomLabel() +
      "</b> · " +
      State.w +
      "×" +
      State.h +
      " · 帧 " +
      (State.current + 1) +
      "/" +
      State.frameCount +
      (marks.length ? " · <b>镜像" + marks.join("") + "</b>" : "");
  }

  function setSave(text, warn) {
    el.saveState.textContent = text;
    el.saveState.classList.toggle("warn", !!warn);
  }

  // ------------------------------------------------------------------
  // 预览窗
  // ------------------------------------------------------------------
  function markPreview() {
    previewDirty = true;
  }

  function updatePreview() {
    if (!previewDirty) return;
    previewDirty = false;
    Render.paintFrame(State.current, el.preview);
  }

  function renderPreviewFrame(i) {
    Render.paintFrame(i, el.preview);
  }

  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove("on");
    }, 2200);
  }

  return {
    init: init,
    toast: toast,
    updatePreview: updatePreview,
    renderPreviewFrame: renderPreviewFrame,
    markPreview: markPreview,
    refreshAll: refreshAll,
    updateHud: updateHud,
    renderFrames: renderFrames,
    renderPlay: renderPlay,
    closeSheet: close,
    tag: "pixel-studio",
  };
})();
