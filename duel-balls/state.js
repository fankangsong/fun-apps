// =====================================================================
// state.js — 双人对撞球：状态机 + 全局可变状态
//
// 流程：
//   MENU（选难度） -> SERVE（球吸附在发球方板上） -> RALLY（往返对打）
//   -> SCORED（有人漏球，短暂结算）-> SERVE / GAMEOVER
// =====================================================================

const GAME_STATE = {
  MENU:     'menu',      // 难度选择
  SERVE:    'serve',     // 待发球：球吸附在发球方板面上
  RALLY:    'rally',     // 对打中
  SCORED:   'scored',    // 本回合结束，短暂展示得分
  GAMEOVER: 'gameover',  // 有人达到胜利分数
  PAUSED:   'paused',
};

// 玩家编号约定：1 = 下方（绿），2 = 上方（红）
const PLAYER = { P1: 1, P2: 2 };

const state = {
  phase: GAME_STATE.MENU,

  // 难度（CONFIG.difficulties 的索引）
  difficultyIndex: CONFIG.defaultDifficulty,

  // 模式（CONFIG.modes 的索引）
  modeIndex: CONFIG.defaultMode,

  // 比分
  scoreP1: 0,
  scoreP2: 0,

  // 发球方 / 上一回合失分方
  server: PLAYER.P1,
  lastScorer: 0,
  winner: 0,

  // 本回合数据
  rallyHits: 0,          // 本回合成功回击次数（用于加速与展示）
  ballSpeed: 0,          // 当前球速（每次回击递增）

  // 计时器（帧）
  serveTimer: 0,

  // 派生布局（在 main.js 的 computeLayout() 中计算）
  layout: {
    arenaX: 0, arenaY: 0, arenaW: 0, arenaH: 0,
    paddleW: 0,      // 板长（随难度变化）
    wallInset: 0,    // 左右墙可视厚度
  },

  // 视觉反馈
  flash: { p1: 0, p2: 0, wall: 0 },
  trail: [],             // 球的拖尾坐标

  flags: {},
  payload: {},
};

function setState(phase) {
  state.phase = phase;
}

// 当前难度配置
function currentDifficulty() {
  return CONFIG.difficulties[state.difficultyIndex];
}

// 当前模式
function currentMode() {
  return CONFIG.modes[state.modeIndex];
}
