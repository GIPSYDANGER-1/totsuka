'use strict';
// ───────── 방 지도: 타일 격자, 방 모양 생성, 바닥 판정, 카메라, 타일 렌더링 ─────────
// 방은 TS×TS 크기 타일의 격자이고, mask로 바닥이 있는 칸을 표시한다 (모서리가 잘린 ㄱ·ㄴ자 방 등).
// 바닥 타일 한 칸은 화면에서 48×24 도트 마름모를 1.9배 한 크기 (TS × ISO.K × 2 ≈ 91px 폭).

const TS = 65;
const PX = 1.9; // 환경 도트 배율 (캐릭터와 같음)
const MAP = { tw: 12, td: 12, mask: [], walls: [], doorSpots: [], corner: null, entry: null, center: null, bounds: null, clip: null };
const CAM = { x: ISO.OX, y: ISO.OY };

function tileAt(tx, ty) { return tx >= 0 && ty >= 0 && tx < MAP.tw && ty < MAP.td && MAP.mask[ty * MAP.tw + tx] === 1; }
function isFloor(x, y) { return tileAt(Math.floor(x / TS), Math.floor(y / TS)); }
const tileCenter = (tx, ty) => ({ x: tx * TS + TS / 2, y: ty * TS + TS / 2 });

// ───────── 방 모양 생성 ─────────
// 일반 방: 가로·세로 타일 수가 매번 다르고, 절반 이상은 모서리 하나를 잘라낸 모양.
// 보스 방: 넓은 정사각형.
function makeRoomMap(isBoss) {
  let tw, td, notch = null;
  if (isBoss) { tw = td = 15; }
  else {
    tw = randi(12, 19); td = randi(10, 17);
    if (Math.random() < 0.5) [tw, td] = [td, tw];
    if (Math.random() < 0.6) {
      const a = randi(3, Math.floor(tw * 0.4)), b = randi(3, Math.floor(td * 0.4));
      notch = { side: pick(['front', 'left', 'right', 'back']), a, b };
    }
  }
  const mask = new Array(tw * td).fill(1);
  if (notch) {
    const { side, a, b } = notch;
    for (let y = 0; y < td; y++) for (let x = 0; x < tw; x++) {
      const cut = side === 'front' ? x >= tw - a && y >= td - b
        : side === 'left' ? x < a && y >= td - b
        : side === 'right' ? x >= tw - a && y < b
        : x < a && y < b;
      if (cut) mask[y * tw + x] = 0;
    }
  }
  Object.assign(MAP, { tw, td, mask });
  ARENA.x2 = ISO.WW = tw * TS; ARENA.y2 = ISO.WD = td * TS;

  // 벽 조각: 왼쪽 뒷벽(L) = 왼쪽(x-1) 칸이 비어 있음, 오른쪽 뒷벽(R) = 위쪽(y-1) 칸이 비어 있음
  MAP.walls = [];
  const tiles = [];
  for (let y = 0; y < td; y++) for (let x = 0; x < tw; x++) if (tileAt(x, y)) {
    tiles.push([x, y]);
    if (!tileAt(x - 1, y)) MAP.walls.push({ side: 'L', tx: x, ty: y });
    if (!tileAt(x, y - 1)) MAP.walls.push({ side: 'R', tx: x, ty: y });
  }
  const depth = ([x, y]) => x + y;
  // 입구: 화면에서 가장 앞(아래) 칸. 안쪽 모서리 문: 양쪽이 벽인 가장 안쪽 칸.
  const front = tiles.reduce((a, b) => depth(b) > depth(a) ? b : a);
  MAP.entry = tileCenter(front[0], front[1]);
  const corners = tiles.filter(([x, y]) => !tileAt(x - 1, y) && !tileAt(x, y - 1)).sort((a, b) => depth(a) - depth(b));
  MAP.corner = { x: corners[0][0] * TS + 40, y: corners[0][1] * TS + 40 };
  // 일반 문 두 개: 왼쪽 뒷벽과 오른쪽 뒷벽에서 하나씩, 모서리에서 조금 떨어진 곳
  const wallSpot = side => {
    const segs = MAP.walls.filter(w => w.side === side).sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty));
    const w = segs[Math.min(segs.length - 1, Math.max(2, Math.floor(segs.length * 0.35)))];
    return side === 'L' ? { x: w.tx * TS + 22, y: w.ty * TS + TS / 2, side } : { x: w.tx * TS + TS / 2, y: w.ty * TS + 22, side };
  };
  MAP.doorSpots = [wallSpot('L'), wallSpot('R')];
  // 보상이 놓일 중앙: 방 한가운데에 가장 가까운 바닥 칸
  const mid = tiles.reduce((a, b) => Math.hypot(b[0] - tw / 2, b[1] - td / 2) < Math.hypot(a[0] - tw / 2, a[1] - td / 2) ? b : a);
  MAP.center = tileCenter(mid[0], mid[1]);
  // 바닥 모양 클립 (예고 범위 등이 바닥 밖으로 그려지지 않게)
  MAP.clip = new Path2D();
  for (const [x, y] of tiles) MAP.clip.rect(x * TS - 0.5, y * TS - 0.5, TS + 1, TS + 1);
  // 화면 투영 범위 (원점 0 기준) — 카메라 제한과 배경 캔버스 크기에 쓴다
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of tiles) for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
    const sx = (cx - cy) * TS * ISO.K, sy = (cx + cy) * TS * ISO.K / 2;
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  ISO.WALL = wallScreenH();
  MAP.bounds = { minX, maxX, minY: minY - ISO.WALL - 30, maxY: maxY + 30 };
}

// 바닥이 없는 칸(방 밖, 잘린 모서리)과 장애물에서 밀어낸다
function collideWorld(o) {
  if (!isFloor(o.x, o.y) && o._lx !== undefined) { o.x = o._lx; o.y = o._ly; }
  for (let iter = 0; iter < 2; iter++) {
    const tx0 = Math.floor((o.x - o.r) / TS), tx1 = Math.floor((o.x + o.r) / TS);
    const ty0 = Math.floor((o.y - o.r) / TS), ty1 = Math.floor((o.y + o.r) / TS);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (tileAt(tx, ty)) continue;
      const cx = clamp(o.x, tx * TS, tx * TS + TS), cy = clamp(o.y, ty * TS, ty * TS + TS);
      const dx = o.x - cx, dy = o.y - cy, d = Math.hypot(dx, dy);
      if (d < o.r && d > 0.001) { o.x = cx + dx / d * o.r; o.y = cy + dy / d * o.r; }
    }
  }
  for (const ob of G.obstacles) {
    const dx = o.x - ob.x, dy = o.y - ob.y, d = Math.hypot(dx, dy), m = o.r + ob.r;
    if (d < m && d > 0.001) { o.x = ob.x + dx / d * m; o.y = ob.y + dy / d * m; }
  }
  if (isFloor(o.x, o.y)) { o._lx = o.x; o._ly = o.y; }
}
function inObstacle(x, y, pad = 0) {
  if (![[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]].every(([dx, dy]) => isFloor(x + dx, y + dy))) return true;
  return G.obstacles.some(ob => Math.hypot(x - ob.x, y - ob.y) < ob.r + pad);
}

// ───────── 카메라 ─────────
// ISO.OX/OY(월드 원점의 화면 위치)를 움직여 플레이어를 따라간다. 방이 화면보다 작으면 가운데 고정.
function cameraTarget() {
  const b = MAP.bounds, P = G.player, top = 66, bottom = H - 30;
  const px = (P.x - P.y) * ISO.K, py = (P.x + P.y) * ISO.K / 2;
  const ox = b.maxX - b.minX <= W - 40 ? W / 2 - (b.minX + b.maxX) / 2 : clamp(W / 2 - px, W - 20 - b.maxX, 20 - b.minX);
  const oy = b.maxY - b.minY <= bottom - top ? (top + bottom) / 2 - (b.minY + b.maxY) / 2 : clamp(H / 2 + 30 - py, bottom - b.maxY, top - b.minY);
  return { ox, oy };
}
function updateCamera(dt, snap = false) {
  const t = cameraTarget(), k = snap ? 1 : Math.min(1, dt * 7);
  CAM.x += (t.ox - CAM.x) * k; CAM.y += (t.oy - CAM.y) * k;
  ISO.OX = Math.round(CAM.x); ISO.OY = Math.round(CAM.y); // 정수 위치라야 도트가 흐려지지 않는다
}

// ───────── 환경 에셋 (sprite-artist 제작, tools/sprites/env.py) ─────────
const ENV_STAGES = ['yomi', 'thunder', 'moon', 'izumo'];
const ENV = {
  common: {
    lantern: loadImg('assets/env/common/lantern.png'),
    toriiFront: loadImg('assets/env/common/torii_front.png'),
    toriiSide: loadImg('assets/env/common/torii_side.png'),
  },
};
for (const s of ENV_STAGES) ENV[s] = {
  floor: [0, 1, 2, 3].map(i => loadImg(`assets/env/${s}/floor_${i}.png`)),
  wall: [0, 1].map(i => loadImg(`assets/env/${s}/wall_${i}.png`)),
  cliff: [0, 1].map(i => loadImg(`assets/env/${s}/cliff_${i}.png`)),
  rock: [0, 1].map(i => loadImg(`assets/env/${s}/rock_${i}.png`)),
};
// 소품 앵커 (땅에 닿는 점, 원본 px)
const ENV_ANCHOR = { lantern: [11, 45], toriiFront: [32, 62], toriiSide: [24, 52], rock: [16, 22] };
const imgOk = img => !!img && img.complete && img.naturalWidth > 0;
const envSet = () => ENV[STAGES[G.stageIdx].env];
const envReady = () => { const e = envSet(); return e && [...e.floor, ...e.wall, ...e.cliff].every(imgOk); };

// 좌우 반전·어둡게 한 사본 (오른쪽 뒷벽, 오른쪽 앞 절벽용). 한 번 만들어 캐시.
const _variants = new Map();
function envVariant(img, flip, shade) {
  const key = img.src + '|' + flip + '|' + shade;
  if (_variants.has(key)) return _variants.get(key);
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  if (flip) { g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(img, 0, 0);
  if (shade) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(0,0,0,${shade})`; g.fillRect(0, 0, c.width, c.height); }
  _variants.set(key, c);
  return c;
}
const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ───────── 배경 (바닥 + 앞쪽 절벽면) ─────────
// 뒷벽은 캐릭터와 앞뒤가 바뀔 수 있어 매 프레임 깊이 정렬해 그린다 (drawWallSeg).
function buildBg(st) {
  const b = MAP.bounds, pad = 40;
  const c = document.createElement('canvas');
  c.width = Math.ceil(b.maxX - b.minX + pad * 2); c.height = Math.ceil(b.maxY - b.minY + pad * 2);
  const ox = pad - b.minX, oy = pad - b.minY; // 캔버스 안에서의 월드 원점
  G.bgO = { x: ox, y: oy };
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  const P = (wx, wy) => ({ x: ox + (wx - wy) * ISO.K, y: oy + (wx + wy) * ISO.K / 2 });
  const env = envSet(), useImg = envReady();
  G.bgFallback = !useImg;

  const tiles = [];
  for (let y = 0; y < MAP.td; y++) for (let x = 0; x < MAP.tw; x++) if (tileAt(x, y)) tiles.push([x, y]);
  tiles.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1])); // 뒤에서 앞으로 (화가 알고리즘)
  for (const [x, y] of tiles) {
    const top = P(x * TS, y * TS), left = P(x * TS, (y + 1) * TS), bot = P((x + 1) * TS, (y + 1) * TS), right = P((x + 1) * TS, y * TS);
    const r = hash2(x, y);
    if (useImg) {
      const img = env.floor[r < 0.05 ? 3 : Math.floor(r * 37) % 3]; // 3번(균열·문양 등)은 드물게
      g.drawImage(img, top.x - 24 * PX, top.y, 48 * PX, 24 * PX);
    } else {
      g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(right.x, right.y); g.lineTo(bot.x, bot.y); g.lineTo(left.x, left.y); g.closePath();
      g.fillStyle = st.floor; g.fill();
      g.fillStyle = `rgba(255,255,255,${r * 0.05})`; g.fill();
      g.strokeStyle = st.tile; g.lineWidth = 2; g.stroke();
    }
    // 앞쪽 가장자리 아래 절벽면 (왼쪽 앞: 아래 칸이 빔, 오른쪽 앞: 오른쪽 칸이 빔)
    if (!tileAt(x, y + 1)) {
      if (useImg) g.drawImage(env.cliff[r < 0.5 ? 0 : 1], left.x, left.y, 24 * PX, 26 * PX);
      else { poly(g, [left, bot, { x: bot.x, y: bot.y + 26 }, { x: left.x, y: left.y + 26 }], st.floor); poly(g, [left, bot, { x: bot.x, y: bot.y + 26 }, { x: left.x, y: left.y + 26 }], 'rgba(0,0,0,0.55)'); }
    }
    if (!tileAt(x + 1, y)) {
      if (useImg) g.drawImage(envVariant(env.cliff[r < 0.5 ? 1 : 0], true, 0.3), bot.x, bot.y - 11 * PX, 24 * PX, 26 * PX);
      else { poly(g, [bot, right, { x: right.x, y: right.y + 26 }, { x: bot.x, y: bot.y + 26 }], st.floor); poly(g, [bot, right, { x: right.x, y: right.y + 26 }, { x: bot.x, y: bot.y + 26 }], 'rgba(0,0,0,0.7)'); }
    }
  }
  // 뒷벽 아래로 드리운 그림자
  g.save(); g.setTransform(ISO.K, ISO.K / 2, -ISO.K, ISO.K / 2, ox, oy);
  g.clip(MAP.clip);
  for (const w of MAP.walls) {
    const x0 = w.tx * TS, y0 = w.ty * TS;
    const gr = w.side === 'L' ? g.createLinearGradient(x0, 0, x0 + 70, 0) : g.createLinearGradient(0, y0, 0, y0 + 70);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x0, y0, w.side === 'L' ? 70 : TS, w.side === 'L' ? TS : 70);
  }
  g.restore();
  return c;
}
function poly(g, pts, fill) { g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.closePath(); g.fillStyle = fill; g.fill(); }

// 벽 높이(화면 px): 벽 이미지 높이에서 읽는다 (24×44 → 낮은 벽, 24×68 → 높은 벽). 밑변은 늘 2:1 사선 11px.
function wallScreenH() {
  const e = envSet(), img = e && e.wall[0];
  return imgOk(img) ? (img.naturalHeight - 12) * PX : 54;
}
// 벽 조각의 화면 영역 (원점 기준, 가림 판정용)
function wallBox(w) {
  const x0 = w.tx * TS, y0 = w.ty * TS;
  const a = w.side === 'L' ? iso(x0, y0 + TS) : iso(x0 + TS, y0), b = iso(x0, y0); // a: 아래 끝, b: 위 끝
  return { x: Math.min(a.x, b.x), y: b.y - ISO.WALL, w: Math.abs(a.x - b.x), h: a.y - b.y + ISO.WALL };
}

// 뒷벽 한 조각 (screenTransform 상태에서 호출)
function drawWallSeg(w) {
  const st = STAGES[G.stageIdx], env = envSet(), x0 = w.tx * TS, y0 = w.ty * TS;
  const variant = hash2(w.tx * 3 + (w.side === 'R' ? 7 : 0), w.ty * 5) < 0.25 ? 1 : 0;
  if (envReady()) {
    const img = env.wall[variant], ih = img.naturalHeight;
    ctx.imageSmoothingEnabled = false;
    if (w.side === 'L') { const a = iso(x0, y0 + TS); ctx.drawImage(img, a.x, a.y - (ih - 1) * PX, 24 * PX, ih * PX); }
    else { const a = iso(x0, y0); ctx.drawImage(envVariant(img, true, 0.28), a.x, a.y - (ih - 12) * PX, 24 * PX, ih * PX); }
    return;
  }
  // 에셋이 없을 때: 면 두 개로 된 단순한 벽
  const a = w.side === 'L' ? iso(x0, y0 + TS) : iso(x0, y0), b = w.side === 'L' ? iso(x0, y0) : iso(x0 + TS, y0), Hh = ISO.WALL;
  const face = [a, b, { x: b.x, y: b.y - Hh }, { x: a.x, y: a.y - Hh }];
  ctx.beginPath(); face.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
  ctx.fillStyle = st.floor; ctx.fill();
  ctx.fillStyle = w.side === 'L' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.5)'; ctx.fill();
  ctx.strokeStyle = st.accent; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(a.x, a.y - Hh); ctx.lineTo(b.x, b.y - Hh); ctx.stroke(); ctx.globalAlpha = 1;
  if (variant) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect((a.x + b.x) / 2 - 4, (a.y + b.y) / 2 - Hh, 8, Hh); }
}

// 장애물 소품 (uprightAt(o) 상태에서 호출). 석등 또는 지역 바위.
function drawProp(o) {
  const env = envSet();
  const img = o.kind === 'rock' ? env && env.rock[o.v || 0] : ENV.common.lantern;
  if (!imgOk(img)) return drawLantern(o);
  const [ax, ay] = o.kind === 'rock' ? ENV_ANCHOR.rock : ENV_ANCHOR.lantern;
  if (!G.silPass) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(o.x, o.y + 2, o.r * 1.1, o.r * 0.45, 0, 0, TAU); ctx.fill(); }
  drawSprite25D(img, 0, 0, img.naturalWidth, img.naturalHeight, o.x, o.y, ax, ay, PX, false, { noRim: true });
  if (o.kind !== 'rock' && !G.silPass) { // 석등 불빛
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gy = o.y - 30 * PX, gr = ctx.createRadialGradient(o.x, gy, 2, o.x, gy, 40);
    gr.addColorStop(0, `rgba(255,190,110,${0.32 + Math.sin(G.time * 5 + o.x) * 0.06})`); gr.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = gr; ctx.fillRect(o.x - 40, gy - 40, 80, 80); ctx.restore();
  }
}
