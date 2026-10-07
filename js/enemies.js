'use strict';
// ───────── 일반 적: 요괴들 ─────────

// 스프라이트시트 (sprite-artist 제작, tools/sprites/*.py). 가로 스트립, 오른쪽을 바라봄.
// [프레임 수, fps]. 앵커(ax, ay)는 프레임 안의 발끝(오니비는 불꽃 머리 중심) 좌표.
function enemySheet(name, F, ax, ay, scale, anims, dir = 'enemies') {
  const o = { F, ax, ay, scale, anims: {} };
  for (const [k, [n, fps]] of Object.entries(anims)) o.anims[k] = { img: loadImg(`assets/${dir}/${name}_${k}.png`), n, fps };
  return o;
}
const ESPR = {
  oni: enemySheet('oni', 96, 46, 82, 1.9, { idle: [4, 5], move: [6, 8], windup: [4, 6], attack: [5, 10], hurt: [2, 10] }),
  kappa: enemySheet('kappa', 48, 24, 44, 1.6, { idle: [4, 5], move: [6, 10], shoot: [4, 12], hurt: [2, 10] }),
  onibi: enemySheet('onibi', 48, 24, 28, 1.9, { idle: [6, 10], charge: [4, 12], hurt: [2, 10] }),
  tengu: enemySheet('tengu', 64, 32, 58, 1.9, { idle: [4, 6], vanish: [5, 14], appear: [5, 14], throw: [4, 10], hurt: [2, 10] }),
};

class Enemy {
  constructor(x, y, o) {
    this.x = x; this.y = y; this.r = o.r; this.name = o.name;
    const scale = o.boss ? 1 : 1 + G.stageIdx * 0.4;
    this.maxHp = this.hp = Math.round(o.hp * scale);
    this.speed = o.speed || 0;
    this.dmgMul = o.boss ? 1 : 1 + G.stageIdx * 0.15;
    this.souls = o.souls || 1;
    this.burn = 0; this.burnDps = 0; this.burnTick = 0; this.slowT = 0; this.flash = 0;
    this.kx = 0; this.ky = 0; this.dead = false; this.t = rand(0, 10); this.face = 0;
    this.bloodColor = o.blood || '#d24a3a';
  }
  timeScale() { let s = G.enemyScale(); if (this.slowT > 0) s *= 0.5; return s; }
  // 스프라이트가 로드되면 발끝을 지면에 맞추고, 아니면 도형을 몸 반지름만큼 띄워 그린다
  get lift() { return this.spriteReady() ? 0 : this.r * 0.75; }
  spriteReady() { return !!this.spr && sprReady(this.spr.anims.idle); }
  loop(anim, t, fps) { const a = this.spr.anims[anim]; return Math.floor(t * (fps || a.fps)) % a.n; }
  flipX() { return Math.cos(isoAng(this.face)) < 0; } // 화면에서 왼쪽을 보면 좌우 반전
  drawSpr(anim, frame, o = {}) {
    const s = this.spr, a = s.anims[anim], sc = s.scale, F = s.F;
    frame = clamp(Math.floor(frame), 0, a.n - 1);
    ctx.save();
    ctx.translate(this.x, this.y - (o.h || 0));
    if (o.rot !== undefined) { ctx.rotate(o.rot); if (Math.cos(o.rot) < 0) ctx.scale(1, -1); }
    else if (this.flipX()) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    const blit = () => ctx.drawImage(a.img, frame * F, 0, F, F, -s.ax * sc, -s.ay * sc, F * sc, F * sc);
    blit();
    if (this.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.8; blit(); } // 피격 시 하얗게 번쩍
    ctx.restore();
  }
  drawShadowFeet(w) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(this.x, this.y + 2, w, w * 0.38, 0, 0, TAU); ctx.fill(); }
  baseUpdate(dt) {
    this.t += dt; this.flash = Math.max(0, this.flash - dt); this.hurtT = Math.max(0, (this.hurtT || 0) - dt);
    if (this.slowT > 0) this.slowT -= dt;
    if (this.burn > 0) {
      this.burn -= dt; this.burnTick += dt;
      if (Math.random() < dt * 14) addFx({ type: 'p', x: this.x + rand(-this.r, this.r) * 0.5, y: this.y + rand(-this.r, this.r) * 0.5, h: rand(5, this.r * 1.6), vh: 60, vx: 0, vy: 0, color: pick(['#ff7a2a', '#ffb04a']), size: 3, life: 0.4 });
      if (this.burnTick >= 0.5) { this.burnTick -= 0.5; damageEnemy(this, this.burnDps * 0.5, { raw: true, silent: true, small: true, color: '#ff9a4a' }); }
      if (this.burn <= 0) this.burnDps = 0;
    }
    this.x += this.kx * dt; this.y += this.ky * dt;
    const k = Math.pow(0.0015, dt); this.kx *= k; this.ky *= k;
    collideWorld(this);
  }
  knock(ax, ay, f) { if (this.isBoss) f *= 0.08; else if (this.heavy) f *= 0.5; this.kx += ax * f; this.ky += ay * f; }
  moveToward(tx, ty, spd, dt) { const a = Math.atan2(ty - this.y, tx - this.x); this.x += Math.cos(a) * spd * dt; this.y += Math.sin(a) * spd * dt; }
  drawShadow() { ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.beginPath(); ctx.ellipse(this.x, this.y + this.r * 0.75, this.r * 1.1, this.r * 0.42, 0, 0, TAU); ctx.fill(); }
  drawOverlay() {
    if (this.flash > 0 && !this.spriteReady()) { ctx.globalAlpha = 0.7; circle(this.x, this.y, this.r, '#ffffff'); ctx.globalAlpha = 1; }
    if (this.slowT > 0 || G.eclipse > 0) { ctx.globalAlpha = 0.6; ring(this.x, this.y, this.r + 5, '#9fc0ff', 2); ctx.globalAlpha = 1; }
    if (!this.isBoss && this.hp < this.maxHp) {
      const w = this.r * 2.2, x = this.x - w / 2, y = this.y - (this.spriteReady() ? this.barH : this.r + 14);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
      ctx.fillStyle = this.burn > 0 ? '#ff8a3a' : '#e24a3a'; ctx.fillRect(x, y, w * this.hp / this.maxHp, 4);
    }
  }
}

// 오니: 느리고 단단한 근접. 몽둥이 내려찍기(예고 원)
class Oni extends Enemy {
  constructor(x, y) { super(x, y, { r: 23, hp: 70, speed: 88, name: '오니', souls: 2 }); this.spr = ESPR.oni; this.barH = this.textH = 104; this.st = 'chase'; this.cd = rand(0.6, 1.4); this.heavy = true; }
  update(dt) {
    this.baseUpdate(dt);
    const s = dt * this.timeScale(), P = G.player, d = dist(this, P);
    this.cd -= s;
    if (this.st === 'chase') {
      this.face = angTo(this, P);
      this.moving = d > 62;
      if (this.moving) this.moveToward(P.x, P.y, this.speed, s);
      if (d < 115 && this.cd <= 0) {
        this.st = 'wind'; this.stT = 0.65;
        const a = this.face;
        addHazard({ kind: 'circle', x: this.x + Math.cos(a) * 52, y: this.y + Math.sin(a) * 52, r: 60, delay: 0.65, dmg: 15 * this.dmgMul, owner: this, cancelOnDeath: true, fx: 'slam', color: '#ff5040' });
      }
    } else if (this.st === 'wind') { this.stT -= s; if (this.stT <= 0) { this.st = 'recover'; this.stT = 0.75; } }
    else if (this.st === 'recover') { this.stT -= s; if (this.stT <= 0) { this.st = 'chase'; this.cd = rand(1, 1.8); } }
  }
  draw() {
    if (!this.spriteReady()) return this.drawShape();
    this.drawShadowFeet(30);
    let anim = 'idle', f = this.loop('idle', this.t);
    if (this.st === 'wind') { anim = 'windup'; f = (0.65 - this.stT) * 6; }          // 몽둥이를 치켜드는 예고
    else if (this.st === 'recover') { anim = 'attack'; f = (0.75 - this.stT) * 10; } // 내려찍기 후 마지막 프레임 유지
    else if (this.hurtT > 0) { anim = 'hurt'; f = this.hurtT > 0.1 ? 0 : 1; }
    else if (this.moving) { anim = 'move'; f = this.loop('move', this.t); }
    this.drawSpr(anim, f);
    this.drawOverlay();
  }
  drawShape() {
    this.drawShadow();
    const { x, y, r } = this, bob = Math.sin(this.t * 6) * 1.5;
    circle(x, y + bob, r, '#8f2a22'); circle(x, y + bob - 3, r * 0.82, '#b8392c');
    // 뿔
    ctx.fillStyle = '#efe2c4';
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + sgn * 8, y - r * 0.6 + bob); ctx.lineTo(x + sgn * 14, y - r - 10 + bob); ctx.lineTo(x + sgn * 2, y - r * 0.75 + bob); ctx.fill(); }
    circle(x - 7, y - 4 + bob, 3.5, '#ffd84a'); circle(x + 7, y - 4 + bob, 3.5, '#ffd84a');
    // 가나보(쇠몽둥이)
    const a = this.face + (this.st === 'wind' ? -1.4 * (1 - this.stT / 0.65) : 0.6);
    ctx.save(); ctx.translate(x, y + bob); ctx.rotate(a);
    ctx.fillStyle = '#3a3330'; ctx.fillRect(r * 0.4, -5, r * 1.6, 10);
    ctx.fillStyle = '#5a504a'; for (let i = 0; i < 3; i++) ctx.fillRect(r * 1.1 + i * 9, -7, 4, 14);
    ctx.restore();
    this.drawOverlay();
  }
}

// 갓파: 거리를 벌리며 물탄을 쏘는 원거리
class Kappa extends Enemy {
  constructor(x, y) { super(x, y, { r: 17, hp: 42, speed: 110, name: '갓파', blood: '#3aa36a' }); this.spr = ESPR.kappa; this.barH = this.textH = 58; this.cd = rand(1, 2); this.st = 'move'; this.strafe = pick([-1, 1]); }
  update(dt) {
    this.baseUpdate(dt);
    const s = dt * this.timeScale(), P = G.player, d = dist(this, P), a = angTo(this, P);
    this.face = a; this.cd -= s; this.shotT = Math.max(0, (this.shotT || 0) - s);
    if (this.st === 'move') {
      let mx = Math.cos(a + Math.PI / 2) * this.strafe * 0.7, my = Math.sin(a + Math.PI / 2) * this.strafe * 0.7;
      if (d < 230) { mx -= Math.cos(a); my -= Math.sin(a); } else if (d > 380) { mx += Math.cos(a); my += Math.sin(a); }
      const l = Math.hypot(mx, my) || 1;
      this.x += mx / l * this.speed * s; this.y += my / l * this.speed * s;
      if (Math.random() < s * 0.5) this.strafe *= -1;
      if (this.cd <= 0) { this.st = 'aim'; this.stT = 0.45; }
    } else {
      this.stT -= s;
      if (this.stT <= 0) {
        const n = G.stageIdx >= 1 ? 3 : 1;
        for (let i = 0; i < n; i++) enemyShoot(this.x, this.y, a + (i - (n - 1) / 2) * 0.24, 270, { r: 7, dmg: 10 * this.dmgMul, color: '#5ad1ff' });
        Sfx.play('shoot');
        this.st = 'move'; this.cd = rand(1.8, 2.6); this.shotT = 0.17;
      }
    }
  }
  draw() {
    if (!this.spriteReady()) return this.drawShape();
    this.drawShadowFeet(18);
    let anim = 'move', f = this.loop('move', this.t);
    if (this.st === 'aim') { anim = 'shoot'; f = this.stT > 0.22 ? 0 : 1; }       // 숨 들이쉼 → 볼 부풀림
    else if (this.shotT > 0) { anim = 'shoot'; f = this.shotT > 0.085 ? 2 : 3; } // 물 뿜기 → 여운
    else if (this.hurtT > 0) { anim = 'hurt'; f = this.hurtT > 0.1 ? 0 : 1; }
    this.drawSpr(anim, f);
    this.drawOverlay();
  }
  drawShape() {
    this.drawShadow();
    const { x, y, r } = this;
    circle(x, y, r, '#2f6e3a'); circle(x - Math.cos(this.face) * 5, y - Math.sin(this.face) * 5, r * 0.75, '#4b8c45');
    circle(x, y - 4, r * 0.48, '#cfe6d8'); circle(x, y - 4, r * 0.32, '#8fc7d8'); // 머리 접시
    circle(x + Math.cos(this.face) * 12, y + Math.sin(this.face) * 12, 5, '#e7c24a'); // 부리
    if (this.st === 'aim') { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.t * 40); ring(x, y, r + 6, '#5ad1ff', 2); ctx.globalAlpha = 1; }
    this.drawOverlay();
  }
}

// 오니비(도깨비불): 맴돌다 직선 돌진
class Onibi extends Enemy {
  constructor(x, y) { super(x, y, { r: 12, hp: 24, speed: 125, name: '오니비', blood: '#6ab8ff' }); this.spr = ESPR.onibi; this.barH = this.textH = 62; this.st = 'hover'; this.cd = rand(1.4, 2.8); this.seed = rand(0, TAU); }
  update(dt) {
    this.baseUpdate(dt);
    const s = dt * this.timeScale(), P = G.player;
    this.cd -= s;
    if (this.st === 'hover') {
      this.face = angTo(this, P);
      const ox = P.x + Math.cos(this.t * 0.8 + this.seed) * 190, oy = P.y + Math.sin(this.t * 0.8 + this.seed) * 150;
      this.moveToward(ox, oy, this.speed, s);
      if (this.cd <= 0 && dist(this, P) < 480) {
        this.st = 'aim'; this.stT = 0.55; this.cAng = angTo(this, P);
        addHazard({ kind: 'line', x: this.x, y: this.y, ang: this.cAng, len: 270, width: 26, delay: 0.55, active: 0, dmg: 0, owner: this, cancelOnDeath: true, color: '#6ab8ff' });
      }
    } else if (this.st === 'aim') {
      this.stT -= s; if (this.stT <= 0) { this.st = 'charge'; this.stT = 0.4; this.hitDone = false; }
    } else {
      this.stT -= s;
      this.x += Math.cos(this.cAng) * 640 * s; this.y += Math.sin(this.cAng) * 640 * s;
      if (!this.hitDone && Math.hypot(this.x - P.x, this.y - P.y) < this.r + P.r && hurtPlayer(10 * this.dmgMul)) this.hitDone = true;
      if (Math.random() < 0.6) addFx({ type: 'p', x: this.x, y: this.y, h: 16, vx: 0, vy: 0, color: '#6ab8ff', size: 5, life: 0.3 });
      if (this.stT <= 0) { this.st = 'hover'; this.cd = rand(1.6, 2.8); }
    }
  }
  draw() {
    if (!this.spriteReady()) return this.drawShape();
    const h = 24 + Math.sin(this.t * 4) * 3; // 공중에 떠 있음
    this.drawShadowFeet(10);
    ctx.save(); ctx.shadowColor = '#6ab8ff'; ctx.shadowBlur = 18;
    if (this.st === 'charge') this.drawSpr('charge', this.loop('charge', this.t), { h, rot: isoAng(this.cAng) });
    else if (this.hurtT > 0) this.drawSpr('hurt', this.hurtT > 0.1 ? 0 : 1, { h });
    else this.drawSpr('idle', this.loop('idle', this.t, this.st === 'aim' ? 16 : 10), { h });
    ctx.restore();
    this.drawOverlay();
  }
  drawShape() {
    const { x, y, r } = this, fl = Math.sin(this.t * 14) * 2;
    ctx.save(); ctx.shadowColor = '#6ab8ff'; ctx.shadowBlur = 22;
    ctx.fillStyle = '#3a7ad8'; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.quadraticCurveTo(x, y - r * 2.6 - fl, x + r, y); ctx.arc(x, y, r, 0, Math.PI); ctx.fill();
    circle(x, y + 1, r * 0.65, '#bfe4ff');
    ctx.restore();
    circle(x - 4, y, 2, '#103060'); circle(x + 4, y, 2, '#103060');
    this.drawOverlay();
  }
}

// 텐구: 순간이동 후 깃털 부채 투척
class Tengu extends Enemy {
  constructor(x, y) { super(x, y, { r: 18, hp: 52, name: '텐구', souls: 2 }); this.spr = ESPR.tengu; this.barH = this.textH = 90; this.st = 'idle'; this.cd = rand(0.8, 1.8); this.alpha = 1; }
  update(dt) {
    this.baseUpdate(dt);
    const s = dt * this.timeScale(), P = G.player;
    this.face = angTo(this, P); this.postT = Math.max(0, (this.postT || 0) - s);
    this.untargetable = this.alpha < 0.35;
    if (this.st === 'idle') { this.cd -= s; if (this.cd <= 0) { this.st = 'vanish'; this.stT = 0.35; } }
    else if (this.st === 'vanish') {
      this.stT -= s; this.alpha = Math.max(0, this.stT / 0.35);
      if (this.stT <= 0) {
        for (let i = 0; i < 20; i++) {
          const a = rand(0, TAU), d = rand(210, 300), nx = P.x + Math.cos(a) * d, ny = P.y + Math.sin(a) * d;
          if (!inObstacle(nx, ny, this.r + 10) && nx > ARENA.x1 + 40 && nx < ARENA.x2 - 40 && ny > ARENA.y1 + 40 && ny < ARENA.y2 - 40) { this.x = nx; this.y = ny; break; }
        }
        burstParticles(this.x, this.y, 10, '#222', 160, 4, 0.4);
        this.st = 'appear'; this.stT = 0.35;
      }
    } else if (this.st === 'appear') { this.stT -= s; this.alpha = 1 - Math.max(0, this.stT / 0.35); if (this.stT <= 0) { this.st = 'throw'; this.stT = 0.4; } }
    else if (this.st === 'throw') {
      this.stT -= s;
      if (this.stT <= 0) {
        for (let i = -2; i <= 2; i++) enemyShoot(this.x, this.y, this.face + i * 0.19, 330, { r: 6, dmg: 9 * this.dmgMul, color: '#e8e0c8', shape: 'feather' });
        Sfx.play('shoot');
        this.st = 'idle'; this.cd = rand(1.6, 2.6); this.postT = 0.12;
      }
    }
  }
  draw() {
    if (!this.spriteReady()) return this.drawShape();
    // vanish/appear 프레임에 연기와 페이드가 들어 있으므로 alpha는 쓰지 않는다
    if (this.st !== 'vanish' && this.st !== 'appear') this.drawShadowFeet(20);
    let anim = 'idle', f = this.loop('idle', this.t);
    if (this.st === 'vanish') { anim = 'vanish'; f = (1 - this.stT / 0.35) * 5; }
    else if (this.st === 'appear') { anim = 'appear'; f = (1 - this.stT / 0.35) * 5; }
    else if (this.st === 'throw') { anim = 'throw'; f = Math.min(2, (1 - this.stT / 0.4) * 3); }
    else if (this.postT > 0) { anim = 'throw'; f = 3; }
    else if (this.hurtT > 0) { anim = 'hurt'; f = this.hurtT > 0.1 ? 0 : 1; }
    this.drawSpr(anim, f);
    if (!this.untargetable) this.drawOverlay();
  }
  drawShape() {
    ctx.globalAlpha = this.alpha;
    this.drawShadow();
    const { x, y, r } = this, flap = Math.sin(this.t * 10) * 0.25;
    ctx.fillStyle = '#1b1b22';
    for (const sgn of [-1, 1]) { ctx.save(); ctx.translate(x + sgn * r * 0.7, y - 4); ctx.rotate(sgn * (0.5 + flap)); ctx.beginPath(); ctx.ellipse(sgn * 14, 0, 18, 8, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    circle(x, y, r, '#3a3a52'); circle(x, y - 3, r * 0.75, '#c23a2e');
    ctx.strokeStyle = '#c23a2e'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x + Math.cos(this.face) * 22, y - 3 + Math.sin(this.face) * 22); ctx.stroke();
    if (this.st === 'throw') { ctx.globalAlpha = this.alpha * (0.5 + 0.5 * Math.sin(this.t * 40)); ring(x, y, r + 6, '#e8e0c8', 2); }
    ctx.globalAlpha = 1;
    if (this.alpha > 0.5) this.drawOverlay();
  }
}

const ENEMY_TYPES = { oni: Oni, kappa: Kappa, onibi: Onibi, tengu: Tengu };
const ENEMY_COST = { onibi: 1, kappa: 2, oni: 3, tengu: 3 };
