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
  const EL = 35 * Math.PI / 180; // 카메라 내려다보는 각도
  const CAM_DIR = new THREE.Vector3(Math.cos(EL) * Math.SQRT1_2, Math.sin(EL), Math.cos(EL) * Math.SQRT1_2);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.8);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008;
  scene.add(hemi, sun, sun.target);

  // 툰 명암 3단계
  const grad = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
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
  camera.zoom = 1.3; camera.updateProjectionMatrix(); // 캐릭터가 화면에서 충분히 크게 보이도록
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

// ───────── 캐릭터 모델 (앞 = +x, 발 = y 0) ─────────
const PI = Math.PI;
function limb(parent, y, z, len, r, col, handCol) { // 어깨에 매달린 팔. 회전 z: 0 = 아래로, PI/2 = 앞으로, PI = 위로
  const a = grp(parent, 0, y, z); a.rotation.order = 'YXZ';
  a.add(part(Geo.cap(r, len), col, { y: -len / 2 - r * 0.3 }));
  a.add(part(Geo.sph(r * 1.05, 10, 8), handCol, { y: -len - r }));
  a.userData.hand = -len - r;
  return a;
}

const BUILD3 = {
  samurai() {
    const g = new THREE.Group(), C = { navy: 0x2b3260, white: 0xece8de, skin: 0xe4b48a, hair: 0xdfe3ea, boot: 0x5a3e2a, band: 0xf4f2ec };
    const hips = grp(g, 0, 32, 0);
    hips.add(part(Geo.cyl(11, 16, 32, 12), C.navy, { y: -16 }));
    const footL = part(Geo.box(12, 5, 7), C.boot, { x: 2, y: -30, z: -6 }), footR = part(Geo.box(12, 5, 7), C.boot, { x: 2, y: -30, z: 6 });
    hips.add(footL, footR);
    hips.add(part(Geo.cyl(2, 2, 36, 8), 0x6a1a24, { x: -5, y: 2, z: -13, rz: 1.25 })); // 칼집
    const torso = grp(hips);
    torso.add(part(Geo.cap(10.5, 12), C.white, { y: 15 }));
    torso.add(part(Geo.box(15, 6, 32), C.navy, { y: 27 })); // 어깨 날개(카타기누)
    torso.add(part(Geo.box(13, 16, 20), C.navy, { y: 15, x: 0.5 }));
    torso.add(part(Geo.cyl(12, 12, 4, 12), 0x1a1820, { y: 6 }));
    const head = grp(torso, 0, 40, 0);
    head.add(part(Geo.sph(9, 16, 12), C.skin));
    head.add(part(new THREE.SphereGeometry(10, 16, 10, 0, PI * 2, 0, 1.75), C.hair, { x: -1.5, y: 1.2, rz: 0.55 }));
    head.add(part(Geo.cyl(2.4, 3, 7, 8), C.hair, { x: -4, y: 10, rz: 0.7 }));
    head.add(part(Geo.cone(6.5, 17, 8), C.hair, { x: 5.5, y: -9.5, rz: PI - 0.3 })); // 흰 수염
    head.add(part(Geo.cone(4, 20, 8), C.hair, { x: -11, y: -4, rz: 1.05 })); // 뒤로 늘어진 머리
    head.add(part(Geo.tor(9.2, 1.4, PI * 2, 18), C.band, { y: 3.5, rx: PI / 2, outline: false }));
    for (const z of [-3.2, 3.2]) head.add(part(Geo.box(1.6, 2.2, 2), 0x15121a, { x: 8.4, y: 1.8, z, outline: false }));
    const armR = limb(torso, 26, 13, 13, 3.6, C.white, C.skin), armL = limb(torso, 26, -13, 13, 3.6, C.white, C.skin);
    const sword = grp(armR, 0, armR.userData.hand, 0); // 칼은 팔이 뻗는 방향(-y)으로 이어진다
    sword.add(part(Geo.cyl(1.5, 1.5, 9, 8), 0x22202a, { y: -2 }));
    sword.add(part(Geo.cyl(4.2, 4.2, 1.4, 12), 0xc9a24a, { y: -7 }));
    sword.add(part(Geo.box(2.8, 40, 1.2), 0xe4ecf6, { y: -28, emissive: 0x2a3a50 }));
    g.userData = { hips, torso, head, armR, armL, footL, footR, sword };
    return g;
  },
  oni() {
    const g = new THREE.Group(), red = 0xc0392b, dark = 0x7a1f18;
    const hips = grp(g, 0, 28, 0);
    const legs = [-9, 9].map(z => { const l = grp(hips, 0, 0, z); l.add(part(Geo.cap(6.5, 12), dark, { y: -12 })); l.add(part(Geo.box(14, 6, 10), 0x3a2a24, { x: 3, y: -25 })); return l; });
    hips.add(part(Geo.cyl(17, 18, 12, 12), 0xe8a020, { y: 2 }));
    for (const y of [-1, 5]) hips.add(part(Geo.tor(17.6, 1.4, PI * 2, 20), 0x1a1210, { y, rx: PI / 2, outline: false }));
    const torso = grp(hips, 0, 6, 0);
    torso.add(part(Geo.cap(17, 16), red, { y: 20 }));
    torso.add(part(Geo.sph(12, 12, 10), 0xd85a44, { x: 8, y: 16, s: [0.7, 1, 1.1], outline: false }));
    const head = grp(torso, 0, 50, 0);
    head.add(part(Geo.sph(12.5, 16, 12), red));
    head.add(part(new THREE.SphereGeometry(13.5, 14, 10, 0, PI * 2, 0, 1.4), 0x1a1210, { x: -3, y: 1, rz: 0.7 }));
    for (const z of [-6, 6]) {
      head.add(part(Geo.cone(3.2, 14, 8), 0xf0e2c4, { y: 13, z, rx: z > 0 ? 0.35 : -0.35 }));
      head.add(part(Geo.sph(2.4, 8, 6), 0xffd84a, { x: 11, y: 3, z: z * 0.7, emissive: 0x8a6a00, outline: false }));
      head.add(part(Geo.cone(1.4, 5, 6), 0xffffff, { x: 10.5, y: -6, z: z * 0.45, rz: PI, outline: false }));
    }
    const armR = limb(torso, 34, 22, 18, 6, red, dark), armL = limb(torso, 34, -22, 18, 6, red, dark);
    const club = grp(armR, 0, armR.userData.hand, 0);
    club.add(part(Geo.cyl(6, 3.2, 46, 10), 0x34302e, { y: -24 }));
    for (let i = 0; i < 6; i++) club.add(part(Geo.sph(2, 6, 5), 0x6a6460, { x: Math.cos(i * 2.1) * 5, y: -30 - (i % 3) * 6, z: Math.sin(i * 2.1) * 5, outline: false }));
    g.userData = { hips, torso, head, armR, armL, legs };
    return g;
  },
  kappa() {
    const g = new THREE.Group(), green = 0x4f9a48;
    const body = grp(g, 0, 20, 0);
    const legs = [-7, 7].map(z => { const l = grp(body, 0, -6, z); l.add(part(Geo.cap(3.5, 6), green, { y: -6 })); l.add(part(Geo.box(9, 3, 7), 0x3a7a36, { x: 2, y: -12 })); return l; });
    body.add(part(Geo.sph(14, 16, 12), green, { s: [1, 1.05, 1] }));
    body.add(part(Geo.sph(12, 12, 10), 0xd8d070, { x: 6, s: [0.55, 0.9, 0.9], outline: false }));
    body.add(part(new THREE.SphereGeometry(15, 14, 10, 0, PI * 2, 0, PI / 2), 0x6a5a2a, { x: -3, rz: PI / 2 })); // 등껍질
    const head = grp(body, 2, 20, 0);
    head.add(part(Geo.sph(10, 14, 10), green));
    head.add(part(Geo.cyl(6.5, 6.5, 2, 14), 0xcfe6e8, { y: 9 }));
    head.add(part(Geo.tor(7, 1.6, PI * 2, 16), 0x2a5a2a, { y: 7.5, rx: PI / 2, outline: false }));
    head.add(part(Geo.cone(3.5, 9, 8), 0xe7c24a, { x: 11, y: -1.5, rz: -PI / 2 }));
    for (const z of [-4, 4]) head.add(part(Geo.sph(1.6, 6, 5), 0x111111, { x: 8.6, y: 3, z, outline: false }));
    const armR = limb(body, 4, 14, 8, 3, green, green), armL = limb(body, 4, -14, 8, 3, green, green);
    g.userData = { body, head, armR, armL, legs };
    return g;
  },
  onibi() {
    const g = new THREE.Group(), core = grp(g, 0, 26, 0);
    const flame = part(Geo.cone(9, 26, 12), 0x3a7ad8, { y: 8, emissive: 0x2a6ae0, ei: 0.9 });
    core.add(flame);
    core.add(part(Geo.sph(9, 14, 10), 0xbfe4ff, { emissive: 0x6ab8ff, ei: 0.8 }));
    for (const z of [-3, 3]) core.add(part(Geo.sph(1.6, 6, 5), 0x0a2040, { x: 8, y: 0, z, outline: false }));
    g.userData = { core, flame };
    return g;
  },
  tengu() {
    const g = new THREE.Group(), red = 0xc23a2e;
    const hips = grp(g, 0, 26, 0);
    hips.add(part(Geo.cyl(8, 12, 26, 10), 0x2b3058, { y: -13 }));
    for (const z of [-5, 5]) hips.add(part(Geo.box(10, 4, 5), 0x5a3a24, { x: 1, y: -26, z }));
    const torso = grp(hips);
    torso.add(part(Geo.cap(9.5, 12), 0xeee8dc, { y: 14 }));
    for (const z of [-3, 3]) torso.add(part(Geo.sph(2.4, 8, 6), 0xe8e4dc, { x: 9.5, y: 20, z }));
    const wings = [-1, 1].map(s => { const w = grp(torso, -7, 24, s * 5); w.rotation.y = s * 0.6; w.add(part(Geo.box(2.5, 24, 13), 0x1b1b24, { x: -4, y: 4, z: s * 7, rz: 0.35 })); return w; });
    const head = grp(torso, 0, 37, 0);
    head.add(part(Geo.sph(8.5, 14, 10), red));
    head.add(part(Geo.cyl(1.8, 2.8, 16, 8), red, { x: 12, y: 0, rz: -PI / 2 + 0.15 })); // 긴 코
    head.add(part(Geo.box(6, 5, 6), 0x111111, { y: 9.5, ry: PI / 4 }));
    head.add(part(new THREE.SphereGeometry(9.4, 12, 8, 0, PI * 2, 0, 1.6), 0xf2f0ea, { x: -2, rz: 0.9 }));
    const armR = limb(torso, 25, 12, 12, 3.3, 0xeee8dc, red), armL = limb(torso, 25, -12, 12, 3.3, 0xeee8dc, red);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(12, 12, 0, PI), tmat(0xd9c49a, { side: THREE.DoubleSide }));
    fan.position.y = armR.userData.hand - 2; fan.rotation.set(0, PI / 2, PI); armR.add(fan);
    g.userData = { hips, torso, head, wings, armR, armL };
    return g;
  },
  kagutsuchi() {
    const g = new THREE.Group(), body = 0x3a1208, lava = 0xff5a1a;
    const hips = grp(g, 0, 46, 0);
    [-13, 13].forEach(z => hips.add(part(Geo.cap(9, 26), 0x2a0a06, { y: -22, z })));
    hips.add(part(Geo.cyl(22, 24, 14, 14), 0x5a1a0e, { y: 2 }));
    const torso = grp(hips, 0, 6, 0);
    torso.add(part(Geo.cap(22, 26), body, { y: 28 }));
    for (let i = 0; i < 5; i++) torso.add(new THREE.Mesh(Geo.box(2, 16 + i * 3, 2.5), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb04a : lava })).translateX(21).translateY(18 + i * 6).translateZ((i - 2) * 7).rotateX((i - 2) * 0.4));
    torso.add(part(Geo.sph(6, 10, 8), 0xffc060, { x: 19, y: 34, emissive: 0xff7a2a, outline: false }));
    const head = grp(torso, 0, 68, 0);
    head.add(part(Geo.sph(14, 16, 12), 0x4a1408));
    for (const z of [-5, 5]) head.add(part(Geo.sph(2.4, 8, 6), 0xffe14a, { x: 12.5, y: 2, z, emissive: 0xffa000, outline: false }));
    const flames = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * PI * 2, f = part(Geo.cone(5 + (i % 3), 22 + (i % 2) * 8, 8), i % 2 ? 0xffd36a : 0xff6a2a, { x: Math.cos(a) * 8 - 3, y: 14, z: Math.sin(a) * 9, rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.4 + 0.3, emissive: i % 2 ? 0xff9a2a : 0xff4a10, ei: 0.9, outline: false });
      f.userData.noXray = true; head.add(f); flames.push(f);
    }
    const armR = limb(torso, 44, 28, 26, 8, body, 0xff8a3a), armL = limb(torso, 44, -28, 26, 8, body, 0xff8a3a);
    g.userData = { hips, torso, head, armR, armL, flames };
    return g;
  },
  raijin() {
    const g = new THREE.Group(), body = 0x5b3fa0, dark = 0x3a2870;
    const hips = grp(g, 0, 44, 0);
    [-13, 13].forEach(z => hips.add(part(Geo.cap(9, 24), dark, { y: -21, z })));
    hips.add(part(Geo.cyl(22, 24, 14, 14), 0xe8a020, { y: 2 }));
    const torso = grp(hips, 0, 6, 0);
    torso.add(part(Geo.cap(23, 24), body, { y: 28 }));
    for (const z of [-9, 9]) torso.add(part(Geo.sph(9, 10, 8), 0x6e52b4, { x: 14, y: 36, z, s: [0.6, 0.8, 1], outline: false }));
    const head = grp(torso, 0, 66, 0);
    head.add(part(Geo.sph(14, 16, 12), body));
    for (const z of [-7, 7]) {
      head.add(part(Geo.cone(3.6, 16, 8), 0xe8c24a, { y: 14, z, rx: z > 0 ? 0.4 : -0.4 }));
      head.add(part(Geo.sph(2.6, 8, 6), 0xfff08a, { x: 12.5, y: 3, z: z * 0.65, emissive: 0xc0a000, outline: false }));
    }
    for (let i = 0; i < 6; i++) head.add(part(Geo.cone(4, 14, 6), 0x1a1028, { x: -6 - (i % 2) * 3, y: 8 + (i % 3) * 3, z: (i - 2.5) * 4, rz: 1.2, outline: false }));
    // 등 뒤의 천둥북 고리
    const ring = grp(torso, -24, 46, 0); ring.rotation.y = PI / 2;
    ring.add(part(Geo.tor(48, 2.4, PI * 2, 40), 0xa8803a, { outline: false }));
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * PI * 2, d = grp(ring, Math.cos(a) * 48, Math.sin(a) * 48, 0);
      d.add(part(Geo.cyl(8, 8, 9, 14), 0x8a2a1a, { rx: PI / 2 }));
      d.add(part(Geo.cyl(7, 7, 9.6, 14), 0xf0e2c0, { rx: PI / 2, outline: false }));
    }
    const armR = limb(torso, 44, 30, 24, 8, body, dark), armL = limb(torso, 44, -30, 24, 8, body, dark);
    for (const a of [armR, armL]) a.add(part(Geo.cyl(1.6, 1.6, 26, 6), 0x5a3a20, { y: a.userData.hand - 12 }));
    g.userData = { hips, torso, head, ring, armR, armL };
    return g;
  },
  tsukuyomi() {
    const g = new THREE.Group(), robe = 0x1c2444, white = 0xeeeae2;
    const body = grp(g, 0, 8, 0);
    body.add(part(Geo.cyl(11, 30, 70, 16), robe, { y: 35 }));
    body.add(part(Geo.cyl(10, 17, 34, 14), white, { y: 66 }));
    const head = grp(body, 0, 92, 0);
    head.add(part(Geo.sph(11, 16, 12), 0xf2eee8));
    head.add(part(new THREE.SphereGeometry(12, 16, 10, 0, PI * 2, 0, 1.8), 0xd8dce8, { x: -1.5, y: 1, rz: 0.6 }));
    head.add(part(Geo.cone(10, 56, 10), 0xd8dce8, { x: -9, y: -24, rz: 0.12 }));
    for (const z of [-4, 4]) head.add(part(Geo.sph(1.8, 8, 6), 0x7ab8ff, { x: 10.2, y: 2, z, emissive: 0x3a7aff, outline: false }));
    const halo = grp(head, -14, 4, 0); halo.rotation.y = PI / 2;
    const h = part(Geo.tor(30, 3.2, 4.3, 30), 0xdfe9ff, { emissive: 0xaec8ff, ei: 0.9, outline: false, rz: 2.2 });
    h.userData.noXray = true; halo.add(h);
    const armR = limb(body, 78, 16, 22, 5, white, 0xf2eee8), armL = limb(body, 78, -16, 22, 5, white, 0xf2eee8);
    for (const a of [armR, armL]) a.add(part(Geo.box(10, 20, 6), white, { y: -18, x: -2 })); // 넓은 소매
    g.userData = { body, head, halo, armR, armL };
    return g;
  },
  orochi(e) {
    const g = new THREE.Group(), green = 0x3f7a3a, belly = 0xc8a070;
    const body = grp(g);
    body.add(part(Geo.tor(50, 17, PI * 2, 30), green, { y: 15, rx: PI / 2 }));
    body.add(part(Geo.tor(36, 15, PI * 2, 26), 0x4c8a44, { y: 40, rx: PI / 2 }));
    body.add(part(Geo.tor(22, 13, PI * 2, 22), green, { y: 62, rx: PI / 2 }));
    body.add(part(Geo.sph(18, 14, 10), 0x4c8a44, { y: 76 }));
    body.add(part(Geo.cone(12, 70, 10), green, { x: -62, y: 14, z: 20, rz: PI / 2 + 0.3, ry: 0.5 }));
    const necks = [], heads = [];
    for (let i = 0; i < 8; i++) {
      const segs = [];
      for (let j = 0; j < 8; j++) { const s = part(Geo.sph(10 - j * 0.5, 10, 8), j % 2 ? green : 0x4c8a44, { outline: j === 0 }); g.add(s); segs.push(s); }
      necks.push(segs);
      const h = grp(g); h.rotation.order = 'YXZ';
      h.add(part(Geo.sph(12, 14, 10), green, { x: 8, s: [1.6, 0.7, 1.05] }));
      const jaw = grp(h, -2, -4, 0);
      jaw.add(part(Geo.box(26, 3, 13), 0x7a2a2a, { x: 12 }));
      jaw.add(part(Geo.box(26, 2, 12), belly, { x: 12, y: -2, outline: false }));
      for (const z of [-6, 6]) {
        h.add(part(Geo.sph(2.4, 8, 6), 0xff3a2a, { x: 12, y: 5, z, emissive: 0xff1a0a, outline: false }));
        h.add(part(Geo.cone(2, 10, 6), 0xd8d0b0, { x: -2, y: 7, z, rz: 1.1 }));
      }
      h.userData.jaw = jaw; heads.push(h);
    }
    g.userData = { body, necks, heads };
    return g;
  },
};
const XRAY_OF = kind => kind === 'samurai' ? R3.xray.player : R3.xray.enemy;

// ───────── 절차적 애니메이션 ─────────
const ease3 = k => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
const walkCycle = (legs, ph, amp) => { legs[0].rotation.z = Math.sin(ph) * amp; legs[1].rotation.z = -Math.sin(ph) * amp; };

const ANIM3 = {
  samurai(m, P) {
    const u = m.userData, t = G.time;
    u.torso.rotation.set(0, 0, 0); u.torso.scale.y = 1; u.hips.position.y = 32;
    u.armR.rotation.set(0, 0, 0.55); u.armL.rotation.set(0, 0, 0.18);
    u.footL.position.set(2, -30, -6); u.footR.position.set(2, -30, 6);
    let yaw = -P.faceAng;
    if (P.moving && P.dashT <= 0) {
      const ph = t * 13, s = Math.sin(ph);
      u.footL.position.x = 2 + s * 8; u.footR.position.x = 2 - s * 8;
      u.footL.position.y = -30 + Math.max(0, Math.cos(ph)) * 4; u.footR.position.y = -30 + Math.max(0, -Math.cos(ph)) * 4;
      u.hips.position.y = 32 + Math.abs(s) * 2; u.armL.rotation.z = 0.18 - s * 0.6; u.torso.rotation.z = -0.12;
    } else u.torso.scale.y = 1 + Math.sin(t * 2.6) * 0.015;
    if (P.dashT > 0) { u.torso.rotation.z = -0.6; u.armR.rotation.z = -0.7; u.armL.rotation.z = -0.5; u.hips.position.y = 26; }
    if (P.castAnim > 0) { const k = ease3((0.6 - P.castAnim) * 5); u.armR.rotation.z = lerp(0.55, PI * 0.97, k); u.armL.rotation.z = lerp(0.18, 2.6, k); }
    if (P.atkAnim > 0) {
      const e = ease3((0.27 - P.atkAnim) / 0.2);
      if (P.combo === 1) { u.armR.rotation.set(0, lerp(-1.3, 1.5, e), PI / 2 - 0.1); u.torso.rotation.y = lerp(-0.4, 0.4, e); } // 가로 되베기
      else { u.armR.rotation.z = lerp(P.combo === 2 ? 3.3 : 2.8, 0.05, e); u.torso.rotation.z = -0.3 * e * (P.combo === 2 ? 1.6 : 1); } // 내려베기 / 강공
    }
    if (P.spinAnim > 0) { yaw += (1 - P.spinAnim / 0.33) * PI * 2; u.armR.rotation.set(0, 0, PI / 2); u.armL.rotation.z = 1.2; }
    if (P.hurtT > 0) u.torso.rotation.z = 0.4;
    m.rotation.y = yaw;
    m.visible = !(P.iframes > 0 && P.dashT <= 0 && Math.floor(G.time * 18) % 2 === 0);
  },
  oni(m, e, dt, rec) {
    const u = m.userData, ph = (G.time + rec.seed) * 9;
    u.torso.rotation.set(0, 0, 0); u.hips.position.y = 28; u.armR.rotation.set(0, 0, 0.55); u.armL.rotation.set(0, 0, 0.25); walkCycle(u.legs, 0, 0);
    if (e.st === 'chase' && e.moving) { walkCycle(u.legs, ph, 0.55); u.hips.position.y = 28 + Math.abs(Math.sin(ph)) * 2.5; u.armL.rotation.z = 0.25 + Math.sin(ph) * 0.4; }
    if (e.st === 'wind') { if (rec.st !== 'wind') rec.max = e.stT || 0.65; const k = ease3(1 - e.stT / rec.max); u.armR.rotation.z = lerp(0.55, 3.5, k); u.torso.rotation.z = 0.25 * k; }
    if (e.st === 'recover') { if (rec.st !== 'recover') rec.rt = 0; rec.rt += dt; const k = Math.min(1, rec.rt * 8); u.armR.rotation.z = lerp(3.5, 0.1, k); u.torso.rotation.z = -0.4 * k * Math.max(0, 1 - rec.rt * 1.5); }
    if (e.hurtT > 0) u.torso.rotation.z += 0.25;
    rec.st = e.st;
  },
  kappa(m, e, dt, rec) {
    const u = m.userData, ph = (G.time + rec.seed) * 12;
    u.body.rotation.set(Math.sin(ph) * 0.12, 0, 0); walkCycle(u.legs, ph, 0.6);
    u.armR.rotation.set(0, 0, 0.4 + Math.sin(ph) * 0.3); u.armL.rotation.set(0, 0, 0.4 - Math.sin(ph) * 0.3);
    if (e.st === 'aim') { u.body.rotation.z = 0.3; u.head.rotation.z = 0.2; }
    else if (e.shotT > 0) { u.body.rotation.z = -0.35; u.head.rotation.z = -0.2; }
    else u.head.rotation.z = 0;
    if (e.hurtT > 0) u.body.rotation.z = 0.3;
  },
  onibi(m, e, dt, rec) {
    const u = m.userData, t = G.time + rec.seed;
    u.flame.scale.set(1, 1 + Math.sin(t * 18) * 0.14, 1);
    u.core.position.set(e.st === 'aim' ? Math.sin(t * 70) * 1.8 : 0, 26 + Math.sin(t * 4) * 3, 0);
    if (e.st === 'charge') { u.core.scale.set(1.7, 0.75, 0.75); u.flame.rotation.z = 1.35; m.rotation.y = -e.cAng; }
    else { u.core.scale.set(1, 1, 1); u.flame.rotation.z = 0.3; }
  },
  tengu(m, e, dt, rec) {
    const u = m.userData, t = G.time + rec.seed;
    u.wings.forEach((w, i) => { w.rotation.x = (i ? 1 : -1) * (0.45 + Math.sin(t * 8) * 0.25); });
    u.armR.rotation.set(0, 0, 0.5); u.torso.rotation.set(0, 0, 0);
    if (e.st === 'throw') u.armR.rotation.z = lerp(0.5, 2.9, ease3(1 - e.stT / 0.4));
    else if (e.postT > 0) { u.armR.rotation.z = 0.2; u.torso.rotation.z = -0.2; }
    const a = e.st === 'vanish' || e.st === 'appear' ? e.alpha : 1;
    m.scale.set(a, a, a); m.visible = a > 0.03;
  },
  kagutsuchi(m, e, dt, rec) {
    const u = m.userData, t = G.time;
    u.flames.forEach((f, i) => f.scale.set(1, 1 + Math.sin(t * 14 + i * 1.7) * 0.28, 1));
    u.torso.rotation.set(0, 0, 0); u.armR.rotation.set(0, 0, 0.3); u.armL.rotation.set(0, 0, 0.3);
    if (e.hold === 'charge') { u.torso.rotation.z = -0.6; u.armR.rotation.z = -0.6; u.armL.rotation.z = -0.6; }
    if (e.act && e.act.name === 'cast') { const k = ease3(e.act.t * 4); u.armR.rotation.z = u.armL.rotation.z = lerp(0.3, 2.9, k); u.torso.rotation.z = 0.15 * k; }
  },
  raijin(m, e, dt, rec) {
    const u = m.userData;
    u.ring.rotation.x += dt * 0.7;
    u.armR.rotation.set(0, 0, 0.5); u.armL.rotation.set(0, 0, 0.5); u.ring.scale.setScalar(1); m.scale.set(1, 1, 1);
    if (e.act && e.act.name === 'drum') { const up = e.act.t < 0.08; u.armR.rotation.z = u.armL.rotation.z = up ? 2.9 : 0.7; u.ring.scale.setScalar(1 + Math.max(0, 0.3 - e.act.t) * 1.2); }
    if (e.act && e.act.name === 'blink') { // 번개로 변해 가늘고 길게 사라졌다 나타남
      const k = clamp(e.act.t / 0.2, 0, 1), s = e.act.rev ? 1 - k : k;
      m.scale.set(1 - s * 0.85, 1 + s * 0.8, 1 - s * 0.85); setFlash(m, s > 0.2);
    }
  },
  tsukuyomi(m, e, dt, rec) {
    const u = m.userData, t = G.time;
    u.body.position.y = 8 + Math.sin(t * 1.6) * 4; u.halo.rotation.x = t * 0.4;
    u.armR.rotation.set(0, 0, 0.25); u.armL.rotation.set(0, 0, 0.25);
    if (e.act && e.act.name === 'cast') { const k = ease3(e.act.t * 5); u.armR.rotation.z = lerp(0.25, 1.9, k); u.armL.rotation.z = lerp(0.25, 1.2, k); }
  },
  orochi(m, e) {
    const u = m.userData, t = G.time, hy0 = 34;
    m.rotation.y = 0;
    u.body.scale.y = 1 + Math.sin(t * 1.5) * 0.02;
    const bez = (a, b, c, k) => (1 - k) * (1 - k) * a + 2 * (1 - k) * k * b + k * k * c;
    for (let i = 0; i < 8; i++) {
      const hw = e.heads[i], dx = hw.x - e.x, dz = hw.y - e.y, L = e.lunge[i], wn = e.warn[i];
      const hy = hy0 + Math.sin(t * 2 + i) * 4, h = u.heads[i];
      h.position.set(dx, hy, dz); h.rotation.set(0, -hw.a, -0.25);
      const open = L > 0.5 ? 1 : L > 0 ? 0.5 : wn > 0 ? (wn > 0.35 ? 0.35 : 0.75) : 0.08 + Math.sin(t * 3 + i) * 0.05;
      h.userData.jaw.rotation.z = -open * 0.85;
      const a = Math.atan2(dz, dx), bx = Math.cos(a) * 18, bz = Math.sin(a) * 18, by = 72;
      const cx = (bx + dx) / 2, cz = (bz + dz) / 2, cy = Math.max(by, hy) + 45;
      u.necks[i].forEach((s, j) => { const k = (j + 0.5) / 8; s.position.set(bez(bx, cx, dx, k), bez(by, cy, hy, k), bez(bz, cz, dz, k)); });
    }
  },
};

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
