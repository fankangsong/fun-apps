# 双人对撞球「太空模式」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 duel-balls 新增可选「太空模式」：中场巡逻的像素飞船（最多 2 艘、4 条线路先后出现）作为双方共用的中立障碍，球撞飞船时镜面反弹并叠加飞船动量；飞船 3 点血、受击闪白、耗尽爆炸。

**Architecture:** 飞船 = Matter 静态矩形刚体（与板子同款 kinematic 移动，`label='ship'`），碰撞走现有 `Physics.onPair` 分发；新增 `ships.js` 模块负责飞船生命周期/移动/像素绘制/掉血爆炸，撞击变向规则在 `main.js` 的 `onShipHit` 实现。普通模式通过 `Ships.setEnabled(false)` 保持零行为变化。

**Tech Stack:** 原生 HTML/CSS/JS（无构建）；p5.js + Matter.js 0.20.0（本地 `../assets/`）；`node --check` 做语法校验；浏览器实测做功能验收。

**Spec:** `docs/superpowers/specs/2026-08-28-duel-balls-space-mode-design.md`

## Global Constraints

- 仅原生 HTML/CSS/JS，禁止 npm/构建/TS/框架；第三方库只用本地 `../assets/`（已存在 p5.min.js、matter.min.js）。
- 双击 `duel-balls/index.html` 可离线运行，控制台无报错。
- 颜色只允许取 `PALETTE` token（config.js），业务代码禁止硬编码色值（render.js 星点 alpha 的 rgba 除外，与现有波点写法一致）。
- 脚本加载顺序：`config → state → physics → input → ships → render → main`（纯 `<script>` 标签，无模块系统）。
- 布局必须覆盖 320px ~ 超宽（iPad 分屏基准）；触控目标 ≥44×44px。
- **普通模式零回归**：`Ships.setEnabled(false)` 时 `update/draw` 直接 return，行为与改动前一致。
- 提交信息用中文 conventional commit 风格（仓库惯例）。

---

### Task 1: 基础层——配置、状态与 Ships 模块

**Files:**
- Modify: `duel-balls/config.js`
- Modify: `duel-balls/state.js`
- Create: `duel-balls/ships.js`
- Modify: `duel-balls/index.html`（新增脚本标签）

**Interfaces:**
- Consumes: `Physics.addStaticBoundary(x, y, w, h)`、`Physics.remove(body)`、`currentDifficulty()`、`PALETTE`、p5 全局绘制函数（经 `init(p5Inst)` 注入实例）
- Produces: `CONFIG.modes[i] = { key, name, desc }`；`CONFIG.space = { laneYRatios, maxShips, shipHP, physW, physH, visualScale, spawnDelayMin, spawnDelayMax, initialDelay, refillDelay, momentumTransfer, despawnMargin, hitFlashFrames, flameFlipFrames }`；`CONFIG.difficulties[i].shipSpeed`；`state.modeIndex`；`currentMode()`；`Ships.{init, setEnabled, reset, update, draw, hit, getVx, forEachRect, drawSprite}`

- [ ] **Step 1: config.js 新增 modes / space 配置与每难度 shipSpeed**

在 `defaultDifficulty: 1,` 之后插入：

```js
  defaultDifficulty: 1,      // 索引，对应 normal

  // --- 模式：普通 / 太空（太空模式有巡逻飞船改变球路）---
  modes: [
    { key: 'classic', name: '普通模式', desc: '经典对撞 · 无干扰' },
    { key: 'space',   name: '太空模式', desc: '巡逻飞船 · 改变球路' },
  ],
  defaultMode: 0,            // 索引，默认普通模式
```

三档难度各追加一行（easy 在 `maxSpeed: 15,` 后、normal 在 `maxSpeed: 19,` 后、hard 在 `maxSpeed: 24,` 后）：

```js
      shipSpeed: 2.6,        // 太空模式：飞船横移速度
```
```js
      shipSpeed: 3.4,        // 太空模式：飞船横移速度
```
```js
      shipSpeed: 4.3,        // 太空模式：飞船横移速度
```

在 `game: { ... },` 块之后追加：

```js
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
```

- [ ] **Step 2: state.js 新增 modeIndex 与 currentMode()**

`difficultyIndex: CONFIG.defaultDifficulty,` 之后插入：

```js
  // 模式（CONFIG.modes 的索引）
  modeIndex: CONFIG.defaultMode,
```

文件末尾 `currentDifficulty()` 之后追加：

```js
// 当前模式
function currentMode() {
  return CONFIG.modes[state.modeIndex];
}
```

- [ ] **Step 3: 创建 duel-balls/ships.js（完整文件）**

```js
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
    if (ships.length >= S.maxShips) return;

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
```

- [ ] **Step 4: index.html 挂载脚本**

`<script src="input.js"></script>` 与 `<script src="render.js"></script>` 之间插入，并更新顺序注释：

```html
  <!-- 按依赖顺序加载模块：config -> state -> physics -> input -> ships -> render -> main -->
```
```html
  <script src="input.js"></script>
  <script src="ships.js"></script>
  <script src="render.js"></script>
```

- [ ] **Step 5: 语法校验**

```bash
node --check duel-balls/config.js && node --check duel-balls/state.js && node --check duel-balls/ships.js
```
预期：无输出（通过）。

- [ ] **Step 6: 浏览器冒烟——加载无报错、行为零变化**

双击打开 `duel-balls/index.html`：菜单正常、任选难度开局可正常对打（此时飞船模块未接线，不出现飞船），控制台无报错。

- [ ] **Step 7: Commit**

```bash
git add duel-balls/config.js duel-balls/state.js duel-balls/ships.js duel-balls/index.html
git commit -m "feat(duel-balls): 新增太空模式配置与巡逻飞船模块"
```

---

### Task 2: 菜单模式选择与 HUD

**Files:**
- Modify: `duel-balls/main.js`

**Interfaces:**
- Consumes: `Ships.setEnabled(bool)`、`currentMode()`、`CONFIG.modes`、`modeButtonRects()`（本任务新增）
- Produces: 菜单可选模式（点击只切换选中不开局）；点难度卡以当前模式开局并 `Ships.setEnabled`；HUD 信息条含模式名；`menuButtonRects()` 的 y 下移到 `height/2 + 34`

- [ ] **Step 1: menuButtonRects 难度行下移 + 新增 modeButtonRects**

`menuButtonRects()` 中 `const y = height / 2 + 10;` 改为 `const y = height / 2 + 34;`，并在其后新增：

```js
// 模式按钮布局（与绘制保持一致；点击只切换选中，不开局）
function modeButtonRects() {
  const bw = Math.min(220, (width - 72) / 2);
  const bh = 72;
  const gap = 20;
  const startX = (width - (bw * 2 + gap)) / 2;
  const y = height / 2 - 58;
  return CONFIG.modes.map((m, i) => ({
    x: startX + i * (bw + gap), y, w: bw, h: bh, data: m,
  }));
}
```

- [ ] **Step 2: handleMenuClick 先判模式卡，难度分支挂 setEnabled**

```js
function handleMenuClick(x, y) {
  // 模式卡：只切换选中，不开局
  const modes = modeButtonRects();
  for (let i = 0; i < modes.length; i++) {
    const b = modes[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      state.modeIndex = i;
      return;
    }
  }
  const btns = menuButtonRects();
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      Ships.setEnabled(currentMode().key === 'space');
      applyDifficulty(i);
      resetMatch();
      return;
    }
  }
}
```

- [ ] **Step 3: drawMenu 插入模式卡绘制（副标题徽章之后、难度按钮之前）**

```js
  // 模式选择（Memphis 贴纸卡，与难度卡同风格）
  const modes = modeButtonRects();
  const modeCols = [PALETTE.blue, PALETTE.sun];
  for (let i = 0; i < modes.length; i++) {
    const b = modes[i];
    const isCur = i === state.modeIndex;
    const col = modeCols[i % modeCols.length];

    // 硬阴影（贴纸凸起）
    noStroke();
    fill(PALETTE.ink);
    rect(b.x + 5, b.y + 5, b.w, b.h, 12);

    // 卡片主体：白底 + 彩描边
    fill(PALETTE.card);
    stroke(isCur ? col : PALETTE.ink);
    strokeWeight(isCur ? 4 : 3);
    rect(b.x, b.y, b.w, b.h, 12);

    // 小图标（左上角）
    noStroke();
    if (b.data.key === 'classic') {
      // 两块对峙的板子
      fill(PALETTE.teal);
      rect(b.x + 14, b.y + 13, 5, 13, 2);
      fill(PALETTE.coral);
      rect(b.x + 23, b.y + 13, 5, 13, 2);
    } else {
      // 像素小飞船
      fill(PALETTE.ink);
      rect(b.x + 13, b.y + 13, 18, 11, 2);
      fill(PALETTE.blue);
      rect(b.x + 15, b.y + 15, 12, 7, 1);
      fill(PALETTE.sun);
      rect(b.x + 17, b.y + 17, 3, 3);
    }

    // 名称 + 描述
    noStroke();
    fill(PALETTE.ink);
    textSize(20);
    text(b.data.name, b.x + b.w / 2, b.y + b.h / 2 - 10);
    fill(PALETTE.inkSoft);
    textSize(10.5);
    text(b.data.desc, b.x + b.w / 2, b.y + b.h / 2 + 14);

    // 当前选中标记：右上角黑底胶囊徽章
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
```

- [ ] **Step 4: HUD 信息条加模式名**

```js
  text(
    `${currentMode().name} · ${currentDifficulty().name} · 先到 ${CONFIG.game.winScore} 分 · 回合 ${state.rallyHits} 拍`,
    cx, 16
  );
```

- [ ] **Step 5: 语法校验**

```bash
node --check duel-balls/main.js
```
预期：无输出。

- [ ] **Step 6: 浏览器验证**

菜单出现两张模式卡（点「太空模式」仅切换选中 + 出现「当前」徽章，不开局）；点难度卡开局后 HUD 顶部显示「太空模式 · …」；普通模式流程不变。

- [ ] **Step 7: Commit**

```bash
git add duel-balls/main.js
git commit -m "feat(duel-balls): 菜单新增普通/太空模式选择与 HUD 模式显示"
```

---

### Task 3: 对局集成——飞船生成、撞击与兜底

**Files:**
- Modify: `duel-balls/main.js`
- Modify: `duel-balls/render.js`

**Interfaces:**
- Consumes: `Ships.{init, update, draw, reset, hit, getVx, forEachRect}`、`pair.collision.normal`（Matter 0.20）
- Produces: 完整太空模式玩法；`Render.drawBackground(stars)` 星点变体

- [ ] **Step 1: setup 初始化 + RALLY 接入 Ships.update**

`setup()` 中 `Input.bind(this);` 后加：

```js
  Ships.init(this);
```

`draw()` 的 RALLY 分支改为：

```js
    case GAME_STATE.RALLY:
      updatePaddles();
      Ships.update();          // 先移动飞船，再推进物理（碰撞用最新位置）
      Physics.step(dt);
      updateGame();
      renderGame();
      break;
```

- [ ] **Step 2: rebuildBodies / scorePoint / resetMatch 清空飞船**

`rebuildBodies()` 函数体首行插入：

```js
  // 先清飞船（此时 Physics.remove 仍指向旧世界）
  Ships.reset();
```

`scorePoint()` 与 `resetMatch()` 函数体首行各插入：

```js
  Ships.reset();
```

- [ ] **Step 3: 注册碰撞 + 新增 onShipHit**

`registerCollisions()` 追加：

```js
  Physics.onPair('ball', 'ship', onShipHit);
```

`onPaddleHit` 之后新增：

```js
// 击中飞船：镜面反弹 + 飞船动量叠加（设计文档 §5）
function onShipHit(bodyA, bodyB, pair) {
  const shipBody = bodyA.label === 'ship' ? bodyA : bodyB;
  const G = CONFIG.game;
  const S = CONFIG.space;

  // 1) Matter 已完成镜面反射（restitution=1），在其结果上叠加飞船横移动量
  let vx = ball.velocity.x + Ships.getVx(shipBody) * S.momentumTransfer;
  let vy = ball.velocity.y;

  // 2) 速度归一：撞击不改变回合节奏
  const speed = state.ballSpeed;
  const mag = Math.hypot(vx, vy) || 1;
  vx = (vx / mag) * speed;
  vy = (vy / mag) * speed;

  // 3) 竖直分量下限：防水平死球（与 onPaddleHit 同款保障）
  const minVy = speed * G.minVerticalRatio;
  if (Math.abs(vy) < minVy) {
    const sign = vy === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(vy);
    vy = minVy * sign;
    const remain = Math.sqrt(Math.max(0, speed * speed - vy * vy));
    vx = Math.sign(vx || 1) * remain;
  }
  Matter.Body.setVelocity(ball, { x: vx, y: vy });

  // 4) 沿碰撞法线弹出（方向校正为指向球），防同帧重复触发/粘滞
  let nx = pair.collision.normal.x;
  let ny = pair.collision.normal.y;
  const toBallX = ball.position.x - shipBody.position.x;
  const toBallY = ball.position.y - shipBody.position.y;
  if (nx * toBallX + ny * toBallY < 0) { nx = -nx; ny = -ny; }
  const support = (S.physW / 2) * Math.abs(nx) + (S.physH / 2) * Math.abs(ny);
  const dist = support + G.ballRadius + 2;
  Matter.Body.setPosition(ball, {
    x: shipBody.position.x + nx * dist,
    y: shipBody.position.y + ny * dist,
  });

  // 5) 掉血 / 爆炸
  Ships.hit(shipBody);
}
```

- [ ] **Step 4: updateGame 增加飞船挤压兜底**

在「兜底：极端情况下球被挤出左右墙」注释块之前插入（`r` 已在函数内定义）：

```js
  // 飞船挤压兜底：球心落入任一飞船外扩矩形（按球半径外扩）时，沿最短轴弹出
  Ships.forEachRect((x, y, w, h) => {
    const ex = x - r, ey = y - r, ew = w + r * 2, eh = h + r * 2;
    const bx = ball.position.x, by = ball.position.y;
    if (bx <= ex || bx >= ex + ew || by <= ey || by >= ey + eh) return;
    const dl = bx - ex, dr = ex + ew - bx, dt = by - ey, db = ey + eh - by;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) Matter.Body.setPosition(ball, { x: ex, y: by });
    else if (m === dr) Matter.Body.setPosition(ball, { x: ex + ew, y: by });
    else if (m === dt) Matter.Body.setPosition(ball, { x: bx, y: ey });
    else Matter.Body.setPosition(ball, { x: bx, y: ey + eh });
  });
```

- [ ] **Step 5: renderGame 接入星点背景与飞船绘制**

`renderGame()` 首行 `Render.drawBackground();` 改为：

```js
  Render.drawBackground(currentMode().key === 'space' && state.phase !== GAME_STATE.MENU);
```

`drawArena();` 之后、`drawTrail();` 之前插入：

```js
  Ships.draw();
```

- [ ] **Step 6: render.js 星点背景变体**

`drawBackground()` 改签名并增加星点分支，新增 `drawStarfield()`：

```js
  function drawBackground(stars) {
    p.background(PALETTE.paper);
    if (stars) {
      drawStarfield();
      return;
    }
    // Memphis 波点纹理：两层错位圆点网格（对应 docs/DESIGN.md §4）
    // ……以下保持原有两层波点代码不变……
  }

  // 太空模式背景：更淡的墨点网格 + 确定性分布的 accent 星点（静态不闪）
  function drawStarfield() {
    p.noStroke();
    p.fill(22, 22, 22, 30);
    const s = 40;
    for (let y = 0; y < p.height; y += s) {
      for (let x = 0; x < p.width; x += s) {
        if (((x / s) + (y / s)) % 2 === 0) p.circle(x, y, 1.6);
      }
    }
    const cols = [PALETTE.teal, PALETTE.blue, PALETTE.pink, PALETTE.coral, PALETTE.sun];
    for (let y = 0; y < p.height; y += s) {
      for (let x = 0; x < p.width; x += s) {
        // 网格坐标哈希：位置与颜色确定，避免逐帧闪烁
        const h = (((x / s) * 73856093) ^ ((y / s) * 19349663)) >>> 0;
        if (h % 13 !== 0) continue;
        p.fill(cols[(h >>> 8) % cols.length]);
        p.rect(x + ((h >>> 4) % 34) + 2, y + ((h >>> 12) % 34) + 2, 2.5, 2.5);
      }
    }
  }
```

- [ ] **Step 7: 语法校验**

```bash
node --check duel-balls/main.js && node --check duel-balls/render.js
```
预期：无输出。

- [ ] **Step 8: 浏览器端到端验证**

太空模式开局发球后：约 1.2s 出现首艘飞船（不同线路、随机方向、匀速）；球撞飞船后变向（镜面 + 动量）且球速不变；连撞 3 次同艘飞船后爆炸（粒子四散），约 1s 后补位；场上同时不超过 2 艘；得分后飞船清空。普通模式无飞船、背景为波点。控制台无报错。

- [ ] **Step 9: Commit**

```bash
git add duel-balls/main.js duel-balls/render.js
git commit -m "feat(duel-balls): 太空模式对局集成——飞船生成、撞击变向与挤压兜底"
```

---

### Task 4: 菜单太空贴纸、注册信息与端到端验收

**Files:**
- Modify: `duel-balls/main.js`
- Modify: `index.html`（仓库根）

**Interfaces:**
- Consumes: `Ships.drawSprite(x, y, scale, colorKey, dir, hp, flameColor, flash)`
- Produces: 菜单太空选中态贴纸；首页注册信息更新

- [ ] **Step 1: drawMenu 选中太空时追加像素飞船贴纸**

`drawMenu()` 中 `drawMenuShapes();` 之后插入：

```js
  // 选中太空模式时，菜单追加一艘像素飞船贴纸（旋转 -4°）
  if (currentMode().key === 'space') {
    push();
    translate(width * 0.32, height * 0.16);
    rotate(radians(-4));
    Ships.drawSprite(0, 0, 5, 'blue', 1, CONFIG.space.shipHP, PALETTE.coral, false);
    pop();
  }
```

- [ ] **Step 2: 根 index.html 注册信息更新**

GAMES 数组中 duel-balls 条目的 desc 与 tags 改为：

```js
        desc: '上下分屏类 Pong 双人对战，板子接球回击；太空模式下有巡逻飞船改变球路。',
        tags: ['对战', 'Pong', '难度', '太空'],
```

- [ ] **Step 3: 语法校验**

```bash
node --check duel-balls/main.js
```
预期：无输出。

- [ ] **Step 4: 端到端验收（浏览器）**

1. 打开 `duel-balls/index.html`：控制台无报错；菜单模式行与难度行布局正确。
2. 选「太空模式」：菜单出现像素飞船贴纸；点难度开局。
3. 完整对打一局：飞船节奏/数量/线路/变向/血量/爆炸符合 spec；HUD 显示模式名。
4. 窗口缩到 320px 宽：菜单两行卡片不重叠不破版。
5. 切回普通模式开局：无飞船、波点背景、行为与改动前一致。
6. 打开根 `index.html`：duel-balls 卡片描述已更新。

- [ ] **Step 5: Commit**

```bash
git add duel-balls/main.js index.html
git commit -m "feat(duel-balls): 菜单太空贴纸与首页注册信息更新"
```

---

## Self-Review 记录

- **Spec 覆盖**：§3.1-3.5 生成/线路/撞击/耐久/难度组合 → Task 1/3；§4 菜单与 HUD → Task 2；§5 物理处理（含法线弹出、挤压兜底）→ Task 3；§6 视觉（sprite/火焰/爆炸/星点/贴纸/绘制顺序）→ Task 1/3/4；§7 文件结构 → 全部任务；§8 边界（resize 重建、回合清空、挤压自愈）→ Task 3；§9 验收 → Task 4 Step 4。无缺口。
- **占位符**：无 TBD/TODO；render.js Step 6 中「保持原有波点代码不变」指保留现有实现（非新代码占位）。
- **类型一致性**：`Ships.drawSprite(x, y, scale, colorKey, dir, hp, flameColor, flash)` 与 Task 1 定义、Task 4 调用一致；`forEachRect(fn(x, y, w, h))` 与 Task 3 兜底调用一致；`pair.collision.normal` 已对照 Matter 0.20.0 本地文件确认存在。
