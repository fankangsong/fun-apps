# AGENTS.md

本仓库是纯静态的小游戏 / 交互可视化合集（每个子目录一个独立应用）。所有开发工作必须遵守以下规范。

## 技术栈（强制）

- **仅使用原生 HTML / CSS / JavaScript**，不依赖任何打包、编译、构建步骤：
  - 禁止引入 npm、Webpack、Vite、esbuild 等构建工具或 `node_modules`
  - 禁止使用 TypeScript、JSX、Sass、PostCSS 等需要编译的语言
  - 禁止使用 Vue / React 等框架
- **第三方库只能通过 CDN `<script>` 标签引入**，且必须固定版本号（如 `p5.js/1.11.3`），优先使用 BootCDN 等国内可达 CDN：
  - 渲染：p5.js（引入后设置 `p5.disableFriendlyErrors = true;`）
  - 物理：Matter.js
- JS 语法保持浏览器可直接运行：不使用 import/export 模块，多文件时按依赖顺序用多个 `<script>` 标签加载（惯例：`config → state → physics → input → render → main`）。
- 应用必须**双击 HTML 文件即可离线运行**（CDN 除外），无需本地服务器。

## 设备兼容（强制，基准：iPad Safari + 手机 Safari/Chrome）

### 目标环境矩阵（所有页面必须全绿）

| 环境 | 逻辑宽度 | 输入方式 |
|---|---|---|
| iPhone Safari / 微信竖屏 | **320~430px**（SE 至 Pro Max） | 触摸（单指/多指） |
| iPhone Safari 横屏 | 568~932px，**高度低至 320px** | 同上 |
| Android 手机 Chrome 竖屏 | 320~412px（DPR 2~3.5） | 触摸 |
| iPad Safari 竖屏 | 768~1024px | 触摸（单指/多指/Apple Pencil） |
| iPad Safari 横屏 | 1024~1366px | 同上 |
| iPad 分屏 1/3 ~ 2/3 | **320~640px** | 同上 |
| Android 平板 Chrome | ≥600px | 触摸 |
| 桌面 Chrome / Edge / Safari / Firefox | ≥1280px | 鼠标 + 键盘 |

> 关键约束：手机与 iPad 分屏模式下页面宽度均可低至 **320px**，任何"平板布局"不得假设宽度 ≥768px，必须按 320px 起步设计。桌面端窗口同样可自由缩小，布局实际需覆盖 320px ~ 超宽全区间。
> 手机端额外基准：典型 DPR 为 **2~3（iPhone Pro Max 为 3x）**，`devicePixelRatio` 最高按 3 规划；竖屏可视为默认形态，横屏是需单独验证的形态（高度可低至 320px）。

### 布局适配方案

1. `<head>` 必须包含：
   ```html
   <meta charset="UTF-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
   <meta name="apple-mobile-web-app-capable" content="yes">
   ```
   注：iOS 10+ 可能忽略 `user-scalable=no`，缩放阻断的实际保障见《Safari / iOS 行为差异规避》一节。
2. **禁用裸 `100vh`**（Safari 地址栏伸缩会导致高度跳变），改用 `html, body { height: 100%; }` 链式继承，或 `100dvh` 带 fallback：
   ```css
   .stage { height: 100vh; height: 100dvh; }
   ```
3. 安全区：`viewport-fit=cover` 下，固定定位容器必须用 `env(safe-area-inset-*)` 留白，防止刘海/Home 指示条遮挡：
   ```css
   .stage {
     position: fixed; inset: 0;
     padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0)
              env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
   }
   ```
4. 画布自适应：p5 在 `windowResized()` 中调用 `resizeCanvas(innerWidth, innerHeight)`；iPad 旋转、分屏拖动都会触发 resize，必须无残留、无变形。物理场景若含固定墙/边界体，resize 时必须同步 `Body.setPosition` 或重建，否则物体会飞出可视区。
5. 高分屏清晰度：保持 p5 默认 `pixelDensity(displayDensity())`；手写 canvas 必须按 `devicePixelRatio` 放大实际像素再缩放坐标系，否则 iPad 上模糊。
   - **手机端性能上限**：3x DPR 手机上全屏画布的实际像素可达约 1290×2796，填充率极高。手写 canvas 应 `dpr = Math.min(devicePixelRatio, 2)` 封顶（视觉差异肉眼难辨，帧率收益显著）；p5 项目若在低端手机掉帧，同样用 `pixelDensity(Math.min(displayDensity(), 2))` 降级。
6. 字号/间距用 `clamp()`（如 `font-size: clamp(14px, 2.5vw, 18px)`）；触控目标 ≥44×44px 且间距 ≥8px；全屏游戏页 `html, body { overflow: hidden; }`，画布 `display: block`。
   - 手机上的最小值即上限约束：`clamp()` 的 **min 值必须 ≤ 14px**（否则 320px 宽下溢出换行）；正文不小于 13px，说明文字不小于 11px。
   - 触控目标在手机上建议提升至 **≥48×48px、间距 ≥12px**（对齐 Android Material 48dp / iOS 44pt 双标准），拍平板可维持 44px 基准。
7. 性能与帧率（手机 CPU/GPU 仅为桌面零头）：
   - 目标 **60fps，最低可接受 30fps**；掉帧时的第一降级手段是降 `pixelDensity`，其次减少粒子和阴影绘制，禁止直接砍玩法。
   - 每帧避免创建对象（复用数组/对象池）；`draw` 循环内禁止 DOM 查询与 `getBoundingClientRect`。
   - CSS 动画优先 `transform`/`opacity`，手机上避免大面积 `filter`、`box-shadow` 叠加与持续运行的 `background-position` 动画。
   - `prefers-reduced-motion` 降级同样对手机省电有效，必须保留。

### 触摸与指针输入方案

1. **首选 Pointer Events**（`pointerdown/pointermove/pointerup/pointercancel`），以 `e.pointerId` 跟踪每一根手指，up/cancel 时必须对称清理：
   ```js
   const pointers = new Map(); // pointerId -> {x, y}
   canvas.addEventListener('pointerdown', (e) => {
     pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
     canvas.setPointerCapture(e.pointerId);
   });
   canvas.addEventListener('pointermove', (e) => {
     if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
   });
   const release = (e) => pointers.delete(e.pointerId);
   canvas.addEventListener('pointerup', release);
   canvas.addEventListener('pointercancel', release); // 手势被系统打断（来电/切后台）
   ```
   p5 项目中画布是自动创建的：在 `setup()` 里用 `window.canvas`（或 `document.querySelector('canvas')`）拿到元素后再绑定上述原生事件，与 p5 的 `draw` 循环共存。
   若使用 p5 的 `mouse*` 事件，注意 p5 只把**第一根手指**映射为 mouse——双人/多指游戏必须读 `touches[]` 数组。
2. `touch-action` 分区控制（不要全页一刀切，可滚动页面会失效）：
   - 游戏画布区域：`touch-action: none`（阻断滚动/缩放/双击）
   - 可滚动列表/文档页：`touch-action: pan-y`
   - 按钮、卡片等可点元素：`touch-action: manipulation`（消灭双击缩放延迟）
3. 原生 touch 监听若需 `preventDefault()`，必须显式声明 `{ passive: false }`，否则 iOS 上静默失效：
   ```js
   canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
   ```
4. 长按系统行为与回弹的 CSS 兜底：
   ```css
   html, body {
     -webkit-touch-callout: none;
     -webkit-user-select: none;
     user-select: none;
     overscroll-behavior: none;
   }
   ```
5. hover 只能作为桌面增强效果，不得承载功能；所有交互必须有触摸路径。

### Safari / iOS 行为差异规避

- **iOS 10+ 可能忽略 `user-scalable=no`**：双指缩放靠画布 `touch-action: none` 阻断，双击缩放靠可点元素的 `manipulation`，不要只依赖 meta。
- `overscroll-behavior` 需 Safari 16+；需兼容更老版本时用第 3 条的 `touchmove preventDefault` 兜底。
- **音频自动播放限制**：`AudioContext` 必须在 `pointerdown`/`touchstart` 等用户手势回调中创建或 `resume()`，音效播放器在首次手势时统一解锁。
- **后台标签页 rAF 暂停**：用 `document.visibilitychange` 暂停游戏循环，恢复时按 `deltaTime`（时间增量）推进，禁止按帧数累加，防止切回后瞬移。
- 需要 `-webkit-` 前缀的属性（渐变文字 `-webkit-background-clip: text`、`-webkit-touch-callout` 等）必须同时写标准写法与前缀写法。

### 手机端专项适配（UI 具体描述）

以下描述按"竖屏手机"为默认形态给出落地形态，全部为强制项：

1. **竖屏单列布局**：`< 480px` 视口下一律单列（卡片、表单、设置项），禁止出现横向滚动或多列网格；游戏 HUD（分数、计时）压缩为顶部一行小胶囊，字号 `clamp(11px, 3vw, 13px)`。
2. **拇指热区优先**：核心操作按钮（跳跃/发射/确认）固定在**屏幕下半部拇指易达区**（距底边 `48px + env(safe-area-inset-bottom)` 以内），左右分置的按钮间距 ≥ 16px 防误触；仅桌面或 iPad 使用的悬浮工具栏在手机上必须收进底部栏或汉堡菜单。
3. **手机横屏（高度 ≤ 400px）**：HUD 移到左右两侧竖排，操作按钮贴左右下角；标题缩为一行小字或隐藏，把垂直空间全部让给画布。用 `@media (max-height: 480px) and (orientation: landscape)` 触发该形态。
4. **游戏画布形态**：竖屏手机上画布占满视口（扣除 HUD/底栏），玩法核心区（如跳跃平台、球桌边界）必须完整落在竖屏可视范围内，禁止"需要横屏才能玩"的强制旋转；确需横屏的玩法必须提供竖屏替代视角或明确引导层。
5. **命中容差放大**：手指点击精度远低于鼠标，游戏内点击/拖拽判定半径在触屏上放大 **1.5 倍**（判定原始半径 ×1.5 或至少 +8px 容差），拖拽热区同理；判定用 `pointerType === 'touch'` 区分。
6. **全屏遮罩式菜单**：手机上的暂停/结算/帮助用**全屏或近全屏遮罩卡片**（居中 + 半透明背景），按钮竖向堆叠 ≥ 3 个；避免桌面式小浮窗（在 320px 宽下极易溢出）。
7. **减少装饰、保留风格**：小屏上 Memphis 装饰图形数量减半、缩至 72%（与 DESIGN.md §7 一致），波点背景保持（纯 CSS 无性能负担）；任何装饰不得遮挡 44px 触控热区。
8. **键盘不可依赖**：手机无键盘/鼠标，全部功能必须纯触摸可达；桌面键盘增强（空格跳跃等）需在手机上有等价按钮（如全屏大的"跳跃"按钮）。
9. **滚动页面的底部余量**：可滚动页面底部预留 `padding-bottom: calc(24px + env(safe-area-inset-bottom))`，防止最后一张卡片被 Home 指示条遮住。

### 屏幕方向兼容（声明 + 全屏旋转提示）

每个应用必须**显式声明**自己的方向兼容能力，并据此决定是否向用户展示"请旋转设备"全屏提示层：

1. **方向声明**：每个应用入口 HTML 的主 `<script>` 顶部声明一个全局常量：
   ```js
   const ORIENTATION = 'auto'; // 'portrait' | 'landscape' | 'auto'
   ```
   - `'portrait'`：仅竖屏可玩（如竖版跳跃、下落类）。
   - `'landscape'`：仅横屏可玩（如左右对战、宽幅场景类）。
   - `'auto'`：横竖屏都完整适配（响应式 HUD 自适应，见上文"手机横屏"条目），**不显示任何提示**。

2. **提示层行为**：当 `ORIENTATION` 与当前设备方向不匹配时（如声明 `'landscape'` 而用户竖屏，或声明 `'portrait'` 而用户横屏），展示**全屏遮罩**提示用户旋转设备；方向匹配后立即自动消失，无需点击：
   ```html
   <div id="rotate-tip" hidden>
     <div class="tip-card">
       <div class="tip-phone"></div> <!-- CSS 绘制的旋转手机示意图 -->
       <p>请旋转设备<span id="rotate-dir"></span></p>
     </div>
   </div>
   ```
   ```css
   #rotate-tip { position: fixed; inset: 0; z-index: 99; display: grid; place-items: center;
     background: var(--paper); padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0)
     env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0); }
   ```
   ```js
   (function () {
     if (ORIENTATION === 'auto') return;
     var tip = document.getElementById('rotate-tip');
     var dir = document.getElementById('rotate-dir');
     function check() {
       var portrait = matchMedia('(orientation: portrait)').matches;
       var need = (ORIENTATION === 'landscape') === portrait; // 声明与现状不匹配
       tip.hidden = !need;
       if (dir) dir.textContent = need ? (ORIENTATION === 'landscape' ? '至横屏' : '至竖屏') : '';
     }
     matchMedia('(orientation: portrait)').addEventListener('change', check);
     window.addEventListener('resize', check);
     check();
   })();
   ```
   实现要点：
   - 提示层出现时**必须暂停游戏循环**（复用 `document.visibilitychange` 的暂停逻辑），防止后台继续掉命/计时。
   - 仅手机/平板生效：桌面宽窗口（如 `min-width: 1024px`）即使方向"不匹配"也不提示，因为桌面没有旋转一说，`'landscape'` 应用在桌面直接可用。
   - 判断用 CSS 媒询 `(orientation: portrait)` 而非 `innerWidth < innerHeight` 手写比较（旋转过渡期更稳定）；旋转动画期间以 `resize`/`change` 事件的双保险刷新。
   - 提示层文案必须中文（如"请旋转设备至横屏"），视觉遵循设计规范（纸色底 + 黑描边贴纸卡，手机示意图可用 CSS 旋转动画示意）。
   - 不使用 `screen.orientation.lock()`（iOS Safari 不支持，Android 上需全屏 PWA），提示层是唯一手段。

3. **注册约定**：`index.html` 的 `GAMES` 数组需同步追加 `orientation` 字段（`'portrait' | 'landscape' | 'auto'`），与页面内 `ORIENTATION` 常量保持一致，卡片标签区可据此显示"竖屏/横屏/自适应"角标，帮助用户进入前预知形态。

### 桌面端等价操作

- 全部核心玩法必须可仅用鼠标完成（Pointer Events 天然同时覆盖鼠标与触摸）。
- 键盘为可选增强（方向键/空格等），不可作为唯一输入。
- 可聚焦元素提供 `:focus-visible` 焦点样式，保证 Tab 键可达。

### 验收测试（提交前必过）

- 真机 iPhone / Android 手机（或 DevTools 320~430px 模拟 + 真机抽检）：竖屏完成全部核心玩法；横屏再过一遍，HUD 与按钮不遮挡、不溢出。
- 方向提示验证：用错误方向打开声明了 `portrait` / `landscape` 的应用，出现全屏提示且游戏暂停；旋转至正确方向后提示自动消失、游戏恢复；`auto` 应用任意方向均无提示；桌面宽窗口下任何声明都不提示。
- 手机上单手（拇指）可触达并完成全部核心操作；底部按钮不被 Home 指示条遮挡。
- 真机 iPad Safari：横竖屏各旋转一次；分屏拖到 1/3 与 2/3 宽，布局不破、画布正确重排。
- 真机触摸完成全部核心玩法：无仅限鼠标 / hover 的功能路径。
- 真机双指同时操作（如双人各控制一指）：互不干扰，页面不发生缩放/滚动。
- 长按任意 UI 元素：不弹系统菜单、不选中文本。
- 手机上连续游戏 3 分钟：无明显发热掉帧（< 30fps）；后台切回进度不瞬移。
- 桌面 Chrome：纯鼠标完成全部核心操作，控制台无报错。
- DevTools 设备模拟只能验证布局，**手势与多点触控必须真机验证**；有 Mac 时可用 Safari 开发菜单远程调试 iPad / iPhone。

## 目录与入口约定

- 每个应用放在仓库根目录下的独立文件夹中（如 `duel-balls/`），入口为该目录下的 `.html` 文件。
- 新增应用后，必须在根目录 `index.html` 的 `GAMES` 数组中追加注册项（`dir / entry / icon / name / desc / tags / orientation`），`orientation` 取值与页面内 `ORIENTATION` 常量一致（见《屏幕方向兼容》）。
- 页面统一中文（`lang="zh-CN"`、中文 UI 文案），视觉风格遵循下文《设计规范》。

## 设计规范（docs/DESIGN.md）

- 所有页面 / 应用的视觉设计**必须遵循 [docs/DESIGN.md](docs/DESIGN.md)**（Memphis 风格设计系统：设计 Tokens、波点背景、图形库、贴纸卡片、动效与响应式规范），上线前过一遍文末《应用检查清单》。
- 参考实现：根目录 `index.html`（首页，标准范例）；风格源文件 `docs/simple.html`（只读参考，勿改）。

## 提交前自检（总入口）

- [ ] 双击 HTML 可直接运行，控制台无报错
- [ ] 已通过上文《验收测试》全部真机项（含手机竖屏/横屏）
- [ ] 已按《手机端专项适配》完成小屏 UI 落地（单列、拇指热区、命中容差、横屏形态）
- [ ] 已声明 `ORIENTATION` 并实现方向不匹配时的全屏旋转提示（`auto` 应用除外），`GAMES` 注册含 `orientation` 字段
- [ ] 已在 `index.html` 注册新应用（如新增）
- [ ] 视觉设计符合《设计规范》（docs/DESIGN.md）的应用检查清单
