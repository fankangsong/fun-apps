// =====================================================================
// config.js — 跳一跳：全局可调参数
//
// 坐标系（与 p5 WEBGL 一致）：Y 轴向上，XZ 为地面平面。
//   - 平台顶面统一在 y = 0，平台沿 Y 向下延伸 platform.height（中心 y = -height/2）
//   - 棋子用「底面中心」表示：pos = {x, y, z}，站立时 y = 0
//
// 玩法：按住蓄力 -> 解析抛物线飞出 -> 落地判定 -> 移交 Matter 模拟站稳/倾倒。
// =====================================================================

const CONFIG = {
  // --- 蓄力 ---
  charge: {
    maxTime: 1200,        // 蓄力封顶时长（ms），spec §2.1 规定 1.2 秒
    minTime: 60,          // 低于此时长视为误触，不起跳
    squashMax: 0.42,      // 蓄力时棋子 Y 轴最大压缩比例
    stretchMax: 0.30,     // 起跳瞬间最大拉伸比例
    stretchDecay: 260,    // 拉伸恢复时长（ms）
  },

  // --- 跳跃（解析抛物线）---
  jump: {
    gravity: 2600,        // 竖直重力加速度（单位/秒²）
    minDist: 40,          // 最小水平跳距（单位）
    maxDist: 340,         // 满蓄力水平跳距（单位）
    apexRatio: 0.34,      // 竖直初速占比：v0y = v0h * apexRatio（越大跳得越高）
    airSpin: 4.2,         // 空中自旋圈速（弧度/秒），纯视觉
  },

  // --- 平台 ---
  platform: {
    height: 90,           // 平台竖直厚度（沿 Y 向下）
    sizeStart: 130,       // 初始平台边长
    sizeMin: 62,          // 平台边长下限
    sizeShrinkPerScore: 1.6,  // 每得 1 分边长缩小量
    sizeJitter: 16,       // 边长随机微扰幅度
    gapStart: 150,        // 初始间距（中心到中心）
    gapMax: 300,          // 间距上限
    gapGrowPerScore: 2.4, // 每得 1 分间距增长量
    gapJitter: 30,        // 间距随机微扰幅度
    cylinderChance: 0.32, // 生成圆柱（16 边近似）的概率，其余为方盒
    keepBehind: 2,        // 环形窗口：当前方块之前保留数量
    keepAhead: 2,         // 当前方块之后保留数量
  },

  // --- 得分 ---
  scoring: {
    normal: 1,            // 普通落点 +1
    comboBase: 2,         // 首次中心落点 +2，之后 +4 / +6 …
    centerRatio: 0.22,    // 中心判定半径 = 平台边长 * 此比例
    centerRatioMin: 0.16, // 小平台时的判定比例下限（防过于苛刻）
  },

  // --- 彩蛋方块 ---
  egg: {
    chance: 0.125,        // 出现概率约 1/8（spec §2.4）
    forbidRepeat: 1,      // 连续出现的间隔：至少隔 N 个普通方块
    stayTime: 1000,       // 停留触发时长（ms），可调（spec §2.3）
    types: {
      record:  { key: 'record',  score: 5,  label: '唱片机 +5'  },
      cube:    { key: 'cube',    score: 15, label: '魔方 +15'   },
      box:     { key: 'box',     score: 30, label: '音乐盒 +30' },
    },
    weights: [0.5, 0.32, 0.18],  // 对应上面三种的出现权重
  },

  // --- 相机（正交投影）---
  camera: {
    pitch: 45,            // 俯仰角（度）
    yaw: -45,             // 方位角（度）
    distance: 900,        // 相机到注视点的距离（正交下只影响裁剪面）
    viewSize: 620,        // 正交视口半高（世界单位），随窗口宽高比换算
    lerp: 0.09,           // 注视点跟随缓动系数（每帧 lerp 比例）
    lookAhead: 0.32,      // 注视点向「下一个方块」方向的偏移比例
  },

  // --- 棋子 ---
  piece: {
    bodyH: 46,            // 圆柱身高
    bodyR: 17,            // 圆柱半径
    headR: 13,            // 球头半径
    settleFrames: 12,     // settling 阶段判定「站稳」所需的连续达标帧数
  },

  // --- 物理（Matter，仅落地后使用）---
  physics: {
    gravityY: 1,          // Matter 重力（仅在 settling 阶段对棋子生效）
    gravityScale: 0.0022,
    friction: 0.82,       // 较大摩擦：边缘不易滑落，中心易站稳
    frictionStatic: 1.4,
    restitution: 0.02,    // 几乎不弹
    // 倾倒判负阈值（弧度）。必须显著大于「连击判定区边缘」对应的倾角：
    // 判定区半径 = size * scoring.centerRatio，归一化后对应
    // tilt = (centerRatio / 0.5) * (π/2) = 0.44 * 1.5708 ≈ 0.691 rad，
    // 与平台尺寸无关。取 1.02 rad(≈58°) 让整个连击区 + 一定安全余量都可存活，
    // 同时保证贴近平台边缘（norm 接近 1 -> 90°）仍会倾倒。
    tiltThreshold: 1.02,
    fallDepth: 520,       // 棋子中心低于此高度视为坠落出局
    velocityEpsilon: 0.36,// 「静止」速度阈值
    fixedDelta: 1000 / 60,
    maxStepsPerFrame: 5,
  },

  // --- 帧时间 ---
  time: {
    maxDelta: 50,         // dt 钳制上限（ms），spec §4.3
  },

  // --- 音效 ---
  audio: {
    enabled: true,
    masterGain: 0.22,
    comboBaseFreq: 523.25,   // C5，连击音阶起点
    comboStepRatio: 1.12246, // 半音 * 2（每级升 2 个半音）
    maxComboSteps: 12,
  },

  debug: {
    showFPS: false,
  },
};

// --- Memphis 配色（禁止在业务代码中硬编码颜色）---
const PALETTE = {
  paper:   '#f6f1e7',
  card:    '#fffdf6',
  ink:     '#161616',
  inkSoft: '#6d675c',
  coral:   '#ff6b6b',
  teal:    '#2ec4b6',
  sun:     '#ffd23f',
  blue:    '#3a86ff',
  pink:    '#ff8fab',
};

// 点睛色循环表（方块按索引 i % 5 取色，docs/DESIGN.md §2）
const BLOCK_COLORS = [PALETTE.coral, PALETTE.teal, PALETTE.sun, PALETTE.blue, PALETTE.pink];
