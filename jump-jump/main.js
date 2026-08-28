// =====================================================================
// main.js — 跳一跳：p5 生命周期 + 游戏循环 + 方块生成 + HUD 控制
//
// 流程（spec §3.3）：
//   aiming -> flying -> settling -> [egg] -> next -> aiming
//                              \-> gameover
//
// 帧时间（spec §4.3）：
//   - visibilitychange 隐藏时冻结推进
//   - dt 按真实时间差计算，钳制上限 CONFIG.time.maxDelta
//   - dt 异常（0 / 负 / NaN / 超限）跳过该帧
// =====================================================================

let p5Inst = null;
let lastMs = 0;

// ---------------------------------------------------------------------
// p5 生命周期
// ---------------------------------------------------------------------

function setup() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const c = createCanvas(w, h, WEBGL);
  p5Inst = this;
  // 高分屏清晰度：保持 p5 默认 pixelDensity(displayDensity())（AGENTS.md 第 5 条）
  pixelDensity(displayDensity());

  // 画布塞进 .stage 容器（保证安全区留白生效）
  const stage = document.getElementById('stage');
  if (stage) stage.appendChild(c.elt);

  Render.init(this);
  Render.resize(w, h);
  Physics.init();

  initDom();
  loadBest();
  bindUI();

  Physics.setHandlers({
    onLanding: handleLanding,
    onSettled: handleSettled,
    onFell: handleFell,
  });

  Input.bind(c.elt);
  Input.setHandlers({
    onPressStart: handlePressStart,
    onPressEnd: handlePressEnd,
    onPressCancel: handlePressCancel,
  });

  // 平台与棋子初始位置：开局前先摆好，开始卡背后能看到场景
  resetRun();
  buildInitialPlatforms();
  snapCamera();

  lastMs = performance.now();
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function windowResized() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  resizeCanvas(w, h);
  Render.resize(w, h);
  // 物理世界坐标与屏幕解耦，无需重建刚体（spec §3.6）
}

function draw() {
  const now = performance.now();
  let dt = now - lastMs;
  lastMs = now;

  // dt 异常保护：0 / 负 / NaN / 超限一律钳制或跳过（spec §4.3）
  if (!isFinite(dt) || dt <= 0) dt = 0;
  if (dt > CONFIG.time.maxDelta) dt = CONFIG.time.maxDelta;

  if (!state.paused) {
    update(dt);
  }

  Render.updateCamera();
  Render.drawScene();
}

// ---------------------------------------------------------------------
// 每帧推进
// ---------------------------------------------------------------------

function update(dt) {
  switch (state.phase) {
    case PHASE.AIMING:
      if (state.charging) {
        Physics.updateCharge(performance.now());
        Audio.chargeUpdate(state.chargeRatio);
      }
      break;

    case PHASE.FLYING:
      Physics.stepFlight(dt);
      break;

    case PHASE.SETTLING:
      Physics.stepSettle(dt);
      break;

    case PHASE.EGG:
      updateEgg(dt);
      break;

    case PHASE.NEXT:
      flushNext(dt);
      break;
  }

  // 帧末统一执行刚体移除（碰撞回调外，spec §4.1）
  Physics.flushRemoveQueue();
}

// ---------------------------------------------------------------------
// 输入
// ---------------------------------------------------------------------

function handlePressStart() {
  // 开始卡 / 结算卡期间由 HTML 按钮处理，画布按压不蓄力
  if (state.phase === PHASE.IDLE || state.phase === PHASE.GAMEOVER) return;

  if (state.phase === PHASE.EGG) {
    // 停留期间再次按下 = 放弃彩蛋，立即转入蓄力（spec §2.4）
    abandonEgg();
    return;
  }
  if (state.phase !== PHASE.AIMING) return;

  Physics.startCharge(performance.now());
  Audio.chargeStart();
}

function handlePressEnd(nowMs) {
  if (state.phase !== PHASE.AIMING || !state.charging) return;
  Audio.chargeStop();
  const jumped = Physics.releaseCharge(nowMs);
  if (jumped) Audio.jump();
}

function handlePressCancel() {
  if (state.phase !== PHASE.AIMING) return;
  // spec §4.2：取消蓄力，棋子恢复站立，绝不起跳
  Physics.cancelCharge();
  Audio.chargeStop();
}

// ---------------------------------------------------------------------
// 落地判定与计分（spec §2.3）
// ---------------------------------------------------------------------

function handleLanding(platform, isCurrent) {
  Audio.land();
  state.shake = 0.5;

  if (isCurrent) {
    // 落回当前平台：0 分，连击清零，可直接再次起跳
    breakCombo();
    syncHud();
    return;
  }

  const dx = state.piece.pos.x - platform.x;
  const dz = state.piece.pos.z - platform.z;
  const dist = Math.hypot(dx, dz);
  const r = Render.centerRadius(platform);

  if (dist < r) {
    // 中心落点：连击递增（+2 / +4 / +6 …）
    bumpCombo();
    Audio.combo(state.combo);
    state.shake = 0.7;
  } else {
    // 普通落点：+1，连击清零
    breakCombo();
    addScore(CONFIG.scoring.normal);
  }
  syncHud();

  // 落到新平台：推进索引，让镜头跟随与后续生成以新平台为基准
  advanceTo(platform);
}

// 把「当前平台」切换到指定平台对象
function advanceTo(platform) {
  const idx = state.platforms.indexOf(platform);
  if (idx < 0) return;
  state.currentIndex = idx;
}

// ---------------------------------------------------------------------
// settling 结束：站稳
// ---------------------------------------------------------------------

function handleSettled() {
  Physics.clearPieceBody();
  const plat = currentPlatform();

  // 踩在未触发的彩蛋上 -> 进入停留计时
  if (plat && plat.egg && !plat.egg.triggered) {
    state.egg.platform = plat;
    state.egg.timer = 0;
    setPhase(PHASE.EGG);
    return;
  }
  goNext();
}

// ---------------------------------------------------------------------
// 彩蛋停留（spec §2.4）
// ---------------------------------------------------------------------

function updateEgg(dt) {
  const plat = state.egg.platform;
  if (!plat) { goNext(); return; }

  state.egg.timer += dt;
  if (state.egg.timer >= CONFIG.egg.stayTime) {
    // 触发彩蛋：加分 + 标记为已触发（触发一次后变普通方块）
    addScore(plat.egg.score);
    plat.egg.triggered = true;
    Audio.egg(plat.egg.key);
    state.shake = 0.6;
    syncHud();
    state.egg.platform = null;
    state.egg.timer = 0;
    goNext();
  }
}

// 停留期间再次按下 = 放弃彩蛋，立即转入蓄力
function abandonEgg() {
  state.egg.platform = null;
  state.egg.timer = 0;
  goNext();
}

// ---------------------------------------------------------------------
// 生成下一个方块 + 回收（进入 NEXT 后由 flushNext 完成镜头过渡）
// ---------------------------------------------------------------------

function goNext() {
  setPhase(PHASE.NEXT);
  spawnNextPlatform();
  recyclePlatforms();
  snapCameraTarget();
}

// NEXT 阶段：等待镜头缓动基本到位后转回 AIMING
function flushNext(dt) {
  const cam = state.cam;
  const d = Math.hypot(cam.targX - cam.lookX, cam.targZ - cam.lookZ);
  if (d < 1.2) {
    const np = nextPlatform();
    if (np) {
      // 棋子对齐到当前平台中心（视觉上站稳）
      const cur = currentPlatform();
      if (cur) {
        state.piece.pos.x = cur.x;
        state.piece.pos.z = cur.z;
        state.piece.pos.y = 0;
      }
      state.piece.tilt = 0;
      state.piece.stretch = 0;
      setPhase(PHASE.AIMING);
    }
  }
}

// ---------------------------------------------------------------------
// 方块生成（spec §2.2 / §3.4）
// ---------------------------------------------------------------------

// 开局：当前方块在原点，再预生成 keepAhead 个
function buildInitialPlatforms() {
  state.platforms.length = 0;
  state.currentIndex = 0;
  state.nextIndex = 1;
  state.spawnCounter = 0;
  state.sinceEgg = 99;

  const first = makePlatform(0, 0, CONFIG.platform.sizeStart, false, null);
  state.platforms.push(first);
  Physics.addPlatformBody(first);

  for (let i = 0; i < CONFIG.platform.keepAhead; i++) spawnNextPlatform();

  const cur = currentPlatform();
  state.piece.pos = { x: cur.x, y: 0, z: cur.z };
  state.nextIndex = 1;
}

// 生成下一个方块：随机沿 X 或 Z 轴延伸，带随机微扰
function spawnNextPlatform() {
  const P = CONFIG.platform;
  const prev = state.platforms[state.platforms.length - 1];
  if (!prev) return null;

  const score = state.score;

  // 尺寸随分数缩小（带微扰），下限 sizeMin
  let size = P.sizeStart - score * P.sizeShrinkPerScore;
  size = Math.max(P.sizeMin, size + (Math.random() * 2 - 1) * P.sizeJitter);

  // 间距随分数拉大（带微扰），上限 gapMax
  let gap = P.gapStart + score * P.gapGrowPerScore;
  gap = Math.min(P.gapMax, gap + (Math.random() * 2 - 1) * P.gapJitter);
  // 保证至少「两个半宽 + 一点余量」，避免视觉重叠
  gap = Math.max(gap, (prev.size + size) / 2 + 12);

  // 随机方向：沿 X 或 Z 轴，正负随机（画面上表现为左前 / 右前）
  const useX = Math.random() < 0.5;
  const sign = Math.random() < 0.5 ? 1 : -1;

  const x = useX ? prev.x + sign * gap : prev.x;
  const z = useX ? prev.z : prev.z + sign * gap;

  // 彩蛋：概率 chance，且不连续出现（sinceEgg 计数强制间隔）
  let egg = null;
  state.sinceEgg++;
  if (state.sinceEgg >= CONFIG.egg.forbidRepeat + 1 && Math.random() < CONFIG.egg.chance) {
    egg = makeEgg();
    state.sinceEgg = 0;
  }

  const plat = makePlatform(x, z, size, Math.random() < P.cylinderChance, egg);
  state.platforms.push(plat);
  Physics.addPlatformBody(plat);
  return plat;
}

function makePlatform(x, z, size, isCylinder, egg) {
  const plat = {
    x, z, size,
    shape: isCylinder ? 'cylinder' : 'box',
    colorIndex: state.spawnCounter % BLOCK_COLORS.length,
    egg: egg || null,
    body: null,
  };
  state.spawnCounter++;
  return plat;
}

// 按权重随机选一种彩蛋（spec §2.4）
function makeEgg() {
  const keys = ['record', 'cube', 'box'];
  const w = CONFIG.egg.weights;
  const total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < keys.length; i++) {
    r -= w[i];
    if (r <= 0) {
      const t = CONFIG.egg.types[keys[i]];
      return { key: t.key, score: t.score, label: t.label, triggered: false };
    }
  }
  const t = CONFIG.egg.types.record;
  return { key: t.key, score: t.score, label: t.label, triggered: false };
}

// ---------------------------------------------------------------------
// 环形窗口回收：只保留当前 ±keepBehind / keepAhead（spec §3.4）
// 入队而非直接移除，由 flushRemoveQueue 在帧末执行
// ---------------------------------------------------------------------

function recyclePlatforms() {
  const P = CONFIG.platform;
  const cur = state.currentIndex;
  const lo = cur - P.keepBehind;
  const hi = cur + P.keepAhead;

  for (let i = 0; i < state.platforms.length; i++) {
    if (i >= lo && i <= hi) continue;
    Physics.queueRemovePlatform(state.platforms[i]);
  }

  // 真正从数组移除（已回收的刚体在帧末出队）
  const kept = [];
  for (let i = 0; i < state.platforms.length; i++) {
    if (i >= lo && i <= hi) kept.push(state.platforms[i]);
  }
  const removedBefore = countRemovedBefore(state.platforms, lo);
  state.platforms = kept;
  state.currentIndex = Math.max(0, Math.min(kept.length - 1, cur - removedBefore));
  state.nextIndex = Math.min(kept.length - 1, state.currentIndex + 1);
}

// 统计数组中下标 < lo 的元素个数（用于回收后重算 currentIndex）
function countRemovedBefore(arr, lo) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (i < lo) n++;
  return n;
}

// ---------------------------------------------------------------------
// 镜头
// ---------------------------------------------------------------------

function snapCameraTarget() {
  const cur = currentPlatform();
  const nxt = nextPlatform();
  if (!cur) return;
  const C = CONFIG.camera;
  if (nxt) {
    state.cam.targX = cur.x + (nxt.x - cur.x) * C.lookAhead;
    state.cam.targZ = cur.z + (nxt.z - cur.z) * C.lookAhead;
  } else {
    state.cam.targX = cur.x;
    state.cam.targZ = cur.z;
  }
}

// 立即对齐（开局 / 重开时避免镜头从远处飞入）
function snapCamera() {
  snapCameraTarget();
  state.cam.lookX = state.cam.targX;
  state.cam.lookZ = state.cam.targZ;
}

// ---------------------------------------------------------------------
// 失败与结算（spec §2.5）
// ---------------------------------------------------------------------

function handleFell(reason) {
  Physics.clearPieceBody();
  breakCombo();
  syncHud();
  state.shake = 1;
  Audio.fail();
  endGame();
}

function endGame() {
  setPhase(PHASE.GAMEOVER);

  const isNew = state.score > state.best;
  if (isNew) saveBest(state.score);

  const d = state.dom;
  if (d.finalV) d.finalV.textContent = String(state.score);
  if (d.statCombo) d.statCombo.textContent = String(state.maxCombo);
  if (d.statBest) d.statBest.textContent = String(state.best);
  if (d.newbest) d.newbest.hidden = !isNew;
  if (d.ovEnd) d.ovEnd.hidden = false;
  syncHud();
}

// ---------------------------------------------------------------------
// UI 绑定
// ---------------------------------------------------------------------

function bindUI() {
  const d = state.dom;
  if (d.btnStart) {
    d.btnStart.addEventListener('click', () => { Audio.unlock(); startGame(); });
  }
  if (d.btnAgain) {
    d.btnAgain.addEventListener('click', () => { Audio.unlock(); restartGame(); });
  }
}

function startGame() {
  if (state.dom.ovStart) state.dom.ovStart.hidden = true;
  resetRun();
  Physics.clearWorld();
  Physics.init();
  buildInitialPlatforms();
  snapCamera();
  setPhase(PHASE.AIMING);
  lastMs = performance.now();
}

function restartGame() {
  if (state.dom.ovEnd) state.dom.ovEnd.hidden = true;
  startGame();
}

// ---------------------------------------------------------------------
// 后台暂停（spec §4.3）
// ---------------------------------------------------------------------

function onVisibilityChange() {
  if (document.hidden) {
    state.paused = true;
    // 切后台时若正在蓄力，取消本次蓄力（绝不起跳）
    if (state.charging) {
      Physics.cancelCharge();
      Audio.chargeStop();
    }
    Input.clear();
  } else {
    state.paused = false;
    lastMs = performance.now();   // 重置时间基准，杜绝瞬移
  }
}

// ---------------------------------------------------------------------
// 键盘（可选增强，桌面端等价操作；鼠标已可完成全部玩法）
// ---------------------------------------------------------------------

function keyPressed() {
  // 空格按下 = 开始蓄力（与按住鼠标等价）
  if (key === ' ' && state.phase === PHASE.AIMING && !state.charging) {
    Audio.unlock();
    Physics.startCharge(performance.now());
    Audio.chargeStart();
  }
}

function keyReleased() {
  if (key === ' ' && state.phase === PHASE.AIMING && state.charging) {
    Audio.chargeStop();
    const jumped = Physics.releaseCharge(performance.now());
    if (jumped) Audio.jump();
  }
}
