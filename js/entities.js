'use strict';
// ───────── 플레이어 / 투사체 / 장판·예고 공격(Hazard) / 이펙트 / 전투 공용 함수 ─────────

// 월드 좌표의 방 (화면에서는 마름모로 투영됨)
const ARENA = { x1: 0, y1: 0, x2: ISO.WW, y2: ISO.WD };

function collideWorld(o) {
  o.x = clamp(o.x, ARENA.x1 + o.r, ARENA.x2 - o.r);
  o.y = clamp(o.y, ARENA.y1 + o.r, ARENA.y2 - o.r);
  for (const ob of G.obstacles) {
    const dx = o.x - ob.x, dy = o.y - ob.y, d = Math.hypot(dx, dy), m = o.r + ob.r;
    if (d < m && d > 0.001) { o.x = ob.x + dx / d * m; o.y = ob.y + dy / d * m; }
  }
}
function inObstacle(x, y, pad = 0) {
  if (x < ARENA.x1 || x > ARENA.x2 || y < ARENA.y1 || y > ARENA.y2) return true;
  return G.obstacles.some(ob => Math.hypot(x - ob.x, y - ob.y) < ob.r + pad);
}

// ───────── 이펙트 ─────────
function addFx(o) { o.life = o.life ?? 0.5; o.max = o.max ?? o.life; if (G.fx.length < 900) G.fx.push(o); return o; }
function burstParticles(x, y, n, color, spd = 220, size = 3, life = 0.5, h = 14) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(0.25, 1) * spd;
    addFx({ type: 'p', x, y, h, vh: rand(-40, 120), vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, size: rand(size * 0.6, size * 1.4), life: rand(life * 0.5, life) });
  }
}
// 번개: 월드 좌표 두 점(+높이)을 화면 좌표로 바꿔 지그재그로 잇는다. 하늘에서 치는 번개는 h1을 크게.
function boltFx(wx1, wy1, wx2, wy2, color = '#d9c8ff', width = 3, h1 = 20, h2 = 20) {
  const a = iso(wx1, wy1, h1), b = iso(wx2, wy2, h2);
  const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
  const pts = [[x1, y1]], segs = 9;
  for (let i = 1; i < segs; i++) {
    const t = i / segs, nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1, off = rand(-1, 1) * 22;
    pts.push([lerp(x1, x2, t) + nx / l * off, lerp(y1, y2, t) + ny / l * off]);
  }
  pts.push([x2, y2]);
  addFx({ type: 'bolt', pts, color, width, life: 0.22 });
}
function addText(x, y, str, color = '#fff', size = 18, h = 40) {
  G.texts.push({ x, y, h, str: String(str), color, size, life: 0.8, vh: 70 });
}
function banner(title, sub = '', dur = 2.6) { G.banner = { title, sub, t: dur, max: dur }; }

function updateFx(dt) {
  for (const f of G.fx) {
    f.life -= dt;
    if (f.type === 'p') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.9; f.vy *= 0.9; if (f.vh) f.h = Math.max(0, (f.h || 0) + f.vh * dt); }
  }
  G.fx = G.fx.filter(f => f.life > 0);
  for (const t of G.texts) { t.life -= dt; t.h += t.vh * dt; t.vh *= 0.92; }
  G.texts = G.texts.filter(t => t.life > 0);
}

// 바닥 평면 이펙트 (groundTransform 상태에서 호출)
const GROUND_FX = new Set(['slash', 'spin', 'ring']);
function drawGroundFx() {
  for (const f of G.fx) {
    if (!GROUND_FX.has(f.type)) continue;
    const k = clamp(f.life / f.max, 0, 1);
    ctx.globalAlpha = k;
    switch (f.type) {
      case 'slash': {
        const prog = 1 - k, a0 = f.ang - f.arc / 2 * f.dir, sweep = f.arc * f.dir * Math.min(1, prog * 2.2 + 0.25);
        ctx.save(); ctx.translate(f.x, f.y);
        ctx.globalAlpha = k * 0.95;
        ctx.beginPath(); ctx.arc(0, 0, f.range, a0, a0 + sweep, f.dir < 0);
        ctx.arc(0, 0, f.range * 0.55, a0 + sweep, a0, f.dir > 0); ctx.closePath();
        ctx.fillStyle = f.color; ctx.shadowColor = f.glow || f.color; ctx.shadowBlur = 18; ctx.fill();
        ctx.restore(); break;
      }
      case 'spin': {
        ctx.save(); ctx.shadowColor = f.color; ctx.shadowBlur = 20;
        ring(f.x, f.y, f.r * (1.05 - k * 0.25), f.color, 14 * k + 2);
        ctx.restore(); break;
      }
      case 'ring': ring(f.x, f.y, lerp(f.r1, f.r0 ?? 0, k), f.color, f.width ?? 3); break;
    }
  }
  ctx.globalAlpha = 1;
}
// 공중 이펙트와 피해 숫자 (screenTransform 상태에서 호출)
function drawAirFx() {
  for (const f of G.fx) {
    if (GROUND_FX.has(f.type)) continue;
    const k = clamp(f.life / f.max, 0, 1);
    ctx.globalAlpha = k;
    switch (f.type) {
      case 'p': { const q = iso(f.x, f.y, f.h || 0); circle(q.x, q.y, f.size * (0.4 + k * 0.6), f.color); break; }
      case 'bolt': {
        ctx.save(); ctx.strokeStyle = f.color; ctx.lineWidth = f.width; ctx.shadowColor = f.color; ctx.shadowBlur = 16; ctx.lineJoin = 'round';
        ctx.beginPath(); f.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
        ctx.lineWidth = f.width * 0.35; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore(); break;
      }
      case 'after': { const q = iso(f.x, f.y); drawPlayerSprite(q.x, q.y, f.anim, f.frame, f.flip, f.color); break; }
    }
  }
  ctx.globalAlpha = 1;
  for (const t of G.texts) {
    ctx.globalAlpha = clamp(t.life / 0.5, 0, 1);
    const q = iso(t.x, t.y, t.h);
    ctx.save(); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.font = `900 ${t.size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeText(t.str, q.x, q.y); ctx.restore();
    text(t.str, q.x, q.y, t.size, t.color, 'center', 900);
  }
  ctx.globalAlpha = 1;
}

// ───────── 전투 공용 ─────────
function applyBurn(e, dps) { if (e.dead) return; e.burn = 3; e.burnDps = Math.min((e.burnDps || 0) + dps, 20); }

function damageEnemy(e, amt, o = {}) {
  if (!e || e.dead || e.untargetable || e.invuln) return;
  const P = G.player;
  let dmg = amt * (o.raw ? 1 : P.dmgMul);
  if (o.crit) dmg *= 2;
  dmg = Math.max(1, Math.round(dmg));
  e.hp -= dmg; e.flash = 0.1; e.hurtT = 0.2;
  addText(e.x + rand(-10, 10), e.y, dmg, o.crit ? '#ffe14a' : (o.color || '#ffffff'), o.crit ? 28 : (o.small ? 15 : 19), (e.textH || e.r * 2) + 12);
  if (!o.silent) Sfx.play('hit');
  if (o.kx !== undefined) e.knock(o.kx, o.ky, o.force || 200);
  if (o.kind === 'attack') {
    if (P.has('fire_atk')) applyBurn(e, 5);
    if (P.has('thunder_atk') && Math.random() < 0.3) chainLightning(e);
  }
  if (e.hp <= 0) killEnemy(e);
}

function chainLightning(src) {
  const near = G.enemies.filter(o => o !== src && !o.dead && !o.untargetable && dist(o, src) < 260)
    .sort((a, b) => dist(a, src) - dist(b, src)).slice(0, 3);
  let from = src;
  if (!near.length) near.push(src);
  for (const t of near) {
    boltFx(from.x, from.y, t.x, t.y, '#cdb8ff', 3);
    damageEnemy(t, 14, { kind: 'power', color: '#cdb8ff', silent: true });
    from = t;
  }
  Sfx.play('thunder');
}

function strikeLightning(x, y, dmg, r = 60) {
  addHazard({ kind: 'circle', team: 'player', x, y, r, delay: 0.08, dmg, fx: 'thunder', color: '#cdb8ff' });
}

function killEnemy(e) {
  if (e.dead) return;
  e.dead = true; e.hp = 0;
  burstParticles(e.x, e.y, e.isBoss ? 80 : 18, e.bloodColor || '#d24a3a', e.isBoss ? 420 : 240, e.isBoss ? 6 : 4, 0.7, e.r);
  G.runSouls += e.souls; G.kills++;
  Sfx.play('kill');
  if (e.isBoss) onBossDefeated(e);
}

function hurtPlayer(dmg) {
  const P = G.player;
  if (!P || P.dead || P.iframes > 0 || P.dashT > 0 || G.state !== 'play') return false;
  dmg = Math.max(1, Math.round(dmg * D().enemyDmg));
  P.hp -= dmg; P.iframes = 0.9; P.hurtT = 0.28;
  G.shake = Math.max(G.shake, 11); G.hitstop = Math.max(G.hitstop, 0.07); G.redFlash = 0.35;
  addText(P.x, P.y, '-' + dmg, '#ff5050', 24, 75);
  burstParticles(P.x, P.y, 14, '#ff4040', 220, 3, 0.4, 30);
  Sfx.play('hurt');
  if (P.hp <= 0) {
    if (P.revives > 0) {
      P.revives--; P.hp = Math.round(P.maxHp * 0.5); P.iframes = 2.2;
      addFx({ type: 'ring', x: P.x, y: P.y, r0: 10, r1: 260, color: '#ffe9a8', width: 6, life: 0.7 });
      banner('불굴(不屈)', '쓰러져도, 다시 일어선다', 1.8);
      for (const h of G.hazards) if (h.team === 'enemy') h.dead = true;
      G.projectiles = G.projectiles.filter(p => p.team !== 'enemy');
    } else { P.hp = 0; P.dead = true; onPlayerDeath(); }
  }
  return true;
}

// ───────── 플레이어 (스사노오) ─────────
const SPR_ANCHOR_X = 46, SPR_FEET = 81, SPR_SCALE = 1.9;
function drawPlayerSprite(x, y, anim, frame, flip, tint) {
  const s = SPR[anim];
  if (!sprReady(s)) {
    circle(x, y - 18, 14, tint || '#e8e4da'); return;
  }
  const dw = 96 * SPR_SCALE;
  ctx.save();
  ctx.translate(x, y + 8);
  if (flip) ctx.scale(-1, 1);
  if (tint) { ctx.globalCompositeOperation = 'lighter'; }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.img, frame * 96, 0, 96, 96, -SPR_ANCHOR_X * SPR_SCALE, -SPR_FEET * SPR_SCALE, dw, dw);
  ctx.restore();
}

class Player {
  constructor(meta) {
    this.x = ARENA.x2 - 70; this.y = ARENA.y2 - 70; this.r = 15;
    this.maxHp = 100 + meta.hp * 10; this.hp = this.maxHp;
    this.dmgMul = 1 + meta.str * 0.08; this.cdMul = 1;
    this.speed = 275; this.aim = -Math.PI / 2;
    this.dashMax = 1 + meta.dash; this.dashCharges = this.dashMax; this.dashRe = 0;
    this.dashT = 0; this.dashDx = 0; this.dashDy = -1; this.trailT = 0; this.afterT = 0;
    this.iframes = 0; this.hurtT = 0;
    this.atkCd = 0; this.combo = 0; this.comboT = 0; this.atkAnim = 0; this.swing = null;
    this.specCd = 0; this.specMax = 1.6; this.castCd = 0; this.castMax = 1;
    this.powers = { attack: null, special: null, dash: null, cast: null };
    this.revives = meta.revive; this.critT = 0; this.dead = false;
    this.moving = false; this.animT = 0; this.flip = false;
  }
  has(id) { for (const k in this.powers) if (this.powers[k] && this.powers[k].id === id) return true; return false; }

  update(dt) {
    const I = Input;
    // 마우스는 대략 몸통 높이를 가리킨다고 보고 지면으로 역투영
    const m = unIso(I.mouse.x, I.mouse.y + 20);
    this.aim = Math.atan2(m.y - this.y, m.x - this.x);
    this.iframes = Math.max(0, this.iframes - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.atkCd -= dt; this.comboT -= dt; this.specCd -= dt; this.castCd -= dt; this.critT -= dt; this.atkAnim -= dt;
    this.spinAnim = (this.spinAnim || 0) - dt; this.castAnim = (this.castAnim || 0) - dt;
    this.animT += dt;
    if (this.swing) { this.swing.t += dt; if (this.swing.t > this.swing.dur) this.swing = null; }
    if (this.dashCharges < this.dashMax) { this.dashRe += dt; if (this.dashRe >= 0.55) { this.dashRe = 0; this.dashCharges++; } }

    let mx = 0, my = 0;
    if (I.isDown('KeyW') || I.isDown('ArrowUp')) my--;
    if (I.isDown('KeyS') || I.isDown('ArrowDown')) my++;
    if (I.isDown('KeyA') || I.isDown('ArrowLeft')) mx--;
    if (I.isDown('KeyD') || I.isDown('ArrowRight')) mx++;
    const ml = Math.hypot(mx, my);
    if (ml) { const d = screenDirToWorld(mx, my); mx = d.x; my = d.y; } // 화면 기준 WASD → 월드 방향
    this.moving = ml > 0;

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.x += this.dashDx * 980 * dt; this.y += this.dashDy * 980 * dt;
      this.afterT -= dt;
      if (this.afterT <= 0) {
        this.afterT = 0.025;
        addFx({ type: 'after', x: this.x, y: this.y, anim: 'dash', frame: 1, flip: this.flip, color: this.has('moon_dash') ? '#9fb8ff' : '#6d86c9', life: 0.22 });
      }
      if (this.has('fire_dash')) {
        this.trailT -= dt;
        if (this.trailT <= 0) { this.trailT = 0.03; addHazard({ kind: 'pool', team: 'player', x: this.x, y: this.y, r: 28, life: 2.5, dps: 16, burn: true, color: '#ff7a2a' }); }
      }
      if (this.dashT <= 0) this.onDashEnd();
    } else {
      const slow = this.atkCd > 0.1 ? 0.4 : 1;
      this.x += mx * this.speed * slow * dt; this.y += my * this.speed * slow * dt;
      const dashKey = I.wasPressed('Space') || I.wasPressed('ShiftLeft') || I.wasPressed('ShiftRight');
      if (dashKey && this.dashCharges > 0) this.dash(ml ? mx : Math.cos(this.aim), ml ? my : Math.sin(this.aim));
      else if ((I.isDown('Mouse0') || I.isDown('KeyJ')) && this.atkCd <= 0) this.attack();
      else if ((I.wasPressed('Mouse2') || I.wasPressed('KeyK')) && this.specCd <= 0) this.special();
    }
    if ((I.wasPressed('KeyQ') || I.wasPressed('KeyL')) && this.powers.cast && this.castCd <= 0) this.cast();
    const sa = isoAng(this.aim);
    if (Math.abs(Math.cos(sa)) > 0.15) this.flip = Math.cos(sa) < 0;
    collideWorld(this);
  }

  dash(dx, dy) {
    this.dashT = 0.16; this.dashDx = dx; this.dashDy = dy;
    this.dashCharges--; this.dashRe = 0; this.atkCd = 0; this.swing = null; this.atkAnim = 0;
    Sfx.play('dash');
    burstParticles(this.x, this.y, 8, 'rgba(200,210,255,0.6)', 120, 3, 0.3);
  }
  onDashEnd() {
    this.iframes = Math.max(this.iframes, 0.06);
    if (this.has('thunder_dash')) strikeLightning(this.x, this.y, 26, 95);
    if (this.has('moon_dash')) { this.critT = 1.5; addFx({ type: 'ring', x: this.x, y: this.y, r0: 40, r1: 8, color: '#cfe0ff', width: 3, life: 0.3 }); }
  }

  attack() {
    this.combo = this.comboT > 0 ? (this.combo + 1) % 3 : 0;
    const c = this.combo, fin = c === 2, a = this.aim;
    const arc = fin ? 2.7 : 1.95, range = fin ? 104 : 86, dmg = fin ? 20 : 11;
    this.atkCd = fin ? 0.42 : 0.25; this.comboT = 0.6; this.atkAnim = 0.27;
    this.x += Math.cos(a) * (fin ? 16 : 9); this.y += Math.sin(a) * (fin ? 16 : 9);
    const dir = c === 1 ? -1 : 1, cx = this.x, cy = this.y;
    this.swing = { t: 0, dur: 0.14, from: a - arc / 2 * dir, to: a + arc / 2 * dir };
    const fireTint = this.has('fire_atk'), thTint = this.has('thunder_atk');
    addFx({ type: 'slash', x: cx, y: cy, ang: a, arc, range, dir, life: 0.17, color: fin ? 'rgba(255,246,214,0.9)' : 'rgba(225,236,255,0.75)', glow: fireTint ? '#ff6a2a' : thTint ? '#a98bff' : '#9fc0ff' });
    Sfx.play(fin ? 'heavy' : 'slash');
    const crit = this.critT > 0; let hit = false;
    for (const e of G.enemies) {
      if (e.dead || e.untargetable) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d > range + e.r) continue;
      if (d > e.r && Math.abs(angDiff(a, Math.atan2(e.y - cy, e.x - cx))) > arc / 2 + Math.atan2(e.r, d)) continue;
      damageEnemy(e, dmg, { kind: 'attack', crit, kx: Math.cos(a), ky: Math.sin(a), force: fin ? 460 : 170 });
      hit = true;
    }
    if (hit) { if (crit) this.critT = 0; G.hitstop = Math.max(G.hitstop, fin ? 0.055 : 0.03); G.shake = Math.max(G.shake, fin ? 6 : 2.5); }
    if (fin && this.has('moon_atk')) {
      G.projectiles.push(new Projectile({ x: cx, y: cy, vx: Math.cos(a) * 700, vy: Math.sin(a) * 700, r: 22, dmg: 20, team: 'player', pierce: true, shape: 'crescent', color: '#dfe9ff', life: 0.9, ang: a }));
      Sfx.play('moon');
    }
  }

  special() {
    const big = this.has('moon_sp'), R = big ? 180 : 115, cx = this.x, cy = this.y;
    this.specCd = this.specMax * this.cdMul; this.atkCd = 0.3; this.atkAnim = 0; this.spinAnim = 0.33;
    this.swing = { t: 0, dur: 0.25, from: this.aim, to: this.aim + TAU };
    addFx({ type: 'spin', x: cx, y: cy, r: R, color: big ? '#cfe0ff' : this.has('fire_sp') ? '#ff9a4a' : '#e6eeff', life: 0.28 });
    Sfx.play('heavy');
    const crit = this.critT > 0; let hit = false;
    for (const e of G.enemies) {
      if (e.dead || e.untargetable) continue;
      const d = Math.hypot(e.x - cx, e.y - cy) || 1;
      if (d < R + e.r) {
        damageEnemy(e, 24, { kind: 'special', crit, kx: (e.x - cx) / d, ky: (e.y - cy) / d, force: 400 });
        if (big) e.slowT = 2;
        hit = true;
      }
    }
    if (hit) { if (crit) this.critT = 0; G.hitstop = Math.max(G.hitstop, 0.05); G.shake = Math.max(G.shake, 6); }
    if (this.has('fire_sp')) {
      for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8 + this.aim;
        G.projectiles.push(new Projectile({ x: cx, y: cy, vx: Math.cos(a) * 470, vy: Math.sin(a) * 470, r: 10, dmg: 11, team: 'player', burn: true, color: '#ff8a3a', life: 0.9 }));
      }
    }
    if (this.has('thunder_sp')) {
      G.enemies.filter(e => !e.dead && !e.untargetable && dist(e, this) < 340)
        .sort((a, b) => dist(a, this) - dist(b, this)).slice(0, 4)
        .forEach((e, i) => setTimer(i * 0.07, () => strikeLightning(e.x, e.y, 22, 55)));
    }
  }

  cast() {
    const p = this.powers.cast;
    this.castMax = p.cd || 8;
    this.castCd = this.castMax * this.cdMul; this.castAnim = 0.5;
    if (p.id === 'fire_cast') {
      const m = unIso(Input.mouse.x, Input.mouse.y), tx = clamp(m.x, ARENA.x1, ARENA.x2), ty = clamp(m.y, ARENA.y1, ARENA.y2);
      addHazard({ kind: 'circle', team: 'player', x: tx, y: ty, r: 120, delay: 0.45, dmg: 50, fx: 'fire', burn: true, color: '#ff7a2a' });
    } else if (p.id === 'thunder_cast') {
      for (let i = 0; i < 8; i++) setTimer(i * 0.3, () => {
        const alive = G.enemies.filter(e => !e.dead && !e.untargetable);
        const t = alive.length ? pick(alive) : { x: rand(ARENA.x1 + 50, ARENA.x2 - 50), y: rand(ARENA.y1 + 50, ARENA.y2 - 50) };
        strikeLightning(t.x + rand(-15, 15), t.y + rand(-15, 15), 24, 65);
      });
      Sfx.play('thunder');
    } else if (p.id === 'moon_cast') {
      G.eclipse = 4;
      addFx({ type: 'ring', x: this.x, y: this.y, r0: 20, r1: 900, color: '#cfe0ff', width: 8, life: 0.8 });
      Sfx.play('moon');
    }
  }

  draw() {
    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(this.x, this.y + 6, 20, 8, 0, 0, TAU); ctx.fill();
    if (this.critT > 0) { ctx.save(); ctx.shadowColor = '#cfe0ff'; ctx.shadowBlur = 25; ring(this.x, this.y - 18, 30, 'rgba(207,224,255,0.6)', 2); ctx.restore(); }
    // 우선순위: 피격 > 대시 > 주술 > 회전베기 > 연격 > 달리기 > 대기
    const once = (k, elapsed) => Math.min(SPR[k].n - 1, SPR[k].hit + Math.floor(elapsed * SPR[k].fps));
    let anim = 'idle', frame = Math.floor(this.animT * SPR.idle.fps) % SPR.idle.n;
    if (this.hurtT > 0) { anim = 'hurt'; frame = once('hurt', 0.28 - this.hurtT); }
    else if (this.dashT > 0) { anim = 'dash'; frame = Math.floor(this.animT * SPR.dash.fps) % SPR.dash.n; }
    else if (this.castAnim > 0) { anim = 'cast'; frame = once('cast', 0.5 - this.castAnim); }
    else if (this.spinAnim > 0) { anim = 'spin'; frame = once('spin', 0.33 - this.spinAnim); }
    else if (this.atkAnim > 0) { anim = 'attack' + (this.combo + 1); frame = once(anim, 0.27 - this.atkAnim); }
    else if (this.moving) { anim = 'run'; frame = Math.floor(this.animT * SPR.run.fps) % SPR.run.n; }
    const blink = this.iframes > 0 && this.dashT <= 0 && Math.floor(G.time * 18) % 2 === 0;
    ctx.globalAlpha = blink ? 0.35 : 1;
    drawPlayerSprite(this.x, this.y, anim, frame, this.flip);
    ctx.globalAlpha = 1;
    // 스프라이트가 없을 때만 검 궤적을 선으로 그린다 (스프라이트에는 검이 그려져 있음)
    if (this.swing && !sprReady(SPR.idle)) {
      const k = clamp(this.swing.t / this.swing.dur, 0, 1), a = isoAng(lerp(this.swing.from, this.swing.to, k));
      const cx = this.x, cy = this.y - 18;
      ctx.save(); ctx.strokeStyle = '#eef4ff'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.shadowColor = '#9fc0ff'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18); ctx.lineTo(cx + Math.cos(a) * 62, cy + Math.sin(a) * 62); ctx.stroke(); ctx.restore();
    }
    // 조준 표시
    const sa = isoAng(this.aim), ax = this.x + Math.cos(sa) * 40, ay = this.y + 2 + Math.sin(sa) * 26;
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(sa); ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill(); ctx.restore();
  }
}

// ───────── 투사체 ─────────
class Projectile {
  constructor(o) {
    Object.assign(this, { r: 7, dmg: 10, team: 'enemy', life: 6, color: '#fff', pierce: false, shape: 'orb', dead: false }, o);
    if (this.pierce) this.hits = new Set();
    if (this.ang === undefined) this.ang = Math.atan2(this.vy, this.vx);
  }
  update(dt) {
    const s = this.team === 'enemy' ? dt * G.enemyScale() : dt;
    this.x += this.vx * s; this.y += this.vy * s; this.life -= s;
    if (this.life <= 0 || this.x < ARENA.x1 - 30 || this.x > ARENA.x2 + 30 || this.y < ARENA.y1 - 30 || this.y > ARENA.y2 + 30) { this.dead = true; return; }
    if (!this.pierce && G.obstacles.some(ob => Math.hypot(this.x - ob.x, this.y - ob.y) < ob.r + this.r * 0.5)) {
      this.dead = true; burstParticles(this.x, this.y, 5, this.color, 120, 2, 0.25); return;
    }
    if (this.team === 'enemy') {
      const P = G.player;
      if (Math.hypot(this.x - P.x, this.y - P.y) < this.r + P.r * 0.8 && hurtPlayer(this.dmg)) this.dead = true;
    } else {
      for (const e of G.enemies) {
        if (e.dead || e.untargetable || (this.hits && this.hits.has(e))) continue;
        if (Math.hypot(this.x - e.x, this.y - e.y) < this.r + e.r) {
          const d = Math.hypot(this.vx, this.vy) || 1;
          damageEnemy(e, this.dmg, { kind: 'power', kx: this.vx / d, ky: this.vy / d, force: 160, color: this.color });
          if (this.burn) applyBurn(e, 5);
          if (this.hits) this.hits.add(e); else { this.dead = true; break; }
        }
      }
    }
  }
  draw() {
    ctx.save(); ctx.shadowColor = this.color; ctx.shadowBlur = 14;
    if (this.shape === 'crescent') {
      ctx.translate(this.x, this.y); ctx.rotate(isoAng(this.ang));
      ctx.beginPath(); ctx.arc(0, 0, this.r, -1.3, 1.3); ctx.arc(-this.r * 0.45, 0, this.r * 0.85, 1.1, -1.1, true); ctx.closePath();
      ctx.fillStyle = this.color; ctx.fill();
    } else if (this.shape === 'feather') {
      ctx.translate(this.x, this.y); ctx.rotate(isoAng(this.ang));
      ctx.fillStyle = this.color; ctx.beginPath(); ctx.ellipse(0, 0, this.r * 2, this.r * 0.7, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-this.r * 2, 0); ctx.lineTo(this.r * 2, 0); ctx.stroke();
    } else {
      circle(this.x, this.y, this.r, this.color);
      circle(this.x, this.y, this.r * 0.5, 'rgba(255,255,255,0.85)');
    }
    ctx.restore();
  }
}
function enemyShoot(x, y, ang, speed, o = {}) {
  speed *= D().bullet;
  G.projectiles.push(new Projectile(Object.assign({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, team: 'enemy' }, o)));
}

// ───────── Hazard: 예고 원/직선/광선/충격파/장판 ─────────
// kind: circle | line | beam | ring | pool, team: enemy | player
class Hazard {
  constructor(o) {
    Object.assign(this, { t: 0, delay: 0, active: 0.12, dmg: 0, team: 'enemy', color: '#ff4a3a', triggered: false, dead: false, life: 0, tick: 0 }, o);
    this.hitSet = new Set();
    if (this.kind === 'ring') this.rad = this.rad || 0;
    if (this.team === 'enemy') { this.delay *= D().tele; if (this.speed) this.speed *= D().bullet; } // 난이도: 예고 시간·충격파 속도
  }
  update(dt) {
    if (this.cancelOnDeath && this.owner && this.owner.dead && !this.triggered) { this.dead = true; return; }
    const s = this.team === 'enemy' ? dt * G.enemyScale() : dt;
    this.t += s;
    const P = G.player;
    if (this.kind === 'ring') {
      this.rad += this.speed * s;
      if (this.rad > this.maxR) this.dead = true;
      if (!this.hitP && Math.abs(Math.hypot(P.x - this.x, P.y - this.y) - this.rad) < this.width / 2 + P.r * 0.6 && hurtPlayer(this.dmg)) this.hitP = true;
      return;
    }
    if (this.follow && this.owner) { this.x = this.owner.x; this.y = this.owner.y; }
    if (this.t < this.delay) return;
    if (!this.triggered) { this.triggered = true; this.onTrigger(); }
    const at = this.t - this.delay;
    if (this.kind === 'pool') {
      if (at > this.life) { this.dead = true; return; }
      this.tick -= s;
      if (this.tick <= 0) {
        this.tick = 0.4;
        if (this.team === 'enemy') { if (Math.hypot(P.x - this.x, P.y - this.y) < this.r + P.r * 0.4) hurtPlayer(this.dmg); }
        else for (const e of G.enemies) {
          if (!e.dead && !e.untargetable && Math.hypot(e.x - this.x, e.y - this.y) < this.r + e.r) {
            damageEnemy(e, this.dps * 0.4, { kind: 'power', silent: true, small: true, color: '#ffb07a' });
            if (this.burn) applyBurn(e, 3);
          }
        }
      }
      return;
    }
    if (this.kind === 'beam') {
      this.ang += (this.angVel || 0) * s;
      if (at > this.active) { this.dead = true; return; }
      const x2 = this.x + Math.cos(this.ang) * this.len, y2 = this.y + Math.sin(this.ang) * this.len;
      if (segDist(P.x, P.y, this.x, this.y, x2, y2) < this.width / 2 + P.r * 0.6) hurtPlayer(this.dmg);
      return;
    }
    if (at > this.active) { this.dead = true; return; }
    if (this.dmg <= 0) return;
    if (this.team === 'enemy') {
      if (!this.hitP && this.hits(P, P.r * 0.6) && hurtPlayer(this.dmg)) this.hitP = true;
    } else {
      for (const e of G.enemies) {
        if (e.dead || e.untargetable || this.hitSet.has(e) || !this.hits(e, e.r)) continue;
        this.hitSet.add(e);
        const d = Math.hypot(e.x - this.x, e.y - this.y) || 1;
        damageEnemy(e, this.dmg, { kind: 'power', kx: (e.x - this.x) / d, ky: (e.y - this.y) / d, force: 260, color: this.color });
        if (this.burn) applyBurn(e, 6);
      }
    }
  }
  hits(o, r) {
    if (this.kind === 'circle') return Math.hypot(o.x - this.x, o.y - this.y) < this.r + r;
    if (this.kind === 'line') return segDist(o.x, o.y, this.x, this.y, this.x + Math.cos(this.ang) * this.len, this.y + Math.sin(this.ang) * this.len) < this.width / 2 + r;
    return false;
  }
  onTrigger() {
    const x = this.x, y = this.y;
    switch (this.fx) {
      case 'fire':
        burstParticles(x, y, 34, '#ff7a2a', 380, 5, 0.6); burstParticles(x, y, 16, '#ffd36a', 220, 4, 0.5);
        addFx({ type: 'ring', x, y, r0: this.r * 0.3, r1: this.r * 1.1, color: '#ffb36a', width: 5, life: 0.3 });
        G.shake = Math.max(G.shake, 7); Sfx.play('boom'); break;
      case 'thunder':
        boltFx(x, y, x, y, '#d9c8ff', 5, 460, 0);
        burstParticles(x, y, 16, '#e7dcff', 300, 3, 0.4);
        addFx({ type: 'ring', x, y, r0: 6, r1: this.r, color: '#cdb8ff', width: 4, life: 0.25 });
        G.shake = Math.max(G.shake, 5); Sfx.play('thunder'); break;
      case 'slam':
        burstParticles(x, y, 18, '#8a6a5a', 260, 4, 0.5);
        addFx({ type: 'ring', x, y, r0: 10, r1: this.r, color: 'rgba(255,200,170,0.7)', width: 4, life: 0.25 });
        G.shake = Math.max(G.shake, 5); Sfx.play('boom'); break;
      case 'moon':
        burstParticles(x, y, 24, '#e6eeff', 300, 4, 0.6);
        addFx({ type: 'ring', x, y, r0: 10, r1: this.r * 1.1, color: '#e6eeff', width: 5, life: 0.35 });
        G.shake = Math.max(G.shake, 6); Sfx.play('moon'); break;
      case 'bite':
        burstParticles(x + Math.cos(this.ang) * this.len * 0.5, y + Math.sin(this.ang) * this.len * 0.5, 20, '#9aff7a', 260, 4, 0.4);
        G.shake = Math.max(G.shake, 6); Sfx.play('heavy'); break;
      case 'poison': burstParticles(x, y, 14, '#7fe05a', 160, 4, 0.5); Sfx.play('hit'); break;
    }
  }
  draw() {
    const c = this.color;
    ctx.save();
    if (this.kind === 'ring') {
      ctx.shadowColor = c; ctx.shadowBlur = 16; ctx.globalAlpha = 0.85;
      ring(this.x, this.y, this.rad, c, this.width * 0.6);
      ctx.restore(); return;
    }
    const pre = this.t < this.delay, prog = this.delay ? clamp(this.t / this.delay, 0, 1) : 1;
    if (this.kind === 'circle') {
      if (pre) {
        ctx.globalAlpha = 0.16; circle(this.x, this.y, this.r, c);
        ctx.globalAlpha = 0.32; circle(this.x, this.y, this.r * prog, c);
        ctx.globalAlpha = 0.8; ring(this.x, this.y, this.r, c, 2);
      } else {
        const k = 1 - (this.t - this.delay) / Math.max(0.01, this.active);
        ctx.globalAlpha = 0.55 * k; ctx.shadowColor = c; ctx.shadowBlur = 25; circle(this.x, this.y, this.r, c);
      }
    } else if (this.kind === 'line' || this.kind === 'beam') {
      ctx.translate(this.x, this.y); ctx.rotate(this.ang);
      if (pre) {
        if (this.kind === 'beam') { ctx.globalAlpha = 0.35 + 0.3 * Math.sin(this.t * 30); ctx.fillStyle = c; ctx.fillRect(0, -2, this.len, 4); }
        else {
          ctx.globalAlpha = 0.14; ctx.fillStyle = c; ctx.fillRect(0, -this.width / 2, this.len, this.width);
          ctx.globalAlpha = 0.3; ctx.fillRect(0, -this.width / 2, this.len * prog, this.width);
          ctx.globalAlpha = 0.7; ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.strokeRect(0, -this.width / 2, this.len, this.width);
        }
      } else {
        const k = this.kind === 'beam' ? 1 : 1 - (this.t - this.delay) / Math.max(0.01, this.active);
        ctx.globalAlpha = 0.75 * k; ctx.shadowColor = c; ctx.shadowBlur = 30; ctx.fillStyle = c;
        ctx.fillRect(0, -this.width / 2, this.len, this.width);
        ctx.globalAlpha = 0.9 * k; ctx.fillStyle = '#fff'; ctx.fillRect(0, -this.width / 6, this.len, this.width / 3);
      }
    } else if (this.kind === 'pool') {
      if (pre) { ctx.globalAlpha = 0.25; ring(this.x, this.y, this.r, c, 2); ctx.globalAlpha = 0.15; circle(this.x, this.y, this.r * prog, c); }
      else {
        const left = this.life - (this.t - this.delay), k = clamp(left / 0.6, 0, 1);
        const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r);
        g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = (0.45 + 0.12 * Math.sin(G.time * 12 + this.x)) * k; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
}
function addHazard(o) { const h = new Hazard(o); G.hazards.push(h); return h; }
