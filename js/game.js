'use strict';
// ───────── 게임 상태 / 방 흐름 / UI / 메인 루프 ─────────

const G = {
  state: 'title', // title | upgrade | play | paused | choice | dead | win
  meta: null, player: null,
  stageIdx: 0, roomIdx: 0, room: null,
  enemies: [], projectiles: [], hazards: [], fx: [], texts: [], pickups: [], doors: [], obstacles: [], spawns: [], timers: [],
  shake: 0, hitstop: 0, redFlash: 0, eclipse: 0, time: 0, bossIntro: 0, waveDelay: 0,
  runSouls: 0, kills: 0, banner: null, choice: null, bg: null,
  enemyScale() { return this.eclipse > 0 ? 0.45 : 1; },
};

// ───────── 영구 저장 ─────────
function loadMeta() {
  const d = { souls: 0, hp: 0, str: 0, dash: 0, revive: 0, runs: 0, wins: 0, best: 0, difficulty: 'normal', clears: {} };
  try { const s = JSON.parse(localStorage.getItem('totsuka_meta')); if (s) Object.assign(d, s); } catch (e) { }
  return d;
}
function saveMeta() { try { localStorage.setItem('totsuka_meta', JSON.stringify(G.meta)); } catch (e) { } }
G.meta = loadMeta();

function setTimer(delay, fn) { G.timers.push({ t: delay, fn }); }

// ───────── 런 / 방 진행 ─────────
function startRun() {
  Object.assign(G, { stageIdx: 0, roomIdx: 0, runSouls: 0, kills: 0, eclipse: 0, time: 0, banner: null, choice: null });
  G.difficulty = G.meta.difficulty in DIFFICULTIES ? G.meta.difficulty : 'normal';
  G.player = new Player(G.meta);
  const d = D(), P = G.player;
  P.maxHp += d.playerHp; P.hp = P.maxHp;
  P.revives = d.noRevive ? 0 : P.revives + d.revive;
  G.meta.runs++; saveMeta();
  G.state = 'play';
  enterRoom(pick(['sake', 'maxhp', 'whet']));
}

function enterRoom(reward) {
  G.roomIdx++;
  const st = STAGES[G.stageIdx];
  G.room = { reward, isBoss: G.roomIdx === ROOMS_PER_STAGE, cleared: false, waves: [], waveIdx: 0 };
  Object.assign(G, { enemies: [], projectiles: [], hazards: [], fx: [], texts: [], pickups: [], doors: [], spawns: [], timers: [], eclipse: 0 });
  const P = G.player;
  Object.assign(P, { x: ISO.WW - 70, y: ISO.WD - 70, dashT: 0, swing: null, iframes: 1, atkCd: 0.2 });
  G.meta.best = Math.max(G.meta.best, G.stageIdx * ROOMS_PER_STAGE + G.roomIdx);
  if (G.room.isBoss) {
    G.obstacles = st.boss === 'orochi' ? [] : [[0.22, 0.5], [0.5, 0.22], [0.78, 0.5], [0.5, 0.78]].map(([x, y]) => ({ x: x * ISO.WW, y: y * ISO.WD, r: 24 }));
    const god = GODS[st.boss];
    G.enemies.push(new BOSS_TYPES[st.boss](ISO.WW * 0.38, ISO.WD * 0.38));
    G.bossIntro = 2.8;
    banner(`${god.title} ${god.name}`, god.lore, 2.8);
    Sfx.play('gong');
  } else {
    G.obstacles = genObstacles();
    G.room.waves = genWaves();
    G.waveDelay = 0.7;
    if (G.roomIdx === 1) banner(st.name, st.sub, 2.4);
  }
  G.bg = buildBg(st);
}

// 문 위치 (월드 좌표). 왼쪽 뒷벽, 오른쪽 뒷벽, 그리고 맨 안쪽 모서리(보스/다음 지역)
const DOOR_SPOTS = [{ x: 22, y: ISO.WD * 0.34 }, { x: ISO.WW * 0.34, y: 22 }];
const DOOR_CORNER = { x: 40, y: 40 };

function genObstacles() {
  const obs = [], n = randi(2, 5), WW = ISO.WW, WD = ISO.WD;
  const avoid = [[WW / 2, WD / 2, 140], [WW - 70, WD - 70, 230], [DOOR_CORNER.x, DOOR_CORNER.y, 170], ...DOOR_SPOTS.map(d => [d.x, d.y, 160])];
  for (let tries = 0; tries < 200 && obs.length < n; tries++) {
    const x = rand(90, WW - 90), y = rand(90, WD - 90);
    if (avoid.some(([ax, ay, r]) => Math.hypot(x - ax, y - ay) < r)) continue;
    if (segDist(x, y, DOOR_CORNER.x, DOOR_CORNER.y, WW / 2, WD / 2) < 90) continue; // 안쪽 모서리 문으로 가는 길목
    if (obs.some(o => Math.hypot(o.x - x, o.y - y) < 150)) continue;
    obs.push({ x, y, r: 24 });
  }
  return obs;
}

function genWaves() {
  const st = STAGES[G.stageIdx];
  const budget = Math.max(3, 5 + G.stageIdx * 3 + G.roomIdx * 2 + D().budget), nW = G.roomIdx >= 3 ? 3 : 2, waves = [];
  for (let w = 0; w < nW; w++) {
    let b = Math.ceil(budget / nW) + (w === nW - 1 ? 1 : 0);
    const wave = [];
    while (b > 0) { const t = pick(st.enemies); wave.push(t); b -= ENEMY_COST[t]; }
    waves.push(wave);
  }
  return waves;
}

function spawnWave(wave) {
  const P = G.player;
  for (const type of wave) {
    let x = ISO.WW / 2, y = ISO.WD / 2;
    for (let i = 0; i < 40; i++) {
      x = rand(ARENA.x1 + 50, ARENA.x2 - 50); y = rand(ARENA.y1 + 50, ARENA.y2 - 50);
      if (Math.hypot(x - P.x, y - P.y) > 260 && !inObstacle(x, y, 40)) break;
    }
    G.spawns.push({ x, y, type, t: rand(0.7, 1.1), max: 0 });
  }
}

function roomCleared() {
  G.room.cleared = true;
  G.projectiles = G.projectiles.filter(p => p.team !== 'enemy');
  Sfx.play('door');
  if (G.room.reward) G.pickups.push({ x: ISO.WW / 2, y: ISO.WD / 2, kind: G.room.reward, t: 0 });
  else openDoors();
}

function openDoors() {
  const P = G.player;
  if (G.room.isBoss) {
    G.doors = [{ ...DOOR_CORNER, kind: 'stage', reward: pick(['heal', 'maxhp', 'sake']) }];
  } else if (G.roomIdx + 1 === ROOMS_PER_STAGE) {
    G.doors = [{ ...DOOR_CORNER, kind: 'boss' }];
  } else {
    const pool = Object.keys(REWARDS).filter(k => !(k === 'heal' && P.hp > P.maxHp * 0.8));
    if (P.hp < P.maxHp * 0.45) pool.push('heal', 'heal'); // 체력이 낮으면 회복이 더 자주 나온다
    const rs = [];
    while (rs.length < 2) { const r = pick(pool); if (!rs.includes(r)) rs.push(r); }
    G.doors = rs.map((r, i) => ({ ...DOOR_SPOTS[i], kind: 'room', reward: r }));
  }
  G.doors.forEach(d => d.open = 0);
  Sfx.play('door');
}

function enterDoor(d) {
  Sfx.play('door');
  if (d.kind === 'stage') {
    G.stageIdx++; G.roomIdx = 0;
    enterRoom(d.reward);
  } else enterRoom(d.kind === 'boss' ? null : d.reward);
}

function onBossDefeated(boss) {
  G.room.cleared = true;
  for (const e of G.enemies) if (e !== boss && !e.dead) killEnemy(e);
  G.spawns = [];
  G.hazards = G.hazards.filter(h => h.team !== 'enemy');
  G.projectiles = G.projectiles.filter(p => p.team !== 'enemy');
  G.hitstop = 0.35; G.shake = 22; G.timers = [];
  Sfx.play('gong');
  const god = GODS[boss.god];
  banner(`${god.name} 격파`, boss.god === 'orochi' ? '여덟 머리가 모두 쓰러졌다' : '신의 권능이 토츠카의 검에 깃든다', 2.2);
  setTimer(2.2, () => {
    if (boss.god === 'orochi') { endRun(true); return; }
    openChoice(boss.god);
  });
}

function openChoice(godId) {
  const god = GODS[godId];
  G.choice = { god: godId, opts: shuffle(god.powers.slice()).slice(0, 3), t: 0 };
  G.state = 'choice';
}
function choosePower(i) {
  const pw = G.choice.opts[i], P = G.player;
  P.powers[pw.slot] = pw;
  if (pw.slot === 'cast') P.castCd = 0;
  const heal = D().choiceHeal;
  P.hp = Math.min(P.maxHp, P.hp + Math.round(P.maxHp * heal));
  G.state = 'play'; G.choice = null;
  Sfx.play('pickup');
  banner(pw.name, `${SLOTS[pw.slot]} 권능 획득` + (heal ? ` · 체력 ${Math.round(heal * 100)}% 회복` : ''), 1.8);
  openDoors();
}

function onPlayerDeath() { setTimer(1.2, () => endRun(false)); G.hitstop = 0.4; }
function endRun(won) {
  G.soulsGained = Math.round(G.runSouls * D().souls);
  G.meta.souls += G.soulsGained;
  if (won) { G.meta.wins++; G.meta.clears[G.difficulty] = (G.meta.clears[G.difficulty] || 0) + 1; }
  saveMeta();
  G.state = won ? 'win' : 'dead';
  G.endT = 0; G.banner = null;
}

// ───────── 업데이트 ─────────
function updatePlay(dt) {
  G.time += dt;
  if (G.eclipse > 0) G.eclipse -= dt;
  if (G.bossIntro > 0) G.bossIntro -= dt;
  const P = G.player;
  if (!P.dead) P.update(dt);

  for (const e of G.enemies) if (!e.dead) e.update(dt);
  // 적끼리 겹치지 않게
  for (let i = 0; i < G.enemies.length; i++) for (let j = i + 1; j < G.enemies.length; j++) {
    const a = G.enemies[i], b = G.enemies[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
    if (d < m && d > 0.01) {
      const push = (m - d) / 2, ux = dx / d, uy = dy / d;
      if (!a.isBoss) { a.x -= ux * push; a.y -= uy * push; }
      if (!b.isBoss) { b.x += ux * push; b.y += uy * push; }
    }
  }
  for (const p of G.projectiles) p.update(dt);
  for (const h of G.hazards) h.update(dt);
  for (const s of G.spawns) s.t -= dt;
  for (const s of G.spawns.filter(s => s.t <= 0)) {
    G.enemies.push(new ENEMY_TYPES[s.type](s.x, s.y));
    burstParticles(s.x, s.y, 14, '#2a1a2a', 200, 5, 0.5);
  }
  G.spawns = G.spawns.filter(s => s.t > 0);
  for (const t of G.timers) { t.t -= dt; if (t.t <= 0) t.fn(); }
  G.timers = G.timers.filter(t => t.t > 0);

  for (const pk of G.pickups) {
    pk.t += dt;
    if (!pk.taken && Math.hypot(P.x - pk.x, P.y - pk.y) < P.r + 26) {
      pk.taken = true;
      const r = REWARDS[pk.kind];
      r.apply(P);
      addText(pk.x, pk.y - 40, `${r.name} — ${r.desc}`, r.color, 20);
      burstParticles(pk.x, pk.y, 24, r.color, 260, 4, 0.6);
      Sfx.play('pickup');
      openDoors();
    }
  }
  G.pickups = G.pickups.filter(p => !p.taken);
  for (const d of G.doors) {
    d.open = Math.min(1, d.open + dt * 2);
    if (d.open >= 1 && Math.hypot(P.x - d.x, P.y - d.y) < 52) { enterDoor(d); break; }
  }

  G.enemies = G.enemies.filter(e => !e.dead);
  G.projectiles = G.projectiles.filter(p => !p.dead);
  G.hazards = G.hazards.filter(h => !h.dead);

  const room = G.room;
  if (!room.isBoss && !room.cleared && G.enemies.length === 0 && G.spawns.length === 0) {
    if (room.waveIdx < room.waves.length) {
      G.waveDelay -= dt;
      if (G.waveDelay <= 0) { spawnWave(room.waves[room.waveIdx++]); G.waveDelay = 0.6; }
    } else roomCleared();
  }
}

// ───────── 배경 ─────────
function buildBg(st) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), K = ISO.K, WW = ISO.WW, WD = ISO.WD, WH = ISO.WALL;
  g.fillStyle = st.wall; g.fillRect(0, 0, W, H);
  const top = iso(0, 0), right = iso(WW, 0), bottom = iso(WW, WD), left = iso(0, WD);
  const poly = (pts, fill) => { g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.closePath(); g.fillStyle = fill; g.fill(); };
  const up = (q, h) => ({ x: q.x, y: q.y - h });

  // 바닥 앞쪽 두께 (떠 있는 석단 느낌)
  const T = 26;
  poly([left, bottom, right, up(right, -T), up(bottom, -T), up(left, -T)], st.floor);
  poly([left, bottom, up(bottom, -T), up(left, -T)], 'rgba(0,0,0,0.55)');
  poly([bottom, right, up(right, -T), up(bottom, -T)], 'rgba(0,0,0,0.7)');

  // 바닥: 월드 좌표로 그리면 마름모로 투영된다
  g.save(); g.setTransform(K, K / 2, -K, K / 2, ISO.OX, ISO.OY);
  g.fillStyle = st.floor; g.fillRect(0, 0, WW, WD);
  g.beginPath(); g.rect(0, 0, WW, WD); g.clip();
  const TS = 65;
  for (let x = 0; x < WW; x += TS) for (let y = 0; y < WD; y += TS) {
    g.fillStyle = `rgba(255,255,255,${rand(0, 0.035)})`; g.fillRect(x, y, TS, TS);
  }
  g.strokeStyle = st.tile; g.lineWidth = 3;
  for (let x = 0; x <= WW; x += TS) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, WD); g.stroke(); }
  for (let y = 0; y <= WD; y += TS) { g.beginPath(); g.moveTo(0, y); g.lineTo(WW, y); g.stroke(); }
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(255,255,255,${rand(0, 0.04)})`; g.fillRect(rand(0, WW), rand(0, WD), rand(1, 4), rand(1, 4)); }
  if (st.deco === 'lava') {
    g.shadowColor = '#ff5a1a'; g.shadowBlur = 14; g.strokeStyle = 'rgba(255,110,40,0.6)'; g.lineWidth = 3;
    for (let i = 0; i < 10; i++) {
      let x = rand(0, WW), y = rand(0, WD);
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += rand(-60, 60); y += rand(-60, 60); g.lineTo(x, y); }
      g.stroke();
    }
    g.shadowBlur = 0;
  } else if (st.deco === 'spark') {
    for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(169,139,255,0.08)'; g.beginPath(); g.arc(rand(0, WW), rand(0, WD), rand(40, 110), 0, TAU); g.fill(); }
  } else if (st.deco === 'moon') {
    const gr = g.createRadialGradient(WW / 2, WD / 2, 20, WW / 2, WD / 2, 420);
    gr.addColorStop(0, 'rgba(200,215,255,0.14)'); gr.addColorStop(1, 'rgba(200,215,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, WW, WD);
    g.strokeStyle = 'rgba(200,215,255,0.14)'; g.lineWidth = 5; g.beginPath(); g.arc(WW / 2, WD / 2, 250, 0, TAU); g.stroke();
    g.beginPath(); g.arc(WW / 2, WD / 2, 270, 0, TAU); g.stroke();
  } else if (st.deco === 'water') {
    g.strokeStyle = 'rgba(120,200,160,0.12)'; g.lineWidth = 3;
    for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(rand(0, WW), rand(0, WD), rand(15, 60), 0, TAU); g.stroke(); }
  }
  // 뒷벽 아래 그림자
  let gr = g.createLinearGradient(0, 0, 0, 90); gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, WW, 90);
  gr = g.createLinearGradient(0, 0, 90, 0); gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 90, WD);
  g.restore();

  // 뒷벽 두 면 (왼쪽 면은 밝게, 오른쪽 면은 어둡게)
  poly([left, top, up(top, WH), up(left, WH)], st.floor);
  poly([left, top, up(top, WH), up(left, WH)], 'rgba(0,0,0,0.3)');
  poly([top, right, up(right, WH), up(top, WH)], st.floor);
  poly([top, right, up(right, WH), up(top, WH)], 'rgba(0,0,0,0.5)');
  // 나무 기둥
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let t = 0; t <= 1.0001; t += 1 / 6) {
    for (const q of [iso(0, WD * t), iso(WW * t, 0)]) g.fillRect(q.x - 4, q.y - WH - 4, 8, WH + 4);
  }
  // 벽 윗선
  g.strokeStyle = st.accent; g.globalAlpha = 0.6; g.lineWidth = 3;
  g.beginPath(); g.moveTo(left.x, left.y - WH); g.lineTo(top.x, top.y - WH); g.lineTo(right.x, right.y - WH); g.stroke();
  // 앞쪽 가장자리
  g.globalAlpha = 0.4; g.lineWidth = 2;
  g.beginPath(); g.moveTo(left.x, left.y); g.lineTo(bottom.x, bottom.y); g.lineTo(right.x, right.y); g.stroke();
  g.globalAlpha = 1;
  // 시메나와(금줄)와 시데 — 기둥 사이로 늘어진다
  g.strokeStyle = '#c9b07a'; g.lineWidth = 5;
  const posts = [];
  for (let k = 6; k >= 0; k--) posts.push(up(iso(0, WD * k / 6), WH - 8));
  for (let k = 1; k <= 6; k++) posts.push(up(iso(WW * k / 6, 0), WH - 8));
  g.beginPath(); g.moveTo(posts[0].x, posts[0].y);
  for (let k = 1; k < posts.length; k++) {
    const a = posts[k - 1], b = posts[k];
    g.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 16, b.x, b.y);
  }
  g.stroke();
  g.fillStyle = '#f2ece0';
  for (let k = 1; k < posts.length; k++) {
    const a = posts[k - 1], b = posts[k], x = (a.x + b.x) / 2, y = (a.y + b.y) / 2 + 8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y + 6); g.lineTo(x, y + 12); g.lineTo(x + 6, y + 18); g.lineTo(x + 2, y + 19); g.lineTo(x - 4, y + 12); g.lineTo(x + 2, y + 6); g.lineTo(x - 4, y); g.fill();
  }
  return c;
}

// 비네트는 한 번만 만든다
const VIGNETTE = (() => {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.72);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H); return c;
})();

// ───────── 그리기 ─────────
function drawLantern(o) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(o.x, o.y + 16, 28, 10, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#4a4744'; ctx.fillRect(o.x - 18, o.y + 2, 36, 14);
  ctx.fillStyle = '#5c5955'; ctx.fillRect(o.x - 8, o.y - 22, 16, 26);
  ctx.save(); ctx.shadowColor = '#ffb04a'; ctx.shadowBlur = 24 + Math.sin(G.time * 5 + o.x) * 6;
  ctx.fillStyle = '#ffcf7a'; ctx.fillRect(o.x - 9, o.y - 40, 18, 16); ctx.restore();
  ctx.fillStyle = '#6a6662'; ctx.beginPath(); ctx.moveTo(o.x - 24, o.y - 40); ctx.lineTo(o.x, o.y - 56); ctx.lineTo(o.x + 24, o.y - 40); ctx.fill();
}

function drawTorii(x, y, open, label) {
  const a = open;
  ctx.save(); ctx.globalAlpha = 0.3 + a * 0.7;
  if (a >= 1) { ctx.shadowColor = '#ff4a2a'; ctx.shadowBlur = 20 + Math.sin(G.time * 4) * 8; }
  ctx.fillStyle = '#c4281c';
  ctx.fillRect(x - 40, y - 64, 9, 66); ctx.fillRect(x + 31, y - 64, 9, 66);
  ctx.fillRect(x - 54, y - 72, 108, 9); ctx.fillRect(x - 46, y - 54, 92, 6);
  ctx.fillStyle = '#1a1210'; ctx.fillRect(x - 58, y - 78, 116, 7);
  ctx.restore();
  // 문 안쪽의 빛
  if (a >= 1) {
    const gr = ctx.createLinearGradient(0, y - 54, 0, y + 4); gr.addColorStop(0, 'rgba(255,220,170,0)'); gr.addColorStop(1, 'rgba(255,220,170,0.3)');
    ctx.fillStyle = gr; ctx.fillRect(x - 31, y - 54, 62, 58);
  }
  if (label) label();
}

function drawRewardIcon(kind, x, y, r = 20) {
  const rw = REWARDS[kind];
  ctx.save(); ctx.shadowColor = rw.color; ctx.shadowBlur = 18;
  circle(x, y, r, '#120e0c'); ring(x, y, r, rw.color, 2.5); ctx.restore();
  text(rw.kanji, x, y + 1, r * 1.05, rw.color, 'center', 900);
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#07060a'; ctx.fillRect(0, 0, W, H);
  if (G.state === 'title') return drawTitle();
  if (G.state === 'upgrade') return drawUpgrade();

  VIEW.sx = G.shake > 0 ? rand(-G.shake, G.shake) : 0;
  VIEW.sy = G.shake > 0 ? rand(-G.shake, G.shake) : 0;
  screenTransform();
  ctx.drawImage(G.bg, 0, 0);

  // 바닥 평면: 예고 범위, 장판, 소환진, 베기 궤적
  groundTransform();
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, ISO.WW, ISO.WD); ctx.clip();
  for (const h of G.hazards) if (h.kind === 'pool') h.draw();
  for (const h of G.hazards) if (h.kind !== 'pool') h.draw();
  for (const s of G.spawns) {
    const k = 1 - clamp(s.t, 0, 1);
    ctx.globalAlpha = 0.6; circle(s.x, s.y, 30 * k + 4, '#120810'); ring(s.x, s.y, 36 * (1 - k) + 10, '#c03a5a', 3); ctx.globalAlpha = 1;
  }
  for (const pk of G.pickups) { ctx.globalAlpha = 0.25 + 0.1 * Math.sin(pk.t * 3); circle(pk.x, pk.y, 34, REWARDS[pk.kind].color); ctx.globalAlpha = 1; }
  drawGroundFx();
  ctx.restore();

  // 뒷벽의 문(도리이)
  screenTransform();
  for (const d of G.doors) {
    const q = iso(d.x, d.y);
    drawTorii(q.x, q.y, d.open, () => {
      // 다음 보상(또는 보스)을 도리이 기둥 사이에 표시
      if (d.kind === 'room' || d.kind === 'stage') drawRewardIcon(d.reward, q.x, q.y - 28, 16);
      else { const god = GODS[STAGES[G.stageIdx].boss]; text(god.kanji, q.x, q.y - 27, 28, god.color, 'center', 900); }
      if (d.kind === 'stage') text('다음 지역', q.x, q.y + 14, 13, '#ffe0b0');
    });
  }

  // 서 있는 것들: 깊이(x + y)로 정렬해 앞에 있는 것을 나중에 그린다
  const list = [];
  for (const o of G.obstacles) list.push({ z: o.x + o.y, d: () => { uprightAt(o); drawLantern(o); } });
  for (const e of G.enemies) list.push({ z: e.x + e.y, d: () => { uprightAt(e, e.lift ?? e.r * 0.75); e.draw(); } });
  for (const pk of G.pickups) list.push({ z: pk.x + pk.y, d: () => { uprightAt(pk, 36 + Math.sin(pk.t * 3) * 5); drawRewardIcon(pk.kind, pk.x, pk.y, 22); } });
  for (const p of G.projectiles) list.push({ z: p.x + p.y, d: () => { uprightAt(p, 24); p.draw(); } });
  if (!G.player.dead) list.push({ z: G.player.x + G.player.y, d: () => { uprightAt(G.player); G.player.draw(); } });
  list.sort((a, b) => a.z - b.z).forEach(o => o.d());

  screenTransform();
  drawAirFx();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  ctx.drawImage(VIGNETTE, 0, 0);
  if (G.eclipse > 0) { ctx.fillStyle = `rgba(40,60,120,${Math.min(0.25, G.eclipse * 0.15)})`; ctx.fillRect(0, 0, W, H); }
  if (G.redFlash > 0) { ctx.fillStyle = `rgba(200,0,0,${G.redFlash * 0.35})`; ctx.fillRect(0, 0, W, H); }
  const P = G.player;
  if (P.hp < P.maxHp * 0.3 && !P.dead) { ctx.fillStyle = `rgba(160,0,0,${0.08 + 0.06 * Math.sin(G.time * 6)})`; ctx.fillRect(0, 0, W, H); }

  drawHUD();
  drawBanner();
  if (G.state === 'choice') drawChoice();
  if (G.state === 'paused') drawPause();
  if (G.state === 'dead' || G.state === 'win') drawEnd();
}

function drawHUD() {
  const P = G.player, st = STAGES[G.stageIdx];
  // 체력
  const hx = 28, hy = 26, hw = 300;
  text('體', hx + 10, hy + 9, 20, '#e8c9a0', 'center', 900);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(hx + 26, hy, hw, 18);
  ctx.fillStyle = '#7a1a14'; ctx.fillRect(hx + 26, hy, hw, 18);
  ctx.fillStyle = '#e0402e'; ctx.fillRect(hx + 26, hy, hw * clamp(P.hp / P.maxHp, 0, 1), 18);
  ctx.strokeStyle = '#e8c9a0'; ctx.lineWidth = 1.5; ctx.strokeRect(hx + 26, hy, hw, 18);
  text(`${Math.max(0, Math.ceil(P.hp))} / ${P.maxHp}`, hx + 26 + hw / 2, hy + 10, 13, '#fff');
  // 대시 충전 / 부활 / 혼
  for (let i = 0; i < P.dashMax; i++) {
    const full = i < P.dashCharges;
    circle(hx + 36 + i * 22, hy + 38, 7, full ? '#cfe0ff' : '#2a2d3a');
    if (!full && i === P.dashCharges) { ctx.beginPath(); ctx.moveTo(hx + 36 + i * 22, hy + 38); ctx.arc(hx + 36 + i * 22, hy + 38, 7, -Math.PI / 2, -Math.PI / 2 + TAU * P.dashRe / 0.55); ctx.fillStyle = '#6a7ab0'; ctx.fill(); }
  }
  let ix = hx + 36 + P.dashMax * 22 + 10;
  if (P.revives > 0) { text(`不屈 ×${P.revives}`, ix, hy + 39, 14, '#ffe0a0', 'left'); ix += 70; }
  text(`魂 ${G.runSouls}`, ix, hy + 39, 14, '#8fd8ff', 'left');
  if (P.dmgMul > 1.001) text(`피해 ×${P.dmgMul.toFixed(2)}`, ix + 70, hy + 39, 13, '#ffd36a', 'left');

  // 지역 / 방
  text(st.name, W / 2, 22, 18, '#e8dcc4');
  let rs = '';
  for (let i = 1; i <= ROOMS_PER_STAGE; i++) rs += i < G.roomIdx ? '●' : i === G.roomIdx ? '◉' : i === ROOMS_PER_STAGE ? '◆' : '○';
  text(`${'一二三四'[G.stageIdx]}  ${rs}  ·  ${D().name}`, W / 2, 44, 13, '#a89878');

  // 권능 슬롯 (공격/특수/대시/주술)
  const sw = 58, gap = 8, sx0 = W - 28 - (sw + gap) * 4 + gap, sy = 12;
  SLOT_ORDER.forEach((slot, i) => {
    const x = sx0 + i * (sw + gap), pw = P.powers[slot], god = pw ? GODS[pw.id.startsWith('fire') ? 'kagutsuchi' : pw.id.startsWith('thunder') ? 'raijin' : 'tsukuyomi'] : null;
    ctx.fillStyle = 'rgba(10,8,8,0.75)'; roundRect(x, sy, sw, sw, 8); ctx.fill();
    ctx.strokeStyle = god ? god.color : '#3a3430'; ctx.lineWidth = 2; roundRect(x, sy, sw, sw, 8); ctx.stroke();
    if (god) text(god.kanji, x + sw / 2, sy + sw / 2 - 4, 26, god.color, 'center', 900);
    else text('—', x + sw / 2, sy + sw / 2 - 4, 18, '#3a3430');
    text(SLOTS[slot], x + sw / 2, sy + sw - 9, 11, '#a89878');
    let cd = 0, max = 1;
    if (slot === 'special') { cd = P.specCd; max = P.specMax * P.cdMul; }
    if (slot === 'cast' && pw) { cd = P.castCd; max = P.castMax * P.cdMul; }
    if (cd > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x + 2, sy + 2 + (sw - 4) * (1 - cd / max), sw - 4, (sw - 4) * cd / max);
      text(cd.toFixed(1), x + sw / 2, sy + sw / 2 - 4, 14, '#fff');
    }
  });
  text('좌클릭 · 우클릭 · Space · Q', sx0 + ((sw + gap) * 4 - gap) / 2, sy + sw + 14, 11, '#6a5e4e');

  // 보스 체력
  const boss = G.enemies.find(e => e.isBoss);
  if (boss) {
    const god = GODS[boss.god], bw = 560, bx = W / 2 - bw / 2, by = H - 16;
    text(`${god.title} · ${god.name}${boss.phase === 2 ? '  [격노]' : ''}`, W / 2, by - 10, 14, god.color);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx, by, bw, 10);
    ctx.fillStyle = god.color; ctx.fillRect(bx, by, bw * boss.hp / boss.maxHp, 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(bx + bw / 2 - 1, by - 2, 2, 14);
  } else if (G.room && G.room.cleared && G.doors.length) {
    text('도리이(鳥居)를 지나 다음 방으로', W / 2, H - 20, 14, '#c9b48a');
  } else if (G.room && G.room.cleared && G.pickups.length) {
    text('보상을 획득하세요', W / 2, H - 20, 14, '#c9b48a');
  }
}

function drawBanner() {
  const b = G.banner; if (!b) return;
  const k = b.t / b.max, a = Math.min(1, (1 - k) * 6, k * 4);
  ctx.globalAlpha = clamp(a, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, H / 2 - 70, W, 120);
  text(b.title, W / 2, H / 2 - 28, 46, '#f4e6c8', 'center', 900);
  if (b.sub) wrapText(b.sub, W / 2, H / 2 + 18, 820, 17, '#c9b48a');
  ctx.globalAlpha = 1;
}

// ───────── 메뉴 UI ─────────
function hover(x, y, w, h) { const m = Input.mouse; return m.x > x && m.x < x + w && m.y > y && m.y < y + h; }
function uiButton(x, y, w, h, label, o = {}) {
  const hv = !o.disabled && hover(x, y, w, h);
  ctx.fillStyle = o.disabled ? 'rgba(40,36,34,0.7)' : hv ? 'rgba(196,40,28,0.85)' : 'rgba(20,14,12,0.85)';
  roundRect(x, y, w, h, 6); ctx.fill();
  ctx.strokeStyle = o.disabled ? '#3a3430' : hv ? '#ffcf9a' : '#8a5a3a'; ctx.lineWidth = 2; roundRect(x, y, w, h, 6); ctx.stroke();
  text(label, x + w / 2, y + h / 2 + 1, o.size || 20, o.disabled ? '#6a5e4e' : '#f4e6c8');
  if (hv && Input.wasPressed('Mouse0')) { Sfx.play('select'); return true; }
  return false;
}

function drawMenuBg() {
  const gr = ctx.createRadialGradient(W / 2, H * 0.4, 50, W / 2, H * 0.4, W * 0.7);
  gr.addColorStop(0, '#2a0f0a'); gr.addColorStop(1, '#07060a'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.07; text('十拳剣', W / 2, H * 0.42, 300, '#ff6a2a', 'center', 900); ctx.globalAlpha = 1;
  // 떠다니는 불티
  for (let i = 0; i < 40; i++) {
    const t = performance.now() / 1000, x = (i * 97 + t * 15 * (1 + i % 3)) % W, y = H - ((i * 53 + t * 40 * (1 + i % 4)) % H);
    circle(x, y, 1.5 + i % 3, `rgba(255,${120 + i * 3},60,${0.3 + (i % 5) * 0.1})`);
  }
}

function drawTitle() {
  drawMenuBg();
  const m = G.meta;
  text('토츠카의 검', W / 2, 160, 84, '#f4e6c8', 'center', 900);
  text('十 拳 剣  ·  TOTSUKA NO TSURUGI', W / 2, 228, 18, '#c9a06a');
  wrapText('다카마가하라에서 추방된 폭풍의 신 스사노오. 신들의 시련을 베어 넘고, 이즈모의 대사(大蛇)를 토츠카의 검으로 베어라.', W / 2, 270, 700, 17, '#a8987e');
  // 난이도 선택 (클릭 또는 ←/→)
  const bw = 150, gap = 12, bx0 = W / 2 - (bw * 4 + gap * 3) / 2, by = 340;
  let cur = DIFF_ORDER.indexOf(m.difficulty); if (cur < 0) cur = 1;
  if (Input.wasPressed('ArrowLeft') || Input.wasPressed('ArrowRight')) {
    cur = clamp(cur + (Input.wasPressed('ArrowRight') ? 1 : -1), 0, 3); m.difficulty = DIFF_ORDER[cur]; saveMeta(); Sfx.play('select');
  }
  DIFF_ORDER.forEach((k, i) => {
    const d = DIFFICULTIES[k], x = bx0 + i * (bw + gap), sel = i === cur, hv = hover(x, by, bw, 42);
    ctx.fillStyle = sel ? 'rgba(40,24,18,0.95)' : hv ? 'rgba(30,20,16,0.9)' : 'rgba(16,12,10,0.8)';
    roundRect(x, by, bw, 42, 6); ctx.fill();
    ctx.strokeStyle = sel ? d.color : hv ? '#8a5a3a' : '#3a3028'; ctx.lineWidth = sel ? 2.5 : 1.5; roundRect(x, by, bw, 42, 6); ctx.stroke();
    text(d.name, x + bw / 2, by + 22, 18, sel ? d.color : '#8a7a62', 'center', sel ? 900 : 700);
    if (m.clears[k]) text(`토벌 ${m.clears[k]}`, x + bw / 2, by + 56, 11, d.color, 'center', 400);
    if (hv && Input.wasPressed('Mouse0') && !sel) { m.difficulty = k; saveMeta(); Sfx.play('select'); }
  });
  text(DIFFICULTIES[DIFF_ORDER[cur]].desc, W / 2, by + 80, 15, '#c9b48a', 'center', 400);
  if (uiButton(W / 2 - 130, 450, 260, 56, '출진(出陣)', { size: 24 })) startRun();
  if (uiButton(W / 2 - 130, 518, 260, 46, `수련 — 영구 강화  (魂 ${m.souls})`, { size: 17 })) G.state = 'upgrade';
  if (Input.wasPressed('Enter') || Input.wasPressed('Space')) startRun();
  text(`출진 ${m.runs}회 · 오로치 토벌 ${m.wins}회`, W / 2, 592, 14, '#6a5e4e');
  text('이동 WASD   ·   베기 좌클릭/J (3연격)   ·   회전베기 우클릭/K   ·   대시 Space/Shift   ·   주술 Q   ·   일시정지 Esc', W / 2, H - 40, 14, '#8a7a62');
}

function drawUpgrade() {
  drawMenuBg();
  text('수련(修練)', W / 2, 90, 48, '#f4e6c8', 'center', 900);
  text(`보유한 혼(魂): ${G.meta.souls}   —  죽어도 영구히 유지되는 강화`, W / 2, 140, 17, '#8fd8ff');
  META.forEach((u, i) => {
    const y = 190 + i * 100, lvl = G.meta[u.id], maxed = lvl >= u.max, cost = u.cost(lvl);
    ctx.fillStyle = 'rgba(20,14,12,0.8)'; roundRect(W / 2 - 360, y, 720, 82, 8); ctx.fill();
    ctx.strokeStyle = '#4a3a2e'; ctx.lineWidth = 1.5; roundRect(W / 2 - 360, y, 720, 82, 8); ctx.stroke();
    text(u.name, W / 2 - 330, y + 28, 22, '#f4e6c8', 'left');
    text(u.desc, W / 2 - 330, y + 58, 15, '#a8987e', 'left');
    for (let k = 0; k < u.max; k++) circle(W / 2 - 40 + k * 22, y + 41, 7, k < lvl ? '#ffb04a' : '#2a2420');
    if (uiButton(W / 2 + 170, y + 18, 170, 46, maxed ? '완성' : `魂 ${cost}`, { disabled: maxed || G.meta.souls < cost })) {
      G.meta.souls -= cost; G.meta[u.id]++; saveMeta(); Sfx.play('pickup');
    }
  });
  if (uiButton(W / 2 - 110, H - 100, 220, 50, '돌아가기') || Input.wasPressed('Escape')) G.state = 'title';
}

function drawChoice() {
  const c = G.choice, god = GODS[c.god], P = G.player;
  c.t += 1 / 60;
  ctx.fillStyle = 'rgba(5,4,6,0.82)'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.08; text(god.kanji, W / 2, H / 2, 520, god.color, 'center', 900); ctx.globalAlpha = 1;
  text(`${god.title} ${god.name}의 권능`, W / 2, 92, 40, god.color, 'center', 900);
  text('하나를 골라 토츠카의 검에 깃들게 하라  (클릭 또는 1·2·3)', W / 2, 140, 17, '#c9b48a');
  const cw = 330, ch = 380, gap = 34, x0 = W / 2 - (cw * 3 + gap * 2) / 2, y0 = 190;
  c.opts.forEach((pw, i) => {
    const x = x0 + i * (cw + gap), hv = hover(x, y0, cw, ch);
    ctx.save();
    if (hv) { ctx.shadowColor = god.color; ctx.shadowBlur = 30; }
    ctx.fillStyle = hv ? 'rgba(40,24,18,0.98)' : 'rgba(22,16,14,0.96)'; roundRect(x, y0 - (hv ? 8 : 0), cw, ch, 12); ctx.fill();
    ctx.restore();
    const y = y0 - (hv ? 8 : 0);
    ctx.strokeStyle = hv ? god.color : '#5a4636'; ctx.lineWidth = 2; roundRect(x, y, cw, ch, 12); ctx.stroke();
    text(`${i + 1}`, x + 24, y + 26, 16, '#6a5e4e');
    ctx.fillStyle = god.color; roundRect(x + cw / 2 - 50, y + 20, 100, 28, 14); ctx.fill();
    text(`${SLOTS[pw.slot]} · ${SLOT_KEYS[pw.slot]}`, x + cw / 2, y + 35, 13, '#120c0a');
    text(god.kanji, x + cw / 2, y + 110, 72, god.color, 'center', 900);
    text(pw.name, x + cw / 2, y + 186, 27, '#f4e6c8', 'center', 900);
    wrapText(pw.desc, x + cw / 2, y + 232, cw - 50, 16, '#c9b8a0');
    if (pw.cd) text(`재사용 대기 ${pw.cd}초`, x + cw / 2, y + ch - 66, 13, '#8a7a62');
    const cur = P.powers[pw.slot];
    if (cur) text(`⟳ 교체: ${cur.name}`, x + cw / 2, y + ch - 32, 15, '#ff9a7a');
    else text('빈 슬롯', x + cw / 2, y + ch - 32, 14, '#6a8a6a');
    if (c.t > 0.4 && ((hv && Input.wasPressed('Mouse0')) || Input.wasPressed('Digit' + (i + 1)))) choosePower(i);
  });
}

function drawPause() {
  ctx.fillStyle = 'rgba(5,4,6,0.85)'; ctx.fillRect(0, 0, W, H);
  text('일시정지', W / 2, 110, 44, '#f4e6c8', 'center', 900);
  const lines = [
    ['이동', 'WASD / 방향키'], ['베기 (3연격)', '좌클릭 / J  — 누르고 있으면 연속'], ['회전베기', '우클릭 / K'],
    ['대시 (무적)', 'Space / Shift'], ['주술 (신의 권능)', 'Q'], ['일시정지', 'Esc'],
  ];
  lines.forEach(([a, b], i) => { text(a, W / 2 - 30, 180 + i * 34, 18, '#c9b48a', 'right'); text(b, W / 2 + 10, 180 + i * 34, 18, '#e8dcc4', 'left', 400); });
  text('지니고 있는 권능', W / 2, 410, 20, '#f4e6c8');
  SLOT_ORDER.forEach((slot, i) => {
    const pw = G.player.powers[slot];
    text(`${SLOTS[slot]}  —  ${pw ? pw.name + ' : ' + pw.desc : '없음'}`, W / 2, 448 + i * 30, 15, pw ? '#e8dcc4' : '#6a5e4e', 'center', 400);
  });
  if (uiButton(W / 2 - 230, H - 110, 210, 50, '계속하기')) G.state = 'play';
  if (uiButton(W / 2 + 20, H - 110, 210, 50, '포기하고 귀환')) endRun(false);
}

function drawEnd() {
  G.endT += 1 / 60;
  const a = Math.min(1, G.endT * 1.5), won = G.state === 'win';
  ctx.fillStyle = `rgba(5,4,6,${0.85 * a})`; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = a;
  if (won) {
    text('야마타노오로치를 베었다', W / 2, 150, 52, '#f4e6c8', 'center', 900);
    wrapText('여덟 번째 꼬리를 베는 순간 토츠카의 검의 날이 이가 빠졌다. 꼬리 속에서 한 자루의 검이 나왔으니 — 훗날 삼종신기가 될 쿠사나기의 검이었다.', W / 2, 220, 760, 18, '#c9b48a');
  } else {
    text('스사노오는 쓰러졌다', W / 2, 160, 52, '#e0402e', 'center', 900);
    text('그러나 폭풍은 다시 일어난다', W / 2, 220, 20, '#a8987e');
  }
  const st = STAGES[G.stageIdx];
  text(`도달: ${st.name} ${G.roomIdx}번째 방`, W / 2, 310, 19, '#e8dcc4', 'center', 400);
  text(`처치한 적: ${G.kills}`, W / 2, 345, 19, '#e8dcc4', 'center', 400);
  const mult = D().souls === 1 ? '' : ` × ${D().souls} (${D().name})`;
  text(`획득한 혼(魂): ${G.runSouls}${mult} = ${G.soulsGained}  →  보유 ${G.meta.souls}`, W / 2, 380, 19, '#8fd8ff', 'center', 400);
  ctx.globalAlpha = 1;
  if (G.endT > 0.8 && uiButton(W / 2 - 140, 460, 280, 56, '다카마가하라로 귀환')) G.state = 'title';
}

// ───────── 메인 루프 ─────────
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(1 / 30, (now - lastT) / 1000); lastT = now;
  if (G.state === 'play') {
    if (Input.wasPressed('Escape') || Input.wasPressed('KeyP')) G.state = 'paused';
    else if (G.hitstop > 0) G.hitstop -= dt;
    else { updatePlay(dt); updateFx(dt); }
    G.shake = Math.max(0, G.shake - dt * 40);
    G.redFlash = Math.max(0, G.redFlash - dt);
    if (G.banner) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }
  } else if (G.state === 'paused') {
    if (Input.wasPressed('Escape') || Input.wasPressed('KeyP')) G.state = 'play';
  } else if (G.state === 'dead' || G.state === 'win') {
    updateFx(dt);
  }
  render();
  Input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 디버그용 (브라우저 콘솔): TOTSUKA.skipTo(2) → 3번째 지역 보스방
window.TOTSUKA = {
  G,
  skipTo(stage) { if (G.state !== 'play') startRun(); G.stageIdx = stage; G.roomIdx = ROOMS_PER_STAGE - 1; enterRoom(null); },
  god() { G.player.hp = G.player.maxHp = 9999; },
};
