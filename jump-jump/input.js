// =====================================================================
// input.js — 跳一跳：Pointer Events（鼠标 + 触摸统一）+ 音频解锁
//
// 单指游戏：只认第一根按下的 pointerId，其余忽略。
// pointercancel（来电 / 系统手势打断）时取消蓄力、棋子恢复站立，绝不起跳。
// up / cancel 对称清理（spec §4.2、AGENTS.md 触摸输入方案）。
// =====================================================================

const Input = (function () {
  let canvasEl = null;
  let activeId = null;          // 当前唯一生效的 pointerId

  const handlers = {
    onPressStart: null,   // ()
    onPressEnd: null,     // (nowMs)
    onPressCancel: null,  // ()
  };

  function bind(el) {
    canvasEl = el;
    canvasEl.style.touchAction = 'none';

    canvasEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // 单指锁：已有活跃指针时忽略后续手指（spec §4.2）
      if (activeId !== null) return;
      activeId = e.pointerId;
      if (canvasEl.setPointerCapture) {
        try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
      }
      Audio.unlock();                       // 首次手势解锁音频
      if (handlers.onPressStart) handlers.onPressStart();
    });

    // pointercancel：手势被系统打断 -> 取消蓄力，绝不起跳
    canvasEl.addEventListener('pointercancel', (e) => {
      if (activeId !== e.pointerId) return;
      activeId = null;
      if (handlers.onPressCancel) handlers.onPressCancel();
    });

    canvasEl.addEventListener('pointerup', (e) => {
      if (activeId !== e.pointerId) return;
      activeId = null;
      if (handlers.onPressEnd) handlers.onPressEnd(performance.now());
    });

    // 兜底：失焦时也要取消，避免「按住切走再回来自动起跳」
    window.addEventListener('blur', () => {
      if (activeId === null) return;
      activeId = null;
      if (handlers.onPressCancel) handlers.onPressCancel();
    });

    // iOS 老版本兜底：overscroll-behavior 需 Safari 16+（AGENTS.md）
    canvasEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  function setHandlers(obj) { Object.assign(handlers, obj); }

  function clear() {
    activeId = null;
  }

  function isPressing() { return activeId !== null; }

  return { bind, setHandlers, clear, isPressing };
})();

// =====================================================================
// Audio — WebAudio 现场合成（不引音频文件，spec §2.6）
// AudioContext 必须在用户手势回调中创建 / resume()（iOS 自动播放限制）。
// 创建或 resume 失败时静默降级：所有方法变为 no-op，游戏无音效仍可玩。
// =====================================================================

const Audio = (function () {
  let ctx = null;
  let master = null;
  let ok = false;
  let chargeOsc = null;
  let chargeGain = null;

  // 在首次 pointerdown / click 回调中调用
  function unlock() {
    if (ok) {
      if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;                       // 不支持 WebAudio：静默降级
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = CONFIG.audio.masterGain;
      master.connect(ctx.destination);
      if (ctx.state === 'suspended') ctx.resume();
      ok = true;
    } catch (e) {
      ok = false;                            // 创建失败：静默降级
    }
  }

  function enabled() { return ok && CONFIG.audio.enabled; }

  // 单个音符
  function tone(freq, durMs, type, gainVal, delayMs) {
    if (!enabled()) return;
    try {
      const t0 = ctx.currentTime + (delayMs || 0) / 1000;
      const dur = durMs / 1000;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gainVal == null ? 0.6 : gainVal, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* 静默降级 */ }
  }

  // 蓄力：持续上升音（按下时起，松手 / 取消时停）
  function chargeStart() {
    if (!enabled() || chargeOsc) return;
    try {
      chargeOsc = ctx.createOscillator();
      chargeGain = ctx.createGain();
      chargeOsc.type = 'triangle';
      chargeOsc.frequency.setValueAtTime(220, ctx.currentTime);
      chargeGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      chargeGain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.08);
      chargeOsc.connect(chargeGain); chargeGain.connect(master);
      chargeOsc.start();
    } catch (e) { chargeOsc = null; }
  }

  // ratio 0~1：音高随蓄力上升
  function chargeUpdate(ratio) {
    if (!enabled() || !chargeOsc) return;
    try {
      chargeOsc.frequency.setTargetAtTime(220 + ratio * 480, ctx.currentTime, 0.05);
    } catch (e) {}
  }

  function chargeStop() {
    if (!chargeOsc) return;
    try {
      chargeGain.gain.cancelScheduledValues(ctx.currentTime);
      chargeGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02);
      chargeOsc.stop(ctx.currentTime + 0.1);
    } catch (e) {}
    chargeOsc = null;
    chargeGain = null;
  }

  // 起跳「啵」
  function jump() {
    if (!enabled()) return;
    tone(320, 110, 'square', 0.35);
    tone(640, 90, 'sine', 0.25, 20);
  }

  // 落地
  function land() { tone(180, 130, 'sine', 0.4); }

  // 连击音阶递升（第 n 次中心落点）
  function combo(n) {
    if (!enabled()) return;
    const step = Math.min(n - 1, CONFIG.audio.maxComboSteps);
    const f = CONFIG.audio.comboBaseFreq * Math.pow(CONFIG.audio.comboStepRatio, step);
    tone(f, 160, 'triangle', 0.5);
    tone(f * 2, 120, 'sine', 0.22, 40);
  }

  // 彩蛋旋律（record=短旋律 / cube=提示音 / box=完整旋律）
  function egg(type) {
    if (!enabled()) return;
    if (type === 'record') {
      [523.25, 659.25, 783.99].forEach((f, i) => tone(f, 150, 'sine', 0.4, i * 110));
    } else if (type === 'cube') {
      [659.25, 880].forEach((f, i) => tone(f, 140, 'square', 0.32, i * 100));
    } else {
      [523.25, 587.33, 659.25, 783.99, 880, 1046.5].forEach((f, i) => tone(f, 170, 'triangle', 0.42, i * 130));
    }
  }

  // 失败
  function fail() {
    if (!enabled()) return;
    tone(300, 160, 'sawtooth', 0.32);
    tone(200, 260, 'sawtooth', 0.28, 130);
  }

  return {
    unlock, chargeStart, chargeUpdate, chargeStop,
    jump, land, combo, egg, fail,
  };
})();
