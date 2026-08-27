// =====================================================================
// main.js — 双人对撞球（类 Pong 双人对战）
//
// 玩法规则：
//   1. 上下分屏：P1 在下方（绿），P2 在上方（红），各控制一块板子。
//   2. 板子只能左右滑动，长度由难度决定（越难越短）。
//   3. 开局球吸附在发球方板面上，发球方点按/松手即发球。
//   4. 球飞向对方，对方须用板子接住使其弹回，如此往返。
//   5. 左右两侧是墙，球可斜射打墙反弹形成角度球。
//   6. 击球点越偏离板心，出射角越大；快速横移板子可「切球」改变方向。
//   7. 球越过某方底线 = 该方没接住，对方得 1 分。先到 winScore 者获胜。
//
// 操作：
//   - 触屏：下半屏按住拖动控制 P1，上半屏按住拖动控制 P2（支持双指同时）。
//   - 鼠标：在对应半场按住拖动。
//   - 键盘：P1 = A/D 或 ←/→，P2 = J/L。空格发球，R 重开。
//
// 架构约束：物理只在 physics.js 推进；本文件只做游戏逻辑与状态；
//           绘制调用 render.js 提供的只读原语。
// =====================================================================

let p5Ref = null;

// --- 刚体引用 ---
let ball = null;
let paddle1 = null;   // 下方玩家
let paddle2 = null;   // 上方玩家
let wallLeft = null;
let wallRight = null;

// --- 板子控制运行时数据 ---
// targetX: 目标中心 x；prevX: 上一帧 x（用于计算横移速度 -> 切球）
const paddleCtrl = {
  1: { targetX: 0, prevX: 0, vx: 0, pointerId: null, keyDir: 0 },
  2: { targetX: 0, prevX: 0, vx: 0, pointerId: null, keyDir: 0 },
};

const KEY_PADDLE_SPEED = 13;   // 键盘控制时板子每帧移动像素

// =====================================================================
// p5 生命周期
// =====================================================================

function setup() {
  const w = CONFIG.fitViewport ? window.innerWidth : CONFIG.fixedW;
  const h = CONFIG.fitViewport ? window.innerHeight : CONFIG.fixedH;
  createCanvas(w, h);
  pixelDensity(1);              // iPad 高分屏降压，保证 60fps

  p5Ref = this;
  Render.init(this);
  Input.bind(this);
  Physics.init();

  computeLayout();
  setupGame();
  bindInput();
}

function windowResized() {
  if (!CONFIG.fitViewport) return;
  resizeCanvas(window.innerWidth, window.innerHeight);
  computeLayout();
  rebuildBodies();
}

function draw() {
  const dt = deltaTime;

  switch (state.phase) {
    case GAME_STATE.MENU:
      renderGame();
      break;

    case GAME_STATE.SERVE:
      updatePaddles();
      stickBallToServer();
      renderGame();
      break;

    case GAME_STATE.RALLY:
      updatePaddles();
      Physics.step(dt);
      updateGame();
      renderGame();
      break;

    case GAME_STATE.SCORED:
      updatePaddles();
      Physics.step(dt);
      state.serveTimer--;
      if (state.serveTimer <= 0) beginServe();
      renderGame();
      break;

    case GAME_STATE.GAMEOVER:
      renderGame();
      break;
  }

  decayFlash();
}

// =====================================================================
// 布局：场地区域与板长（依赖难度）
// =====================================================================

function computeLayout() {
  const L = state.layout;
  const wall = CONFIG.game.wallThickness;

  // 场地区域：留出左右墙的可视厚度
  L.arenaX = 0;
  L.arenaY = 0;
  L.arenaW = width;
  L.arenaH = height;

  // 板长 = 场地宽 * 难度比例
  L.paddleW = Math.max(60, L.arenaW * currentDifficulty().paddleRatio);
  L.wallInset = Math.min(wall, L.arenaW * 0.06);
}

// 可玩区域（两墙之间）的 x 边界
function playLeft()  { return state.layout.wallInset; }
function playRight() { return width - state.layout.wallInset; }

// =====================================================================
// setupGame — 创建刚体
// =====================================================================

function setupGame() {
  buildBodies();
  registerCollisions();
  // 初始停留在难度选择菜单（state.phase 默认为 MENU），
  // 玩家选定难度后才由 applyDifficulty -> resetMatch 开局。
  state.ballSpeed = currentDifficulty().ballSpeed;
  stickBallToServer();
}

function rebuildBodies() {
  // 尺寸变化时重建（先清空世界再建，避免残留刚体）
  Physics.clear();
  Physics.init();
  buildBodies();
  registerCollisions();
  placePaddlesInitial();
  if (state.phase === GAME_STATE.SERVE) stickBallToServer();
}

function buildBodies() {
  const G = CONFIG.game;
  const L = state.layout;
  const inset = L.wallInset;

  // --- 左右墙（静态，完全弹性）---
  // 放在可玩区外侧，厚度足够防止高速球穿透
  wallLeft = Physics.addStaticBoundary(
    inset - G.wallThickness / 2, height / 2, G.wallThickness, height * 2
  );
  wallLeft.label = 'wall';

  wallRight = Physics.addStaticBoundary(
    width - inset + G.wallThickness / 2, height / 2, G.wallThickness, height * 2
  );
  wallRight.label = 'wall';

  // --- 板子：静态刚体，用 setPosition 手动移动（kinematic 风格）---
  paddle1 = Physics.addStaticBoundary(
    width / 2, height - G.paddleMargin, L.paddleW, G.paddleThickness
  );
  paddle1.label = 'paddle1';

  paddle2 = Physics.addStaticBoundary(
    width / 2, G.paddleMargin, L.paddleW, G.paddleThickness
  );
  paddle2.label = 'paddle2';

  // --- 球 ---
  ball = Physics.addCircle(width / 2, height / 2, G.ballRadius, {
    restitution: 1,
    friction: 0,
    frictionAir: 0,
    frictionStatic: 0,
    inertia: Infinity,     // 禁止旋转，Pong 手感更稳定
  });
  ball.label = 'ball';

  placePaddlesInitial();
}

function placePaddlesInitial() {
  for (const id of [1, 2]) {
    paddleCtrl[id].targetX = width / 2;
    paddleCtrl[id].prevX = width / 2;
    paddleCtrl[id].vx = 0;
  }
  Matter.Body.setPosition(paddle1, { x: width / 2, y: height - CONFIG.game.paddleMargin });
  Matter.Body.setPosition(paddle2, { x: width / 2, y: CONFIG.game.paddleMargin });
}

// =====================================================================
// 碰撞注册
// =====================================================================

function registerCollisions() {
  Physics.onPair('ball', 'paddle1', () => onPaddleHit(1));
  Physics.onPair('ball', 'paddle2', () => onPaddleHit(2));
  Physics.onPair('ball', 'wall', () => { state.flash.wall = 8; });
}

// 击中板子：按「击球点偏移 + 板子横移速度」重算出射方向
function onPaddleHit(playerId) {
  const paddle = playerId === 1 ? paddle1 : paddle2;
  const L = state.layout;
  const G = CONFIG.game;
  const diff = currentDifficulty();

  // 1) 击球点相对板心的归一化偏移 [-1, 1]
  let offset = (ball.position.x - paddle.position.x) / (L.paddleW / 2);
  offset = Math.max(-1, Math.min(1, offset));

  // 2) 板子横移速度带来的「切球」，叠加到偏移上
  const spin = paddleCtrl[playerId].vx * G.paddleSpeedInfluence / 10;
  let dir = offset + spin;
  dir = Math.max(-1.3, Math.min(1.3, dir));

  // 3) 出射角：偏离板心越远角度越大
  const angle = dir * (G.maxBounceAngle * Math.PI / 180);

  // 4) 球速：每次回击递增，直到难度上限
  state.rallyHits++;
  state.ballSpeed = Math.min(
    diff.maxSpeed,
    state.ballSpeed + diff.speedUpPerHit
  );

  // 5) 竖直方向必须朝向对方：P1(下) 击球 -> 向上(-y)；P2(上) -> 向下(+y)
  const towardY = playerId === 1 ? -1 : 1;

  let vx = Math.sin(angle) * state.ballSpeed;
  let vy = Math.cos(angle) * state.ballSpeed * towardY;

  // 6) 保证足够的竖直分量，防止球贴着墙来回横飞卡死回合
  const minVy = state.ballSpeed * G.minVerticalRatio;
  if (Math.abs(vy) < minVy) {
    vy = minVy * towardY;
    const remain = Math.sqrt(Math.max(0, state.ballSpeed ** 2 - vy * vy));
    vx = Math.sign(vx || 1) * remain;
  }

  Matter.Body.setVelocity(ball, { x: vx, y: vy });

  // 7) 把球顶出板面，避免同一帧重复触发碰撞导致「粘板」
  const pushY = playerId === 1
    ? paddle.position.y - G.paddleThickness / 2 - G.ballRadius - 1
    : paddle.position.y + G.paddleThickness / 2 + G.ballRadius + 1;
  Matter.Body.setPosition(ball, { x: ball.position.x, y: pushY });

  state.flash['p' + playerId] = 10;
}

// =====================================================================
// updatePaddles — 板子跟手移动（每帧）
// =====================================================================

function updatePaddles() {
  const L = state.layout;
  const half = L.paddleW / 2;
  const minX = playLeft() + half;
  const maxX = playRight() - half;

  for (const id of [1, 2]) {
    const ctrl = paddleCtrl[id];
    const body = id === 1 ? paddle1 : paddle2;

    // 键盘输入叠加到目标位置
    if (ctrl.keyDir !== 0) {
      ctrl.targetX += ctrl.keyDir * KEY_PADDLE_SPEED;
    }

    // 夹紧在可玩区内
    ctrl.targetX = Math.max(minX, Math.min(maxX, ctrl.targetX));

    // 记录横移速度（供切球使用）
    ctrl.vx = ctrl.targetX - ctrl.prevX;
    ctrl.prevX = ctrl.targetX;

    // 静态刚体手动移动
    Matter.Body.setPosition(body, { x: ctrl.targetX, y: body.position.y });
  }
}

// =====================================================================
// updateGame — 回合判定（球是否越过底线）
// =====================================================================

function updateGame() {
  recordTrail();

  const r = CONFIG.game.ballRadius;

  // 球越过下底线 -> P1 没接住 -> P2 得分
  if (ball.position.y - r > height) {
    scorePoint(PLAYER.P2);
    return;
  }
  // 球越过上底线 -> P2 没接住 -> P1 得分
  if (ball.position.y + r < 0) {
    scorePoint(PLAYER.P1);
    return;
  }

  // 兜底：极端情况下球被挤出左右墙，拉回场内
  const lx = playLeft() + r;
  const rx = playRight() - r;
  if (ball.position.x < lx || ball.position.x > rx) {
    Matter.Body.setPosition(ball, {
      x: Math.max(lx, Math.min(rx, ball.position.x)),
      y: ball.position.y,
    });
  }
}

function recordTrail() {
  state.trail.push({ x: ball.position.x, y: ball.position.y });
  if (state.trail.length > 14) state.trail.shift();
}

function scorePoint(playerId) {
  if (playerId === PLAYER.P1) state.scoreP1++;
  else state.scoreP2++;

  state.lastScorer = playerId;
  state.flash['p' + playerId] = 24;

  // 失分方获得下一球的发球权
  state.server = playerId === PLAYER.P1 ? PLAYER.P2 : PLAYER.P1;

  // 停球
  Matter.Body.setVelocity(ball, { x: 0, y: 0 });
  state.trail.length = 0;

  if (state.scoreP1 >= CONFIG.game.winScore || state.scoreP2 >= CONFIG.game.winScore) {
    state.winner = state.scoreP1 > state.scoreP2 ? PLAYER.P1 : PLAYER.P2;
    setState(GAME_STATE.GAMEOVER);
    return;
  }

  state.serveTimer = CONFIG.game.serveDelay;
  setState(GAME_STATE.SCORED);
}

// =====================================================================
// 发球流程
// =====================================================================

function beginServe() {
  state.rallyHits = 0;
  state.ballSpeed = currentDifficulty().ballSpeed;
  state.trail.length = 0;
  Matter.Body.setVelocity(ball, { x: 0, y: 0 });
  stickBallToServer();
  setState(GAME_STATE.SERVE);
}

// 待发球时球吸附在发球方板面正上/下方，随板移动
function stickBallToServer() {
  const G = CONFIG.game;
  const paddle = state.server === PLAYER.P1 ? paddle1 : paddle2;
  const dy = state.server === PLAYER.P1
    ? -(G.paddleThickness / 2 + G.ballRadius + 2)
    : (G.paddleThickness / 2 + G.ballRadius + 2);

  Matter.Body.setPosition(ball, {
    x: paddle.position.x,
    y: paddle.position.y + dy,
  });
  Matter.Body.setVelocity(ball, { x: 0, y: 0 });
}

// 发球：从板面射出，带一点由板子横移决定的初始角度
function serveBall() {
  if (state.phase !== GAME_STATE.SERVE) return;

  const G = CONFIG.game;
  const towardY = state.server === PLAYER.P1 ? -1 : 1;
  const ctrl = paddleCtrl[state.server];

  // 初始角度受发球时板子横移影响，范围较小
  let dir = Math.max(-1, Math.min(1, ctrl.vx * G.paddleSpeedInfluence / 8));
  const angle = dir * (30 * Math.PI / 180);

  state.ballSpeed = currentDifficulty().ballSpeed;
  Matter.Body.setVelocity(ball, {
    x: Math.sin(angle) * state.ballSpeed,
    y: Math.cos(angle) * state.ballSpeed * towardY,
  });

  setState(GAME_STATE.RALLY);
}

// =====================================================================
// 比赛重置
// =====================================================================

function resetMatch() {
  state.scoreP1 = 0;
  state.scoreP2 = 0;
  state.winner = 0;
  state.lastScorer = 0;
  state.server = PLAYER.P1;
  placePaddlesInitial();
  beginServe();
}

// 切换难度需要重建板子（板长变化）
function applyDifficulty(index) {
  state.difficultyIndex = index;
  computeLayout();
  rebuildBodies();
}

// =====================================================================
// 输入绑定
// =====================================================================

function bindInput() {
  Input.setHandlers({
    onPointerDown: (x, y, id) => {
      if (state.phase === GAME_STATE.MENU) {
        handleMenuClick(x, y);
        return;
      }
      if (state.phase === GAME_STATE.GAMEOVER) {
        resetMatch();
        return;
      }
      // 按下位置决定控制哪一方：下半屏 -> P1，上半屏 -> P2
      const playerId = y > height / 2 ? PLAYER.P1 : PLAYER.P2;
      const ctrl = paddleCtrl[playerId];
      if (ctrl.pointerId !== null) return;   // 该方已被另一根手指占用
      ctrl.pointerId = id;
      ctrl.targetX = x;
    },

    onPointerMove: (x, y, id) => {
      for (const pid of [1, 2]) {
        if (paddleCtrl[pid].pointerId === id) paddleCtrl[pid].targetX = x;
      }
    },

    onPointerUp: (x, y, id) => {
      for (const pid of [1, 2]) {
        if (paddleCtrl[pid].pointerId !== id) continue;
        paddleCtrl[pid].pointerId = null;
        // 发球方松手即发球
        if (state.phase === GAME_STATE.SERVE && pid === state.server) serveBall();
      }
    },

    onTap: (x, y, id) => {
      // 待发球时，发球方在自己半场轻点也可直接发球
      if (state.phase !== GAME_STATE.SERVE) return;
      const playerId = y > height / 2 ? PLAYER.P1 : PLAYER.P2;
      if (playerId === state.server) serveBall();
    },
  });
}

// 难度菜单点击命中检测（按钮布局与 render 中保持一致）
function handleMenuClick(x, y) {
  const btns = menuButtonRects();
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      applyDifficulty(i);
      resetMatch();
      return;
    }
  }
}

function menuButtonRects() {
  const bw = Math.min(260, width * 0.24);
  const bh = 96;
  const gap = 24;
  const total = CONFIG.difficulties.length * bw + (CONFIG.difficulties.length - 1) * gap;
  const startX = (width - total) / 2;
  const y = height / 2 + 10;
  return CONFIG.difficulties.map((d, i) => ({
    x: startX + i * (bw + gap), y, w: bw, h: bh, data: d,
  }));
}

// --- 键盘：P1 = A/D 或 ←/→；P2 = J/L ---
function keyPressed() {
  if (key === 'r' || key === 'R') { resetMatch(); return; }
  if (key === ' ') { serveBall(); return; }
  if (state.phase === GAME_STATE.GAMEOVER) { resetMatch(); return; }

  if (key === 'a' || key === 'A' || keyCode === LEFT_ARROW)  paddleCtrl[1].keyDir = -1;
  if (key === 'd' || key === 'D' || keyCode === RIGHT_ARROW) paddleCtrl[1].keyDir = 1;
  if (key === 'j' || key === 'J') paddleCtrl[2].keyDir = -1;
  if (key === 'l' || key === 'L') paddleCtrl[2].keyDir = 1;
}

function keyReleased() {
  if (key === 'a' || key === 'A' || key === 'd' || key === 'D' ||
      keyCode === LEFT_ARROW || keyCode === RIGHT_ARROW) paddleCtrl[1].keyDir = 0;
  if (key === 'j' || key === 'J' || key === 'l' || key === 'L') paddleCtrl[2].keyDir = 0;
}

// =====================================================================
// renderGame — 绘制（只读，不修改物理/状态）
// =====================================================================

function renderGame() {
  Render.drawBackground();

  if (state.phase === GAME_STATE.MENU) {
    drawMenu();
    if (CONFIG.debug.showFPS) Render.drawAll();
    return;
  }

  drawArena();
  drawTrail();
  drawPaddle(paddle1, PLAYER.P1);
  drawPaddle(paddle2, PLAYER.P2);
  drawBall();
  drawHUD();

  if (state.phase === GAME_STATE.SERVE)  drawServeHint();
  if (state.phase === GAME_STATE.SCORED) drawScoredBanner();
  if (state.phase === GAME_STATE.GAMEOVER) drawGameOver();

  if (CONFIG.debug.showBodies) Render.drawAll();
}

// 场地：左右墙 + 中线 + 双方底线（Memphis 纸色 + 黑描边）
function drawArena() {
  const lw = playLeft();
  const rw = playRight();

  // 可玩区：纸色底
  noStroke();
  fill(PALETTE.arena);
  rect(lw, 0, rw - lw, height);

  // 可玩区外缘黑描边（Memphis 骨架）
  stroke(PALETTE.ink);
  strokeWeight(3);
  noFill();
  rect(lw, 0, rw - lw, height);

  // 左右墙（击中时高亮 + 黑边贴纸感）
  const wallAlpha = state.flash.wall > 0 ? 255 : 150;
  stroke(PALETTE.ink);
  strokeWeight(2.5);
  fill(red(color(PALETTE.wall)), green(color(PALETTE.wall)), blue(color(PALETTE.wall)), wallAlpha);
  rect(0, 0, lw, height);
  rect(rw, 0, width - rw, height);

  // 中线（黑虚线）
  stroke(PALETTE.midLine);
  strokeWeight(3);
  const dash = 22;
  for (let x = lw; x < rw; x += dash * 2) {
    line(x, height / 2, Math.min(x + dash, rw), height / 2);
  }

  // 中心圆（黑描边空心圆）
  noFill();
  stroke(PALETTE.ink);
  strokeWeight(2.5);
  circle(width / 2, height / 2, Math.min(width, height) * 0.22);

  // 双方底线：玩家色粗线 + 黑边
  strokeWeight(5);
  stroke(PALETTE.p1Dark);
  line(lw, height - 3, rw, height - 3);
  stroke(PALETTE.p2Dark);
  line(lw, 3, rw, 3);
  strokeWeight(2.5);
  stroke(PALETTE.ink);
  line(lw, height - 3, rw, height - 3);
  line(lw, 3, rw, 3);
  noStroke();
}

function drawPaddle(body, playerId) {
  const G = CONFIG.game;
  const L = state.layout;
  const isP1 = playerId === PLAYER.P1;
  const base = isP1 ? PALETTE.p1 : PALETTE.p2;
  const glow = isP1 ? PALETTE.p1Glow : PALETTE.p2Glow;
  const flash = state.flash['p' + playerId];

  push();
  translate(body.position.x, body.position.y);

  // 命中辉光（同色柔光）
  if (flash > 0) {
    noStroke();
    const c = color(glow);
    c.setAlpha(flash * 8);
    fill(c);
    rectMode(CENTER);
    rect(0, 0, L.paddleW + 22, G.paddleThickness + 22, 14);
  }

  // 板子：玩家色填充 + 黑描边（Memphis 贴纸）
  stroke(PALETTE.ink);
  strokeWeight(3);
  fill(flash > 0 ? glow : base);
  rectMode(CENTER);
  rect(0, 0, L.paddleW, G.paddleThickness, G.paddleThickness / 2);

  // 板心标记：帮助玩家判断击球点（正中反弹角最小）
  noStroke();
  fill(isP1 ? PALETTE.p1Dark : PALETTE.p2Dark);
  rect(0, 0, 4, G.paddleThickness * 0.5, 2);

  rectMode(CORNER);
  pop();
}

function drawBall() {
  const r = CONFIG.game.ballRadius;
  push();
  // 外发光（纸色柔和光晕）
  noStroke();
  const g = color(PALETTE.ballGlow);
  g.setAlpha(70);
  fill(g);
  circle(ball.position.x, ball.position.y, r * 3.2);
  // 球体：明黄 + 黑描边
  stroke(PALETTE.ink);
  strokeWeight(3);
  fill(PALETTE.ball);
  circle(ball.position.x, ball.position.y, r * 2);
  pop();
}

function drawTrail() {
  if (state.trail.length < 2) return;
  push();
  noStroke();
  for (let i = 0; i < state.trail.length; i++) {
    const t = state.trail[i];
    const k = i / state.trail.length;
    const c = color(PALETTE.trail);
    c.setAlpha(k * 90);
    fill(c);
    circle(t.x, t.y, CONFIG.game.ballRadius * 2 * k * 0.85);
  }
  pop();
}

// 带黑色硬阴影的 Memphis 数字（分数）
function drawMemphisNumber(str, x, y, size, color, dx, dy) {
  push();
  textAlign(CENTER, CENTER);
  noStroke();
  // 显式设字号，避免 p5 textFont 回退导致字号被吞
  textSize(size);
  fill(PALETTE.ink);
  text(str, x + dx, y + dy);
  textSize(size);
  fill(color);
  text(str, x, y);
  pop();
}

function drawHUD() {
  const cx = width / 2;

  push();
  textAlign(CENTER, CENTER);

  // 比分：镜像布局 —— P2 在上方半场（旋转 180° 便于上方玩家正向阅读），
  // P1 在下方半场（正向）。远离中线与中心圆，无视觉重叠。
  const scoreY2 = height * 0.20;
  const scoreY1 = height * 0.80;
  const scoreSize = 76;

  // P2 比分 + 玩家标签（上方，旋转 180°）
  push();
  translate(cx, scoreY2);
  rotate(PI);
  drawMemphisNumber(String(state.scoreP2), -28, 0, scoreSize, PALETTE.p2, -5, 5);
  // 玩家标签（与分数并排，整体旋转后仍正向显示）
  noStroke();
  fill(PALETTE.p2Dark);
  textAlign(LEFT, CENTER);
  textSize(22);
  textStyle(BOLD);
  text('P2', 30, 0);
  textStyle(NORMAL);
  pop();

  // P1 比分 + 玩家标签（下方，正向）
  drawMemphisNumber(String(state.scoreP1), cx - 28, scoreY1, scoreSize, PALETTE.p1, -5, 5);
  noStroke();
  fill(PALETTE.p1Dark);
  textAlign(LEFT, CENTER);
  textSize(22);
  textStyle(BOLD);
  text('P1', cx + 30, scoreY1);
  textStyle(NORMAL);

  // 顶部难度信息条（避开中线与中心圆，不与场地元素重叠）
  textAlign(CENTER, TOP);
  textSize(13);
  noStroke();
  fill(PALETTE.inkSoft);
  text(
    `${currentDifficulty().name} · 先到 ${CONFIG.game.winScore} 分 · 回合 ${state.rallyHits} 拍`,
    cx, 16
  );

  // HUD 操作提示（加大字号到 14px，留安全边距避免贴近板子/边角被截断）
  textStyle(BOLD);
  textSize(14);
  fill(PALETTE.ink);
  // P1 提示：底部左侧（远离底部板子，留 56px 安全距离）
  textAlign(LEFT, BOTTOM);
  text('P1 · 下半屏拖动 / A · D', 18, height - 56);
  // P2 提示：顶部右侧（远离顶部信息条）
  textAlign(RIGHT, BOTTOM);
  text('P2 · 上半屏拖动 / J · L', width - 18, 40);
  textStyle(NORMAL);

  // 角落俱乐部标注（弱化大字距，留安全边距）
  textSize(10.5);
  fill(PALETTE.inkSoft);
  textAlign(LEFT, BOTTOM);
  text('fun apps society · est. 2026', 18, height - 18);
  textAlign(RIGHT, BOTTOM);
  text('memphis vibes · 双击即玩 · nº 04', width - 18, height - 18);
  pop();
}

function drawServeHint() {
  const isP1 = state.server === PLAYER.P1;
  const y = isP1 ? height * 0.72 : height * 0.28;
  const col = isP1 ? PALETTE.p1 : PALETTE.p2;

  push();
  textAlign(CENTER, CENTER);
  // 黑底胶囊提示（Memphis 徽章）
  const msg = isP1 ? 'P1 发球 · 拖动瞄准 · 松手 / 点击发出' : 'P2 发球 · 拖动瞄准 · 松手 / 点击发出';
  noStroke();
  const w = textWidth(msg) + 44;
  fill(PALETTE.ink);
  rect(width / 2 - w / 2, y - 19, w, 38, 19);
  fill(col);
  textSize(18);
  if (isP1) {
    text(msg, width / 2, y + 2);
  } else {
    push();
    translate(width / 2, y);
    rotate(PI);
    text(msg, 0, 2);
    pop();
  }
  pop();
}

function drawScoredBanner() {
  const winnerIsP1 = state.lastScorer === PLAYER.P1;
  drawMemphisNumber(winnerIsP1 ? 'P1 得分！' : 'P2 得分！',
    width / 2, height / 2 - 130, 34, winnerIsP1 ? PALETTE.p1 : PALETTE.p2, -4, 4);
}

function drawGameOver() {
  push();
  noStroke();
  fill(PALETTE.overlay);
  rect(0, 0, width, height);

  const isP1 = state.winner === PLAYER.P1;
  const col = isP1 ? PALETTE.p1 : PALETTE.p2;

  // 获胜大字（Memphis 硬阴影）
  drawMemphisNumber(isP1 ? 'P1 获胜' : 'P2 获胜', width / 2, height / 2 - 40, 64, col, -6, 6);

  // 比分
  drawMemphisNumber(`${state.scoreP1} : ${state.scoreP2}`, width / 2, height / 2 + 28, 30, PALETTE.ink, -3, 3);

  // 再来一局提示（黑底胶囊）
  const hint = '点击任意处 / 按 R 再来一局';
  textAlign(CENTER, CENTER);
  noStroke();
  const w = textWidth(hint) + 44;
  fill(PALETTE.ink);
  rect(width / 2 - w / 2, height / 2 + 72, w, 40, 20);
  fill(PALETTE.sun);
  textSize(16);
  text(hint, width / 2, height / 2 + 92);
  pop();
}

// 菜单散落 Memphis 图形（仅装饰，呼应首页散落贴纸）
function drawMenuShapes() {
  const shapes = [
    { t: 'tri', x: width * 0.12, y: height * 0.18, s: 44, col: PALETTE.coral, rot: -14 },
    { t: 'dot', x: width * 0.86, y: height * 0.14, s: 40, col: PALETTE.blue, rot: 10 },
    { t: 'squig', x: width * 0.1,  y: height * 0.82, s: 90, col: PALETTE.teal, rot: 8 },
    { t: 'tri', x: width * 0.88, y: height * 0.8,  s: 40, col: PALETTE.sun, rot: -6 },
    { t: 'pill', x: width * 0.78, y: height * 0.28, s: 80, col: PALETTE.pink, rot: 12 },
  ];
  push();
  for (const sh of shapes) {
    push();
    translate(sh.x, sh.y);
    rotate(radians(sh.rot));
    stroke(PALETTE.ink);
    strokeWeight(2.5);
    fill(sh.col);
    if (sh.t === 'tri') {
      const r = sh.s / 2;
      triangle(0, -r, r * 0.87, r * 0.5, -r * 0.87, r * 0.5);
    } else if (sh.t === 'dot') {
      circle(0, 0, sh.s);
      noFill();
      stroke(PALETTE.paper);
      strokeWeight(3);
      strokeCap(ROUND);
      for (let a = 0; a < 12; a++) {
        const ang = a * (TWO_PI / 12);
        const x1 = cos(ang) * sh.s * 0.28, y1 = sin(ang) * sh.s * 0.28;
        const x2 = cos(ang) * sh.s * 0.4,  y2 = sin(ang) * sh.s * 0.4;
        line(x1, y1, x2, y2);
      }
    } else if (sh.t === 'pill') {
      rectMode(CENTER);
      rect(0, 0, sh.s, sh.s * 0.4, sh.s * 0.2);
      rectMode(CORNER);
      noStroke();
      stroke(PALETTE.paper);
      strokeWeight(2);
      line(-sh.s * 0.18, sh.s * 0.14, sh.s * 0.18, -sh.s * 0.14);
    } else if (sh.t === 'squig') {
      noFill();
      strokeCap(ROUND);
      // 黑色硬阴影（错位）
      stroke(PALETTE.ink);
      strokeWeight(5);
      beginShape();
      for (let i = 0; i <= 6; i++) {
        vertex(-sh.s / 2 + (i * sh.s) / 6 + 3, sin(i * 1.1) * 7 + 3);
      }
      endShape();
      // 彩色波浪线
      stroke(sh.col);
      strokeWeight(5);
      beginShape();
      for (let i = 0; i <= 6; i++) {
        vertex(-sh.s / 2 + (i * sh.s) / 6, sin(i * 1.1) * 7);
      }
      endShape();
    }
    pop();
  }
  pop();
}

function drawMenu() {
  drawMenuShapes();

  push();
  textAlign(CENTER, CENTER);
  noStroke();

  // 标题：三层同向硬阴影（Memphis 招牌，docs/DESIGN.md §5.2）
  // 偏移统一向右下（+4 ink、+8 coral），避免方向错位导致小屏糊字/重影。
  // 逐层显式设置 textSize，避免 p5 textFont 不可用时回退导致字号被吞。
  noStroke();
  textSize(58);
  fill(PALETTE.coral);
  text('双人对撞球', width / 2 + 8, height / 2 - 144);
  textSize(58);
  fill(PALETTE.ink);
  text('双人对撞球', width / 2 + 4, height / 2 - 148);
  textSize(58);
  fill(PALETTE.paper);
  text('双人对撞球', width / 2, height / 2 - 152);

  // 副标题徽章（黑底纸字，旋转 -2°）
  textSize(15);
  const sub = '两人各守一边 · 板子把球打回去 · 先到 5 分获胜';
  const sw = textWidth(sub) + 40;
  push();
  translate(width / 2, height / 2 - 96);
  rotate(radians(-2));
  fill(PALETTE.ink);
  rect(-sw / 2, -18, sw, 36, 8);
  fill(PALETTE.sun);
  text(sub, 0, 3);
  pop();

  // 难度按钮（Memphis 贴纸卡片）
  const btns = menuButtonRects();
  const btnCols = [PALETTE.coral, PALETTE.teal, PALETTE.blue];
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    const isCur = i === state.difficultyIndex;
    const col = btnCols[i % btnCols.length];

    // 硬阴影（贴纸凸起）
    stroke(PALETTE.ink);
    strokeWeight(0);
    fill(PALETTE.ink);
    rect(b.x + 6, b.y + 6, b.w, b.h, 12);

    // 卡片主体：白底 + 彩描边
    fill(PALETTE.card);
    stroke(isCur ? col : PALETTE.ink);
    strokeWeight(isCur ? 4 : 3);
    rect(b.x, b.y, b.w, b.h, 12);

    // 难度色标签（左上角小圆点）
    noStroke();
    fill(col);
    circle(b.x + 20, b.y + 20, 14);
    fill(PALETTE.ink);
    circle(b.x + 20, b.y + 20, 5);

    // 名称
    noStroke();
    fill(PALETTE.ink);
    textSize(24);
    text(b.data.name, b.x + b.w / 2, b.y + b.h / 2 - 14);

    // 描述
    fill(PALETTE.inkSoft);
    textSize(13);
    text(b.data.desc, b.x + b.w / 2, b.y + b.h / 2 + 16);

    // 当前选中标记：右上角黑底胶囊徽章（不与名称冲突）
    if (isCur) {
      push();
      translate(b.x + b.w - 8, b.y + 8);
      const tag = '当前';
      textStyle(BOLD);
      textSize(11);
      const tw = textWidth(tag) + 18;
      rectMode(CORNER);
      noStroke();
      fill(PALETTE.ink);
      rect(-tw, -2, tw, 16, 5);
      fill(col);
      textAlign(RIGHT, CENTER);
      text(tag, -6, 6);
      textStyle(NORMAL);
      pop();
    }
  }
  pop();
}

// 视觉闪烁衰减
function decayFlash() {
  if (state.flash.p1 > 0) state.flash.p1--;
  if (state.flash.p2 > 0) state.flash.p2--;
  if (state.flash.wall > 0) state.flash.wall--;
}
