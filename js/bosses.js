'use strict';
// ───────── 보스: 일본 신화의 신들 ─────────
// 각 패턴은 제너레이터. `yield 초` 로 대기, `yield 0` 은 다음 프레임.
// 체력 50% 이하에서 2페이즈(격노) — 패턴이 빨라지고 새 패턴이 추가된다.

// 보스 스프라이트 (sprite-artist 제작, tools/sprites/<보스>.py). 배율 1.9, 발끝 앵커.
const BSPR = {
  kagutsuchi: enemySheet('kagutsuchi', 128, 64, 112, 1.9, { idle: [6, 8], cast: [5, 10], charge: [4, 12] }, 'bosses'),
  raijin: enemySheet('raijin', 128, 64, 112, 1.9, { idle: [6, 8], drum: [5, 12], blink: [4, 20] }, 'bosses'),
  tsukuyomi: enemySheet('tsukuyomi', 128, 64, 112, 1.9, { idle: [6, 6], cast: [5, 10] }, 'bosses'),
  orochi: enemySheet('orochi_body', 160, 80, 124, 1.9, { idle: [4, 4] }, 'bosses'),
  orochiHead: enemySheet('orochi_head', 48, 11, 24, 1.5, { idle: [4, 6], bite: [4, 12] }, 'bosses'), // 앵커 = 목 접합점
};
// 오로치 몸통 프레임 안의 목 밑동 8개 (화면 왼쪽 → 오른쪽). 숨쉬기 프레임마다 위로 0/1/2/1px
const OROCHI_NECKS = [[51, 66], [54, 71], [62, 75], [74, 77], [86, 77], [98, 75], [106, 71], [109, 66]];
const OROCHI_BREATH = [0, 1, 2, 1];

class Boss extends Enemy {
  constructor(x, y, o) {
    super(x, y, Object.assign({ boss: true }, o));
    this.isBoss = true; this.god = o.god; this.co = null; this.wait = 0; this.rest = 1.2;
    this.phase = 1; this.patterns = []; this.patterns2 = []; this.lastPat = null; this.sdt = 0;
    this.spr = BSPR[o.god]; this.textH = o.textH || 180;
    this.act = null; this.hold = null; this.faceLock = null;
  }
  // 한 번 재생하는 동작 (rev: 거꾸로). hold는 풀 때까지 반복하는 자세.
  play(name, rev = false) { this.act = { name, t: 0, rev }; }
  animFrame() {
    if (this.hold) return [this.hold, this.loop(this.hold, this.t)];
    if (this.act) {
      const a = this.spr.anims[this.act.name], f = Math.floor(this.act.t * a.fps);
      if (f < a.n) return [this.act.name, this.act.rev ? a.n - 1 - f : f];
      this.act = null;
    }
    return ['idle', this.loop('idle', this.t)];
  }
  // 스프라이트가 있으면 그리고 true, 없으면 false (도형으로 대체)
  drawBody() {
    if (!this.spriteReady()) return false;
    this.drawShadowFeet(this.r * 1.3);
    const [anim, f] = this.animFrame();
    this.drawSpr(anim, f);
    this.drawOverlay();
    return true;
  }
  update(dt) {
    this.sdt = dt * this.timeScale();
    this.baseUpdate(dt);
    if (this.act) this.act.t += this.sdt;
    this.face = this.faceLock ?? angTo(this, G.player);
    if (G.bossIntro > 0) return;
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) {
      this.phase = 2;
      banner('격노(激怒)', `${GODS[this.god].name}의 신위가 폭주한다`, 1.6);
      G.shake = 14; Sfx.play('gong');
      addFx({ type: 'ring', x: this.x, y: this.y, r0: 20, r1: 500, color: GODS[this.god].color, width: 8, life: 0.7 });
    }
    if (this.co) {
      if (this.wait > 0) this.wait -= this.sdt;
      else {
        const r = this.co.next();
        if (r.done) { this.co = null; this.rest = (this.phase === 2 ? 0.6 : 1.0) * D().rest; }
        else this.wait = r.value || 0;
      }
    } else {
      this.idle(this.sdt);
      this.rest -= this.sdt;
      if (this.rest <= 0) {
        const pool = this.phase === 2 ? this.patterns.concat(this.patterns2) : this.patterns;
        let p; do { p = pick(pool); } while (pool.length > 1 && p === this.lastPat);
        this.lastPat = p; this.co = p.call(this); this.wait = 0;
      }
    }
  }
  bullet(ang, spd, o) { enemyShoot(this.x, this.y, ang, spd, o); }
  keepDistance(P, want, spd, dt) {
    const d = dist(this, P), a = angTo(this, P);
    const dir = d > want + 40 ? 1 : d < want - 40 ? -1 : 0;
    this.x += (Math.cos(a) * dir + Math.cos(a + Math.PI / 2) * 0.5) * spd * dt;
    this.y += (Math.sin(a) * dir + Math.sin(a + Math.PI / 2) * 0.5) * spd * dt;
  }
  drawAura(color, kanji, body, rim) {
    const { x, y, r } = this;
    this.drawShadow();
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 40 + Math.sin(G.time * 4) * 10;
    circle(x, y, r, rim); ctx.restore();
    circle(x, y, r * 0.86, body);
    text(kanji, x, y + 2, r * 1.05, color, 'center', 900);
    this.drawOverlay();
  }
}

// ── 1. 카구츠치 (불) ──
class Kagutsuchi extends Boss {
  constructor(x, y) {
    super(x, y, { r: 40, hp: 760, name: '카구츠치', god: 'kagutsuchi', souls: 30, blood: '#ff7a2a' });
    this.patterns = [this.pRing, this.pCharge, this.pPillars];
    this.patterns2 = [this.pSpiral];
  }
  idle(dt) { this.keepDistance(G.player, 260, 75, dt); }
  *pRing() {
    const waves = this.phase === 2 ? 4 : 3;
    for (let k = 0; k < waves; k++) {
      const n = 14 + this.phase * 2, off = rand(0, TAU);
      this.play('cast');
      for (let i = 0; i < n; i++) this.bullet(off + i * TAU / n, 200, { r: 9, dmg: 12, color: '#ff7a2a' });
      Sfx.play('shoot'); yield 0.5;
    }
    yield 0.4;
  }
  *pCharge() {
    const times = this.phase === 2 ? 3 : 2;
    for (let k = 0; k < times; k++) {
      const a = angTo(this, G.player);
      this.hold = 'charge'; this.faceLock = a; // 몸을 숙인 돌진 자세로 예고
      const warn = addHazard({ kind: 'line', x: this.x, y: this.y, ang: a, len: 650, width: this.r * 2, delay: 0.65, active: 0, owner: this, cancelOnDeath: true, color: '#ff6a2a' });
      yield warn.delay; // 예고선이 다 차면 돌진
      let t = 0, drop = 0, hit = false;
      Sfx.play('dash');
      while (t < 0.75) {
        t += this.sdt; drop += this.sdt;
        const nx = this.x + Math.cos(a) * 820 * this.sdt, ny = this.y + Math.sin(a) * 820 * this.sdt;
        if (nx < ARENA.x1 + this.r || nx > ARENA.x2 - this.r || ny < ARENA.y1 + this.r || ny > ARENA.y2 - this.r) break;
        this.x = nx; this.y = ny;
        if (drop > 0.045) { drop = 0; addHazard({ kind: 'pool', x: this.x, y: this.y, r: 30, life: 3, dmg: 8, color: '#ff6a2a' }); }
        if (!hit && dist(this, G.player) < this.r + G.player.r && hurtPlayer(20)) hit = true;
        yield 0;
      }
      G.shake = 8; this.hold = null; this.faceLock = null; yield 0.45;
    }
    yield 0.4;
  }
  *pPillars() {
    const n = this.phase === 2 ? 8 : 5;
    this.play('cast');
    for (let i = 0; i < n; i++) {
      const P = G.player;
      addHazard({ kind: 'circle', x: P.x + rand(-20, 20), y: P.y + rand(-20, 20), r: 66, delay: 0.85, dmg: 18, fx: 'fire', color: '#ff7a2a' });
      yield 0.3;
    }
    yield 0.8;
  }
  *pSpiral() {
    let t = 0, acc = 0, a = rand(0, TAU);
    this.play('cast');
    while (t < 2.6) {
      t += this.sdt; acc += this.sdt;
      if (acc > 0.09) { acc = 0; for (let k = 0; k < 3; k++) this.bullet(a + k * TAU / 3, 230, { r: 8, dmg: 11, color: '#ffb04a' }); a += 0.27; }
      yield 0;
    }
    yield 0.5;
  }
  draw() {
    if (Math.random() < 0.5) addFx({ type: 'p', x: this.x + rand(-25, 25), y: this.y + rand(-25, 25), h: rand(10, 50), vh: rand(80, 160), vx: 0, vy: 0, color: pick(['#ff6a2a', '#ffb04a', '#ff3a1a']), size: rand(3, 7), life: 0.6 });
    this.drawBody() || this.drawAura('#ff8a3a', '火', '#3a0d06', '#ff5a1a');
  }
}

// ── 2. 라이진 (번개) ──
class Raijin extends Boss {
  constructor(x, y) {
    super(x, y, { r: 42, hp: 920, name: '라이진', god: 'raijin', souls: 40, blood: '#a98bff' });
    this.patterns = [this.pStrikes, this.pDrums, this.pBlink];
    this.patterns2 = [this.pBolts];
    this.drumHit = 0;
  }
  idle(dt) { this.moveToward(ISO.WW / 2 + Math.cos(this.t * 0.5) * 220, ISO.WD / 2 + Math.sin(this.t * 0.7) * 220, 95, dt); }
  *pStrikes() {
    const n = this.phase === 2 ? 18 : 12;
    this.play('drum');
    for (let i = 0; i < n; i++) {
      const onP = i % 4 === 0, P = G.player;
      const x = onP ? P.x : rand(ARENA.x1 + 40, ARENA.x2 - 40), y = onP ? P.y : rand(ARENA.y1 + 40, ARENA.y2 - 40);
      addHazard({ kind: 'circle', x, y, r: 58, delay: 1.0, dmg: 20, fx: 'thunder', color: '#b98bff' });
      if (i % 3 === 2) yield 0.15;
    }
    yield 1.2;
  }
  *pDrums() {
    const n = this.phase === 2 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      this.play('drum'); yield 0.08; // 북채를 내리치는 프레임에 맞춰 충격파
      this.drumHit = 0.2;
      addHazard({ kind: 'ring', x: this.x, y: this.y, rad: this.r, speed: 330, width: 30, maxR: 1500, dmg: 16, color: '#d9c6ff' });
      Sfx.play('boom'); G.shake = 6;
      yield this.phase === 2 ? 0.5 : 0.75;
    }
    yield 0.6;
  }
  *pBlink() {
    const n = this.phase === 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      this.play('blink'); Sfx.play('thunder');           // 번개로 변해 사라짐
      boltFx(this.x, this.y, this.x, this.y, '#d9c8ff', 4, 460, 0);
      yield 0.2;
      burstParticles(this.x, this.y, 20, '#cdb8ff', 260, 4, 0.4);
      const P = G.player, a = rand(0, TAU);
      this.x = clamp(P.x + Math.cos(a) * 140, ARENA.x1 + 60, ARENA.x2 - 60);
      this.y = clamp(P.y + Math.sin(a) * 140, ARENA.y1 + 60, ARENA.y2 - 60);
      this.play('blink', true);                            // 번개 기둥에서 다시 나타남
      boltFx(this.x, this.y, this.x, this.y, '#d9c8ff', 4, 460, 0);
      yield 0.2;
      addHazard({ kind: 'circle', x: this.x, y: this.y, r: 125, delay: 0.55, dmg: 22, fx: 'thunder', owner: this, cancelOnDeath: true, color: '#b98bff' });
      yield 0.75;
    }
    yield 0.3;
  }
  *pBolts() {
    for (let k = 0; k < 4; k++) {
      const a = angTo(this, G.player);
      this.play('drum');
      for (let i = -2; i <= 2; i++) this.bullet(a + i * 0.2, 430, { r: 7, dmg: 12, color: '#e0d2ff' });
      Sfx.play('shoot'); yield 0.32;
    }
    yield 0.5;
  }
  draw() {
    if (Math.random() < 0.03) boltFx(this.x, this.y, this.x + rand(-80, 80), this.y + rand(-80, 80), '#cdb8ff', 2, 70, 0);
    if (this.drawBody()) return; // 천둥북 고리는 스프라이트에 들어 있다
    this.drumHit = Math.max(0, this.drumHit - 1 / 60);
    // 등 뒤의 천둥북 고리
    for (let i = 0; i < 8; i++) {
      const a = this.t * 0.6 + i * TAU / 8, rr = this.r + 22 + this.drumHit * 40;
      const dx = this.x + Math.cos(a) * rr, dy = this.y + Math.sin(a) * rr;
      circle(dx, dy, 10, '#5a2a1a'); circle(dx, dy, 7, '#e8d6b0'); text('巴', dx, dy + 1, 9, '#5a2a1a');
    }
    this.drawAura('#cdb8ff', '雷', '#1a1030', '#7a5aff');
  }
}

// ── 3. 츠쿠요미 (달) ──
class Tsukuyomi extends Boss {
  constructor(x, y) {
    super(x, y, { r: 40, hp: 1050, name: '츠쿠요미', god: 'tsukuyomi', souls: 50, blood: '#cfe0ff' });
    this.patterns = [this.pCrescent, this.pSpiral, this.pBeams];
    this.patterns2 = [this.pMoonfall];
  }
  idle(dt) { this.keepDistance(G.player, 300, 85, dt); }
  *pCrescent() {
    const waves = this.phase === 2 ? 3 : 2;
    for (let w = 0; w < waves; w++) {
      const a = angTo(this, G.player);
      this.play('cast');
      for (let i = -3; i <= 3; i++) this.bullet(a + i * 0.2 + (w % 2) * 0.1, 215, { r: 14, dmg: 14, color: '#dfe9ff', shape: 'crescent' });
      Sfx.play('moon'); yield 0.75;
    }
    yield 0.5;
  }
  *pSpiral() {
    let t = 0, acc = 0, ang = rand(0, TAU);
    const arms = this.phase === 2 ? 5 : 4;
    this.play('cast');
    while (t < 2.8) {
      t += this.sdt; acc += this.sdt;
      if (acc >= 0.11) { acc = 0; for (let k = 0; k < arms; k++) this.bullet(ang + k * TAU / arms, 175, { r: 7, dmg: 11, color: '#bcd0ff' }); ang += 0.22; }
      yield 0;
    }
    yield 0.6;
  }
  *pBeams() {
    const n = this.phase === 2 ? 4 : 3, base = angTo(this, G.player) + Math.PI / n, dir = pick([-1, 1]);
    this.play('cast');
    for (let k = 0; k < n; k++) addHazard({ kind: 'beam', owner: this, follow: true, x: this.x, y: this.y, ang: base + k * TAU / n, angVel: 0.5 * dir, len: 1500, width: 30, delay: 1.1, active: 2.6, dmg: 20, color: '#e6eeff' });
    Sfx.play('moon');
    yield 3.8;
  }
  *pMoonfall() {
    const P = G.player;
    this.play('cast');
    addHazard({ kind: 'circle', x: P.x, y: P.y, r: 95, delay: 1.1, dmg: 24, fx: 'moon', color: '#dfe9ff' });
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      addHazard({ kind: 'circle', x: P.x + Math.cos(a) * 190, y: P.y + Math.sin(a) * 190, r: 80, delay: 1.5, dmg: 20, fx: 'moon', color: '#bcd0ff' });
    }
    yield 2.0;
  }
  draw() {
    if (this.drawBody()) return; // 초승달 광배는 스프라이트에 들어 있다
    // 등 뒤의 초승달 광배
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(Math.sin(G.time) * 0.2 - 0.6);
    ctx.shadowColor = '#e6eeff'; ctx.shadowBlur = 30; ctx.fillStyle = '#e6eeff';
    ctx.beginPath(); ctx.arc(0, 0, this.r + 30, -2.2, 2.2); ctx.arc(-18, 0, this.r + 16, 2.0, -2.0, true); ctx.closePath(); ctx.fill();
    ctx.restore();
    this.drawAura('#e6eeff', '月', '#0d1426', '#8fa6e0');
  }
}

// ── 최종. 야마타노오로치 ──
class Orochi extends Boss {
  constructor(x, y) {
    super(x, y, { r: 52, hp: 1700, name: '야마타노오로치', god: 'orochi', souls: 80, blood: '#5fbf4a', textH: 150 });
    this.patterns = [this.pBite, this.pSpray, this.pPools];
    this.patterns2 = [this.pEightfold, this.pSummon];
    this.heads = []; this.lunge = new Array(8).fill(0); this.warn = new Array(8).fill(0);
    this.updateHeads();
  }
  updateHeads() {
    for (let i = 0; i < 8; i++) {
      const base = Math.PI / 4 - Math.PI * 0.6 + i * (Math.PI * 1.2) / 7; // 화면 아래쪽 부채꼴로 펼쳐진 여덟 머리
      const a = base + Math.sin(this.t * 1.6 + i) * 0.12, len = 135 + Math.sin(this.t * 2 + i * 1.7) * 12 + this.lunge[i] * 70;
      this.heads[i] = { x: this.x + Math.cos(a) * len, y: this.y + Math.sin(a) * len, a };
    }
  }
  update(dt) {
    super.update(dt);
    for (let i = 0; i < 8; i++) { this.lunge[i] = Math.max(0, this.lunge[i] - dt * 2.5); this.warn[i] = Math.max(0, this.warn[i] - this.sdt); }
    this.updateHeads();
  }
  idle(dt) { const s = Math.sin(this.t * 0.4) * 130; this.moveToward(ISO.WW * 0.27 + s, ISO.WD * 0.27 - s, 50, dt); }
  *pBite() {
    const n = this.phase === 2 ? 5 : 3;
    for (const i of shuffle([0, 1, 2, 3, 4, 5, 6, 7]).slice(0, n)) {
      const h = this.heads[i], a = angTo(h, G.player);
      const hz = addHazard({ kind: 'line', x: h.x, y: h.y, ang: a, len: 780, width: 56, delay: 0.75, active: 0.18, dmg: 22, owner: this, cancelOnDeath: true, fx: 'bite', color: '#8aff6a' });
      this.warn[i] = hz.delay;
      setTimer(hz.delay / G.enemyScale(), () => { this.lunge[i] = 1; });
      yield 0.3;
    }
    yield 1.0;
  }
  *pSpray() {
    const rounds = this.phase === 2 ? 4 : 3;
    for (let r = 0; r < rounds; r++) {
      for (const h of this.heads) {
        const a = angTo(h, G.player) + rand(-0.15, 0.15);
        enemyShoot(h.x, h.y, a, 220, { r: 8, dmg: 12, color: '#9aff6a' });
      }
      Sfx.play('shoot'); yield 0.6;
    }
    yield 0.5;
  }
  *pPools() {
    const n = this.phase === 2 ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const P = G.player, onP = i < 2;
      addHazard({ kind: 'pool', x: onP ? P.x : rand(ARENA.x1 + 60, ARENA.x2 - 60), y: onP ? P.y : rand(ARENA.y1 + 60, ARENA.y2 - 60), r: 72, delay: 0.9, life: 5, dmg: 12, fx: 'poison', color: '#6adf4a' });
      yield 0.15;
    }
    yield 1.0;
  }
  *pEightfold() {
    let delay = 1;
    for (const h of this.heads) delay = addHazard({ kind: 'line', x: h.x, y: h.y, ang: h.a, len: 950, width: 44, delay: 1.0, active: 0.25, dmg: 25, owner: this, cancelOnDeath: true, fx: 'bite', color: '#b6ff8a' }).delay;
    this.warn.fill(delay);
    setTimer(delay / G.enemyScale(), () => this.lunge.fill(1));
    yield 1.6;
  }
  *pSummon() {
    for (let i = 0; i < 3; i++) {
      const x = rand(ARENA.x1 + 200, ARENA.x2 - 60), y = rand(ARENA.y1 + 200, ARENA.y2 - 60);
      G.spawns.push({ x, y, type: 'onibi', t: 0.9, max: 0 });
    }
    yield 1.2;
  }
  flipX() { return false; } // 몸통은 목 밑동 좌표가 고정이라 뒤집지 않는다
  draw() {
    if (!this.spriteReady()) return this.drawShape();
    const { x, y } = this, S = this.spr.scale, bf = this.loop('idle', this.t), lift = OROCHI_BREATH[bf];
    const HS = BSPR.orochiHead, hs = HS.scale;
    this.drawShadowFeet(this.r * 2.4);
    this.drawSpr('idle', bf);
    // 몸통 뒤쪽(화면 위)으로 뻗은 머리부터 그려 겹침을 맞춘다
    const order = [...this.heads.keys()].sort((a, b) => (this.heads[a].x + this.heads[a].y) - (this.heads[b].x + this.heads[b].y));
    for (const i of order) {
      const hw = this.heads[i], h = isoLocal(this, hw.x, hw.y, 30);
      const nb = OROCHI_NECKS[7 - i]; // 머리 0번이 화면 오른쪽 → 오른쪽 끝 목 밑동
      const bx = x + (nb[0] - 80) * S, by = y + (nb[1] - lift - 124) * S;
      const cx = (bx + h.x) / 2 + Math.sin(this.t * 3 + i) * 14, cy = Math.min(by, h.y) - 40;
      ctx.lineCap = 'round';
      for (const [w, c] of [[25, '#183a2c'], [20, '#4c9850'], [6, '#7fd46a']]) {
        ctx.strokeStyle = c; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(cx, cy, h.x, h.y); ctx.stroke();
      }
      const L = this.lunge[i], wn = this.warn[i];
      let anim = 'idle', f = Math.floor(this.t * 6 + i) % 4;
      if (L > 0.5) { anim = 'bite'; f = 2; } else if (L > 0) { anim = 'bite'; f = 3; } else if (wn > 0) { anim = 'bite'; f = wn > 0.35 ? 0 : 1; }
      const img = HS.anims[anim].img;
      ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(isoAng(hw.a)); ctx.imageSmoothingEnabled = false;
      const blit = () => ctx.drawImage(img, f * 48, 0, 48, 48, -HS.ax * hs, -HS.ay * hs, 48 * hs, 48 * hs);
      blit();
      if (this.flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.8; blit(); }
      ctx.restore();
    }
    this.drawOverlay();
  }
  drawShape() {
    const { x, y, r } = this;
    // 목과 머리
    // 몸통 뒤쪽(화면 위)으로 뻗은 머리부터 그려 겹침을 맞춘다
    const order = [...this.heads.keys()].sort((a, b) => (this.heads[a].x + this.heads[a].y) - (this.heads[b].x + this.heads[b].y));
    for (const i of order) {
      const hw = this.heads[i], h = isoLocal(this, hw.x, hw.y, 26), by = y - 20;
      ctx.strokeStyle = '#1f3a22'; ctx.lineWidth = 22; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, by); ctx.quadraticCurveTo((x + h.x) / 2 + Math.sin(this.t * 3 + i) * 14, Math.min(by, h.y) - 30, h.x, h.y); ctx.stroke();
      ctx.strokeStyle = '#3f6e3a'; ctx.lineWidth = 14; ctx.stroke();
      ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(isoAng(hw.a));
      ctx.fillStyle = '#2f5a2c'; ctx.beginPath(); ctx.ellipse(6, 0, 20, 13, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff3a2a'; circle(10, -6, 3, '#ff3a2a'); circle(10, 6, 3, '#ff3a2a');
      ctx.restore();
    }
    this.drawAura('#9aff7a', '蛇', '#0f1f10', '#3f8a3a');
  }
}

const BOSS_TYPES = { kagutsuchi: Kagutsuchi, raijin: Raijin, tsukuyomi: Tsukuyomi, orochi: Orochi };
