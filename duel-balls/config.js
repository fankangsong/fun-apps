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
  backgroundColor: '#f6f1e7',

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
      shipSpeed: 2.6,        // 太空模式：飞船横移速度
    },
    {
      key: 'normal',
      name: '普通',
      desc: '标准板长 · 中速',
      paddleRatio: 0.20,
      ballSpeed: 9.5,
      speedUpPerHit: 0.22,
      maxSpeed: 19,
      shipSpeed: 3.4,        // 太空模式：飞船横移速度
    },
    {
      key: 'hard',
      name: '困难',
      desc: '板子短 · 球速快',
      paddleRatio: 0.13,
      ballSpeed: 12,
      speedUpPerHit: 0.35,
      maxSpeed: 24,
      shipSpeed: 4.3,        // 太空模式：飞船横移速度
    },
  ],
  defaultDifficulty: 1,      // 索引，对应 normal

  // --- 模式：普通 / 太空（太空模式有巡逻飞船改变球路）---
  modes: [
    { key: 'classic', name: '普通模式', desc: '经典对撞 · 无干扰' },
    { key: 'space',   name: '太空模式', desc: '巡逻飞船 · 改变球路' },
  ],
  defaultMode: 0,            // 索引，默认普通模式

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

  // --- 太空模式：巡逻飞船参数 ---
  // 设计文档：docs/superpowers/specs/2026-08-28-duel-balls-space-mode-design.md
  space: {
    laneYRatios: [0.30, 0.42, 0.58, 0.70], // 4 条水平航线（场地高比例）
    maxShips: 2,              // 场上同时最多飞船数
    shipHP: 3,                // 每艘可承受的撞击次数（舷窗数）
    physW: 48, physH: 20,     // 物理矩形（略小于视觉，留宽容度）
    visualScale: 4,           // 像素画每像素边长（13×6 → 52×24）
    spawnDelayMin: 150,       // 生成间隔下限（帧）
    spawnDelayMax: 240,       // 生成间隔上限（帧）
    initialDelay: 75,         // 回合开始到首艘飞船的延迟（帧）
    refillDelay: 60,          // 飞船被摧毁后的补位延迟（帧）
    momentumTransfer: 1.0,    // 飞船横移动量叠加到球 vx 的系数
    despawnMargin: 60,        // 出入场缓冲距离（px）
    hitFlashFrames: 6,        // 受击闪白帧数
    flameFlipFrames: 8,       // 推进器火焰换帧间隔（帧）
  },
};

// --- 颜色系统（禁止在业务代码中硬编码颜色）---
// Memphis 风格：纸色底 + 黑描边 + 高饱和撞色（设计规范 docs/DESIGN.md §2）
const PALETTE = {
  // --- 基础 Tokens ---
  paper:     '#f6f1e7',   // 纸色底
  card:      '#fffdf6',   // 卡片底
  ink:       '#161616',   // 墨黑：描边 / 文字 / 硬阴影
  inkSoft:   '#6d675c',   // 弱化文字
  soft:      '#3c3a33',   // 正文
  coral:     '#ff6b6b',   // 珊瑚红
  teal:      '#2ec4b6',   // 青绿
  sun:       '#ffd23f',   // 明黄
  blue:      '#3a86ff',   // 宝蓝
  pink:      '#ff8fab',   // 粉

  // --- 兼容旧 key（保持业务代码稳定）---
  bg:        '#f6f1e7',
  bgGrid:    '#efe8d8',
  arenaEdge: '#161616',
  text:      '#161616',
  textDim:   '#6d675c',
  accent:    '#3a86ff',
  ok:        '#2ec4b6',
  miss:      '#ff6b6b',
  overlay:   'rgba(246, 241, 231, 0.86)',

  // --- 场地 ---
  arena:     '#faf3e6',   // 可玩区填充
  wall:      '#e9e0cc',   // 左右墙
  midLine:   '#161616',   // 中线（黑）

  // --- 球（明黄 + 黑描边）---
  ball:      '#ffd23f',
  ballGlow:  '#fff1b8',
  trail:     '#ffd23f',

  // --- 玩家：P1(下) 青绿 / P2(上) 珊瑚红，黑描边 ---
  p1:        '#2ec4b6',
  p1Dark:    '#0e6f66',
  p1Glow:    '#9ef1e6',
  p2:        '#ff6b6b',
  p2Dark:    '#a83c3c',
  p2Glow:    '#ffc4c4',
};
