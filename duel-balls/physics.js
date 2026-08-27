// =====================================================================
// physics.js — Matter.js 封装层（与模板一致）
//
// 职责：
//   1. 初始化引擎、世界
//   2. 提供创建刚体的便捷方法（矩形/圆形/静态边界）
//   3. 集中处理碰撞事件
//   4. 在每帧用「固定步长」推进物理，保证 iPad 与桌面表现一致
// =====================================================================

const Physics = (function () {
  let engine, world;
  let accumulator = 0;   // 固定步长累加器
  const collisionHandlers = {};

  function init() {
    engine = Matter.Engine.create({
      positionIterations: CONFIG.physics.positionIterations,
      velocityIterations: CONFIG.physics.velocityIterations,
    });
    world = engine.world;
    engine.gravity.y = CONFIG.physics.gravityY;
    engine.gravity.scale = CONFIG.physics.gravityScale;

    Matter.Events.on(engine, 'collisionStart', onCollisionStart);
  }

  function addRectangle(x, y, w, h, opts = {}) {
    const body = Matter.Bodies.rectangle(x, y, w, h, Object.assign({
      restitution: CONFIG.physics.restitution,
      friction: CONFIG.physics.friction,
      frictionAir: CONFIG.physics.airFriction,
    }, opts));
    Matter.World.add(world, body);
    return body;
  }

  function addCircle(x, y, r, opts = {}) {
    const body = Matter.Bodies.circle(x, y, r, Object.assign({
      restitution: CONFIG.physics.restitution,
      friction: CONFIG.physics.friction,
      frictionAir: CONFIG.physics.airFriction,
    }, opts));
    Matter.World.add(world, body);
    return body;
  }

  // 静态边界（地面、墙）
  function addStaticBoundary(x, y, w, h, angle = 0) {
    return addRectangle(x, y, w, h, { isStatic: true, angle });
  }

  function remove(body) {
    if (body) Matter.World.remove(world, body);
  }

  function clear() {
    Matter.World.clear(world, false);
    Matter.Engine.clear(engine);
  }

  function onPair(labelA, labelB, fn) {
    collisionHandlers[pairKey(labelA, labelB)] = fn;
    collisionHandlers[pairKey(labelB, labelA)] = fn;
  }

  function pairKey(a, b) {
    return a + '|' + b;
  }

  function onCollisionStart(evt) {
    for (const pair of evt.pairs) {
      const la = pair.bodyA.label;
      const lb = pair.bodyB.label;
      const key = pairKey(la, lb);
      const fn = collisionHandlers[key];
      if (fn) fn(pair.bodyA, pair.bodyB, pair);
    }
  }

  function step(deltaMs) {
    const fixed = CONFIG.physics.fixedDelta;
    accumulator += deltaMs;
    let steps = 0;
    while (accumulator >= fixed && steps < 5) {
      Matter.Engine.update(engine, fixed);
      accumulator -= fixed;
      steps++;
    }
    if (steps === 5) accumulator = 0;
  }

  function getWorld() { return world; }
  function getEngine() { return engine; }

  return {
    init, addRectangle, addCircle, addStaticBoundary,
    remove, clear, onPair, step, getWorld, getEngine,
  };
})();
