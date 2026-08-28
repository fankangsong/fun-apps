// =====================================================================
// state.js — 跳一跳：状态机 + 全局可变状态 + 最高分持久化
//
// 状态流转（spec §3.1）：
//   idle -> aiming -> flying -> settling -> next -> aiming
//                                      \-> egg（彩蛋停留）-> next
//                                      \-> gameover
// =====================================================================

const PHASE = {
  IDLE:     'idle',      // 开始卡展示中，未开局
  AIMING:   'aiming',    // 可蓄力（按住中或待按）
  FLYING:   'flying',    // 解析抛物线飞行中
  SETTLING: 'settling',  // 已落地，交给 Matter 判定站稳 / 倾倒
  EGG:      'egg',       // 停在彩蛋方块上，停留计时中
  NEXT:     'next',      // 镜头平移 + 生成新方块
  GAMEOVER: 'gameover',  // 结算卡
};

const BEST_KEY = 'jj_best_score';

const state = {
  phase: PHASE.IDLE,

  // --- 分数 ---
  score: 0,
  combo: 0,              // 连击次数（0 = 无连击）；第 n 次中心落点得 comboBase * n
  maxCombo: 0,           // 本局最高连击（结算卡展示）
  best: 0,               // 历史最高分（内存镜像，localStorage 失败时退化为纯内存）

  // --- 蓄力 ---
  chargeStart: 0,        // 按下时刻（ms，performance.now()）
  charging: false,       // 是否正在按住
  chargeRatio: 0,        // 蓄力进度 0~1（供渲染层读）

  // --- 平台（环形窗口）---
  // 每项：{ x, z, size, shape:'box'|'cylinder', colorIndex, egg:null|{key,score,label,triggered}, body }
  platforms: [],
  currentIndex: 0,        // platforms 数组中「当前所站方块」的下标
  nextIndex: 1,           // 「下一个方块」的下标（= currentIndex + 1）
  spawnCounter: 0,        // 已生成方块总数，用于配色循环
  sinceEgg: 99,           // 距上次彩蛋已生成的方块数

  // --- 棋子 ---
  // pos 为底面中心；y = 0 表示站在平台顶面
  piece: {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    squash: 0,            // 0~1 压缩量（渲染用，1 = 压到最扁）
    stretch: 0,           // 0~1 拉伸量（渲染用）
    spin: 0,              // 空中自旋角（弧度，纯视觉）
    tilt: 0,              // 当前倾斜角（弧度，settling 阶段由 Matter 写入）
  },

  // --- 跳跃运行时 ---
  flight: {
    dir: 'x',             // 'x' | 'z'
    sign: 1,              // +1 | -1
    fromX: 0, fromZ: 0,
    t: 0,                 // 已飞行时间（秒）
    targetDist: 0,        // 本次目标水平距离
    vh: 0,                // 水平速度
    vy0: 0,               // 竖直初速
    startY: 0,            // 起跳时的 y
  },

  // --- 彩蛋停留 ---
  egg: {
    platform: null,       // 停留中的彩蛋方块对象
    timer: 0,             // 已停留时长（ms）
  },

  // --- 镜头 ---
  cam: {
    lookX: 0, lookZ: 0,   // 当前注视点
    targX: 0, targZ: 0,   // 目标注视点
  },

  // --- Matter 帧末移除队列（spec §4.1：碰撞回调内绝不移除刚体）---
  removeQueue: [],

  // --- 运行时标志 ---
  paused: false,
  shake: 0,              // 落地/失败时的镜头震动强度（渲染用）

  // --- HUD DOM 引用（由 initDom() 填充）---
  dom: {},
};

// ---------------------------------------------------------------------
// 状态切换
// ---------------------------------------------------------------------

function setPhase(p) {
  state.phase = p;
}

// 当前所站的平台对象
function currentPlatform() {
  return state.platforms[state.currentIndex] || null;
}

// 下一个目标平台对象
function nextPlatform() {
  return state.platforms[state.nextIndex] || null;
}

// ---------------------------------------------------------------------
// 得分与连击（spec §2.3）
// ---------------------------------------------------------------------

function addScore(n) {
  state.score += n;
}

// 中心落点：连击第 n 次得 comboBase * n（+2 / +4 / +6 …）
function bumpCombo() {
  state.combo += 1;
  const gain = CONFIG.scoring.comboBase * state.combo;
  addScore(gain);
  if (state.combo > state.maxCombo) state.maxCombo = state.combo;
  return gain;
}

// 未踩中中心 / 落回原平台 / 失败：连击清零
function breakCombo() {
  state.combo = 0;
}

// ---------------------------------------------------------------------
// 最高分持久化（localStorage 读写全部 try/catch，Safari 隐私模式会抛错）
// ---------------------------------------------------------------------

function loadBest() {
  try {
    const v = parseInt(localStorage.getItem(BEST_KEY), 10);
    state.best = (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0;
  } catch (e) {
    state.best = 0;   // 降级：仅存内存
  }
  return state.best;
}

function saveBest(v) {
  state.best = v;
  try {
    localStorage.setItem(BEST_KEY, String(v));
    return true;
  } catch (e) {
    return false;     // 降级：本局有效，刷新后丢失
  }
}

// ---------------------------------------------------------------------
// HUD DOM 引用
// ---------------------------------------------------------------------

function initDom() {
  state.dom = {
    scoreV:   document.getElementById('scoreV'),
    bestV:    document.getElementById('bestV'),
    comboV:   document.getElementById('comboV'),
    ovStart:  document.getElementById('ovStart'),
    ovEnd:    document.getElementById('ovEnd'),
    finalV:   document.getElementById('finalV'),
    newbest:  document.getElementById('newbest'),
    statCombo: document.getElementById('statCombo'),
    statBest:  document.getElementById('statBest'),
    btnStart: document.getElementById('btnStart'),
    btnAgain: document.getElementById('btnAgain'),
  };
  syncHud();
}

// 把分数 / 最佳 / 连击同步到 HUD（幂等，可每帧调用）
function syncHud() {
  const d = state.dom;
  if (!d || !d.scoreV) return;
  d.scoreV.textContent = String(state.score);
  d.bestV.textContent = String(state.best);
  if (state.combo >= 2) {
    d.comboV.textContent = '连击 ×' + state.combo;
    d.comboV.classList.add('on');
  } else {
    d.comboV.classList.remove('on');
  }
}

// ---------------------------------------------------------------------
// 一局重置（保留 best，清空分数与场地）
// ---------------------------------------------------------------------

function resetRun() {
  state.score = 0;
  state.combo = 0;
  state.maxCombo = 0;
  state.chargeStart = 0;
  state.charging = false;
  state.chargeRatio = 0;
  state.platforms.length = 0;
  state.currentIndex = 0;
  state.nextIndex = 1;
  state.spawnCounter = 0;
  state.sinceEgg = 99;
  state.egg.platform = null;
  state.egg.timer = 0;
  state.piece.pos = { x: 0, y: 0, z: 0 };
  state.piece.vel = { x: 0, y: 0, z: 0 };
  state.piece.squash = 0;
  state.piece.stretch = 0;
  state.piece.spin = 0;
  state.piece.tilt = 0;
  state.flight.t = 0;
  state.removeQueue.length = 0;
  state.shake = 0;
  syncHud();
}
