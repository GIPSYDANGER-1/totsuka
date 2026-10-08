'use strict';
// ───────── 캔버스 / 공용 유틸 / 입력 / 사운드 ─────────
const W = 1280, H = 720, TAU = Math.PI * 2;
const canvas = document.getElementById('game');
let ctx = canvas.getContext('2d'); // 실루엣 패스에서 잠시 오프스크린 캔버스로 바꿔 끼운다
canvas.width = W; canvas.height = H;
function fitCanvas() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  canvas.style.width = Math.floor(W * s) + 'px';
  canvas.style.height = Math.floor(H * s) + 'px';
}
addEventListener('resize', fitCanvas); fitCanvas();

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

// ───────── 입력 ─────────
const Input = {
  keys: {}, pressed: {}, mouse: { x: W / 2, y: H / 2 },
  isDown(k) { return !!this.keys[k]; },
  wasPressed(k) { return !!this.pressed[k]; },
  endFrame() { this.pressed = {}; },
};
addEventListener('keydown', e => {
  if (!Input.keys[e.code]) Input.pressed[e.code] = true;
  Input.keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  Sfx.unlock();
});
addEventListener('keyup', e => { Input.keys[e.code] = false; });
addEventListener('blur', () => { Input.keys = {}; });
function trackMouse(e) {
  const r = canvas.getBoundingClientRect();
  Input.mouse.x = (e.clientX - r.left) * W / r.width;
  Input.mouse.y = (e.clientY - r.top) * H / r.height;
}
addEventListener('mousemove', trackMouse);
canvas.addEventListener('mousedown', e => {
  trackMouse(e);
  const k = 'Mouse' + e.button;
  Input.pressed[k] = true; Input.keys[k] = true;
  Sfx.unlock();
});
addEventListener('mouseup', e => { Input.keys['Mouse' + e.button] = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ───────── 사운드 (WebAudio 합성, 에셋 없음) ─────────
const Sfx = {
  ac: null, vol: 0.22, last: {},
  unlock() {
    if (!this.ac) {
      try {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();
        const len = this.ac.sampleRate;
        this.noise = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { this.ac = null; }
    }
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
  },
  tone(freq, dur, type = 'sine', vol = 1, slide = 0) {
    const c = this.ac; if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(this.vol * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur);
  },
  burst(dur, vol = 1, freq = 2000, q = 1) {
    const c = this.ac; if (!c) return;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime;
    s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(this.vol * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(c.destination); s.start(t); s.stop(t + dur);
  },
  play(n) {
    if (!this.ac) return;
    const now = performance.now();
    if (this.last[n] && now - this.last[n] < 40) return;
    this.last[n] = now;
    switch (n) {
      case 'slash': this.burst(0.12, 0.5, 3800, 0.9); break;
      case 'heavy': this.burst(0.25, 0.8, 1800, 0.6); this.tone(160, 0.2, 'triangle', 0.4, 0.5); break;
      case 'hit': this.tone(190, 0.09, 'square', 0.25, 0.5); break;
      case 'dash': this.burst(0.18, 0.35, 1100, 0.5); break;
      case 'hurt': this.tone(140, 0.28, 'sawtooth', 0.5, 0.4); break;
      case 'boom': this.burst(0.5, 0.9, 260, 0.6); this.tone(70, 0.45, 'sine', 0.8, 0.4); break;
      case 'thunder': this.burst(0.7, 0.9, 700, 0.3); this.tone(50, 0.5, 'sawtooth', 0.3, 0.5); break;
      case 'shoot': this.tone(560, 0.07, 'triangle', 0.18, 0.6); break;
      case 'pickup': this.tone(660, 0.12, 'sine', 0.45, 1.5); setTimeout(() => this.tone(990, 0.18, 'sine', 0.45), 90); break;
      case 'kill': this.tone(320, 0.16, 'triangle', 0.35, 0.3); break;
      case 'select': this.tone(520, 0.07, 'sine', 0.35, 1.3); break;
      case 'gong': this.tone(98, 1.8, 'sine', 1, 0.97); this.tone(196, 1.2, 'sine', 0.35, 0.99); this.tone(293, 0.9, 'sine', 0.15); break;
      case 'moon': this.tone(880, 0.6, 'sine', 0.3, 0.5); this.tone(1320, 0.5, 'sine', 0.15, 0.5); break;
      case 'door': this.tone(220, 0.5, 'triangle', 0.4, 1.5); break;
    }
  },
};

// ───────── 그리기 헬퍼 ─────────
const FONT = '"Noto Serif KR", "Hiragino Mincho ProN", "Apple SD Gothic Neo", serif';
function circle(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
function ring(x, y, r, stroke, lw) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
function text(str, x, y, size, color, align = 'center', weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}
function wrapText(str, x, y, maxW, size, color, lineH = size * 1.45, align = 'center', weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const lines = []; let line = '';
  for (const word of str.split(' ')) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => text(l, x, y + i * lineH, size, color, align, weight));
  return lines.length * lineH;
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ───────── 이미지 로더 ─────────
// 배포 후 에셋이 바뀌어도 예전 이미지가 캐시에서 나오지 않도록 버전 쿼리를 붙인다
function loadImg(src) { const img = new Image(); img.src = src + '?v=' + (window.BUILD || 0); return img; }
// 주인공: 사무라이 8방향 (오른쪽은 원본 에셋, 나머지는 sprite-artist가 tools/sprites/samurai8.py로 제작)
// 96×96 프레임, 발끝 앵커 (46, 81). 직접 그린 방향은 5개(e, se, s, ne, n), 나머지 3개는 좌우 반전.
// hit: 칼이 휘둘러지는 프레임. 판정이 누르는 즉시 나므로 그 프레임부터 재생한다.
// (이전 주인공 스사노오 스프라이트는 assets/player/susanoo_*.png에 남아 있다)
const SPR = {};
const sheet = (file, n, fps, hit = 0) => ({ img: loadImg(`assets/player/${file}.png`), n, fps, hit });
for (const d of ['e', 'se', 's', 'ne', 'n']) {
  const orig = d === 'e'; // 원본 옆모습은 프레임 수가 다르다
  SPR[`idle_${d}`] = sheet(`samurai_${d}_idle`, orig ? 10 : 6, orig ? 10 : 6);
  SPR[`run_${d}`] = sheet(`samurai_${d}_run`, orig ? 16 : 8, orig ? 16 : 10);
  SPR[`attack_${d}`] = sheet(`samurai_${d}_attack`, orig ? 7 : 6, orig ? 14 : 12, orig ? 4 : 3);
}
SPR.dash = sheet('samurai_dash', 4, 12);
SPR.spin = sheet('samurai_spin', 6, 18, 1);
SPR.cast = sheet('samurai_cast', 5, 8);
SPR.hurt = sheet('samurai_hurt', 4, 10);
// 화면 각도 8구역(0 = 오른쪽, 시계 방향) → [시트 방향, 좌우 반전]
const DIR8 = [['e', false], ['se', false], ['s', false], ['se', true], ['e', true], ['ne', true], ['n', false], ['ne', false]];
const sprReady = s => s.img.complete && s.img.naturalWidth > 0;
