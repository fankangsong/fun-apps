// =====================================================================
// export.js — 像素画板：PNG / 雪碧图 / GIF / 工程文件 导出与图片像素化导入
//
// GIF 编码使用本地 assets/omggif.js（同步、无 Worker，file:// 下可用）：
//   1) 收集全部帧的不透明颜色 -> 生成全局调色板（≤256，长度补齐为 2 的幂）
//      颜色数超限时退化为 3-3-2 位量化（每条通道取平均色），保证 ≤256
//   2) 逐帧把 RGBA 像素映射为调色板索引（带缓存，O(1) 命中）
//   3) GifWriter 写入，delay = round(100 / fps)，透明时 disposal = 2
//   4) 帧数多时分批处理并让出主线程，避免 iPad 卡死
// =====================================================================

const Exporter = (function () {
  'use strict';

  var MAX_PIXELS = 2097152;   // 导出位图总像素上限（约 2048×1024）

  // ------------------------------------------------------------------
  // 通用
  // ------------------------------------------------------------------
  function now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function frameCanvas(idx, scale) {
    var s = Math.max(1, Math.min(16, Math.round(scale || 1)));
    var src = Render.frameCanvas(idx);
    if (s === 1) return src;
    var c = document.createElement('canvas');
    c.width = State.w * s;
    c.height = State.h * s;
    var cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function sheetCanvas(scale, cols) {
    var s = Math.max(1, Math.min(16, Math.round(scale || 1)));
    var n = State.frameCount;
    cols = Math.max(1, Math.min(n, Math.round(cols || 4)));
    var rows = Math.ceil(n / cols);
    var cw = State.w * s, ch = State.h * s;
    var c = document.createElement('canvas');
    c.width = cw * cols;
    c.height = ch * rows;
    var cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    for (var i = 0; i < n; i++) {
      var src = frameCanvas(i, s);
      cx.drawImage(src, (i % cols) * cw, Math.floor(i / cols) * ch);
    }
    return c;
  }

  function toBlob(canvas) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) {
          if (b) resolve(b);
          else reject(new Error('图片生成失败，试试降低放大倍数'));
        }, 'image/png');
        return;
      }
      try { resolve(dataURLtoBlob(canvas.toDataURL('image/png'))); }
      catch (e) { reject(e); }
    });
  }

  function dataURLtoBlob(d) {
    var parts = d.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [null, 'image/png'])[1];
    var bin = atob(parts[1]);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { a.remove(); URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
    }, 6000);
  }

  function stamp() {
    var d = new Date();
    function p(v) { return (v < 10 ? '0' : '') + v; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function baseName() {
    return 'pixel-' + State.w + 'x' + State.h + '-' + stamp();
  }

  function checkSize(w, h) {
    if (w * h > MAX_PIXELS) throw new Error('尺寸过大：请降低放大倍数');
  }

  // ------------------------------------------------------------------
  // PNG / 雪碧图
  // ------------------------------------------------------------------
  function makePng(scale, frameIndex) {
    var idx = frameIndex === undefined ? State.current : frameIndex;
    checkSize(State.w * scale, State.h * scale);
    return toBlob(frameCanvas(idx, scale)).then(function (b) {
      return { blob: b, name: baseName() + '.png', kind: 'png' };
    });
  }

  function makeSheet(scale, cols) {
    var n = State.frameCount;
    var rows = Math.ceil(n / (cols || 4));
    checkSize(State.w * scale * (cols || 4), State.h * scale * rows);
    return toBlob(sheetCanvas(scale, cols)).then(function (b) {
      return { blob: b, name: baseName() + '-sheet.png', kind: 'png' };
    });
  }

  // ------------------------------------------------------------------
  // GIF
  // ------------------------------------------------------------------
  // 收集唯一颜色；超出上限时返回 3-3-2 量化的分桶信息
  function buildPalette(transparent) {
    var n = State.frameCount;
    var limit = CONFIG.export.gifMaxColors - (transparent ? 1 : 0);
    var seen = new Map();      // key -> 顺序下标
    var list = [];             // [r,g,b]
    var i, p, f, a, key, qi;

    for (i = 0; i < n; i++) {
      f = State.frameData(i);
      if (!f) continue;
      for (p = 0; p < f.length; p += 4) {
        if (f[p + 3] < 128) continue;
        key = (f[p] << 16) | (f[p + 1] << 8) | f[p + 2];
        if (!seen.has(key)) {
          if (list.length >= limit) return quantizedPalette(transparent);
          seen.set(key, list.length);
          list.push([f[p], f[p + 1], f[p + 2]]);
        }
      }
    }
    if (!list.length) return null;

    // 组装 omggif 调色板：透明槽固定 0
    var pal = [];
    var map = seen;
    var transIdx = -1;
    if (transparent) {
      pal.push(0x000000);
      transIdx = 0;
    }
    for (i = 0; i < list.length; i++) {
      pal.push((list[i][0] << 16) | (list[i][1] << 8) | list[i][2]);
    }
    var total = pal.length;
    var pow = 2;
    while (pow < total) pow <<= 1;
    if (pow < 2) pow = 2;
    while (pal.length < pow) pal.push(0x000000);

    // key -> 调色板下标（透明占位 0，故整体 +1）
    var offset = transparent ? 1 : 0;
    var keyToIndex = function (k) {
      var v = map.get(k);
      return v === undefined ? -1 : v + offset;
    };
    return { palette: pal, keyToIndex: keyToIndex, transIdx: transIdx, quant: false };
  }

  // 3-3-2 位量化：32 级红 × 32 级绿 × 4 级蓝 的桶平均色
  function quantizedPalette(transparent) {
    var n = State.frameCount;
    var acc = new Float64Array(256 * 3);
    var cnt = new Uint32Array(256);
    var i, p, f, b;
    for (i = 0; i < n; i++) {
      f = State.frameData(i);
      if (!f) continue;
      for (p = 0; p < f.length; p += 4) {
        if (f[p + 3] < 128) continue;
        b = ((f[p] >> 5) << 5) | ((f[p + 1] >> 5) << 2) | (f[p + 2] >> 6);
        acc[b * 3] += f[p];
        acc[b * 3 + 1] += f[p + 1];
        acc[b * 3 + 2] += f[p + 2];
        cnt[b]++;
      }
    }
    var pal = [];
    var transIdx = -1;
    if (transparent) { pal.push(0x000000); transIdx = 0; }
    var slot = new Int16Array(256).fill(-1);
    for (b = 0; b < 256; b++) {
      if (!cnt[b]) continue;
      slot[b] = pal.length;
      pal.push(((acc[b * 3] / cnt[b]) | 0) << 16 |
               ((acc[b * 3 + 1] / cnt[b]) | 0) << 8 |
               ((acc[b * 3 + 2] / cnt[b]) | 0));
    }
    var total = pal.length;
    var pow = 2;
    while (pow < total) pow <<= 1;
    if (pow < 2) pow = 2;
    while (pal.length < pow) pal.push(0x000000);

    return {
      palette: pal,
      transIdx: transIdx,
      quant: true,
      keyToIndex: function (key) {
        var r = (key >> 16) & 255, g = (key >> 8) & 255, bl = key & 255;
        var bb = ((r >> 5) << 5) | ((g >> 5) << 2) | (bl >> 6);
        return slot[bb];
      }
    };
  }

  function buildIndexed(frameIdx, info, scale, ow, oh) {
    var w = State.w, h = State.h;
    var f = State.frameData(frameIdx);
    var src = new Uint8Array(w * h);
    var trans = info.transIdx;
    var cache = new Map();
    var p, key, idx;
    for (p = 0; p < w * h; p++) {
      var i = p * 4;
      if (f[i + 3] < 128) {
        src[p] = trans >= 0 ? trans : 0;
        continue;
      }
      key = (f[i] << 16) | (f[i + 1] << 8) | f[i + 2];
      idx = cache.get(key);
      if (idx === undefined) {
        idx = info.keyToIndex(key);
        if (idx < 0) idx = 0;
        cache.set(key, idx);
      }
      src[p] = idx;
    }
    if (scale === 1) return src;

    // 最近邻整数倍放大
    var out = new Uint8Array(ow * oh);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var v = src[y * w + x];
        var rowBase = (y * scale) * ow + x * scale;
        for (var j = 0; j < scale; j++) {
          var off = rowBase + j * ow;
          out.fill(v, off, off + scale);
        }
      }
    }
    return out;
  }

  function makeGif(opts, onProgress) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      try {
        var n = State.frameCount;
        if (!n) { reject(new Error(CONFIG.text.gifEmpty)); return; }
        if (typeof GifWriter !== 'function') {
          reject(new Error('GIF 编码库未加载（assets/omggif.js）'));
          return;
        }
        var scale = Math.max(1, Math.min(16, Math.round(opts.scale || 1)));
        var ow = State.w * scale, oh = State.h * scale;
        checkSize(ow, oh);
        var transparent = !!opts.transparent;
        var delay = Math.max(2, Math.round(100 / State.fps));
        var info = buildPalette(transparent);
        if (!info) { reject(new Error('画布是空的，先画点什么吧')); return; }

        var indexed = new Array(n);
        var i = 0;

        function step() {
          var t0 = now();
          while (i < n && now() - t0 < 22) {
            indexed[i] = buildIndexed(i, info, scale, ow, oh);
            i++;
            if (onProgress) onProgress((i / n) * 0.72);
          }
          if (i < n) { setTimeout(step, 0); return; }
          finish();
        }

        function finish() {
          try {
            var size = Math.max(65536, ow * oh * n * 2 + 8192);
            var out = null;
            for (var attempt = 0; attempt < 3 && !out; attempt++) {
              var buf = new Uint8Array(size);
              var gw = new GifWriter(buf, ow, oh, {
                loop: opts.loop ? 0 : null,
                palette: info.palette
              });
              for (var k = 0; k < n; k++) {
                gw.addFrame(0, 0, ow, oh, indexed[k], {
                  delay: delay,
                  disposal: transparent ? 2 : 1,
                  transparent: transparent && info.transIdx >= 0 ? info.transIdx : undefined
                });
              }
              var written = gw.end();
              if (written < buf.length - 4) out = buf.slice(0, written);
              else size *= 2;   // 缓冲被写满，翻倍重试
            }
            if (!out) { reject(new Error('GIF 缓冲不足，请减少帧数或尺寸')); return; }
            if (onProgress) onProgress(1);
            resolve({
              blob: new Blob([out], { type: 'image/gif' }),
              name: baseName() + '.gif',
              kind: 'gif',
              frames: n,
              bytes: out.length
            });
          } catch (e) { reject(e); }
        }

        setTimeout(step, 0);
      } catch (e) { reject(e); }
    });
  }

  // ------------------------------------------------------------------
  // 工程文件
  // ------------------------------------------------------------------
  function makeProject() {
    var json = JSON.stringify(State.serialize());
    return Promise.resolve({
      blob: new Blob([json], { type: 'application/json' }),
      name: 'pixel-project-' + stamp() + '.json',
      kind: 'json'
    });
  }

  function readProject(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onerror = function () { reject(new Error('工程文件读取失败')); };
      r.onload = function () {
        try {
          var ok = State.applyData(JSON.parse(r.result));
          if (ok) resolve(true);
          else reject(new Error('这不是本应用的工程文件'));
        } catch (e) { reject(new Error('工程文件解析失败')); }
      };
      r.readAsText(file);
    });
  }

  // ------------------------------------------------------------------
  // 图片像素化导入（cover 居中裁剪 + 平滑缩放采样）
  // ------------------------------------------------------------------
  function readImage(file, opts) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('未选择文件')); return; }
      if (!/^image\//.test(file.type)) { reject(new Error('请选择图片文件')); return; }
      var r = new FileReader();
      r.onerror = function () { reject(new Error(CONFIG.text.importFail)); };
      r.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error(CONFIG.text.importFail)); };
        img.onload = function () {
          try { resolve(sampleImage(img, opts || {})); }
          catch (e) { reject(e); }
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }

  function sampleImage(img, opts) {
    var w = State.w, h = State.h;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in cx) cx.imageSmoothingQuality = 'high';

    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) throw new Error(CONFIG.text.importFail);
    var k = Math.max(w / iw, h / ih);
    var dw = iw * k, dh = ih * k;
    cx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);

    var data = cx.getImageData(0, 0, w, h).data;
    State.pushUndo();
    var f = State.beginEdit();
    var n = w * h;
    for (var p = 0; p < n; p++) {
      var i = p * 4;
      if (data[i + 3] < 128) {
        f[i] = 0; f[i + 1] = 0; f[i + 2] = 0; f[i + 3] = 0;
      } else {
        f[i] = data[i]; f[i + 1] = data[i + 1]; f[i + 2] = data[i + 2]; f[i + 3] = 255;
      }
    }
    State.bumpChange();
    return true;
  }

  // ------------------------------------------------------------------
  // 统一入口
  // ------------------------------------------------------------------
  function run(opts, onProgress) {
    opts = opts || {};
    switch (opts.format) {
      case 'gif':
        return makeGif(opts, onProgress);
      case 'sheet':
        return makeSheet(opts.scale || 1, opts.cols || CONFIG.export.sheetCols);
      case 'json':
        return makeProject();
      case 'png':
      default:
        return makePng(opts.scale || 1, opts.frameIndex);
    }
  }

  return {
    run: run,
    download: download,
    readImage: readImage,
    readProject: readProject,
    makeGif: makeGif,
    frameCanvas: frameCanvas,
    sheetCanvas: sheetCanvas,
    toBlob: toBlob
  };
})();
