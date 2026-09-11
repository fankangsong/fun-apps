// =====================================================================
// config.js — 像素画板：全局可调参数
//
// 坐标系约定：
//   - 画布像素坐标 (x, y)：左上角为 (0, 0)，x 向右、y 向下，整数
//   - 像素数据：每帧一个 Uint8ClampedArray，长度 = w * h * 4，索引 = (y * w + x) * 4
//   - 屏幕坐标（CSS px）：由 view.js 负责与像素坐标互相换算
//
// 像素取值约定：不透明像素 alpha = 255；透明（橡皮擦除）像素写入 rgba(0,0,0,0)，
// 不做半透明混合，保证像素画硬边与 GIF 导出的干净量化。
// =====================================================================

const CONFIG = {
  // --- 画布尺寸 ---
  minSize: 2,
  maxSize: 256,
  sizePresets: [16, 32, 64, 96, 128],
  defaultW: 32,
  defaultH: 32,

  // --- 动画 ---
  defaultFps: 8,
  fpsMin: 1,
  fpsMax: 24,
  maxFrames: 80,          // 帧数上限（防止内存与导出耗时失控）

  // --- 笔刷 ---
  brushSizes: [1, 2, 3, 4, 6, 8, 12, 16],
  defaultBrush: 1,
  // Apple Pencil 压感：pressure -> 笔刷边长（受当前笔刷大小上限约束）
  penPressure: { min: 0.15, max: 0.85 },

  // --- 历史 ---
  historyMax: 40,

  // --- 视图 ---
  view: {
    minScale: 1,
    maxScale: 40,
    padding: 26,          // 自适应时画布四周留白（CSS px）
    minVisible: 0.16,     // 平移后画布至少保留在视口内的比例
    wheelStep: 1.14,      // 滚轮缩放步进
    pinchGain: 1.0
  },

  // --- 手势判定 ---
  gesture: {
    multiTapMs: 340,      // 多指轻点判定时长
    multiTapDist: 28,     // 多指轻点位移容差（CSS px）
    twoFingerUndo: true,  // 双指轻点 = 撤销
    threeFingerRedo: true // 三指轻点 = 重做
  },

  // --- 持久化 ---
  storage: {
    key: 'pixel-studio/project/v1',
    debounce: 700         // 自动保存防抖（ms）
  },

  // --- 导出 ---
  export: {
    scales: [1, 4, 8, 16],
    defaultScale: 4,
    sheetCols: 4,
    gifMaxColors: 256,    // GIF 调色板上限（2 的幂由编码时补齐）
    gifBatchFrames: 24    // 每批处理的帧数（超过则让出主线程）
  },

  // --- 默认调色板（Memphis 设计令牌）---
  palette: [
    '#161616', '#fffdf6', '#ff6b6b', '#2ec4b6',
    '#ffd23f', '#3a86ff', '#ff8fab', '#6d675c'
  ],
  recentMax: 5,

  // --- 工具表（图标为 24×24 内联 SVG；tc 为选中态底色）---
  tools: [
    {
      id: 'pencil', name: '铅笔', key: 'B', tc: 'var(--sun)',
      svg: '<path d="M5.2 18.8l.9-3.7L16.4 4.8a2 2 0 0 1 2.8 2.8L8.9 18.2z"/><path d="M14.9 6.3l2.8 2.8"/>'
    },
    {
      id: 'eraser', name: '橡皮', key: 'E', tc: 'var(--pink)',
      svg: '<path d="M6.4 20.4l-2.8-2.8a1.8 1.8 0 0 1 0-2.5l7.6-7.6a1.8 1.8 0 0 1 2.5 0l3.8 3.8a1.8 1.8 0 0 1 0 2.5l-6.6 6.6z"/><path d="M9.6 20.4h9.6"/>'
    },
    {
      id: 'bucket', name: '油漆桶', key: 'G', tc: 'var(--teal)',
      svg: '<path d="M7.6 11.4l4.9-4.9 6 6-4.9 4.9a1.7 1.7 0 0 1-2.4 0l-3.6-3.6a1.7 1.7 0 0 1 0-2.4z"/><path d="M19.4 15.4c1 1.7 1 4-.8 4s-1.8-2.3-.8-4z"/>'
    },
    {
      id: 'line', name: '直线', key: 'L', tc: 'var(--blue)',
      svg: '<path d="M5.4 18.6L18.6 5.4"/><circle cx="5.4" cy="18.6" r="1.7"/><circle cx="18.6" cy="5.4" r="1.7"/>'
    },
    {
      id: 'rect', name: '矩形', key: 'R', tc: 'var(--coral)',
      svg: '<rect x="4" y="6.5" width="16" height="11" rx="1.4"/>'
    },
    {
      id: 'ellipse', name: '椭圆', key: 'O', tc: 'var(--sun)',
      svg: '<ellipse cx="12" cy="12" rx="8" ry="6"/>'
    },
    {
      id: 'picker', name: '吸管', key: 'I', tc: 'var(--teal)',
      svg: '<path d="M4.6 19.4l1.1-3.6 7.2-7.2"/><path d="M11.4 10.4l2.2 2.2"/><path d="M12.6 6.4l5 5a2.4 2.4 0 0 1-3.4 3.4l-5-5a2.4 2.4 0 0 1 3.4-3.4z"/>'
    },
    {
      id: 'select', name: '选区', key: 'M', tc: 'var(--pink)',
      svg: '<path d="M4 8.4V4.6h3.8M16.2 4.6H20v3.8M20 15.6v3.8h-3.8M7.8 19.4H4v-3.8" stroke-linecap="round"/><rect x="9.4" y="9.4" width="5.2" height="5.2" stroke-dasharray="2 2.4"/>'
    }
  ],

  // --- 文案 ---
  text: {
    saved: '已保存到本机',
    saving: '保存中…',
    storageFull: '本机存储已满，已切到内存模式',
    needOneFrame: '至少保留一帧',
    maxFrames: '帧数已达上限',
    copied: '已复制当前帧',
    deleted: '已删除该帧',
    resized: '画布尺寸已更新',
    imported: '图片已像素化取样',
    importFail: '图片读取失败，换一张试试',
    pickerTrans: '这里是透明像素',
    brushMax: '笔刷已到最大',
    brushMin: '笔刷已到最小',
    undoEmpty: '没有可撤销的步骤',
    redoEmpty: '没有可重做的步骤',
    gifEmpty: '至少需要一帧才能导出'
  }
};
