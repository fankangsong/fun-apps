// =====================================================================
// input.js — 统一输入（Pointer Events 兼容鼠标 + 触屏）
//
// 相比模板的扩展：支持「多指并发」。
// 双人对撞球需要两名玩家同时各按住一块板子，因此不能像模板那样
// 用单一 activePointerId 锁死，改为用 Map 追踪每一个活跃指针。
//
// 语义化回调（均带 pointerId，便于业务侧区分是哪根手指/哪个玩家）：
//   onPointerDown(x, y, id)
//   onPointerMove(x, y, id)
//   onPointerUp(x, y, id)
//   onTap(x, y, id)          —— 按下到抬起位移 < 8px 视为点击
// =====================================================================

const Input = (function () {
  let canvasEl = null;

  // pointerId -> { startX, startY, x, y }
  const pointers = new Map();

  const handlers = {
    onPointerDown: null,
    onPointerMove: null,
    onPointerUp:   null,
    onTap:         null,
  };

  function bind(p5Inst) {
    canvasEl = p5Inst.canvas;
    canvasEl.style.touchAction = 'none';

    canvasEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const { x, y } = toCanvasCoords(e);
      pointers.set(e.pointerId, { startX: x, startY: y, x, y });
      // 让该指针后续的 move/up 即使移出画布也能收到
      if (canvasEl.setPointerCapture) {
        try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
      }
      if (handlers.onPointerDown) handlers.onPointerDown(x, y, e.pointerId);
    });

    canvasEl.addEventListener('pointermove', (e) => {
      const rec = pointers.get(e.pointerId);
      if (!rec) return;              // 未按下的悬停移动不处理
      e.preventDefault();
      const { x, y } = toCanvasCoords(e);
      rec.x = x;
      rec.y = y;
      if (handlers.onPointerMove) handlers.onPointerMove(x, y, e.pointerId);
    });

    const end = (e) => {
      const rec = pointers.get(e.pointerId);
      if (!rec) return;
      const { x, y } = toCanvasCoords(e);
      pointers.delete(e.pointerId);

      if (handlers.onPointerUp) handlers.onPointerUp(x, y, e.pointerId);

      const moved = Math.hypot(x - rec.startX, y - rec.startY);
      if (moved < 8 && handlers.onTap) handlers.onTap(x, y, e.pointerId);
    };
    canvasEl.addEventListener('pointerup', end);
    canvasEl.addEventListener('pointercancel', end);
  }

  // 将屏幕坐标换算到画布内部坐标。
  // 注意：setup() 中已 pixelDensity(1)，画布内部像素 == CSS 像素，
  // 因此只用「画布像素宽 / CSS 显示宽」的比例即可，绝不能再除以
  // devicePixelRatio，否则在 Retina/高分屏上坐标会被放大误算，
  // 导致菜单点击命不中（点击"没反应"）。
  function toCanvasCoords(e) {
    const rect = canvasEl.getBoundingClientRect();
    const sx = canvasEl.width / rect.width;
    const sy = canvasEl.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  }

  function setHandlers(obj) {
    Object.assign(handlers, obj);
  }

  // 供业务侧主动查询当前所有按下的指针
  function getPointers() { return pointers; }

  function clear() { pointers.clear(); }

  return { bind, setHandlers, getPointers, clear };
})();
