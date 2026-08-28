// =====================================================================
// render.js — 跳一跳：p5 WEBGL 3D 场景绘制
//
// 坐标系：Y 轴向上，XZ 为地面平面。平台顶面统一 y = 0，平台中心 y = -height/2。
// 相机：ortho() 正交投影，俯仰 45°、方位 -45°，注视点随状态缓动 lerp（spec §3.2）。
// 本文件只读 state，不修改任何游戏状态。
// =====================================================================

const Render = (function () {
  let p = null;          // p5 实例
  let vw = 1, vh = 1;    // 视口尺寸

  function init(p5Inst) {
    p = p5Inst;
    vw = p.width;
    vh = p.height;
  }

  function resize(w, h) { vw = w; vh = h; }

  // -------------------------------------------------------------------
  // 相机
  // -------------------------------------------------------------------

  // 正交视锥：按窗口宽高比换算，窄屏（320px）自动放大视野避免裁切
  function applyCamera() {
    const C = CONFIG.camera;
    const aspect = vw / Math.max(1, vh);
    // 窄屏（竖屏）时按宽度补偿，保证水平方向能容纳足够世界宽度
    let halfH = C.viewSize;
    if (aspect < 1) halfH = C.viewSize / Math.max(0.55, aspect);

    const halfW = halfH * aspect;
    p.ortho(-halfW, halfW, -halfH, halfH, -3000, 3000);

    // 注视点缓动（在 updateCamera 中已 lerp，这里只做相机摆位）
    const cam = state.cam;
    const rad = C.yaw * Math.PI / 180;
    const pit = C.pitch * Math.PI / 180;
    const d = C.distance;
    const horiz = Math.cos(pit) * d;
    const eyeX = cam.lookX - Math.sin(rad) * horiz;
    const eyeZ = cam.lookZ - Math.cos(rad) * horiz;
    const eyeY = Math.sin(pit) * d;

    // 落地/失败震动
    let shX = 0, shY = 0;
    if (state.shake > 0.001) {
      shX = (Math.random() - 0.5) * state.shake * 26;
      shY = (Math.random() - 0.5) * state.shake * 26;
    }

    p.camera(
      eyeX + shX, eyeY + shY, eyeZ,
      cam.lookX, 0, cam.lookZ,
      0, 1, 0
    );
  }

  // 每帧更新注视点（缓动到「当前方块与下一方块之间」）
  function updateCamera() {
    const C = CONFIG.camera;
    const cur = currentPlatform();
    const nxt = nextPlatform();
    const cam = state.cam;

    if (cur && nxt) {
      cam.targX = cur.x + (nxt.x - cur.x) * C.lookAhead;
      cam.targZ = cur.z + (nxt.z - cur.z) * C.lookAhead;
    } else if (cur) {
      cam.targX = cur.x;
      cam.targZ = cur.z;
    }
    cam.lookX += (cam.targX - cam.lookX) * C.lerp;
    cam.lookZ += (cam.targZ - cam.lookZ) * C.lerp;

    if (state.shake > 0) {
      state.shake *= 0.86;
      if (state.shake < 0.001) state.shake = 0;
    }
  }

  // -------------------------------------------------------------------
  // 场景
  // -------------------------------------------------------------------

  function drawScene() {
    applyCamera();

    // 背景：纸色（HTML body 波点已铺底，WEBGL 用不透明纸色清屏）
    p.background(246, 241, 231);

    // 光照：柔和定向光 + 环境光，让 3D 方块有体积感
    p.ambientLight(150, 146, 136);
    p.directionalLight(255, 252, 244, -0.4, -0.9, -0.35);
    p.directionalLight(120, 116, 108, 0.6, 0.4, 0.5);

    drawGround();
    drawPlatforms();
    drawPiece();
    drawChargeRing();
  }

  // 地面：淡色平面（Memphis 纸感，衬托 3D 方块）
  function drawGround() {
    const cam = state.cam;
    p.push();
    p.noStroke();
    p.fill(239, 232, 216);
    p.translate(cam.lookX, -CONFIG.platform.height - 2, cam.lookZ);
    p.rotateX(Math.PI / 2);
    p.plane(2600, 2600);
    p.pop();
  }

  // -------------------------------------------------------------------
  // 平台
  // -------------------------------------------------------------------

  function drawPlatforms() {
    for (let i = 0; i < state.platforms.length; i++) {
      drawPlatform(state.platforms[i], i === state.currentIndex);
    }
  }

  function drawPlatform(plat, isCurrent) {
    const col = p.color(BLOCK_COLORS[plat.colorIndex % BLOCK_COLORS.length]);

    p.push();
    p.translate(plat.x, -CONFIG.platform.height / 2, plat.z);

    // 彩蛋方块：停留计时中有脉冲缩放
    let s = 1;
    if (plat.egg && !plat.egg.triggered && state.egg.platform === plat && state.egg.timer > 0) {
      const k = state.egg.timer / CONFIG.egg.stayTime;
      s = 1 + Math.sin(k * Math.PI * 6) * 0.035;
    }
    if (s !== 1) p.scale(1, s, 1);

    // 墨黑描边（Memphis 骨架）
    p.stroke(22, 22, 22);
    p.strokeWeight(2.4);
    p.fill(col);

    if (plat.shape === 'cylinder') {
      p.cylinder(plat.size / 2, CONFIG.platform.height, 16, 1);
    } else {
      p.box(plat.size, CONFIG.platform.height, plat.size);
    }

    // 顶面：中心判定圆（连击判定区的视觉提示）
    drawPlatformTop(plat, isCurrent);

    // 彩蛋装饰
    if (plat.egg && !plat.egg.triggered) drawEggDeco(plat);

    p.pop();
  }

  // 顶面：中心圆标记（连击判定半径），当前平台高亮
  function drawPlatformTop(plat, isCurrent) {
    const r = centerRadius(plat);
    p.push();
    p.translate(0, CONFIG.platform.height / 2 + 0.6, 0);
    p.rotateX(Math.PI / 2);
    p.noStroke();
    if (isCurrent) {
      // 当前平台：中心判定圆用亮色提示
      p.fill(255, 253, 246, 190);
    } else {
      p.fill(255, 253, 246, 110);
    }
    p.circle(0, 0, r * 2);
    // 墨黑圆环（Memphis 描边）
    p.noFill();
    p.stroke(22, 22, 22);
    p.strokeWeight(2);
    p.circle(0, 0, r * 2);
    p.pop();
  }

  // 连击中心判定半径（spec §2.3：距中心 < 判定半径）
  function centerRadius(plat) {
    const S = CONFIG.scoring;
    const ratio = Math.max(S.centerRatioMin, S.centerRatio);
    return plat.size * ratio;
  }

  // 彩蛋装饰：唱片机 / 魔方 / 音乐盒（渲染层差异，物理形状与普通方块一致）
  function drawEggDeco(plat) {
    const key = plat.egg.key;
    p.push();
    p.translate(0, CONFIG.platform.height / 2 + 1.2, 0);
    p.rotateX(Math.PI / 2);
    p.noStroke();

    if (key === 'record') {
      // 黑胶唱片：黑盘 + 纸色中心，停留时旋转
      const spin = state.egg.platform === plat ? state.egg.timer / 1000 * 6 : 0;
      p.push();
      p.rotate(spin);
      p.fill(22, 22, 22);
      p.circle(0, 0, plat.size * 0.52);
      p.fill(246, 241, 231);
      p.circle(0, 0, plat.size * 0.16);
      p.noFill();
      p.stroke(246, 241, 231);
      p.strokeWeight(1.2);
      p.circle(0, 0, plat.size * 0.36);
      p.pop();
    } else if (key === 'cube') {
      // 魔方：3×3 色块阵列，停留时整体自旋
      const spin = state.egg.platform === plat ? state.egg.timer / 1000 * 3 : 0;
      p.push();
      p.rotate(spin);
      const cell = plat.size * 0.17;
      for (let r = -1; r <= 1; r++) {
        for (let c = -1; c <= 1; c++) {
          p.fill(BLOCK_COLORS[((r + 1) * 3 + (c + 1)) % BLOCK_COLORS.length]);
          p.rect(c * cell - cell / 2, r * cell - cell / 2, cell * 0.86, cell * 0.86, 2);
        }
      }
      p.pop();
    } else if (key === 'box') {
      // 音乐盒：条形音波，停留时上下跳动
      const t = state.egg.platform === plat ? state.egg.timer / 1000 : 0;
      const bars = 5;
      const bw = plat.size * 0.10;
      for (let i = 0; i < bars; i++) {
        const hx = (i - (bars - 1) / 2) * bw * 1.5;
        const hh = plat.size * (0.14 + 0.12 * Math.abs(Math.sin(t * 5 + i * 0.8)));
        p.fill(BLOCK_COLORS[i % BLOCK_COLORS.length]);
        p.rect(hx - bw / 2, -hh / 2, bw, hh, 2);
      }
    }
    p.pop();
  }

  // -------------------------------------------------------------------
  // 棋子（圆柱身 + 球头，墨黑描边）
  // -------------------------------------------------------------------

  function drawPiece() {
    const P = CONFIG.piece;
    const pos = state.piece.pos;

    // 假阴影：地面椭圆，随高度缩放并淡出
    drawShadow(pos);

    p.push();
    p.translate(pos.x, pos.y, pos.z);

    // 空中自旋 / settling 倾倒
    if (state.phase === PHASE.FLYING) {
      p.rotateY(state.piece.spin);
    }
    if (state.piece.tilt > 0.001) {
      const F = state.flight;
      if (F.dir === 'x') p.rotateZ(state.piece.tilt * F.sign);
      else p.rotateX(-state.piece.tilt * F.sign);
    }

    // squash & stretch：蓄力压缩 / 起跳拉伸
    let sy = 1, sxz = 1;
    if (state.piece.squash > 0) {
      sy = 1 - state.piece.squash * 0.45;
      sxz = 1 + state.piece.squash * 0.28;
    }
    if (state.piece.stretch > 0) {
      sy = 1 + state.piece.stretch * 0.40;
      sxz = 1 - state.piece.stretch * 0.20;
    }
    p.scale(sxz, sy, sxz);

    // 圆柱身（p5 cylinder 以原点为中心，需先抬高半个身高）
    p.stroke(22, 22, 22);
    p.strokeWeight(2.4);
    p.fill(PALETTE.coral);
    p.push();
    p.translate(0, P.bodyH / 2, 0);
    p.cylinder(P.bodyR, P.bodyH, 14, 1);
    p.pop();

    // 球头
    p.fill(PALETTE.sun);
    p.push();
    p.translate(0, P.bodyH + P.headR * 0.72, 0);
    p.sphere(P.headR, 12, 10);
    p.pop();

    p.pop();
  }

  // 假阴影（地面椭圆，随棋子高度缩放淡出）
  function drawShadow(pos) {
    const h = Math.max(0, pos.y);
    const k = Math.max(0, 1 - h / 320);           // 越高越小越淡
    if (k <= 0.02) return;
    const r = CONFIG.piece.bodyR * (1.05 + (1 - k) * 1.1);

    p.push();
    p.translate(pos.x, 0.9, pos.z);
    p.rotateX(Math.PI / 2);
    p.noStroke();
    p.fill(22, 22, 22, 70 * k);
    p.circle(0, 0, r * 2);
    p.pop();
  }

  // -------------------------------------------------------------------
  // 蓄力圈：棋子脚下扩散的圆环（3D 内绘制，不做屏幕进度条 —— spec §3.5）
  // -------------------------------------------------------------------

  function drawChargeRing() {
    if (state.phase !== PHASE.AIMING || !state.charging) return;
    const r0 = state.chargeRatio;
    if (r0 <= 0.001) return;

    const pos = state.piece.pos;
    const base = CONFIG.piece.bodyR * 1.2;
    const radius = base + r0 * CONFIG.piece.bodyR * 3.4;

    p.push();
    p.translate(pos.x, 1.2, pos.z);
    p.rotateX(Math.PI / 2);
    p.noFill();
    p.stroke(PALETTE.ink);
    p.strokeWeight(3.2);
    p.circle(0, 0, radius * 2);
    // 满蓄力时换色提示封顶
    if (r0 >= 0.999) {
      p.stroke(PALETTE.coral);
      p.strokeWeight(2.2);
      p.circle(0, 0, radius * 2 + 7);
    }
    p.pop();
  }

  return { init, resize, updateCamera, applyCamera, drawScene, centerRadius };
})();
