# 设计规范：Memphis 风格设计系统

> 本文档总结自 `docs/simple.html`（Squiggle Club · Nº 064），并已应用于根目录 `index.html` 首页。
> 所有新页面 / 新应用的视觉设计必须遵循本规范；AGENTS.md 中的《设计规范》一节即指向本文档。

---

## 1. 设计理念

Memphis（孟菲斯）风格，源自 1981 年意大利 Memphis Group（Ettore Sottsass）的后现代设计流派。核心口号：**"no rules · only vibes"（无规则 · 只管好玩）**。

关键词：**高饱和撞色、几何图形拼贴、黑色硬描边 / 硬阴影、纸质感底色、反规则排版（倾斜 / 错位 / 旋转）、俏皮弹跳动效**。

设计心法：

- 形状是主角：页面由"散落的几何贴纸"构成，不追求对称与网格严谨。
- 黑色是骨架：所有彩色图形靠黑色描边 / 阴影压住，避免视觉涣散。
- 彩色只点睛：五色撞色用于图形、阴影、徽章等局部，不做大面积背景。
- 一切都可以被"戳一下"：装饰图形应尽可能有点击反馈（换色 / 旋转）。

---

## 2. 设计 Tokens（CSS 变量，强制）

每个页面 `<style>` 顶部必须声明同一套变量：

```css
:root {
  --paper: #f6f1e7;  /* 纸色：页面底色 */
  --ink:   #161616;  /* 墨黑：文字、描边、黑底块 */
  --coral: #ff6b6b;  /* 珊瑚红 */
  --teal:  #2ec4b6;  /* 青绿 */
  --sun:   #ffd23f;  /* 明黄 */
  --blue:  #3a86ff;  /* 宝蓝 */
  --pink:  #ff8fab;  /* 粉 */
}
```

用色规则：

| 角色 | 取值 | 说明 |
|---|---|---|
| 底色 | `--paper` | 页面 / 卡片底色，营造纸质感 |
| 骨架 | `--ink` | 文字、边框、投影、黑底字幕条 / 徽章 |
| 点睛色 | coral / teal / sun / blue / pink | 只用于图形填充、硬投影、徽章、编号等局部 |
| 弱化文字 | `#6d675c` | 角落标注等次要信息 |

- 同一视图至少出现 **3 种点睛色**撞色。
- 点睛色按索引循环分配（`i % 5`），保证分布均匀。
- 禁止引入色板之外的颜色（白色系 `#fffdf6` 卡片底除外）。

---

## 3. 字体系统

```css
body {
  font-family: "Avenir Next", "Segoe UI", "PingFang SC", "Hiragino Sans GB",
               "Microsoft YaHei", system-ui, sans-serif;
}
```

| 用途 | 规格 |
|---|---|
| 巨型标题 | `font-weight: 900; font-size: clamp(44px, 9vw, 110px); line-height: .95; letter-spacing: -.01em;` |
| 章节标题（黑底条） | `font-weight: 900; font-size: clamp(15px, 3vw, 19px); letter-spacing: .3em; text-transform: uppercase;` |
| 副标题徽章 / 小标签 | `font-size: 11~13px; font-weight: 700; letter-spacing: .3em; text-transform: uppercase;` |
| 正文 | `font-size: clamp(13.5px, 2.6vw, 15.5px); line-height: 1.7; color: #3c3a33;` |
| 角落标注 | `font-size: 10.5px; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: #6d675c;` |

字号一律用 `clamp()` 随视口缩放（呼应 AGENTS.md 布局规范第 6 条）。

---

## 4. 背景纹理（波点，必选）

纸色底上叠两层错位圆点网格，固定层 + `pointer-events: none`：

```css
body::before {
  content: ""; position: fixed; inset: 0; z-index: 0;
  pointer-events: none; opacity: .8;
  background-image:
    radial-gradient(#16161680 1px, transparent 1.6px),
    radial-gradient(#16161650 1px, transparent 1.6px);
  background-size: 34px 34px, 54px 54px;
  background-position: 0 0, 17px 27px;
}
```

所有内容容器需设 `position: relative; z-index: 1`（或更高）压在纹理之上。

---

## 5. 核心组件规范

### 5.1 滚动字幕条（marquee）

黑底黄字、固定吸顶，内容重复拼接至 ≥ 200% 宽实现无缝循环：

```css
.marquee {
  position: fixed; top: 0; left: 0; right: 0; z-index: 20;
  background: var(--ink); color: var(--sun); overflow: hidden;
  font-size: 12px; font-weight: 700; letter-spacing: .34em;
  text-transform: uppercase;
  padding: 9px 0;
  padding-top: calc(9px + env(safe-area-inset-top, 0));
}
.marquee .in { display: inline-block; white-space: nowrap; animation: mq 22s linear infinite; }
@keyframes mq { to { transform: translateX(-50%); } }
```

```js
document.getElementById('mq').textContent = 'FUN APPS · 无规则 · 只管好玩 · '.repeat(24);
```

### 5.2 硬阴影大标题

双层错位硬阴影是本风格的招牌。标题色用纸色（镂空感），第二行换色换阴影：

```css
.title h1 {
  font-size: clamp(44px, 9vw, 110px); font-weight: 900; line-height: .95;
  color: var(--paper);
  text-shadow: 4px 4px 0 var(--ink), 8px 8px 0 var(--coral);
}
.title .pop { /* 第二行 */
  color: var(--sun);
  text-shadow: 4px 4px 0 var(--ink), 8px 8px 0 var(--blue);
}
```

副标题徽章：黑底纸字，整体旋转 -2°：

```css
.badge {
  display: inline-block; background: var(--ink); color: var(--paper);
  font-size: clamp(11px, 2.6vw, 13px); font-weight: 700;
  letter-spacing: .3em; text-transform: uppercase;
  padding: 10px 20px; transform: rotate(-2deg);
}
```

### 5.3 Memphis 图形库（SVG，7 种）

装饰图形全部用内联 SVG 绘制，取色自 Tokens。标准定义（`c` 为填充色）：

| 图形 | SVG 要点 |
|---|---|
| 波浪线 squiggle | `path M6 40 Q 22 8, 40 34 T 76 32 T 112 30 T 146 26`，`stroke-width:11`，圆头 |
| 三角 triangle | `polygon points="45,4 88,78 2,78"` 实心填充 |
| 虚线圆 dotted circle | 实心圆 + 内圈纸色虚线 `stroke-dasharray="2 12"` |
| 半圆 half circle | `path M2 60 A 58 58 0 0 1 118 60 Z` 实心 |
| 锯齿 zigzag | 折线 polyline，`stroke-width:12`，圆头圆角 |
| 条纹胶囊 pill | 圆角矩形 `rx="24"` + 三条纸色斜线 |
| 扇形弧 arc fan | 大弧彩描边 + 小弧黑描边 |

散落布局规则：

- 用百分比 `left/top` 绝对定位，围绕中心标题四周散布，**避开中心区**。
- 每个图形随机旋转 -8° ~ 10°（`--hr` 变量存 hover 角度）。
- 数量 6 ~ 10 个，按 `i % 7` 循环图形、`i % 5` 循环颜色。

### 5.4 图形交互（点按换色）

装饰图形必须可点击：点按后在色板中循环换色并旋转 +22°，带一次弹性脉冲：

```js
el.addEventListener('click', function () {
  var c2 = (+el.dataset.ci + 1) % 5;      // 换色
  el.dataset.ci = c2;
  var r = (+el.dataset.rot) + 22;          // 累加旋转
  el.dataset.rot = r;
  el.innerHTML = DEFS[+el.dataset.di](COLS[c2]).html;
  el.style.rotate = r + 'deg';
  el.style.transform = 'scale(1.15)';      // 脉冲
  setTimeout(function () { el.style.transform = ''; }, 240);
});
```

注意：装饰图形设 `aria-hidden="true"`（无语义），但保留 `pointer-events` 供点击玩耍。

### 5.5 贴纸卡片（目录 / 入口）

黑描边 + 彩色硬投影 + 轻微倾斜，hover 时回正并抬起：

```css
.card {
  position: relative; display: block;
  background: #fffdf6; color: var(--ink); text-decoration: none;
  border: 3px solid var(--ink); border-radius: 18px;
  box-shadow: 7px 7px 0 var(--c, var(--ink));   /* --c 为该卡的点睛色 */
  padding: clamp(20px, 3vw, 28px);
  transform: rotate(var(--tilt, 0deg));          /* ±1.2° 交错倾斜 */
  touch-action: manipulation;
  transition: transform .28s cubic-bezier(.3, 1.6, .5, 1), box-shadow .28s;
  animation: pop .55s cubic-bezier(.3, 1.6, .5, 1) both;
  animation-delay: var(--d, 0s);                 /* 逐卡错峰入场 */
}
@keyframes pop { from { opacity: 0; transform: rotate(var(--tilt, 0deg)) translateY(26px) scale(.96); } }
@media (hover: hover) {
  .card:hover { transform: rotate(0deg) translateY(-5px); box-shadow: 9px 12px 0 var(--c, var(--ink)); }
}
.card:active { transform: rotate(var(--tilt, 0deg)) scale(.97); }
```

卡片内部结构（可选元素按需取舍）：圆形图标徽章（点睛色底 + 黑描边）、名称（900 字重）、英文小标（大写宽字距）、`№ 01` 编号胶囊、描述、标签胶囊（首个反色）。

### 5.6 角落标注

页面左下 / 右下角的小号大写标注，营造"会员俱乐部"氛围：

```
fun apps society · est. 2026      （左下）
memphis vibes · 双击即玩 · nº 07   （右下）
```

---

## 6. 动效规范

| 场景 | 规范 |
|---|---|
| 弹性曲线（统一） | `cubic-bezier(.3, 1.6, .5, 1)` |
| 图形 / 按钮 hover | `scale(1.12)` 或旋转回正 + 抬起 |
| 按下 active | `scale(.94)`（或投影变短的"按下"感） |
| 入场 | `pop` 弹跳（透明度 + 上移 + 缩放），列表项按 `i * .08s` 错峰 |
| 循环 | marquee 线性匀速 `linear infinite` |
| 降级 | `@media (prefers-reduced-motion: reduce)` 下关闭全部动画与过渡 |

---

## 7. 响应式规则（衔接 AGENTS.md 设备矩阵）

布局按 **320px 起步**设计，覆盖 320px ~ 超宽全区间：

- 散落图形：`< 640px` 缩至 **72%**；`< 520px` 裁剪至 **6 个**，避免遮挡。
- 右下角标注、页脚右侧信息：`< 640px` 隐藏（`.corner2` / `.foot .r`）。
- 卡片网格：默认单列，`≥ 680px` 双列，禁止假设平板宽度 ≥ 768px。
- 窗口 resize 时**防抖重建**（约 180ms）散落图形，适配 iPad 旋转 / 分屏拖动。
- 固定定位元素（marquee、页脚）使用 `env(safe-area-inset-*)` 留白。

---

## 8. 交互与无障碍

- 装饰图形纯玩耍用途，`aria-hidden="true"`；功能元素（卡片、按钮）必须可聚焦，`:focus-visible` 用 `outline: 3px solid var(--blue); outline-offset: 3~4px`。
- 触控目标 ≥ 44×44px；可点元素 `touch-action: manipulation`。
- hover 效果包在 `@media (hover: hover)` 中，触摸设备不触发，功能不得依赖 hover。

---

## 9. 应用检查清单（新页面上线前）

- [ ] 顶部声明完整设计 Tokens（§2）
- [ ] 纸色底 + 波点纹理背景（§4）
- [ ] 有滚动字幕条 / 硬阴影大标题 / 角落标注中至少两类招牌元素（§5）
- [ ] 装饰图形来自 §5.3 图形库，可点按换色（§5.4）
- [ ] 入口卡片符合贴纸规范（§5.5）
- [ ] 动效统一弹性曲线，`prefers-reduced-motion` 已降级（§6）
- [ ] 320px 起步响应式验证通过（§7）
- [ ] 中文 UI（`lang="zh-CN"`），文案可带英文点缀（如 `· nº 07`）
