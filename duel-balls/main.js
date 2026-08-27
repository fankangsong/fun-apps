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

// 场地：左右墙 + 中线 + 双方底线
function drawArena() {
  const lw = playLeft();
  const rw = playRight();

  // 可玩区
  noStroke();
  fill(PALETTE.arena);
  rect(lw, 0, rw - lw, height);

  // 左右墙（击中时高亮）
  const wallAlpha = state.flash.wall > 0 ? 255 : 160;
  fill(red(color(PALETTE.wall)), green(color(PALETTE.wall)), blue(color(PALETTE.wall)), wallAlpha);
  rect(0, 0, lw, height);
  rect(rw, 0, width - rw, height);

  // 中线（虚线）
  stroke(PALETTE.midLine);
  strokeWeight(3);
  const dash = 22;
  for (let x = lw; x < rw; x += dash * 2) {
    line(x, height / 2, Math.min(x + dash, rw), height / 2);
  }

  // 中心圆
  noFill();
  strokeWeight(2);
  circle(width / 2, height / 2, Math.min(width, height) * 0.22);

  // 双方底线
  strokeWeight(4);
  stroke(PALETTE.p1Dark);
  line(lw, height - 3, rw, height - 3);
  stroke(PALETTE.p2Dark);
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

  // 命中辉光
  if (flash > 0) {
    noStroke();
    const c = color(glow);
    c.setAlpha(flash * 8);
    fill(c);
    rectMode(CENTER);
    rect(0, 0, L.paddleW + 22, G.paddleThickness + 22, 14);
  }

  noStroke();
  fill(flash > 0 ? glow : base);
  rectMode(CENTER);
  rect(0, 0, L.paddleW, G.paddleThickness, G.paddleThickness / 2);

  // 板心标记：帮助玩家判断击球点（正中反弹角最小）
  fill(isP1 ? PALETTE.p1Dark : PALETTE.p2Dark);
  rect(0, 0, 4, G.paddleThickness * 0.5, 2);

  rectMode(CORNER);
  pop();
}

function drawBall() {
  const r = CONFIG.game.ballRadius;
  push();
  noStroke();
  // 外发光
  const g = color(PALETTE.ballGlow);
  g.setAlpha(60);
  fill(g);
  circle(ball.position.x, ball.position.y, r * 3.2);
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

function drawHUD() {
  const cx = width / 2;

  push();
  textAlign(CENTER, CENTER);
  noStroke();

  // 比分：P2 在上（旋转 180° 便于对面玩家阅读），P1 在下
  textSize(56);
  fill(PALETTE.p2);
  push();
  translate(cx, height / 2 - 70);
  rotate(PI);
  text(state.scoreP2, 0, 0);
  pop();

  fill(PALETTE.p1);
  text(state.scoreP1, cx, height / 2 + 70);

  // 中央信息：难度 + 连续对拉次数
  textSize(14);
  fill(PALETTE.textDim);
  text(
    `${currentDifficulty().name} · 先到 ${CONFIG.game.winScore} 分 · 回合 ${state.rallyHits} 拍`,
    cx, height / 2 - 4
  );

  // 左右角落提示
  textAlign(LEFT, BOTTOM);
  textSize(12);
  fill(PALETTE.textDim);
  text('P1: 下半屏拖动 / A·D', 16, height - 12);
  textAlign(RIGHT, TOP);
  text('P2: 上半屏拖动 / J·L', width - 16, 12);
  pop();
}

function drawServeHint() {
  const isP1 = state.server === PLAYER.P1;
  const y = isP1 ? height * 0.72 : height * 0.28;

  push();
  textAlign(CENTER, CENTER);
  noStroke();
  fill(isP1 ? PALETTE.p1 : PALETTE.p2);
  textSize(20);

  if (isP1) {
    text('P1 发球：拖动瞄准，松手 / 点击发出', width / 2, y);
  } else {
    push();
    translate(width / 2, y);
    rotate(PI);
    text('P2 发球：拖动瞄准，松手 / 点击发出', 0, 0);
    pop();
  }
  pop();
}

function drawScoredBanner() {
  const winnerIsP1 = state.lastScorer === PLAYER.P1;
  push();
  textAlign(CENTER, CENTER);
  noStroke();
  fill(winnerIsP1 ? PALETTE.p1 : PALETTE.p2);
  textSize(34);
  const msg = winnerIsP1 ? 'P1 得分！' : 'P2 得分！';
  text(msg, width / 2, height / 2 - 130);
  pop();
}

function drawGameOver() {
  push();
  noStroke();
  fill(PALETTE.overlay);
  rect(0, 0, width, height);

  const isP1 = state.winner === PLAYER.P1;
  textAlign(CENTER, CENTER);
  fill(isP1 ? PALETTE.p1 : PALETTE.p2);
  textSize(64);
  text(isP1 ? 'P1 获胜' : 'P2 获胜', width / 2, height / 2 - 40);

  fill(PALETTE.text);
  textSize(28);
  text(`${state.scoreP1} : ${state.scoreP2}`, width / 2, height / 2 + 24);

  fill(PALETTE.textDim);
  textSize(16);
  text('点击任意处 / 按 R 再来一局', width / 2, height / 2 + 76);
  pop();
}

function drawMenu() {
  push();
  textAlign(CENTER, CENTER);
  noStroke();

  fill(PALETTE.text);
  textSize(52);
  text('双人对撞球', width / 2, height / 2 - 150);

  fill(PALETTE.textDim);
  textSize(16);
  text('两人各守一边，用板子把球打回去 · 选择难度开始', width / 2, height / 2 - 100);

  const btns = menuButtonRects();
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    const isCur = i === state.difficultyIndex;

    fill(isCur ? PALETTE.p1Dark : PALETTE.arena);
    stroke(isCur ? PALETTE.p1 : PALETTE.arenaEdge);
    strokeWeight(2);
    rect(b.x, b.y, b.w, b.h, 12);

    noStroke();
    fill(isCur ? PALETTE.p1 : PALETTE.text);
    textSize(24);
    text(b.data.name, b.x + b.w / 2, b.y + b.h / 2 - 12);

    fill(PALETTE.textDim);
    textSize(13);
    text(b.data.desc, b.x + b.w / 2, b.y + b.h / 2 + 18);
  }
  pop();
}

// 视觉闪烁衰减
function decayFlash() {
  if (state.flash.p1 > 0) state.flash.p1--;
  if (state.flash.p2 > 0) state.flash.p2--;
  if (state.flash.wall > 0) state.flash.wall--;
}
