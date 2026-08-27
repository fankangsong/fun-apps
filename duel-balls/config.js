// =====================================================================
// config.js — 双人对撞球：全局配置（物理参数、颜色、游戏数值）
//
// 玩法：上下分屏双人对战（类 Pong）。
//   - 上方玩家 P2、下方玩家 P1，各控制一块可左右滑动的板子。
//   - 球从发球方板面弹出，飞向对方；对方须用板子接住使其弹回。
//   - 左右两侧是墙，球可斜射打墙反弹，形成角度球。
//   - 未接住（球越过己方底线）则对方得分。
//   - 板子长度由难度决定：越难板子越短、球越快。
//
// 坐标系与 p5.js 一致（左上角为原点，y 轴向下为正）。
// =====================================================================

const CONFIG = {
  // --- 画布 ---
  fitViewport: true,
  fixedW: 1280,
  fixedH: 800,
  backgroundColor: '#0e1116',

  // --- 物理引擎（Matter.js）---
  // Pong 需要球「永不减速」，因此重力与空气阻力全部关闭，
  // 弹性设为 1（完全弹性碰撞），能量不衰减。
  physics: {
    gravityY: 0,
    gravityScale: 0,
    airFriction: 0,          // 无空气阻力：球速恒定
    restitution: 1,          // 完全弹性
    friction: 0,             // 无表面摩擦（切球由代码显式施加）
    frictionStatic: 0,
    positionIterations: 8,
    velocityIterations: 8,
    fixedDelta: 1000 / 60,
  },

  // --- 调参辅助 ---
  debug: {
    showBodies: false,
    showFPS: false,
  },

  // --- 难度分级：板长 / 球速 / 每次回击加速 ---
  // paddleRatio: 板长占场地宽度的比例
  difficulties: [
    {
      key: 'easy',
      name: '简单',
      desc: '板子长 · 球速慢',
      paddleRatio: 0.30,
      ballSpeed: 7.5,
      speedUpPerHit: 0.12,   // 每次成功回击球速递增
      maxSpeed: 15,
    },
    {
      key: 'normal',
      name: '普通',
      desc: '标准板长 · 中速',
      paddleRatio: 0.20,
      ballSpeed: 9.5,
      speedUpPerHit: 0.22,
      maxSpeed: 19,
    },
    {
      key: 'hard',
      name: '困难',
      desc: '板子短 · 球速快',
      paddleRatio: 0.13,
      ballSpeed: 12,
      speedUpPerHit: 0.35,
      maxSpeed: 24,
    },
  ],
  defaultDifficulty: 1,      // 索引，对应 normal

  // --- 游戏数值 ---
  game: {
    ballRadius: 14,
    paddleThickness: 18,     // 板子厚度
    paddleMargin: 54,        // 板子中心到己方底线的距离
    paddleSpeedInfluence: 0.35, // 板子横向移动速度对球的「切球」影响系数
    maxBounceAngle: 60,      // 击球点偏离板心 -> 最大出射角（度）
    minVerticalRatio: 0.35,  // 竖直速度分量下限比例，防止球贴着墙无限横飞
    serveDelay: 45,          // 得分后到下一次发球的帧数
    winScore: 5,             // 先达此分数获胜
    wallThickness: 60,       // 左右墙厚度（防止高速穿透）
  },
};

// --- 颜色系统（禁止在业务代码中硬编码颜色）---
const PALETTE = {
  bg:        '#0e1116',
  bgGrid:    '#1b2330',
  arena:     '#131b25',      // 场地填充
  arenaEdge: '#2c3a4a',      // 场地边界
  wall:      '#3a4a5e',      // 左右墙
  midLine:   '#243244',      // 中线

  ball:      '#ffd54a',
  ballGlow:  '#ffec9e',
  trail:     '#ffd54a',

  p1:        '#4ade80',      // 玩家1（下方，绿）
  p1Dark:    '#0f3d22',
  p1Glow:    '#8ff0b5',
  p2:        '#ff7a7a',      // 玩家2（上方，红）
  p2Dark:    '#4a1717',
  p2Glow:    '#ffb3b3',

  text:      '#c8d4e0',
  textDim:   '#6b7a8c',
  accent:    '#7fd4ff',
  ok:        '#4ade80',
  miss:      '#ef6b6b',
  overlay:   'rgba(10, 14, 20, 0.82)',
};
