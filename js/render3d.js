'use strict';
// ───────── 3D 렌더러 (Three.js): 하데스 같은 쿼터뷰 카툰 3D ─────────
// 게임 판정은 그대로 평평한 월드 좌표(x, y)에서 하고, 그리기만 3D로 한다.
//   월드 (x, y) → 3D (x, 높이, y). 카메라는 +x,+z 쪽 위에서 원점을 내려다보는 정사영(쿼터뷰).
// 캐릭터·요괴·보스·맵은 코드로 조립한 저폴리 모델 + 툰 셰이딩(3단 명암) + 검은 외곽선(뒤집은 껍질).
// 예고 범위·장판·베기 궤적은 기존 2D 그리기 코드를 바닥 텍스처에 그대로 그려 재사용한다.
// HUD·메뉴·파티클·피해 숫자는 위에 겹친 2D 캔버스에 그린다. WebGL이 안 되면 기존 2D 도트 렌더러로 대체.

const R3 = { active: false };

(function initR3() {
  const gl = document.getElementById('gl');
  if (!window.THREE || !gl) return;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true }); } catch (e) { return; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H, false);
  renderer.useLegacyLights = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const SCALE = 1.15; // 화면 px / 월드 단위
  const camera = new THREE.OrthographicCamera(-W / 2 / SCALE, W / 2 / SCALE, H / 2 / SCALE, -H / 2 / SCALE, 1, 5000);
  const EL = 40 * Math.PI / 180; // 카메라 내려다보는 각도
  const CAM_DIR = new THREE.Vector3(Math.cos(EL) * Math.SQRT1_2, Math.sin(EL), Math.cos(EL) * Math.SQRT1_2);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.8);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008;
  scene.add(hemi, sun, sun.target);

  // 툰 명암 3단계
  const grad = new THREE.DataTexture(new Uint8Array([78, 145, 210, 255]), 4, 1, THREE.RedFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x120c10, side: THREE.BackSide });
  const xray = {
    player: new THREE.MeshBasicMaterial({ color: 0x6fb4ff, depthFunc: THREE.GreaterDepth, depthWrite: false }),
    enemy: new THREE.MeshBasicMaterial({ color: 0xe0443a, depthFunc: THREE.GreaterDepth, depthWrite: false }),
  };

  Object.assign(R3, {
    active: true, renderer, scene, camera, CAM_DIR, hemi, sun, grad, outlineMat, xray,
    target: new THREE.Vector3(), shakeV: new THREE.Vector3(), tmp: new THREE.Vector3(),
    room: null, dyn: new THREE.Group(), ents: new Map(), dying: [], props: new Map(), lastT: performance.now(),
  });
  scene.add(R3.dyn);
  camera.zoom = 0.95; camera.updateProjectionMatrix(); // 멀리서 방 전체를 넓게 보는 시점
  canvas.style.background = 'transparent';
})();

// ───────── 투영 (2D 오버레이용) ─────────
function r3Project(wx, wy, h = 0) {
  const v = R3.tmp.set(wx, h * 1.2, wy).project(R3.camera);
  return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
}
function r3Unproject(sx, sy) {
  const o = new THREE.Vector3(sx / W * 2 - 1, -(sy / H * 2 - 1), -1).unproject(R3.camera);
  const d = new THREE.Vector3(); R3.camera.getWorldDirection(d);
  const t = -o.y / d.y;
  return { x: o.x + d.x * t, y: o.z + d.z * t };
}
function r3UpdateCamera(dt, snap) {
  const P = G.player;
  if (!P) return;
  const cx = ISO.WW > 420 ? clamp(P.x, 200, ISO.WW - 200) : ISO.WW / 2;
  const cz = ISO.WD > 420 ? clamp(P.y, 200, ISO.WD - 200) : ISO.WD / 2;
  const k = snap ? 1 : Math.min(1, dt * 6);
  R3.target.x += (cx - R3.target.x) * k; R3.target.z += (cz - R3.target.z) * k;
  r3PlaceCamera();
}
function r3PlaceCamera() {
  const c = R3.camera, s = G.shake > 0 ? G.shake * 0.8 : 0;
  R3.shakeV.set(rand(-s, s), 0, rand(-s, s));
  c.position.copy(R3.target).add(R3.shakeV).addScaledVector(R3.CAM_DIR, 1500);
  c.lookAt(R3.target.x + R3.shakeV.x, 0, R3.target.z + R3.shakeV.z);
  c.updateMatrixWorld();
  const o = r3Project(0, 0); ISO.OX = o.x; ISO.OY = o.y; // 번개 이펙트 등 원점 기준 좌표용
}

// ───────── 재질·부품 헬퍼 ─────────
function tmat(color, o = {}) {
  return new THREE.MeshToonMaterial({
    color, gradientMap: R3.grad, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1,
    flatShading: !!o.flat, side: o.side ?? THREE.FrontSide, transparent: !!o.transparent, opacity: o.opacity ?? 1,
  });
}
// 툰 재질 메쉬 + 검은 외곽선(조금 키운 뒷면 껍질)
function part(geo, color, o = {}) {
  const m = new THREE.Mesh(geo, tmat(color, o));
  m.castShadow = o.shadow !== false; m.receiveShadow = o.receive !== false;
  if (o.outline !== false) {
    // 외곽선 두께를 부품 크기와 상관없이 일정하게 (가는 팔도 굵은 몸통도 같은 굵기)
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const ol = new THREE.Mesh(geo, R3.outlineMat);
    ol.scale.setScalar(1 + (o.ol || 1.7) / Math.max(2, geo.boundingSphere.radius)); ol.userData.isOutline = true;
    m.add(ol);
  }
  m.position.set(o.x || 0, o.y || 0, o.z || 0);
  if (o.rx || o.ry || o.rz) m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  if (o.s) m.scale.set(...o.s);
  return m;
}
function grp(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); if (parent) parent.add(g); return g; }
const Geo = {
  box: (x, y, z) => new THREE.BoxGeometry(x, y, z),
  sph: (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h),
  cyl: (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s),
  cone: (r, h, s = 10) => new THREE.ConeGeometry(r, h, s),
  cap: (r, l, s = 10) => new THREE.CapsuleGeometry(r, l, 4, s),
  tor: (R, r, a = Math.PI * 2, s = 24) => new THREE.TorusGeometry(R, r, 8, s, a),
};
function disposeTree(o) {
  o.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material && c.material !== R3.outlineMat && !Object.values(R3.xray).includes(c.material)) {
      (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
}
// 캐릭터 마무리: 그리기 순서(환경 → 가림 실루엣 → 캐릭터)와 실루엣 메쉬, 피격 번쩍임용 재질 목록
function finishCharacter(root, xrayMat) {
  const mats = [], meshes = [];
  root.traverse(c => { if (c.isMesh) meshes.push(c); });
  for (const c of meshes) {
    c.renderOrder = 10;
    if (c.userData.isOutline) continue;
    if (c.material.emissive) mats.push({ m: c.material, e: c.material.emissive.getHex(), ei: c.material.emissiveIntensity });
    if (!c.userData.noXray) { const x = new THREE.Mesh(c.geometry, xrayMat); x.renderOrder = 5; x.userData.isXray = true; c.add(x); }
  }
  root.userData.mats = mats;
  return root;
}
function setFlash(root, on) {
  for (const r of root.userData.mats || []) {
    if (on) { r.m.emissive.setHex(0xffffff); r.m.emissiveIntensity = 0.7; }
    else { r.m.emissive.setHex(r.e); r.m.emissiveIntensity = r.ei; }
  }
}

// ───────── 지역 분위기 ─────────
const R3_STAGE = {
  yomi: { bg: 0x120705, sky: 0xffb08a, ground: 0x3a1208, hemi: 0.75, sun: 0xffe2c8, sunI: 1.05,
    floor: 0x4a2c22, wall: 0x3a2620, wallDark: 0x1e1210, cap: 0x5a3a2e, trim: 0x2a1a14, accent: 0xff6a2a, rock: 0x2e2220 },
  thunder: { bg: 0x0b0914, sky: 0xc8b8ff, ground: 0x1a1030, hemi: 0.75, sun: 0xeee6ff, sunI: 1.0,
    floor: 0x3e3a58, wall: 0x3a3650, wallDark: 0x211e30, cap: 0x56507a, trim: 0x29243c, accent: 0xa98bff, rock: 0x4a4560 },
  moon: { bg: 0x070a12, sky: 0xbcd2ff, ground: 0x101828, hemi: 0.8, sun: 0xe6eeff, sunI: 1.0,
    floor: 0x2c3650, wall: 0xe6e2d8, wallDark: 0x262a34, cap: 0x2a2a30, trim: 0x1a1414, accent: 0xbcd2ff, rock: 0x6a6f7a },
  izumo: { bg: 0x050c08, sky: 0xc8f0c0, ground: 0x0a1a0e, hemi: 0.78, sun: 0xf2ffe8, sunI: 1.0,
    floor: 0x34463a, wall: 0x46564a, wallDark: 0x22302a, cap: 0x5e7a52, trim: 0x2a3a2e, accent: 0x7fd46a, rock: 0x5a6660 },
};
const r3Stage = () => R3_STAGE[STAGES[G.stageIdx].env];

// ───────── 방 조립 (바닥 타일, 높은 뒷벽, 금줄, 소품, 바닥 예고 레이어) ─────────
const WALL3 = 125;
function r3BuildRoom() {
  if (R3.room) { R3.scene.remove(R3.room); disposeTree(R3.room); }
  for (const [, rec] of R3.ents) { R3.dyn.remove(rec.model); disposeTree(rec.model); }
  for (const rec of R3.dying) { R3.dyn.remove(rec.model); disposeTree(rec.model); }
  for (const [, m] of R3.props) { R3.dyn.remove(m); disposeTree(m); }
  R3.ents.clear(); R3.dying = []; R3.props.clear();

  const S = r3Stage(), room = new THREE.Group(), env = STAGES[G.stageIdx].env;
  R3.room = room; R3.scene.add(room);
  R3.renderer.setClearColor(S.bg);
  R3.hemi.color.setHex(S.sky); R3.hemi.groundColor.setHex(S.ground); R3.hemi.intensity = S.hemi;
  R3.sun.color.setHex(S.sun); R3.sun.intensity = S.sunI;
  const cx = ISO.WW / 2, cz = ISO.WD / 2, half = Math.max(ISO.WW, ISO.WD) * 0.8 + 150;
  R3.sun.position.set(cx - 650, 900, cz + 120); // 화면 위-왼쪽에서 비추는 빛
  R3.sun.target.position.set(cx, 0, cz);
  Object.assign(R3.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 10, far: 3000 });
  R3.sun.shadow.camera.updateProjectionMatrix();

  // 바닥: 타일마다 조금씩 다른 색의 두꺼운 석판 (앞 가장자리는 옆면이 석단처럼 보인다)
  const tiles = [];
  for (let y = 0; y < MAP.td; y++) for (let x = 0; x < MAP.tw; x++) if (tileAt(x, y)) tiles.push([x, y]);
  const floorMat = tmat(0xffffff);
  const inst = new THREE.InstancedMesh(Geo.box(TS - 2.5, 44, TS - 2.5), floorMat, tiles.length);
  const base = new THREE.Color(S.floor), c = new THREE.Color(), mtx = new THREE.Matrix4();
  tiles.forEach(([x, y], i) => {
    mtx.makeTranslation(x * TS + TS / 2, -22, y * TS + TS / 2); inst.setMatrixAt(i, mtx);
    c.copy(base).multiplyScalar(0.86 + hash2(x, y) * 0.24); inst.setColorAt(i, c);
  });
  inst.receiveShadow = true; room.add(inst);
  // 줄눈(타일 사이 틈) 아래 어두운 판
  const grout = new THREE.Mesh(Geo.box(ISO.WW, 2, ISO.WD), tmat(S.wallDark));
  grout.position.set(cx, -3, cz); room.add(grout);
  r3FloorDecals(room, tiles, env, S);

  // 뒷벽: 돌 기단 + 벽체 + 갓, 칸마다 기둥, 위로 금줄과 시데
  for (const w of MAP.walls) r3WallSeg(room, w, S, env);

  // 장애물 소품
  let lights = 0;
  for (const o of G.obstacles) {
    const m = o.kind === 'rock' ? r3Rock(env, o.v || 0, S) : r3Lantern(lights++ < 5);
    m.position.set(o.x, 0, o.y); m.rotation.y = hash2(o.x | 0, o.y | 0) * 6;
    if (o.kind !== 'rock') m.rotation.y = 0;
    room.add(m);
  }

  // 바닥 예고 레이어: 기존 2D 그리기 코드를 이 캔버스에 그려 바닥에 깐다
  const FS = 0.6;
  const fc = document.createElement('canvas'); fc.width = Math.ceil(ISO.WW * FS); fc.height = Math.ceil(ISO.WD * FS);
  const tex = new THREE.CanvasTexture(fc); tex.colorSpace = THREE.SRGBColorSpace;
  const layer = new THREE.Mesh(new THREE.PlaneGeometry(ISO.WW, ISO.WD), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  layer.rotation.x = -Math.PI / 2; layer.position.set(cx, 0.6, cz); layer.renderOrder = 20;
  room.add(layer);
  R3.floor = { canvas: fc, g: fc.getContext('2d'), tex, FS };
}

function r3FloorDecals(room, tiles, env, S) {
  for (const [x, y] of tiles) {
    const r = hash2(x + 101, y + 7);
    if (r > 0.06) continue;
    const g = grp(room, x * TS + TS / 2, 0.4, y * TS + TS / 2);
    const glow = (col, opacity = 1) => new THREE.MeshBasicMaterial({ color: col, transparent: opacity < 1, opacity });
    if (env === 'yomi') { // 용암 균열
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(Geo.box(18 + i * 6, 0.8, 2.4), glow(0xff6a2a));
        m.rotation.y = hash2(x * 3 + i, y) * Math.PI; m.position.set((i - 1) * 6, 0, (hash2(x, y + i) - 0.5) * 14); g.add(m);
      }
    } else if (env === 'thunder') { // 번개 그을림
      const s = new THREE.Mesh(new THREE.CircleGeometry(22, 16), glow(0x000000, 0.45)); s.rotation.x = -Math.PI / 2; g.add(s);
      for (let i = 0; i < 2; i++) { const m = new THREE.Mesh(Geo.box(22, 0.8, 1.6), glow(0xb9a0ff)); m.rotation.y = i * 1.3 + r * 9; m.position.y = 0.2; g.add(m); }
    } else if (env === 'moon') { // 초승달 문양
      const m = new THREE.Mesh(Geo.tor(15, 1.8, 4.2, 20), glow(0xcfe0ff)); m.rotation.x = -Math.PI / 2; m.rotation.z = r * 30; g.add(m);
    } else { // 물웅덩이
      const m = new THREE.Mesh(new THREE.CircleGeometry(24, 18), glow(0x4a8a86, 0.7)); m.rotation.x = -Math.PI / 2; m.scale.set(1, 0.7, 1); g.add(m);
    }
  }
}

function r3WallSeg(room, w, S, env) {
  const L = w.side === 'L', x0 = w.tx * TS, z0 = w.ty * TS;
  // 벽 한 칸을 'L'(z 방향으로 뻗음) 기준으로 만들고, R은 축을 바꿔 놓는다
  const seg = grp(room);
  if (L) seg.position.set(x0, 0, z0 + TS / 2); else { seg.position.set(x0 + TS / 2, 0, z0); seg.rotation.y = -Math.PI / 2; }
  // seg 로컬: 벽면은 x=0, 벽 몸체는 x<0, 방 안쪽은 +x, 벽은 z ∈ [-TS/2, TS/2]
  const wallCol = env === 'moon' ? S.wall : S.wall;
  seg.add(part(Geo.box(16, WALL3, TS + 0.6), wallCol, { x: -8, y: WALL3 / 2, outline: false }));
  seg.add(part(Geo.box(22, 22, TS + 0.6), S.wallDark, { x: -7, y: 11, outline: false })); // 돌 기단
  seg.add(part(Geo.box(24, 7, TS + 1), S.cap, { x: -8, y: WALL3 + 3.5, outline: false })); // 갓
  if (env === 'moon') seg.add(part(Geo.box(17, 9, TS + 0.6), S.trim, { x: -8, y: 46, outline: false })); // 나게시 띠
  if ((w.tx + w.ty) % 2 === 0) seg.add(part(Geo.box(18, WALL3 + 12, 18), S.trim, { x: -6, y: (WALL3 + 12) / 2, z: -TS / 2, outline: false })); // 기둥
  // 금줄 (가운데가 처진 새끼줄) + 시데
  const y = WALL3 - 22;
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(5, y, -TS / 2), new THREE.Vector3(8, y - 18, 0), new THREE.Vector3(5, y, TS / 2));
  const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 2.4, 6), tmat(0xc9b07a)); rope.castShadow = true; seg.add(rope);
  for (const dz of [-1, 1]) {
    const shide = new THREE.Mesh(Geo.box(1, 7, 4), tmat(0xf4f0e6)); shide.position.set(7, y - 16, dz * 3); shide.rotation.x = dz * 0.3; seg.add(shide);
    const shide2 = shide.clone(); shide2.position.y -= 6; shide2.position.z -= dz * 2; seg.add(shide2);
  }
  seg.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
}

function r3Lantern(withLight) {
  const g = new THREE.Group(), stone = 0xb8b2a6, dark = 0x8a857c;
  g.add(part(Geo.box(26, 6, 26), dark, { y: 3 }));
  g.add(part(Geo.cyl(5, 7, 32, 8), stone, { y: 22 }));
  g.add(part(Geo.box(22, 4, 22), dark, { y: 40 }));
  g.add(part(Geo.box(15, 14, 15), stone, { y: 49 }));
  const win = new THREE.MeshBasicMaterial({ color: 0xffc070 });
  g.add(new THREE.Mesh(Geo.box(15.6, 7, 8), win).translateY(49), new THREE.Mesh(Geo.box(8, 7, 15.6), win).translateY(49));
  g.add(part(Geo.cone(17, 12, 4), dark, { y: 62, ry: Math.PI / 4 }));
  g.add(part(Geo.sph(3, 8, 6), dark, { y: 70 }));
  if (withLight) { const l = new THREE.PointLight(0xffb06a, 1.3, 230, 1.5); l.position.y = 49; g.add(l); }
  return g;
}

function r3Rock(env, v, S) {
  const g = new THREE.Group();
  const rock = (r, col, x = 0, z = 0, sy = 0.75) => g.add(part(new THREE.DodecahedronGeometry(r, 0), col, { x, y: r * sy * 0.8, z, s: [1.15, sy, 1], flat: true }));
  if (env === 'yomi') {
    if (v === 0) { rock(22, S.rock); for (let i = 0; i < 3; i++) g.add(new THREE.Mesh(Geo.box(20, 1.5, 2), new THREE.MeshBasicMaterial({ color: 0xff6a2a })).translateY(12 + i * 4).rotateY(i * 1.1)); }
    else { rock(14, S.rock, -6, 4); for (const [x, z, y] of [[6, -4, 10], [10, 6, 6], [0, 8, 14]]) g.add(part(Geo.sph(6, 10, 8), 0xe8e0cc, { x, y, z })); }
  } else if (env === 'thunder') {
    if (v === 0) { rock(18, S.rock, -8, 0, 0.9); rock(16, S.rock, 10, 4, 0.8); }
    else for (const [x, z, h] of [[0, 0, 34], [9, 5, 22], [-8, 6, 18], [4, -9, 16]]) g.add(part(new THREE.OctahedronGeometry(7, 0), 0x9a7aff, { x, y: h / 2, z, s: [1, h / 14, 1], emissive: 0x4a2a9a, flat: true }));
  } else if (env === 'moon') {
    if (v === 0) { g.add(part(Geo.box(30, 18, 22), 0x6a4630, { y: 9 })); g.add(part(Geo.box(32, 4, 24), 0x4a2e20, { y: 20 })); }
    else for (let i = 0; i < 4; i++) g.add(part(Geo.cyl(13 - i * 2.6, 14 - i * 2.6, 7, 8), 0xa8aab0, { y: 3.5 + i * 8 }));
  } else {
    if (v === 0) { rock(20, S.rock); g.add(part(Geo.sph(17, 10, 6), 0x5aa04a, { y: 16, s: [1.2, 0.35, 1] })); }
    else for (let i = 0; i < 9; i++) g.add(part(Geo.cyl(1.2, 1.8, 30 + hash2(i, 3) * 20, 5), 0x6a9a4a, { x: (hash2(i, 1) - 0.5) * 24, y: 20, z: (hash2(i, 2) - 0.5) * 24, rz: (hash2(i, 4) - 0.5) * 0.4 }));
  }
  return g;
}

// 도리이 (기둥이 z축 방향으로 벌어짐). 문 안쪽에 빛나는 막.
function r3Torii() {
  const g = new THREE.Group(), red = 0xc4281c, black = 0x1a1210;
  for (const z of [-30, 30]) { g.add(part(Geo.cyl(4, 4.6, 76, 10), red, { y: 38, z })); g.add(part(Geo.cyl(6, 6, 7, 10), black, { y: 3.5, z })); }
  g.add(part(Geo.box(10, 6, 92), black, { y: 80 }));
  g.add(part(Geo.box(8, 4, 82), red, { y: 75 }));
  g.add(part(Geo.box(6, 5, 72), red, { y: 58 }));
  g.add(part(Geo.box(4, 12, 4), red, { y: 67 }));
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(56, 54), new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.rotation.y = Math.PI / 2; glow.position.y = 29; g.add(glow);
  g.userData.glow = glow;
  return g;
}

// 캐릭터 모델(BUILD3)과 애니메이션(ANIM3)은 js/models3d.js

// ───────── 게임 상태 → 3D 장면 동기화 ─────────
const KIND_OF = e => e === G.player ? 'samurai' : e.constructor.name.toLowerCase();
function r3Sync(dt) {
  const alive = new Set();
  const handle = e => {
    alive.add(e);
    let rec = R3.ents.get(e);
    const kind = KIND_OF(e);
    if (!rec) {
      if (!BUILD3[kind]) return;
      rec = { model: finishCharacter(BUILD3[kind](e), XRAY_OF(kind)), kind, born: 0, seed: Math.random() * 10 };
      R3.dyn.add(rec.model); R3.ents.set(e, rec);
    }
    const m = rec.model;
    m.position.set(e.x, e.hopH || 0, e.y);
    if (kind !== 'samurai' && kind !== 'orochi') m.rotation.y = -(e.face || 0);
    rec.born = Math.min(1, rec.born + dt * 4);
    if (kind !== 'tengu') m.scale.setScalar(rec.born < 1 ? 0.3 + 0.7 * ease3(rec.born) : 1);
    ANIM3[kind](m, e, dt, rec);
    if (!(kind === 'raijin' && e.act && e.act.name === 'blink')) setFlash(m, e.flash > 0 || (e === G.player && e.hurtT > 0.2));
  };
  if (G.player && !G.player.dead) handle(G.player);
  for (const e of G.enemies) if (!e.dead) handle(e);
  // 죽은 캐릭터는 쓰러지며 사라진다
  for (const [e, rec] of R3.ents) if (!alive.has(e)) { R3.ents.delete(e); rec.dying = 0.5; R3.dying.push(rec); setFlash(rec.model, true); }
  for (const rec of R3.dying) {
    rec.dying -= dt;
    const m = rec.model;
    m.rotation.z = lerp(m.rotation.z, -1.4, Math.min(1, dt * 8)); m.position.y -= dt * 30;
    m.scale.multiplyScalar(1 - dt * 1.6);
    if (rec.dying <= 0) { R3.dyn.remove(m); disposeTree(m); }
  }
  R3.dying = R3.dying.filter(r => r.dying > 0);

  // 보상 구슬과 문(도리이)
  const live = new Set();
  for (const pk of G.pickups) {
    live.add(pk);
    let m = R3.props.get(pk);
    if (!m) {
      m = new THREE.Mesh(new THREE.OctahedronGeometry(11, 0), new THREE.MeshBasicMaterial({ color: REWARDS[pk.kind].color }));
      const ol = new THREE.Mesh(m.geometry, R3.outlineMat); ol.scale.setScalar(1.12); m.add(ol);
      R3.dyn.add(m); R3.props.set(pk, m);
    }
    m.position.set(pk.x, 36 + Math.sin(pk.t * 3) * 5, pk.y); m.rotation.y = pk.t * 1.5;
  }
  for (const d of G.doors) {
    live.add(d);
    let m = R3.props.get(d);
    if (!m) {
      m = r3Torii();
      m.position.set(d.x, 0, d.y);
      m.rotation.y = d.side === 'L' ? 0 : d.side === 'R' ? -PI / 2 : PI * 0.75;
      R3.dyn.add(m); R3.props.set(d, m);
    }
    m.userData.glow.material.opacity = d.open >= 1 ? 0.32 + Math.sin(G.time * 3) * 0.08 : 0;
    m.scale.setScalar(0.4 + 0.6 * ease3(d.open));
  }
  for (const [k, m] of R3.props) if (!live.has(k)) { R3.dyn.remove(m); disposeTree(m); R3.props.delete(k); }
}

// 예고 범위·장판·소환진·베기 궤적을 바닥 텍스처에 그린다 (기존 2D 코드 재사용)
function r3DrawFloorLayer() {
  const F = R3.floor; if (!F) return;
  const main = ctx; ctx = F.g;
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, F.canvas.width, F.canvas.height);
    ctx.setTransform(F.FS, 0, 0, F.FS, 0, 0);
    ctx.save(); ctx.clip(MAP.clip);
    for (const h of G.hazards) if (h.kind === 'pool') h.draw();
    for (const h of G.hazards) if (h.kind !== 'pool') h.draw();
    for (const s of G.spawns) {
      const k = 1 - clamp(s.t, 0, 1);
      ctx.globalAlpha = 0.7; circle(s.x, s.y, 30 * k + 4, '#120810'); ring(s.x, s.y, 36 * (1 - k) + 10, '#c03a5a', 3); ctx.globalAlpha = 1;
    }
    for (const pk of G.pickups) { ctx.globalAlpha = 0.3 + 0.1 * Math.sin(pk.t * 3); circle(pk.x, pk.y, 34, REWARDS[pk.kind].color); ctx.globalAlpha = 1; }
    drawGroundFx();
    ctx.restore();
  } finally { ctx = main; }
  F.tex.needsUpdate = true;
}

const BAR_H3 = { oni: 95, kappa: 52, onibi: 58, tengu: 72 };
function render3DFrame() {
  const now = performance.now(), dt = Math.min(0.05, (now - R3.lastT) / 1000); R3.lastT = now;
  r3PlaceCamera();
  r3Sync(dt);
  r3DrawFloorLayer();
  R3.renderer.render(R3.scene, R3.camera);

  // ── 위에 겹치는 2D: 탄환, 문·보상 표시, 체력바, 파티클, 피해 숫자, HUD ──
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  VIEW.sx = VIEW.sy = 0;
  for (const p of G.projectiles) { uprightAt(p, 24); p.draw(); }
  screenTransform();
  for (const d of G.doors) {
    if (d.open < 1) continue;
    const q = iso(d.x, d.y, 62);
    if (d.kind === 'room' || d.kind === 'stage') drawRewardIcon(d.reward, q.x, q.y, 15);
    else { const god = GODS[STAGES[G.stageIdx].boss]; text(god.kanji, q.x, q.y, 28, god.color, 'center', 900); }
    if (d.kind === 'stage') text('다음 지역', q.x, q.y + 26, 13, '#ffe0b0');
  }
  for (const pk of G.pickups) { const q = iso(pk.x, pk.y, 72); drawRewardIcon(pk.kind, q.x, q.y, 16); }
  for (const e of G.enemies) {
    if (e.isBoss || e.dead || e.hp >= e.maxHp || e.untargetable) continue;
    const q = iso(e.x, e.y, BAR_H3[KIND_OF(e)] || 70), w = e.r * 2.2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(q.x - w / 2 - 1, q.y - 1, w + 2, 6);
    ctx.fillStyle = e.burn > 0 ? '#ff8a3a' : '#e24a3a'; ctx.fillRect(q.x - w / 2, q.y, w * e.hp / e.maxHp, 4);
  }
  drawAirFx();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawScreenOverlays();
}
