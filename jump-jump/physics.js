// =====================================================================
// physics.js — 跳一跳：解析抛物线 + 落点判定 + Matter 落地接管
//
// 分工（spec §3.3）：
//   1. aiming：蓄力时长 -> 目标水平跳距（线性，1.2s 封顶）
//   2. flying：手写解析推进（水平匀速 + 竖直 v0y - g*t），不走引擎
//   3. 落地检测：棋子底面触及平台顶面(y=0) 且 XZ 在平台范围内 -> 落点判定
//      若越过顶面高度后 XZ 始终出界 -> 继续下坠，低于阈值移交 Matter 判负
//   4. settling：创建 Matter 刚体继承位置与水平速度，Engine.update 判定站稳/倾倒
//
// 安全约束（spec §4）：
//   - 碰撞回调内绝不移除刚体，统一入 state.removeQueue，帧末 flushRemoveQueue()
//   - dt 由调用方钳制上限 CONFIG.time.maxDelta 后再传入
// =====================================================================

const Physics = (function () {
  let engine = null;
  let world = null;
  let pieceBody = null;          // 棋子刚体（仅 settling 阶段存在）
  let accumulator = 0;           // 固定步长累加器
  let settleFrames = 0;          // 连续「静止且直立」的帧数

  const handlers = {
    onLanding: null,   // (platform, isCurrent)
    onSettled: null,   // ()
    onFell: null,      // (reason: 'tilt' | 'fall')
  };

  // -------------------------------------------------------------------
  // 引擎
  // -------------------------------------------------------------------

  function init() {
    engine = Matter.Engine.create({
      positionIterations: 8,
      velocityIterations: 8,
    });
    world = engine.world;
    engine.gravity.y = CONFIG.physics.gravityY;
    engine.gravity.scale = CONFIG.physics.gravityScale;
    accumulator = 0;
    settleFrames = 0;
  }

  function clearWorld() {
    if (!world) return;
    Matter.World.clear(world, false);
    Matter.Engine.clear(engine);
    pieceBody = null;
    settleFrames = 0;
    accumulator = 0;
  }

  function setHandlers(obj) { Object.assign(handlers, obj); }

  // -------------------------------------------------------------------
  // 蓄力（aiming）
  // -------------------------------------------------------------------

  function startCharge(nowMs) {
    state.charging = true;
    state.chargeStart = nowMs;
    state.chargeRatio = 0;
  }

  // 每帧调用：更新蓄力进度与棋子压缩量
  function updateCharge(nowMs) {
    if (!state.charging) return;
    const held = nowMs - state.chargeStart;
    const ratio = clamp01(held / CONFIG.charge.maxTime);
    state.chargeRatio = ratio;
    state.piece.squash = ratio * CONFIG.charge.squashMax;
  }

  // pointercancel / 失焦：取消本次蓄力，棋子恢复站立，绝不起跳（spec §4.2）
  function cancelCharge() {
    state.charging = false;
    state.chargeRatio = 0;
    state.piece.squash = 0;
  }

  // 本次蓄力对应的水平跳距
  function chargeToDistance(heldMs) {
    const C = CONFIG.charge, J = CONFIG.jump;
    const r = clamp01(heldMs / C.maxTime);
    return J.minDist + (J.maxDist - J.minDist) * r;
  }

  // 松手：起跳（heldMs 低于 minTime 视为误触，不起跳）
  function releaseCharge(nowMs) {
    if (!state.charging) return false;
    const held = nowMs - state.chargeStart;
    state.charging = false;
    if (held < CONFIG.charge.minTime) {
      state.chargeRatio = 0;
      state.piece.squash = 0;
      return false;
    }
    const dist = chargeToDistance(held);
    state.chargeRatio = clamp01(held / CONFIG.charge.maxTime);
    beginFlight(dist);
    return true;
  }

  // -------------------------------------------------------------------
  // 飞行（解析抛物线）
  // -------------------------------------------------------------------

  // 由「目标水平距离」反解初速度，保证落点确定性（spec §5 验收 2）
  function beginFlight(dist) {
    const J = CONFIG.jump;
    const p = currentPlatform();
    const np = nextPlatform();
    if (!p || !np) return;

    // 方向：从当前平台指向下一个平台，吸附到 X / Z 主轴
    const dx = np.x - p.x;
    const dz = np.z - p.z;
    const useX = Math.abs(dx) >= Math.abs(dz);
    const F = state.flight;

    F.dir = useX ? 'x' : 'z';
    F.sign = (useX ? dx : dz) >= 0 ? 1 : -1;
    F.fromX = state.piece.pos.x;
    F.fromZ = state.piece.pos.z;
    F.targetDist = dist;
    F.t = 0;
    F.startY = state.piece.pos.y;

    // 竖直初速由 apexRatio 决定；飞行总时长 T = 2 * vy0 / g
    const vy0 = Math.sqrt(Math.max(1, J.gravity * J.apexRatio * dist));
    F.vy0 = vy0;
    const T = (2 * vy0) / J.gravity;
    F.vh = T > 0 ? dist / T : 0;

    state.piece.vel = { x: 0, y: vy0, z: 0 };
    state.piece.squash = 0;
    state.piece.stretch = CONFIG.charge.stretchMax;
    state.piece.spin = 0;

    setPhase(PHASE.FLYING);
  }

  // 解析推进一帧；dtMs 已由调用方钳制
  function stepFlight(dtMs) {
    const J = CONFIG.jump;
    const F = state.flight;
    const dt = dtMs / 1000;

    F.t += dt;
    const t = F.t;
    const horiz = F.vh * t;
    const vert = F.vy0 * t - 0.5 * J.gravity * t * t;

    const pos = state.piece.pos;
    if (F.dir === 'x') {
      pos.x = F.fromX + F.sign * horiz;
      pos.z = F.fromZ;
    } else {
      pos.z = F.fromZ + F.sign * horiz;
      pos.x = F.fromX;
    }
    pos.y = F.startY + vert;
    state.piece.vel.y = F.vy0 - J.gravity * t;
    state.piece.spin += J.airSpin * dt;

    // 拉伸随时间衰减
    if (state.piece.stretch > 0) {
      state.piece.stretch -= dtMs / CONFIG.charge.stretchDecay;
      if (state.piece.stretch < 0) state.piece.stretch = 0;
    }

    // --- 落地检测：只在下落段（vy < 0）判定，且必须由上方穿过顶面 ---
    if (state.piece.vel.y < 0 && pos.y <= 0) {
      const hit = platformAt(pos.x, pos.z);
      if (hit) {
        pos.y = 0;
        const isCurrent = (hit === currentPlatform());
        landing(hit, isCurrent);
        return;
      }
    }

    // --- 越过顶面且 XZ 出界：继续下坠，低于阈值移交 Matter 翻滚坠落 ---
    if (pos.y < -CONFIG.physics.fallDepth) {
      state.piece.vel.y = Math.min(state.piece.vel.y, -1);
      spawnPieceBodyForFall();
      if (handlers.onFell) handlers.onFell('fall');
    }
  }

  // 平面几何判定：返回 (x,z) 所在的平台，没有则返回 null
  function platformAt(x, z) {
    for (let i = 0; i < state.platforms.length; i++) {
      const p = state.platforms[i];
      const half = p.size / 2;
      if (p.shape === 'cylinder') {
        // 圆柱：圆形判定
        const r = Math.hypot(x - p.x, z - p.z);
        if (r <= half) return p;
      } else {
        if (Math.abs(x - p.x) <= half && Math.abs(z - p.z) <= half) return p;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------
  // 落地：先计分，再创建 Matter 刚体进入 settling
  // -------------------------------------------------------------------

  function landing(platform, isCurrent) {
    if (handlers.onLanding) handlers.onLanding(platform, isCurrent);

    // 继承水平速度（方向上指向飞行方向，大小按剩余水平速度）
    const F = state.flight;
    const vx = F.dir === 'x' ? F.sign * F.vh * 0.35 : 0;
    const vz = F.dir === 'z' ? F.sign * F.vh * 0.35 : 0;
    spawnPieceBody(state.piece.pos.x, state.piece.pos.z, vx, vz);

    settleFrames = 0;
    setPhase(PHASE.SETTLING);
  }

  // -------------------------------------------------------------------
  // Matter 刚体
  // -------------------------------------------------------------------

  // 平台静态刚体（顶面在 y=0，沿 Y 向下延伸 platform.height）
  // 注意：Matter 是 2D 引擎，这里把世界 XZ 平面映射到 Matter 的 XY 平面：
  //   Matter.x = world.x，Matter.y = world.z
  // 重力沿 Matter.y 在此映射下无实际意义，平台只用做碰撞体，
  // 棋子倾倒由 computeTilt() 按质心偏移判定，不依赖 Matter 的旋转自由度。
  function addPlatformBody(p) {
    if (!world || p.body) return;
    const body = p.shape === 'cylinder'
      ? Matter.Bodies.polygon(p.x, p.z, 16, p.size / 2, { isStatic: true })
      : Matter.Bodies.rectangle(p.x, p.z, p.size, p.size, { isStatic: true });

    body.friction = CONFIG.physics.friction;
    body.frictionStatic = CONFIG.physics.frictionStatic;
    body.restitution = CONFIG.physics.restitution;
    body.label = 'platform';
    Matter.World.add(world, body);
    p.body = body;
  }

  // 入队移除（碰撞回调内调用此函数，绝不直接 World.remove —— spec §4.1）
  function queueRemovePlatform(p) {
    if (p && p.body) state.removeQueue.push(p);
  }

  // 帧末统一执行移除（在碰撞回调之外调用）
  function flushRemoveQueue() {
    if (!state.removeQueue.length) return;
    for (const p of state.removeQueue) {
      if (p.body) {
        Matter.World.remove(world, p.body);
        p.body = null;
      }
    }
    state.removeQueue.length = 0;
  }

  // 棋子刚体：正常落地
  function spawnPieceBody(x, z, vx, vz) {
    clearPieceBody();
    if (!world) return;
    const P = CONFIG.piece;
    const body = Matter.Bodies.rectangle(x, z, P.bodyR * 2, P.bodyR * 2, {
      friction: CONFIG.physics.friction,
      frictionStatic: CONFIG.physics.frictionStatic,
      restitution: CONFIG.physics.restitution,
    });
    body.label = 'piece';
    body.frictionAir = 0.06;
    Matter.Body.setVelocity(body, { x: vx || 0, y: vz || 0 });
    Matter.World.add(world, body);
    pieceBody = body;
  }

  // 棋子刚体：坠落（无支撑，给一点水平初速制造翻滚）
  function spawnPieceBodyForFall() {
    const F = state.flight;
    const vx = F.dir === 'x' ? F.sign * F.vh * 0.5 : 0;
    const vz = F.dir === 'z' ? F.sign * F.vh * 0.5 : 0;
    spawnPieceBody(state.piece.pos.x, state.piece.pos.z, vx, vz);
  }

  function clearPieceBody() {
    if (pieceBody && world) Matter.World.remove(world, pieceBody);
    pieceBody = null;
  }

  // -------------------------------------------------------------------
  // settling：推进 Matter，判定站稳 / 倾倒 / 坠落（spec §3.3 步骤 5）
  // -------------------------------------------------------------------

  function stepSettle(dtMs) {
    if (!engine || !pieceBody) return;

    const fixed = CONFIG.physics.fixedDelta;
    accumulator += dtMs;
    let steps = 0;
    while (accumulator >= fixed && steps < CONFIG.physics.maxStepsPerFrame) {
      Matter.Engine.update(engine, fixed);
      accumulator -= fixed;
      steps++;
    }
    if (steps === CONFIG.physics.maxStepsPerFrame) accumulator = 0;

    // 同步回渲染坐标（Matter.y -> world.z）
    state.piece.pos.x = pieceBody.position.x;
    state.piece.pos.z = pieceBody.position.y;

    const speed = Math.hypot(pieceBody.velocity.x, pieceBody.velocity.y);

    // 1) 坠落：中心离开所有平台 -> 持续下坠，低于阈值判负
    if (!platformAt(state.piece.pos.x, state.piece.pos.z)) {
      state.piece.pos.y -= Math.max(2, speed * 1.4);
      if (state.piece.pos.y < -CONFIG.physics.fallDepth) {
        if (handlers.onFell) handlers.onFell('fall');
        return;
      }
      settleFrames = 0;
      return;
    }
    state.piece.pos.y = 0;

    // 2) 倾倒：由「质心超出支撑多边形」推导等效倾角
    const tilt = computeTilt(state.piece.pos.x, state.piece.pos.z);
    state.piece.tilt = tilt;
    if (tilt > CONFIG.physics.tiltThreshold) {
      if (handlers.onFell) handlers.onFell('tilt');
      return;
    }

    // 3) 站稳：连续 settleFrames 帧速度低于阈值且姿态直立
    if (speed < CONFIG.physics.velocityEpsilon && tilt < CONFIG.physics.tiltThreshold * 0.5) {
      settleFrames++;
      if (settleFrames >= CONFIG.piece.settleFrames) {
        state.piece.tilt = 0;
        if (handlers.onSettled) handlers.onSettled();
        return;
      }
    } else {
      settleFrames = 0;
    }
  }

  // 等效倾角：棋子中心距平台中心的偏移 -> 归一化到 [0, 1] 再映射到角度
  //   - 站在正中（off = 0）-> 0，绝对安全
  //   - 质心越过支撑边缘（off >= half）-> 90°，必然倾倒
  //   - 中间线性插值
  //
  // 关键约束：整个「连击判定区」必须落在判负阈值内，否则玩家踩中中心
  // 拿到连击的同时会被判负，游戏无法进行。判定区半径 = size * centerRatio，
  // 归一化后恒为 centerRatio / 0.5 = 0.44（与平台尺寸无关），
  // 对应 tilt = 0.44 * 90° ≈ 0.691 rad。因此 tiltThreshold 必须显著大于该值，
  // 见 CONFIG.physics.tiltThreshold 注释（当前 1.02 rad ≈ 58°）。
  function computeTilt(x, z) {
    const p = platformAt(x, z);
    if (!p) return Math.PI / 2;
    const off = Math.hypot(x - p.x, z - p.z);
    const half = Math.max(1, p.size / 2);
    const norm = Math.min(1, Math.max(0, off / half));
    return norm * (Math.PI / 2);
  }

  // -------------------------------------------------------------------
  // 工具
  // -------------------------------------------------------------------

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function hasPieceBody() { return !!pieceBody; }

  return {
    init, clearWorld, setHandlers,
    startCharge, updateCharge, cancelCharge, releaseCharge, chargeToDistance,
    beginFlight, stepFlight, platformAt,
    addPlatformBody, queueRemovePlatform, flushRemoveQueue,
    spawnPieceBody, clearPieceBody, hasPieceBody,
    stepSettle, computeTilt,
  };
})();
