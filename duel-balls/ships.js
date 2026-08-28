// =====================================================================
// ships.js — 太空模式：巡逻飞船模块（生成 / 移动 / 绘制 / 耐久）
//
// 设计文档：docs/superpowers/specs/2026-08-28-duel-balls-space-mode-design.md
// 撞击变向规则（镜面反弹 + 动量叠加）在 main.js 的 onShipHit 中实现，
// 本模块只管飞船的「生命周期 + 匀速移动 + 像素绘制 + 掉血爆炸」。
//
// 接口：
//   Ships.init(p5Inst)      setup() 中调用一次
//   Ships.setEnabled(v)     true = 太空模式；false 时顺带 reset
//   Ships.reset()           清空全部飞船/粒子，生成计时器回到 initialDelay
//   Ships.update()          每帧推进（仅 RALLY 调用；内部自带 enabled 判断）
//   Ships.draw()            绘制（renderGame 中调用；内部自带 enabled 判断）
//   Ships.hit(body)         球撞飞船：掉血 + 闪白；血尽爆炸销毁并加速补位
//   Ships.getVx(body)       飞船横移速度（dir × speed），供动量叠加
//   Ships.forEachRect(fn)   遍历当前飞船物理矩形 fn(x, y, w, h)，供挤压兜底
//   Ships.drawSprite(...)   通用像素飞船绘制（菜单贴纸复用）
// =====================================================================

const Ships = (function () {
  let p = null;
  let enabled = false;

  // 像素画：'.'=透明 '1'=ink 描边 '2'=船体色 '3'=舷窗（血量）
  // 朝右定义，朝左时水平镜像
  const SPRITE = [
    '....11.......',
    '...1221......',
    '112222222211.',
    '1223232322221',
    '.1222222221..',
    '.11..........',
  ];
  const SPRITE_COLS = 13;
  const SPRITE_ROWS = 6;
  const BODY_COLOR_KEYS = ['teal', 'blue', 'pink', 'coral'];

  let ships = [];       // { body, laneIndex, dir, speed, hp, colorKey, flamePhase, hitFlash }
  let particles = [];   // { x, y, vx, vy, life, maxLife, colorKey }
  let spawnTimer = 0;
  let laneOccupied = [];

  function init(p5Inst) {
    p = p5Inst;
    laneOccupied = CONFIG.space.laneYRatios.map(function () { return false; });
    spawnTimer = CONFIG.space.initialDelay;
  }

  function setEnabled(v) {
    enabled = v;
    if (!v) reset();
  }

  function reset() {
    for (const s of ships) Physics.remove(s.body);
    ships = [];
    particles = [];
    laneOccupied = laneOccupied.map(function () { return false; });
    spawnTimer = CONFIG.space.initialDelay;
  }

  function laneY(laneIndex) {
    return p.height * CONFIG.space.laneYRatios[laneIndex];
  }

  // --- 生成：空闲线路随机挑一条，随机方向，从场外滑入 ---
  function trySpawn() {
    const S = CONFIG.space;
    const maxShips = CONFIG.debug.shipMax ?? S.maxShips;
    if (ships.length >= maxShips) return;

    const free = [];
    for (let i = 0; i < laneOccupied.length; i++) {
      if (!laneOccupied[i]) free.push(i);
    }
    if (free.length === 0) return;

    const laneIndex = free[Math.floor(Math.random() * free.length)];
    const dir = Math.random() < 0.5 ? 1 : -1;
    const off = S.despawnMargin + S.physW / 2;
    const x = dir === 1 ? -off : p.width + off;

    const body = Physics.addStaticBoundary(x, laneY(laneIndex), S.physW, S.physH);
    body.label = 'ship';

    ships.push({
      body: body,
      laneIndex: laneIndex,
      dir: dir,
      speed: currentDifficulty().shipSpeed,
      hp: S.shipHP,
      colorKey: BODY_COLOR_KEYS[Math.floor(Math.random() * BODY_COLOR_KEYS.length)],
      flamePhase: Math.floor(Math.random() * S.flameFlipFrames * 2),
      hitFlash: 0,
    });
    laneOccupied[laneIndex] = true;
  }

  // --- 每帧推进：生成调度 → 匀速移动 → 出界销毁 → 粒子 ---
  // （main.js 在 Physics.step 之前调用，保证碰撞检测用最新位置）
  function update() {
    if (!enabled) return;
    const S = CONFIG.space;

    spawnTimer--;
    if (spawnTimer <= 0) {
      trySpawn();
      spawnTimer = S.spawnDelayMin +
        Math.floor(Math.random() * (S.spawnDelayMax - S.spawnDelayMin + 1));
    }

    for (let i = ships.length - 1; i >= 0; i--) {
      const s = ships[i];
      Matter.Body.setPosition(s.body, {
        x: s.body.position.x + s.dir * s.speed,
        y: s.body.position.y,
      });
      s.flamePhase = (s.flamePhase + 1) % (S.flameFlipFrames * 2);
      if (s.hitFlash > 0) s.hitFlash--;

      const off = S.despawnMargin + S.physW / 2;
      const out = s.dir === 1
        ? s.body.position.x > p.width + off
        : s.body.position.x < -off;
      if (out) removeShip(i);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.x += q.vx;
      q.y += q.vy;
      q.life--;
      if (q.life <= 0) particles.splice(i, 1);
    }
  }

  function removeShip(index) {
    const s = ships[index];
    laneOccupied[s.laneIndex] = false;
    Physics.remove(s.body);
    ships.splice(index, 1);
  }

  // --- 球撞飞船：掉血 + 闪白；血尽爆炸销毁 ---
  function hit(body) {
    const idx = ships.findIndex(function (s) { return s.body === body; });
    if (idx < 0) return;
    const s = ships[idx];
    s.hp--;
    s.hitFlash = CONFIG.space.hitFlashFrames;
    if (s.hp <= 0) {
      explode(s);
      removeShip(idx);
      // 加速补位
      spawnTimer = Math.min(spawnTimer, CONFIG.space.refillDelay);
    }
  }

  function explode(s) {
    const colorKeys = [s.colorKey, 'ink', 'sun'];
    const n = 10 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1 + Math.random() * 2;
      const life = 18 + Math.floor(Math.random() * 11);
      particles.push({
        x: s.body.position.x,
        y: s.body.position.y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: life,
        maxLife: life,
        colorKey: colorKeys[Math.floor(Math.random() * colorKeys.length)],
      });
    }
  }

  function getVx(body) {
    for (const s of ships) {
      if (s.body === body) return s.dir * s.speed;
    }
    return 0;
  }

  function forEachRect(fn) {
    const S = CONFIG.space;
    for (const s of ships) {
      fn(s.body.position.x - S.physW / 2, s.body.position.y - S.physH / 2,
         S.physW, S.physH);
    }
  }

  // --- 绘制 ---
  function draw() {
    if (!enabled) return;
    drawParticles();
    for (const s of ships) drawShip(s);
  }

  function drawShip(s) {
    const S = CONFIG.space;
    const flameOn = Math.floor(s.flamePhase / S.flameFlipFrames) % 2 === 0;
    drawSprite(s.body.position.x, s.body.position.y, S.visualScale,
      s.colorKey, s.dir, s.hp,
      flameOn ? PALETTE.sun : PALETTE.coral,
      s.hitFlash > 0);
  }

  function drawParticles() {
    p.push();
    p.noStroke();
    for (const q of particles) {
      const c = p.color(PALETTE[q.colorKey]);
      c.setAlpha(255 * q.life / q.maxLife);
      p.fill(c);
      p.rect(q.x - 2, q.y - 2, 4, 4);
    }
    p.pop();
  }

  // 通用像素飞船绘制（对局与菜单贴纸共用）
  // x,y = 船体中心；flameColor 为 null 时不画推进器；flash 为 true 时整体闪白
  function drawSprite(x, y, scale, colorKey, dir, hp, flameColor, flash) {
    const u = scale;
    const w = SPRITE_COLS * u;
    const h = SPRITE_ROWS * u;

    p.push();
    p.noStroke();

    if (flameColor) {
      p.fill(flameColor);
      const flameW = u * 2;
      p.rect(dir === 1 ? x - w / 2 - flameW : x + w / 2, y - u * 1.5, flameW, u * 3);
    }

    for (let row = 0; row < SPRITE_ROWS; row++) {
      for (let col = 0; col < SPRITE_COLS; col++) {
        const ch = SPRITE[row][col];
        if (ch === '.') continue;
        const c = dir === 1 ? col : (SPRITE_COLS - 1 - col);
        const px = x - w / 2 + c * u;
        const py = y - h / 2 + row * u;
        if (flash) {
          p.fill(PALETTE.paper);
        } else if (ch === '1') {
          p.fill(PALETTE.ink);
        } else if (ch === '2') {
          p.fill(PALETTE[colorKey]);
        } else {
          // 舷窗 = 血量：序号 0(船尾侧)~2(船头侧)，小于 hp 的亮
          p.fill((col - 3) / 2 < hp ? PALETTE.sun : PALETTE.paper);
        }
        p.rect(px, py, u, u);
      }
    }
    p.pop();
  }

  return {
    init, setEnabled, reset, update, draw,
    hit, getVx, forEachRect, drawSprite,
  };
})();
