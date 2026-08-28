# AGENTS.md

本仓库是纯静态的小游戏 / 交互可视化合集（每个子目录一个独立应用）。所有开发工作必须遵守以下规范。

## 技术栈（强制）

- **仅使用原生 HTML / CSS / JavaScript**，不依赖任何打包、编译、构建步骤：
  - 禁止引入 npm、Webpack、Vite、esbuild 等构建工具或 `node_modules`
  - 禁止使用 TypeScript、JSX、Sass、PostCSS 等需要编译的语言
  - 禁止使用 Vue / React 等框架
- **第三方库优先通过本地 `<script>` 标签引入**：统一存放在仓库根 `assets/` 目录（如 `assets/p5.min.js`），应用内以相对路径引用（如 `../assets/p5.min.js`），保证双击 HTML 即可完全离线运行：
  - 渲染：p5.js（引入后设置 `p5.disableFriendlyErrors = true;`）→ 本地 `assets/p5.min.js`
  - 物理：Matter.js → 本地 `assets/matter.min.js`
  - 引入新库时：下载**固定版本**的压缩版（如 `p5.js/1.11.3`）提交到 `assets/`，不得改动其文件内容
  - 仅当库无法本地化时才允许 CDN `<script>` 兜底，且同样必须固定版本号，优先使用 BootCDN 等国内可达 CDN
- JS 语法保持浏览器可直接运行：不使用 import/export 模块，多文件时按依赖顺序用多个 `<script>` 标签加载（惯例：`config → state → physics → input → render → main`）。
- 应用必须**双击 HTML 文件即可完全离线运行**（第三方库一律走本地 `assets/`，不依赖网络），无需本地服务器。

## 设备兼容（强制，基准：iPad Safari）

### 目标环境矩阵（所有页面必须全绿）

| 环境 | 逻辑宽度 | 输入方式 |
|---|---|---|
| iPad Safari 竖屏 | 768~1024px | 触摸（单指/多指/Apple Pencil） |
| iPad Safari 横屏 | 1024~1366px | 同上 |
| iPad 分屏 1/3 ~ 2/3 | **320~640px** | 同上 |
| Android 平板 Chrome | ≥600px | 触摸 |
| 桌面 Chrome / Edge / Safari / Firefox | ≥1280px | 鼠标 + 键盘 |

> 关键约束：iPad 分屏模式下页面宽度可低至 **320px**，"平板布局"不得假设宽度 ≥768px，必须按 320px 起步设计。桌面端窗口同样可自由缩小，布局实际需覆盖 320px ~ 超宽全区间。

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
6. 字号/间距用 `clamp()`（如 `font-size: clamp(14px, 2.5vw, 18px)`）；触控目标 ≥44×44px 且间距 ≥8px；全屏游戏页 `html, body { overflow: hidden; }`，画布 `display: block`。

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

### 桌面端等价操作

- 全部核心玩法必须可仅用鼠标完成（Pointer Events 天然同时覆盖鼠标与触摸）。
- 键盘为可选增强（方向键/空格等），不可作为唯一输入。
- 可聚焦元素提供 `:focus-visible` 焦点样式，保证 Tab 键可达。

### 验收测试（提交前必过）

- 真机 iPad Safari：横竖屏各旋转一次；分屏拖到 1/3 与 2/3 宽，布局不破、画布正确重排。
- 真机触摸完成全部核心玩法：无仅限鼠标 / hover 的功能路径。
- 真机双指同时操作（如双人各控制一指）：互不干扰，页面不发生缩放/滚动。
- 长按任意 UI 元素：不弹系统菜单、不选中文本。
- 桌面 Chrome：纯鼠标完成全部核心操作，控制台无报错。
- DevTools 设备模拟只能验证布局，**手势与多点触控必须真机验证**；有 Mac 时可用 Safari 开发菜单远程调试 iPad。

## 目录与入口约定

- 每个应用放在仓库根目录下的独立文件夹中（如 `duel-balls/`），入口为该目录下的 `.html` 文件。
- 新增应用后，必须在根目录 `index.html` 的 `GAMES` 数组中追加注册项（`dir / entry / icon / name / desc / tags`）。
- 页面统一中文（`lang="zh-CN"`、中文 UI 文案），视觉风格遵循下文《设计规范》。

## 设计规范（docs/DESIGN.md）

- 所有页面 / 应用的视觉设计**必须遵循 [docs/DESIGN.md](docs/DESIGN.md)**（Memphis 风格设计系统：设计 Tokens、波点背景、图形库、贴纸卡片、动效与响应式规范），上线前过一遍文末《应用检查清单》。
- 参考实现：根目录 `index.html`（首页，标准范例）；风格源文件 `docs/simple.html`（只读参考，勿改）。

## 提交前自检（总入口）

- [ ] 双击 HTML 可直接运行，控制台无报错
- [ ] 已通过上文《验收测试》全部真机项
- [ ] 已在 `index.html` 注册新应用（如新增）
- [ ] 视觉设计符合《设计规范》（docs/DESIGN.md）的应用检查清单
