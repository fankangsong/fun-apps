// =====================================================================
// render.js — p5.js 绘制层（与模板一致，额外导出通用原语）
//
// 职责：只读绘制，不修改物理/状态。
// =====================================================================

const Render = (function () {
  let p;

  function init(p5Inst) { p = p5Inst; }

  function drawAll() {
    drawBackground();
    if (CONFIG.debug.showBodies) drawBodiesDebug();
    if (CONFIG.debug.showFPS) drawFPS();
  }

  function drawBackground() {
    p.background(PALETTE.bg);
    p.stroke(PALETTE.bgGrid);
    p.strokeWeight(1);
    for (let x = 0; x < p.width; x += 60) p.line(x, 0, x, p.height);
    for (let y = 0; y < p.height; y += 60) p.line(0, y, p.width, y);
  }

  function drawCircleBody(body, fillCol, strokeCol) {
    p.push();
    p.translate(body.position.x, body.position.y);
    p.rotate(body.angle);
    if (strokeCol) { p.stroke(strokeCol); p.strokeWeight(1.5); } else p.noStroke();
    p.fill(fillCol);
    p.circle(0, 0, body.circleRadius * 2);
    p.pop();
  }

  function drawRectBody(body, fillCol, strokeCol) {
    const w = body.bounds.max.x - body.bounds.min.x;
    const h = body.bounds.max.y - body.bounds.min.y;
    p.push();
    p.translate(body.position.x, body.position.y);
    p.rotate(body.angle);
    if (strokeCol) { p.stroke(strokeCol); p.strokeWeight(1.5); } else p.noStroke();
    p.fill(fillCol);
    p.rectMode(p.CENTER);
    p.rect(0, 0, w, h, 4);
    p.rectMode(p.CORNER);
    p.pop();
  }

  function drawBodiesDebug() {
    const bodies = Matter.Composite.allBodies(Physics.getWorld());
    p.noFill();
    p.stroke(127, 212, 255, 180);
    p.strokeWeight(1);
    for (const b of bodies) {
      p.beginShape();
      for (const v of b.vertices) p.vertex(v.x, v.y);
      p.endShape(p.CLOSE);
    }
  }

  function drawFPS() {
    p.noStroke();
    p.fill(PALETTE.text);
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(12);
    p.text('FPS ' + p.frameRate().toFixed(1), 12, 12);
  }

  return { init, drawAll, drawCircleBody, drawRectBody, drawBackground };
})();
