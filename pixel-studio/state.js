// =====================================================================
// state.js — 像素画板：数据模型 / 历史 / 本机存储
//
// 数据模型：
//   frames: Uint8ClampedArray[]  每帧 RGBA 字节，长度 = w*h*4
//   palette: '#rrggbb'[]         调色板
//   current: number              当前帧下标
//
// 撤销策略（写时复制，快照式）：
//   pushUndo() 先存快照（frames 数组浅拷贝，帧数据共享引用），
//   随后 beginEdit() 把「将要被改的那一帧」整体复制一份替换掉，
//   于是历史快照仍指向旧数据，单次快照成本仅为数组长度，内存极省。
//
// 持久化：
//   每帧按「行程编码(RLE) + base64」压缩（像素画压缩率极高），
//   写入 localStorage；失败（超配额 / 隐私模式）则降级为内存模式。
// =====================================================================

const State = (function () {
  'use strict';

  var S = {
    // --- 画布与动画 ---
    w: CONFIG.defaultW,
    h: CONFIG.defaultH,
    fps: CONFIG.defaultFps,
    frames: [],
    current: 0,

    // --- 颜色 ---
    palette: CONFIG.palette.slice(),
    recent: [],
    color: CONFIG.palette[0],

    // --- 工具与开关 ---
    tool: 'pencil',
    brush: CONFIG.defaultBrush,
    grid: true,
    onion: false,
    mirrorX: false,
    mirrorY: false,
    shapeFill: false,
    penOnly: false,
    pressureOn: false,
    playing: false,

    // --- 视图（由 view.js 写入，供 UI 展示）---
    scale: 1,

    // --- 运行时 ---
    undoStack: [],
    redoStack: [],
    storageOk: true,
    _listeners: {},
    _saveTimer: 0,
    _pxTimer: 0,
    _changeCount: 0   // 像素实际变化计数：用于丢弃「空笔画」的历史记录
  };

  // ------------------------------------------------------------------
  // 事件
  // ------------------------------------------------------------------
  function on(evt, fn) {
    (S._listeners[evt] || (S._listeners[evt] = [])).push(fn);
  }
  function emit(evt, data) {
    var l = S._listeners[evt];
    if (!l) return;
    for (var i = 0; i < l.length; i++) {
      try { l[i](data); } catch (e) { console.error('[pixel-studio] listener error:', e); }
    }
  }

  // ------------------------------------------------------------------
  // 基础工具
  // ------------------------------------------------------------------
  function newFrame(w, h) {
    return new Uint8ClampedArray(w * h * 4);
  }

  function hexToRgb(hex) {
    var s = String(hex).trim().replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    if (isNaN(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function colorRgba(hex) {
    var c = hexToRgb(hex);
    return [c[0], c[1], c[2], 255];
  }

  // 当前工具要写入的像素值（透明 = 擦除）
  function currentRgba() {
    if (S.tool === 'eraser') return [0, 0, 0, 0];
    return colorRgba(S.color);
  }

  // ------------------------------------------------------------------
  // 工程生命周期
  // ------------------------------------------------------------------
  function createProject(w, h) {
    S.w = clampSize(w);
    S.h = clampSize(h);
    S.frames = [newFrame(S.w, S.h)];
    S.current = 0;
    S.undoStack.length = 0;
    S.redoStack.length = 0;
    emit('size');
    emit('frames');
    emit('frame');
    emit('pixels');
    emit('history', null);
    scheduleSave();
  }

  function clampSize(v) {
    v = Math.round(Number(v) || CONFIG.defaultW);
    return Math.max(CONFIG.minSize, Math.min(CONFIG.maxSize, v));
  }

  // 改尺寸：keep 为真时保留左上角对齐的既有内容
  function resize(w, h, keep) {
    var nw = clampSize(w), nh = clampSize(h);
    var ow = S.w, oh = S.h;
    if (nw === ow && nh === oh) return false;
    pushUndo();
    S.frames = S.frames.map(function (f) {
      var nf = newFrame(nw, nh);
      if (!keep) return nf;
      var cw = Math.min(nw, ow), ch = Math.min(nh, oh);
      for (var y = 0; y < ch; y++) {
        var srcOff = (y * ow) * 4;
        nf.set(f.subarray(srcOff, srcOff + cw * 4), (y * nw) * 4);
      }
      return nf;
    });
    S.w = nw;
    S.h = nh;
    emit('size');
    emit('pixels');
    emit('frames'); // 帧数据对象已更换，缩略图需重建
    scheduleSave();
    return true;
  }

  // ------------------------------------------------------------------
  // 像素读写
  // ------------------------------------------------------------------
  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < S.w && y < S.h;
  }

  function setPixel(x, y, rgba, frameIndex) {
    if (!inBounds(x, y)) return false;
    var fi = frameIndex === undefined ? S.current : frameIndex;
    var f = S.frames[fi];
    if (!f) return false;
    var i = (y * S.w + x) * 4;
    if (f[i] === rgba[0] && f[i + 1] === rgba[1] && f[i + 2] === rgba[2] && f[i + 3] === rgba[3]) return false;
    f[i] = rgba[0]; f[i + 1] = rgba[1]; f[i + 2] = rgba[2]; f[i + 3] = rgba[3];
    S._changeCount++;
    return true;
  }

  function getPixel(x, y, frameIndex) {
    if (!inBounds(x, y)) return null;
    var fi = frameIndex === undefined ? S.current : frameIndex;
    var f = S.frames[fi];
    if (!f) return null;
    var i = (y * S.w + x) * 4;
    return [f[i], f[i + 1], f[i + 2], f[i + 3]];
  }

  function frameData(index) {
    var i = index === undefined ? S.current : index;
    return S.frames[i] || null;
  }

  // 带镜像的落笔（左右 / 上下 / 四象限）
  function setPixelMirrored(x, y, rgba) {
    var hit = setPixel(x, y, rgba);
    if (S.mirrorX) hit = setPixel(S.w - 1 - x, y, rgba) || hit;
    if (S.mirrorY) hit = setPixel(x, S.h - 1 - y, rgba) || hit;
    if (S.mirrorX && S.mirrorY) hit = setPixel(S.w - 1 - x, S.h - 1 - y, rgba) || hit;
    return hit;
  }

  // ------------------------------------------------------------------
  // 历史（写时复制快照）
  // ------------------------------------------------------------------
  function snapshot() {
    return { frames: S.frames.slice(), current: S.current, w: S.w, h: S.h };
  }

  function pushUndo() {
    S.undoStack.push(snapshot());
    if (S.undoStack.length > CONFIG.historyMax) S.undoStack.shift();
    S.redoStack.length = 0;
    emit('history', null);
  }

  // 复制当前帧，之后的修改不影响历史快照
  function beginEdit(index) {
    var i = index === undefined ? S.current : index;
    if (S.frames[i]) S.frames[i] = new Uint8ClampedArray(S.frames[i]);
    return S.frames[i];
  }

  function undo() {
    if (!S.undoStack.length) return false;
    S.redoStack.push(snapshot());
    restore(S.undoStack.pop());
    emit('history', null);
    return true;
  }

  function redo() {
    if (!S.redoStack.length) return false;
    S.undoStack.push(snapshot());
    restore(S.redoStack.pop());
    emit('history', null);
    return true;
  }

  function restore(snap) {
    var sizeChanged = (snap.w !== S.w || snap.h !== S.h);
    S.frames = snap.frames.slice();
    S.current = Math.min(snap.current, S.frames.length - 1);
    S.w = snap.w;
    S.h = snap.h;
    if (sizeChanged) emit('size');
    emit('frames');
    emit('frame');
    emit('pixels');
    scheduleSave();
  }

  function canUndo() { return S.undoStack.length > 0; }
  function canRedo() { return S.redoStack.length > 0; }

  // 丢弃最后一条历史（笔画结束时发现没有任何像素变化）
  function dropLastUndo() {
    if (S.undoStack.length) {
      S.undoStack.pop();
      emit('history', null);
    }
  }

  // 中断当前笔画：回到该笔画开始前的状态，且不污染重做栈
  function revertStroke() {
    if (!S.undoStack.length) return false;
    restore(S.undoStack.pop());
    emit('history', null);
    return true;
  }

  function bumpChange() { S._changeCount++; }
  function changeCount() { return S._changeCount; }

  // ------------------------------------------------------------------
  // 帧操作
  // ------------------------------------------------------------------
  function addFrame(copyCurrent) {
    if (S.frames.length >= CONFIG.maxFrames) return -1;
    pushUndo();
    var f = newFrame(S.w, S.h);
    if (copyCurrent) f.set(S.frames[S.current]);
    S.frames.splice(S.current + 1, 0, f);
    S.current += 1;
    emit('frames');
    emit('frame');
    emit('pixels');
    scheduleSave();
    return S.current;
  }

  function deleteFrame(index) {
    if (S.frames.length <= 1) return false;
    var i = index === undefined ? S.current : index;
    pushUndo();
    S.frames.splice(i, 1);
    if (S.current >= S.frames.length) S.current = S.frames.length - 1;
    emit('frames');
    emit('frame');
    emit('pixels');
    scheduleSave();
    return true;
  }

  function moveFrame(from, to) {
    if (from === to || from < 0 || to < 0 || from >= S.frames.length || to >= S.frames.length) return false;
    pushUndo();
    var cur = S.frames[S.current];
    var f = S.frames.splice(from, 1)[0];
    S.frames.splice(to, 0, f);
    S.current = S.frames.indexOf(cur);
    emit('frames');
    emit('frame');
    scheduleSave();
    return true;
  }

  function gotoFrame(i) {
    i = Math.max(0, Math.min(S.frames.length - 1, i));
    if (i === S.current) return false;
    S.current = i;
    emit('frame');
    emit('pixels');
    return true;
  }

  function clearFrame() {
    pushUndo();
    beginEdit();
    S.frames[S.current].fill(0);
    S._changeCount++;
    emit('pixels');
    scheduleSave();
  }

  // ------------------------------------------------------------------
  // 颜色 / 开关
  // ------------------------------------------------------------------
  function setColor(hex) {
    S.color = hex;
    if (S.tool === 'eraser') S.tool = 'pencil';
    // 只记录调色板之外的颜色，避免「最近使用」与主色板重复占位
    if (S.palette.indexOf(hex) < 0) pushRecent(hex);
    emit('color');
    emit('tool');
    scheduleSave();
  }

  function pushRecent(hex) {
    var i = S.recent.indexOf(hex);
    if (i >= 0) S.recent.splice(i, 1);
    S.recent.unshift(hex);
    if (S.recent.length > CONFIG.recentMax) S.recent.pop();
    emit('palette');
  }

  function addPaletteColor(hex) {
    if (S.palette.indexOf(hex) >= 0) return false;
    S.palette.push(hex);
    emit('palette');
    scheduleSave();
    return true;
  }

  function removePaletteColor(hex) {
    var i = S.palette.indexOf(hex);
    if (i < 0 || S.palette.length <= 1) return false;
    if (CONFIG.palette.indexOf(hex) >= 0) return false;   // 内置色不参与移除
    S.palette.splice(i, 1);
    emit('palette');
    scheduleSave();
    return true;
  }

  function setTool(id) {
    if (S.tool === id) return;
    S.tool = id;
    emit('tool');
    scheduleSave();
  }

  function setBrush(n) {
    var max = CONFIG.brushSizes[CONFIG.brushSizes.length - 1] || 12;
    n = Math.max(1, Math.min(max, Math.round(n) || 1));
    S.brush = n;
    emit('brush');
    scheduleSave();
  }

  function setFlag(name, value) {
    if (!(name in S)) return;
    S[name] = value;
    emit('flags');
    scheduleSave();
  }

  function toggleFlag(name) {
    setFlag(name, !S[name]);
    return S[name];
  }

  function setFps(v) {
    S.fps = Math.max(CONFIG.fpsMin, Math.min(CONFIG.fpsMax, Math.round(v) || CONFIG.defaultFps));
    emit('fps');
    scheduleSave();
  }

  function toolDef(id) {
    var list = CONFIG.tools, i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  // 当前帧像素有两类通知：立即（结构性变化）与节流（连续绘制）
  function markPixels(immediate) {
    if (immediate) {
      if (S._pxTimer) { clearTimeout(S._pxTimer); S._pxTimer = 0; }
      emit('pixels');
      return;
    }
    if (S._pxTimer) return;
    S._pxTimer = setTimeout(function () {
      S._pxTimer = 0;
      emit('pixels');
    }, 90);
  }

  // ------------------------------------------------------------------
  // 序列化：RLE + base64
  // ------------------------------------------------------------------
  function b64Encode(bytes) {
    var s = '', CH = 0x8000, i;
    for (i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }

  function b64Decode(str) {
    var bin = atob(str), bytes = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  var encCache = new WeakMap();

  function encodeFrame(f) {
    var cached = encCache.get(f);
    if (cached) return cached;
    var n = f.length >> 2;
    var dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
    var vals = [], runs = [];
    var i = 0;
    while (i < n) {
      var v = dv.getUint32(i << 2, true);
      var r = 1;
      while (i + r < n && r < 65536 && dv.getUint32((i + r) << 2, true) === v) r++;
      vals.push(v);
      runs.push(r - 1);
      i += r;
    }
    var bytes = new Uint8Array(vals.length * 6);
    var bdv = new DataView(bytes.buffer);
    for (i = 0; i < vals.length; i++) {
      bdv.setUint32(i * 6, vals[i], true);
      bdv.setUint16(i * 6 + 4, runs[i], true);
    }
    var out = b64Encode(bytes);
    encCache.set(f, out);
    return out;
  }

  function decodeFrame(str, w, h) {
    var bytes = b64Decode(str);
    var n = w * h;
    var out = new Uint8ClampedArray(n * 4);
    var bdv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var odv = new DataView(out.buffer);
    var p = 0, i;
    for (i = 0; i + 6 <= bytes.length; i += 6) {
      var v = bdv.getUint32(i, true);
      var run = bdv.getUint16(i + 4, true) + 1;
      for (var k = 0; k < run && p < n; k++, p++) odv.setUint32(p << 2, v, true);
    }
    return out;
  }

  function serialize() {
    return {
      v: 1,
      app: 'pixel-studio',
      w: S.w,
      h: S.h,
      fps: S.fps,
      current: S.current,
      palette: S.palette.slice(),
      recent: S.recent.slice(),
      tool: S.tool,
      brush: S.brush,
      grid: S.grid,
      onion: S.onion,
      mirrorX: S.mirrorX,
      mirrorY: S.mirrorY,
      shapeFill: S.shapeFill,
      penOnly: S.penOnly,
      pressureOn: S.pressureOn,
      frames: S.frames.map(encodeFrame)
    };
  }

  function applyData(o) {
    if (!o || o.v !== 1 || !o.frames || !o.frames.length) return false;
    var w = clampSize(o.w), h = clampSize(o.h);
    var frames;
    try {
      frames = o.frames.map(function (s) { return decodeFrame(s, w, h); });
    } catch (e) {
      console.error('[pixel-studio] 数据解析失败', e);
      return false;
    }
    S.w = w; S.h = h;
    S.frames = frames;
    S.current = Math.max(0, Math.min(frames.length - 1, o.current | 0));
    if (o.palette && o.palette.length) S.palette = o.palette.slice();
    S.recent = (o.recent || []).slice();
    S.fps = Math.max(CONFIG.fpsMin, Math.min(CONFIG.fpsMax, o.fps || CONFIG.defaultFps));
    if (o.tool) S.tool = o.tool;
    if (o.brush) S.brush = o.brush;
    S.grid = o.grid !== false;
    S.onion = !!o.onion;
    S.mirrorX = !!o.mirrorX;
    S.mirrorY = !!o.mirrorY;
    S.shapeFill = !!o.shapeFill;
    S.penOnly = !!o.penOnly;
    S.pressureOn = !!o.pressureOn;
    S.undoStack.length = 0;
    S.redoStack.length = 0;
    emit('size');
    emit('frames');
    emit('frame');
    emit('pixels');
    emit('tool');
    emit('brush');
    emit('color');
    emit('palette');
    emit('flags');
    emit('fps');
    emit('history', null);
    return true;
  }

  // ------------------------------------------------------------------
  // 本机存储（localStorage，失败降级内存模式）
  // ------------------------------------------------------------------
  function scheduleSave() {
    if (S._saveTimer) clearTimeout(S._saveTimer);
    S._saveTimer = setTimeout(function () {
      S._saveTimer = 0;
      saveNow();
    }, CONFIG.storage.debounce);
  }

  function saveNow() {
    emit('saving', null);
    try {
      localStorage.setItem(CONFIG.storage.key, JSON.stringify(serialize()));
      S.storageOk = true;
      emit('saved', true);
    } catch (e) {
      S.storageOk = false;
      emit('saved', false);
    }
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(CONFIG.storage.key); } catch (e) { raw = null; }
    if (!raw) return false;
    try {
      return applyData(JSON.parse(raw));
    } catch (e) {
      console.error('[pixel-studio] 本机存档损坏，已忽略', e);
      return false;
    }
  }

  function clearStorage() {
    try { localStorage.removeItem(CONFIG.storage.key); } catch (e) { /* 忽略 */ }
  }

  // ------------------------------------------------------------------
  // 对外 API
  // ------------------------------------------------------------------
  return {
    // 状态（读取用 getter；结构性修改请走下方方法）
    get data() { return S; },
    get flags() { return S; },
    get w() { return S.w; },
    get h() { return S.h; },
    get fps() { return S.fps; },
    get current() { return S.current; },
    get frameCount() { return S.frames.length; },
    get color() { return S.color; },
    get tool() { return S.tool; },
    get brush() { return S.brush; },
    get palette() { return S.palette; },
    get recent() { return S.recent; },
    // 开关：外部（输入层 / 渲染层 / UI）可直接读写，避免「只读 getter 静默丢值」
    get grid() { return S.grid; },
    set grid(v) { S.grid = !!v; },
    get onion() { return S.onion; },
    set onion(v) { S.onion = !!v; },
    get mirrorX() { return S.mirrorX; },
    set mirrorX(v) { S.mirrorX = !!v; },
    get mirrorY() { return S.mirrorY; },
    set mirrorY(v) { S.mirrorY = !!v; },
    get shapeFill() { return S.shapeFill; },
    set shapeFill(v) { S.shapeFill = !!v; },
    get penOnly() { return S.penOnly; },
    set penOnly(v) { S.penOnly = !!v; },
    get pressureOn() { return S.pressureOn; },
    set pressureOn(v) { S.pressureOn = !!v; },
    get scale() { return S.scale; },
    set scale(v) { S.scale = v; },
    get playing() { return S.playing; },
    set playing(v) { S.playing = !!v; },

    on: on,
    emit: emit,

    // 基础
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    colorRgba: colorRgba,
    currentRgba: currentRgba,

    // 工程
    createProject: createProject,
    resize: resize,
    clampSize: clampSize,

    // 像素
    inBounds: inBounds,
    setPixel: setPixel,
    getPixel: getPixel,
    setPixelMirrored: setPixelMirrored,
    frameData: frameData,
    markPixels: markPixels,

    // 历史
    pushUndo: pushUndo,
    beginEdit: beginEdit,
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    dropLastUndo: dropLastUndo,
    revertStroke: revertStroke,
    bumpChange: bumpChange,
    changeCount: changeCount,

    // 帧
    addFrame: addFrame,
    deleteFrame: deleteFrame,
    moveFrame: moveFrame,
    gotoFrame: gotoFrame,
    clearFrame: clearFrame,

    // 颜色 / 工具 / 开关
    setColor: setColor,
    pushRecent: pushRecent,
    addPaletteColor: addPaletteColor,
    removePaletteColor: removePaletteColor,
    setTool: setTool,
    setBrush: setBrush,
    setFlag: setFlag,
    toggleFlag: toggleFlag,
    setFps: setFps,
    toolDef: toolDef,

    // 存取
    serialize: serialize,
    applyData: applyData,
    scheduleSave: scheduleSave,
    saveNow: saveNow,
    load: load,
    clearStorage: clearStorage
  };
})();
