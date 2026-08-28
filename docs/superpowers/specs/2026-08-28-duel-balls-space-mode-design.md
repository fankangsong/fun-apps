# 双人对撞球「太空模式」设计文档

- 日期：2026-08-28
- 状态：已确认（用户已批准玩法设计）
- 范围：`duel-balls/` 新增太空模式玩法；普通模式行为保持零变化
- 关联规范：[docs/DESIGN.md](../../DESIGN.md)（Memphis 视觉规范）、仓库 [AGENTS.md](../../AGENTS.md)（技术栈与设备兼容）

## 1. 背景与目标

双人对撞球（类 Pong 上下分屏对战）当前玩法为纯双人对拍。本设计新增可选择的「太空模式」：
场地中间带不时有像素风格飞船匀速横穿，球撞飞船会发生变向。飞船是**双方共用的中立障碍**，
乐趣在于「借船打球」与「船挡救球」的博弈。得分规则（漏球对方得分、先到 `winScore` 胜、
失分方发球）完全不变。

## 2. 已确认的玩法决策

| 决策点 | 结论 |
|---|---|
| 球撞飞船的变向方式 | **镜面反弹 + 叠加飞船横移动量**（类似板子切球：迎面飞来的飞船把球撞得更斜） |
| 飞船耐久 | **每艘 3 点血**，受击闪白、舷窗熄灭，血量耗尽后像素爆炸销毁，随后补位 |

## 3. 玩法规则

### 3.1 生成与线路

- 仅在太空模式且 `RALLY` 阶段生成；`SERVE` / `SCORED` / `GAMEOVER` / `MENU` 阶段不生成。
- 回合开始（发球进入 `RALLY`）后 `initialDelay`（75 帧 ≈ 1.25s）出现第一艘；
  此后每当生成计时器归零（间隔 `spawnDelayMin~Max`，150~240 帧 ≈ 2.5~4s 随机）尝试生成。
- 生成条件（同时满足）：场上飞船数 < `maxShips`（2）；存在空闲线路。
- 线路：中场 4 条水平航线，y = 场地高 × `[0.30, 0.42, 0.58, 0.70]`；
  **同一线路（含入场中）同时最多 1 艘**。
- 每次生成：从空闲线路随机挑一条；方向随机（左场外入场向右飞 / 右场外入场向左飞，各 50%）；
  船体色从色板随机（teal / blue / pink / coral）。
- 飞船被摧毁后，生成计时器缩短为 `refillDelay`（60 帧 ≈ 1s），加速补位。

### 3.2 移动

- 匀速直线横移，速度 = 当前难度的 `shipSpeed`（简单 2.6 / 普通 3.4 / 困难 4.3 px/步），
  远慢于球速，保证可反应。
- 船身完全越过对侧边界外 `despawnMargin`（60px）即销毁刚体、释放线路。

### 3.3 撞击与变向

球撞飞船 = **镜面反弹 + 动量叠加**，处理序列见 §5。关键规则：

- 球速大小不变：碰撞后 |v| 归一为 `state.ballSpeed`，飞船撞击**不加速、不计入回击拍数**
  （`rallyHits` 仅由板子击球累加）。
- 竖直分量下限：复用现有 `minVerticalRatio`（0.35），防止球被撞成水平死球卡死回合。
- 击毁飞船不奖励分数（中立障碍，双方共用）。

### 3.4 飞船耐久与爆炸

- 每艘 `shipHP`（3）点血；船身 3 个舷窗像素即血条（亮 = 有血，按船头侧向船尾顺序熄灭）。
- 受击：整体闪白 `hitFlashFrames`（6 帧）。
- 血量耗尽：像素爆炸（见 §6.2），销毁刚体、释放线路，触发补位计时。

### 3.5 模式与难度组合

- 菜单先选模式（普通 / 太空），再点难度开局；模式 × 三档难度自由组合。
- 难度在太空模式下额外控制船速（`shipSpeed`）；板长 / 球速 / 加速规则两模式一致。

## 4. 菜单与 HUD

- 菜单在副标题与难度按钮之间新增一排两张**模式贴纸卡**（与难度卡同风格：硬阴影、
  色点、选中彩描边 + 「当前」徽章）：普通模式（小图标：两块对峙的板子）、
  太空模式（小图标：像素飞船）。
- 交互差异：**点模式卡只切换选中、不开局**（选中态即时刷新，选中太空时菜单散落
  贴纸装饰中追加一艘像素飞船）；点难度卡 = 以当前模式 + 难度开局。
- 布局：模式卡 `w = min(220, (width - 72) / 2)`、`h = 72`、间距 20px、水平居中，
  行顶 y = `height/2 - 58`（行体跨度 `height/2-58 ~ height/2+14`）；
  难度按钮行整体下移至 y = `height/2 + 34`——与模式行、副标题徽章
  （底边 `height/2-78`）各留约 20px 间距，320px 分屏宽度下不重叠、不破版。
- HUD 顶部信息条加入模式名：「太空模式 · 普通 · 先到 5 分 · 回合 N 拍」。

## 5. 撞击物理处理（实现规格）

**技术路线**：飞船 = Matter 静态矩形刚体（与板子同款 kinematic 风格，每帧 `setPosition`），
`label = 'ship'`，走现有 `Physics.onPair` 碰撞分发。与现有架构同构。

防穿透已验算：60Hz 固定步长下球最大 24px/步，小于球-船接触带宽
（竖直向 ballRadius×2 + physH/2×2 ≈ 28px，水平向 physW/2 + ballRadius + shipSpeed ≈ 38px），
离散采样必然命中，无需 CCD。

`onShipHit(bodyA, bodyB, pair)` 处理序列（main.js，与 `onPaddleHit` 并列）：

1. 取 Matter 镜面反射结果（restitution = 1 天然保速保向，无需重算方向）。
2. 动量叠加：`vx += 飞船横移速度 × momentumTransfer（1.0）`，
   飞船横移速度 = `dir × shipSpeed`（由 `Ships.getVx(body)` 提供）。
3. 速度归一：`|v|` 重设为 `state.ballSpeed`。
4. 竖直分量下限：`|vy| < ballSpeed × minVerticalRatio` 时按原竖直方向补足，
   水平分量按剩余量重算（与 `onPaddleHit` 第 6 步同款逻辑）。
5. 沿碰撞法线弹出球（法线方向校正为「指向球」；弹出距离 = ballRadius + 2），
   防同帧重复触发 / 粘滞。
6. 调 `Ships.hit(body)`：掉血 + 闪白；血尽则爆炸销毁。

**每帧兜底**（main.js `updateGame` 内）：球心若落入任一飞船外扩矩形
（四周各外扩 ballRadius），沿最短轴强制弹出——覆盖「飞船把球挤向墙」等极端挤压场景。

## 6. 视觉设计（遵循 docs/DESIGN.md）

### 6.1 像素飞船

- 13×6 字符画矩阵，`visualScale`（4px）每像素 → 视觉 52×24；
  物理矩形略小：`physW × physH` = 48 × 20（宽容度）。
- 参考 sprite（0 = 透明，1 = ink 描边，2 = 船体色，3 = 舷窗；朝右，朝左时水平镜像；
  实现时可在保持规格——13×6、3 舷窗、ink 描边、尾部火焰位——的前提下微调形状）：

```
'....11.......',
'...1221......',
'112222222211.',
'1223232322221',
'.1222222221..',
'.11..........',
```

- 舷窗亮色 = `PALETTE.sun`，熄灭 = `PALETTE.paper`；按船头侧向船尾顺序熄灭。
- 船体色随机取 `PALETTE.teal / blue / pink / coral`。
- 推进器火焰：尾部（船尾方向外侧）2 帧动画，`flameFlipFrames`（8 帧）切换，
  帧 A = sun、帧 B = coral，约 2×3 像素区域，纯装饰。
- 不额外加投影（与球一致）；ink 描边像素即 Memphis 贴纸语言。

### 6.2 受击与爆炸

- 受击闪白：`hitFlashFrames`（6 帧）内所有非透明像素以 `PALETTE.paper` 绘制。
- 爆炸：10~14 个 4px 方块粒子（颜色 = 船体色 / ink / sun 随机），
  自船心四散（速度 1~3 px/帧随机方向），寿命 18~28 帧，alpha 随寿命衰减，无重力。

### 6.3 背景星点变体

- 仅太空模式对局中生效：`Render.drawBackground(stars)` 增加分支——
  保留墨色点阵网格（alpha 略降），叠加**确定性分布**的 accent 色星点
  （基于网格坐标哈希，静态不闪烁；约每 13 个网格点 1 个，2×2px，
  颜色按哈希轮换 teal/blue/pink/coral/sun）。
- 菜单与普通模式保持现有波点背景不变。

### 6.4 绘制顺序

场地 → **飞船** → 球拖尾 → 板 → 球 → HUD（飞船压在中线/中心圆之上，球压住飞船）。

## 7. 代码结构变更

保持仓库分层惯例，加载顺序 `config → state → physics → input → ships → render → main`
（新增 ships.js 于 physics 之后）。

| 文件 | 变更 |
|---|---|
| **ships.js（新）** | `Ships` 模块（IIFE）：`init(p5)` / `setEnabled(bool)` / `reset()` / `update()` / `draw()` / `hit(body)` / `getVx(body)` / `forEachRect(fn)`。内部维护 `ships[]`（body、laneIndex、dir、speed、hp、colorKey、flamePhase、hitFlash）、线路占用表、爆炸粒子数组；全部数值读 CONFIG |
| config.js | 新增 `modes` 数组与 `defaultMode`；新增 `space` 参数组；每档难度新增 `shipSpeed` |
| state.js | 新增 `modeIndex` 与 `currentMode()` |
| main.js | 菜单模式行（`modeButtonRects()` 绘制与命中共享）；`draw()` RALLY 分支在 `Physics.step` 前插入 `Ships.update()`；`registerCollisions()` 注册 ball-ship；新增 `onShipHit`；`updateGame` 增加挤压兜底；`scorePoint` / `resetMatch` / `rebuildBodies` 中 `Ships.reset()`；HUD 信息条加模式名；`renderGame` 中调用 `Ships.draw()` 与星点背景 |
| render.js | `drawBackground(stars)` 星点变体分支（约 15 行） |
| 根 index.html | GAMES 注册项 desc 修正并提及太空模式，tags 增加「太空」 |

**普通模式零行为变化**：模式未启用时 `Ships.update / draw` 直接 return。

### config.js 新增配置（完整规格）

```js
modes: [
  { key: 'classic', name: '普通模式', desc: '经典对撞 · 无干扰' },
  { key: 'space',   name: '太空模式', desc: '巡逻飞船 · 改变球路' },
],
defaultMode: 0,

space: {
  laneYRatios: [0.30, 0.42, 0.58, 0.70],
  maxShips: 2,
  shipHP: 3,
  physW: 48, physH: 20,
  visualScale: 4,
  spawnDelayMin: 150, spawnDelayMax: 240,
  initialDelay: 75,
  refillDelay: 60,
  momentumTransfer: 1.0,
  despawnMargin: 60,
  hitFlashFrames: 6,
  flameFlipFrames: 8,
},
// difficulties[i] 各新增：shipSpeed: 2.6 / 3.4 / 4.3
```

## 8. 边界与异常

- **resize / 旋转 / 分屏**：`windowResized → rebuildBodies → Ships.reset()`，
  线路 y 随新高度重算；已生成飞船清空，约 `initialDelay` 后重新生成——与板子/墙同一重建路径，无残留。
- **回合切换**：`scorePoint`（含进入 GAMEOVER 的分支）与 `resetMatch` 清空全部飞船与粒子；
  发球时场地必然干净。
- **飞船把球挤向墙**：法线弹出 + minVy + 每帧兜底弹出，三层保障自愈。
- **双指双人 / 键盘操作**：纯增量玩法，输入路径零改动。
- **模式切换**：仅菜单内切换；开局时按所选模式 `Ships.setEnabled(...)`，
  普通模式下 `setEnabled(false)` 会顺带 `reset()`。

## 9. 验收清单

- [ ] 桌面 Chrome：普通模式回归一致（行为与改动前完全相同）；太空模式下飞船
      生成节奏 / 数量上限 / 线路占用 / 匀速横穿 / 撞击变向（镜面 + 动量）/ 血量与爆炸
      全部符合本规格；控制台无报错。
- [ ] 窗口 320px ~ 超宽缩放：菜单模式行 + 难度行不重叠不破版；对局中线路随高度重排、
      resize 后无残影。
- [ ] iPad 真机（AGENTS.md 验收项）：双指对战不受飞船干扰；长按无系统菜单。
- [ ] DESIGN.md 应用检查清单：颜色全部取自 PALETTE token、ink 描边、贴纸语言、
      无裸 100vh 等约束沿用现有实现。
