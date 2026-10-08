'use strict';
// ───────── 3D 캐릭터 모델과 애니메이션 ─────────
// 레고처럼 보이지 않도록:
//   · 몸통·옷은 옆모습 곡선을 돌린 회전체(lathe)로 허리·가슴·어깨·옷자락 굴곡을 만든다
//   · 팔다리는 두 마디(위팔·아래팔 / 허벅지·정강이)로 끝이 가늘어지고 관절이 굽는다
//   · 외곽선은 표면을 법선 방향으로 밀어낸 뒷면이라 꺾이는 곳에서도 일정한 두께로 이어진다
//   · 머리카락·끈·수염은 움직임에 따라 늦게 따라오는 2차 움직임을 준다
// 좌표: 앞 = +x, 발바닥 = y 0, 오른쪽 = +z.

const PI = Math.PI;
const ease3 = k => 1 - Math.pow(1 - clamp(k, 0, 1), 3);

// ───────── 모델 키트 ─────────
const _olMats = new Map();
function outlineMat(w) {
  if (_olMats.has(w)) return _olMats.get(w);
  const m = new THREE.ShaderMaterial({
    uniforms: { w: { value: w }, color: { value: new THREE.Color(0x140e12) } },
    vertexShader: 'uniform float w; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * w, 1.0); }',
    fragmentShader: 'uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }',
    side: THREE.BackSide,
  });
  _olMats.set(w, m);
  return m;
}
// 툰 재질 메쉬 + 법선 외곽선
function skin(geo, color, o = {}) {
  const m = new THREE.Mesh(geo, tmat(color, o));
  m.castShadow = o.shadow !== false; m.receiveShadow = true;
  if (o.outline !== false) { const ol = new THREE.Mesh(geo, outlineMat(o.ol ?? 1.25)); ol.userData.isOutline = true; m.add(ol); }
  m.position.set(o.x || 0, o.y || 0, o.z || 0);
  if (o.rx || o.ry || o.rz) m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  if (o.noXray) m.userData.noXray = true;
  return m;
}
// 옆모습 곡선 [[반지름, 높이], ...] (아래 → 위)을 돌려 만든 매끈한 몸
function lathe(pts, segs = 18, phiStart = 0, phiLen = PI * 2) {
  const curve = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y)));
  const pp = curve.getPoints(Math.max(14, pts.length * 6)).map(v => new THREE.Vector2(Math.max(0.001, v.x), v.y));
  const g = new THREE.LatheGeometry(pp, segs, phiStart, phiLen);
  g.computeVertexNormals();
  return g;
}
const ell = (rx, ry, rz, w = 16, h = 12) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
// 관절에서 아래로 매달린 끝이 둥근 팔다리 마디 (길이 L, 위 반지름 r1, 아래 반지름 r2)
const segGeo = (L, r1, r2) => lathe([[0, -L - r2 * 0.85], [r2 * 0.8, -L - r2 * 0.45], [r2, -L], [(r1 + r2) * 0.52, -L * 0.5], [r1, 0], [r1 * 0.75, r1 * 0.5], [0, r1 * 0.85]], 12);

// 두 마디 팔: sh(어깨) → el(팔꿈치) → hand. 포즈는 setArm으로.
function arm(parent, x, y, z, o) {
  const sh = grp(parent, x, y, z); sh.rotation.order = 'YXZ';
  sh.add(skin(segGeo(o.up, o.r1, o.r2), o.col));
  const el = grp(sh, 0, -o.up, 0); el.rotation.order = 'YXZ';
  el.add(skin(segGeo(o.lo, o.r2 * 0.95, o.r3), o.col2 ?? o.col));
  const hand = grp(el, 0, -o.lo - o.r3 * 0.6, 0);
  if (o.handCol !== undefined) hand.add(skin(ell(o.r3 * 1.25, o.r3 * 1.35, o.r3 * 1.15, 12, 10), o.handCol, { y: -o.r3 * 0.6 }));
  return { sh, el, hand };
}
// 어깨 회전 z: 0 = 아래, PI/2 = 앞, PI = 위 / 팔꿈치 굽힘(앞으로) / 어깨 좌우 회전 yaw
function setArm(a, z, bend = 0.3, yaw = 0) { a.sh.rotation.set(0, yaw, z); a.el.rotation.set(0, 0, bend); }
// 두 마디 다리: hip → knee → foot. 무릎은 뒤로 굽는다.
function leg(parent, x, y, z, o) {
  const hip = grp(parent, x, y, z);
  hip.add(skin(segGeo(o.up, o.r1, o.r2), o.col));
  const knee = grp(hip, 0, -o.up, 0);
  knee.add(skin(segGeo(o.lo, o.r2 * 0.95, o.r3), o.col2 ?? o.col));
  knee.add(skin(ell(o.foot[0], o.foot[1], o.foot[2], 12, 8), o.footCol ?? o.col, { x: o.foot[0] * 0.45, y: -o.lo - o.r3 * 0.4 }));
  return { hip, knee };
}
function setLeg(l, swing, bend) { l.hip.rotation.z = swing; l.knee.rotation.z = -bend; }
function walkLegs(legs, ph, amp) {
  const s = Math.sin(ph);
  setLeg(legs[0], s * amp, Math.max(0, -Math.cos(ph)) * amp * 1.4);
  setLeg(legs[1], -s * amp, Math.max(0, Math.cos(ph)) * amp * 1.4);
}
// 2차 움직임: 이동 속도와 방향 전환에 늦게 따라오는 흔들림 값 (rec에 상태 저장)
function sway(rec, e, dt) {
  const vx = (e.x - (rec.px ?? e.x)) / Math.max(dt, 1e-3), vy = (e.y - (rec.py ?? e.y)) / Math.max(dt, 1e-3);
  rec.px = e.x; rec.py = e.y;
  const sp = Math.min(1, Math.hypot(vx, vy) / 400);
  rec.sw = lerp(rec.sw ?? 0, sp, Math.min(1, dt * 6));
  return rec.sw;
}

// ───────── 모델 ─────────
const BUILD3 = {
  samurai() {
    const g = new THREE.Group(), C = { navy: 0x2c3462, navyD: 0x1e2346, white: 0xeeeae0, skin: 0xe3b08a, hair: 0xe4e7ee, boot: 0x5a3e2a, obi: 0x1c1a24 };
    const body = grp(g);
    const feet = [-6, 6].map(z => body.add(skin(ell(5.5, 3, 4), C.boot, { x: 3, y: 2.5, z })) && body.children[body.children.length - 1]);
    const hakama = skin(lathe([[0, 2], [16, 2.4], [16.5, 6], [14.6, 18], [12.2, 30], [11, 36], [0, 37]], 20), C.navy);
    body.add(hakama);
    const torso = grp(body, 0, 34, 0); torso.rotation.order = 'YXZ';
    torso.add(skin(Geo.tor(11.2, 1.7, PI * 2, 20), C.obi, { y: 2, rx: PI / 2, outline: false }));
    torso.add(skin(lathe([[0, 0], [11, 1], [10.6, 8], [12.6, 16], [13.6, 22], [11.2, 27], [6, 30], [0, 31]], 18), C.white));
    // 앞이 트인 남색 조끼(카타기누)와 어깨 날개
    torso.add(skin(lathe([[11.6, 4], [12.9, 12], [14.3, 21], [13.9, 25], [10.5, 28.5]], 18, PI / 2 + 0.5, PI * 2 - 1.0), C.navy, { side: THREE.DoubleSide }));
    for (const z of [-1, 1]) torso.add(skin(ell(5.5, 1.8, 7.5), C.navy, { y: 26, z: z * 11.5, rx: z * 0.25 }));
    torso.add(skin(lathe([[0, 0], [3.6, 0], [3.4, 5], [0, 6]], 10), C.skin, { y: 29 }));
    const head = grp(torso, 0, 39, 0);
    head.add(skin(ell(8.2, 9, 8), C.skin));
    head.add(skin(ell(1.6, 2, 1.5, 8, 6), C.skin, { x: 8, y: -0.5, outline: false }));
    for (const z of [-2.9, 2.9]) {
      head.add(skin(ell(0.8, 1.4, 0.9, 8, 6), 0x1a1418, { x: 7.4, y: 1.6, z, outline: false }));
      head.add(skin(ell(0.9, 0.9, 2.4, 8, 6), C.hair, { x: 7.6, y: 3.8, z: z * 1.05, rx: z * 0.15, outline: false }));
    }
    head.add(skin(new THREE.SphereGeometry(1, 18, 12, 0, PI * 2, 0, 1.9).scale(9, 9.6, 8.9), C.hair, { x: -1.2, y: 0.8, rz: 0.55 }));
    head.add(skin(ell(2.3, 3, 2.3, 10, 8), C.hair, { x: -2.5, y: 9.6 }));
    const beard = grp(head, 6, -4, 0);
    beard.add(skin(ell(4.2, 9.5, 5.6), C.hair, { y: -6, rz: -0.15 }));
    head.add(skin(ell(1.4, 1.1, 4.4, 10, 6), C.hair, { x: 8.2, y: -2.6 }));
    head.add(skin(Geo.tor(8.7, 1.1, PI * 2, 22), 0xf8f6f0, { y: 3.4, rx: PI / 2 + 0.15, outline: false }));
    const hairBack = grp(head, -6, 2, 0);
    hairBack.add(skin(ell(5.2, 14, 6.4), C.hair, { y: -10 }));
    const tails = [-1.6, 1.6].map(z => { const t = grp(head, -8.5, 3.5, z); t.add(skin(ell(0.6, 7, 1.7, 8, 6), 0xf8f6f0, { y: -6, outline: false })); return t; });
    const armR = arm(torso, 0, 25, 13.5, { up: 13, lo: 12, r1: 5.2, r2: 4.4, r3: 3, col: C.white, handCol: C.skin });
    const armL = arm(torso, 0, 25, -13.5, { up: 13, lo: 12, r1: 5.2, r2: 4.4, r3: 3, col: C.white, handCol: C.skin });
    // 칼: 손에서 팔 방향(-y)으로 이어진다
    const sword = grp(armR.hand, 0, -2, 0);
    sword.add(skin(lathe([[0, -9], [1.6, -9], [1.5, 0], [0, 0.2]], 8), 0x24202c, { ol: 0.8 }));
    sword.add(skin(Geo.tor(3.6, 1, PI * 2, 14), 0xc9a24a, { y: -9.5, rx: PI / 2, outline: false }));
    const blade = new THREE.Mesh(Geo.box(2.6, 42, 0.8), tmat(0xe8eef6, { emissive: 0x2a3a52 }));
    blade.position.y = -31; blade.castShadow = true; sword.add(blade);
    body.add(skin(lathe([[0, 0], [2, 0.5], [2, 34], [0, 35]], 8), 0x6a1a24, { x: -6, y: 33, z: -13, rz: 2.0, ry: 0.2 })); // 칼집
    g.userData = { body, feet, hakama, torso, head, beard, hairBack, tails, armR, armL, blade };
    return g;
  },
};

// ───────── 애니메이션 ─────────
const ANIM3 = {
  samurai(m, P, dt, rec) {
    const u = m.userData, t = G.time, sw = sway(rec, P, dt);
    u.torso.rotation.set(0, 0, 0); u.torso.position.y = 34; u.body.rotation.set(0, 0, 0);
    setArm(u.armR, 0.45, 0.75); setArm(u.armL, 0.12, 0.35);
    u.feet[0].position.set(3, 2.5, -6); u.feet[1].position.set(3, 2.5, 6); u.hakama.rotation.set(0, 0, 0);
    let yaw = -P.faceAng;
    if (P.moving && P.dashT <= 0) {
      const ph = t * 13, s = Math.sin(ph);
      u.feet[0].position.x = 3 + s * 9; u.feet[1].position.x = 3 - s * 9;
      u.feet[0].position.y = 2.5 + Math.max(0, Math.cos(ph)) * 4; u.feet[1].position.y = 2.5 + Math.max(0, -Math.cos(ph)) * 4;
      u.torso.position.y = 34 + Math.abs(s) * 1.6; u.torso.rotation.y = s * 0.12; u.torso.rotation.z = -0.1;
      u.hakama.rotation.x = s * 0.06; u.hakama.rotation.z = -0.05;
      setArm(u.armL, 0.12 - s * 0.55, 0.45);
    } else u.torso.position.y = 34 + Math.sin(t * 2.6) * 0.5;
    if (P.dashT > 0) { u.torso.rotation.z = -0.55; u.torso.position.y = 28; setArm(u.armR, -0.9, 0.3); setArm(u.armL, -0.6, 0.3); }
    if (P.castAnim > 0) { const k = ease3((0.6 - P.castAnim) * 5); setArm(u.armR, lerp(0.45, PI * 0.96, k), lerp(0.75, 0.05, k)); setArm(u.armL, lerp(0.12, 2.3, k), 0.6); }
    if (P.atkAnim > 0) {
      const e = ease3((0.27 - P.atkAnim) / 0.2);
      if (P.combo === 1) { setArm(u.armR, PI / 2 - 0.15, 0.15, lerp(-1.4, 1.5, e)); u.torso.rotation.y = lerp(-0.45, 0.45, e); } // 가로 되베기
      else { const big = P.combo === 2; setArm(u.armR, lerp(big ? 3.4 : 2.9, 0.2, e), lerp(0.5, 0.1, e)); setArm(u.armL, lerp(2.6, 0.5, e), 0.5); u.torso.rotation.z = -0.3 * e * (big ? 1.7 : 1); }
    }
    if (P.spinAnim > 0) { yaw += (1 - P.spinAnim / 0.33) * PI * 2; setArm(u.armR, PI / 2, 0.1); setArm(u.armL, 1.1, 0.4); }
    if (P.hurtT > 0) u.torso.rotation.z = 0.4;
    // 2차 움직임: 뒷머리·머리띠 끝자락·수염
    u.hairBack.rotation.z = -0.15 + sw * 0.6 + Math.sin(t * 5) * 0.04;
    u.tails.forEach((tl, i) => { tl.rotation.z = -0.5 - sw * 0.9 + Math.sin(t * 9 + i) * 0.12; tl.rotation.x = (i ? 1 : -1) * 0.25; });
    u.beard.rotation.z = sw * 0.25 + Math.sin(t * 3) * 0.03;
    m.rotation.y = yaw;
    m.visible = !(P.iframes > 0 && P.dashT <= 0 && Math.floor(G.time * 18) % 2 === 0);
  },
};

// ───────── 요괴 ─────────
Object.assign(BUILD3, {
  oni() {
    const g = new THREE.Group(), red = 0xc23a2c, dark = 0x7e2018, horn = 0xf0e2c4;
    const body = grp(g);
    const legs = [-1, 1].map(z => leg(body, 0, 30, z * 10, { up: 15, lo: 14, r1: 8, r2: 6.4, r3: 5, col: dark, foot: [8, 4, 6], footCol: 0x3a2622 }));
    body.add(skin(lathe([[0, 24], [19, 25], [18.6, 31], [16.5, 37], [0, 38]], 18), 0xe8a020));
    for (const y of [27.5, 33]) body.add(skin(Geo.tor(18.4 - (y - 27) * 0.3, 1.2, PI * 2, 22), 0x1a1210, { y, rx: PI / 2, outline: false }));
    const torso = grp(body, 0, 36, 0); torso.rotation.order = 'YXZ';
    torso.add(skin(lathe([[0, 0], [17, 1], [20.5, 10], [19, 20], [22, 28], [18, 36], [8, 41], [0, 42]], 20), red));
    torso.add(skin(ell(11, 13, 14), 0xd85a44, { x: 9, y: 12, outline: false }));
    const head = grp(torso, 0, 50, 0);
    head.add(skin(ell(12, 12, 12), red));
    head.add(skin(ell(9, 6, 11), red, { x: 4, y: -7 }));
    head.add(skin(ell(3.5, 2.6, 10.5, 10, 8), 0x7e2018, { x: 9, y: 4.5 }));
    for (const z of [-1, 1]) {
      head.add(skin(lathe([[0, 0], [3.4, 0.6], [2.4, 8], [0.8, 14], [0, 16]], 10), horn, { x: -1, y: 9, z: z * 6, rx: z * 0.45, rz: -0.25 }));
      head.add(skin(ell(2.4, 2, 2, 8, 6), 0xffd84a, { x: 10.3, y: 1.5, z: z * 4.3, emissive: 0x9a7a00, outline: false }));
      head.add(skin(lathe([[0, 0], [1.4, 0.3], [0, 5]], 6), 0xffffff, { x: 10, y: -8, z: z * 4, rz: PI, outline: false }));
    }
    for (let i = 0; i < 6; i++) head.add(skin(ell(5, 8, 5, 10, 8), 0x1a1210, { x: -6 - (i % 2) * 2, y: 4 + (i % 3) * 3, z: (i - 2.5) * 4, rz: 0.9, outline: false }));
    const armR = arm(torso, 0, 33, 23, { up: 17, lo: 15, r1: 8, r2: 6.4, r3: 5.2, col: red, handCol: dark });
    const armL = arm(torso, 0, 33, -23, { up: 17, lo: 15, r1: 8, r2: 6.4, r3: 5.2, col: red, handCol: dark });
    const club = grp(armR.hand, 0, -2, 0);
    club.add(skin(lathe([[0, -48], [6.2, -46], [6.4, -42], [5.6, -30], [3.4, -8], [3, 0], [0, 1]], 12), 0x34302e));
    for (let i = 0; i < 10; i++) { const a = i * 2.4; club.add(skin(lathe([[0, 0], [1.6, 0.2], [0, 3]], 6), 0x7a7470, { x: Math.cos(a) * 5.6, y: -44 + (i % 4) * 7, z: Math.sin(a) * 5.6, rz: -Math.cos(a) * 1.4, rx: Math.sin(a) * 1.4, outline: false })); }
    g.userData = { body, legs, torso, head, armR, armL };
    return g;
  },
  kappa() {
    const g = new THREE.Group(), green = 0x4f9a48, dk = 0x356e32;
    const body = grp(g);
    const legs = [-1, 1].map(z => leg(body, 0, 12, z * 7, { up: 5, lo: 5, r1: 3.6, r2: 3, r3: 2.6, col: green, foot: [5.5, 2, 5], footCol: dk }));
    const torso = grp(body, 0, 9, 0); torso.rotation.order = 'YXZ';
    torso.add(skin(lathe([[0, 0], [11, 1], [14, 8], [13.6, 16], [10, 22], [0, 24]], 18), green));
    torso.add(skin(ell(6, 9.5, 9), 0xd8d070, { x: 7.5, y: 11, outline: false }));
    const shell = skin(new THREE.SphereGeometry(1, 18, 10, 0, PI * 2, 0, PI / 2).scale(16, 7, 15), 0x6a5a2a, { x: -4, y: 12, rz: PI / 2, side: THREE.DoubleSide });
    torso.add(shell);
    torso.add(skin(Geo.tor(15.4, 1.3, PI * 2, 24), 0x8a7a40, { x: -4, y: 12, ry: PI / 2, outline: false }));
    const head = grp(torso, 2, 30, 0);
    head.add(skin(ell(9.6, 8.8, 9.4), green));
    head.add(skin(lathe([[0, 0], [6.6, 0], [6.6, 1.6], [0, 1.2]], 16), 0xcfe6e8, { y: 7.6 }));
    head.add(skin(Geo.tor(7.2, 1.7, PI * 2, 18), 0x2a5a2a, { y: 6.6, rx: PI / 2, outline: false }));
    head.add(skin(ell(5, 2.4, 4, 10, 8), 0xe7c24a, { x: 9.5, y: -1.5 }));
    for (const z of [-1, 1]) {
      head.add(skin(ell(1.8, 2, 1.8, 8, 6), 0xffffff, { x: 7.6, y: 3, z: z * 4, outline: false }));
      head.add(skin(ell(1, 1.2, 1, 6, 5), 0x111111, { x: 9.2, y: 3, z: z * 4, outline: false }));
    }
    const armR = arm(torso, 0, 15, 13, { up: 6, lo: 6, r1: 3, r2: 2.6, r3: 2.2, col: green, handCol: dk });
    const armL = arm(torso, 0, 15, -13, { up: 6, lo: 6, r1: 3, r2: 2.6, r3: 2.2, col: green, handCol: dk });
    g.userData = { body, legs, torso, head, armR, armL };
    return g;
  },
  onibi() {
    const g = new THREE.Group(), core = grp(g, 0, 26, 0);
    const flame = skin(lathe([[0, -9], [8, -6.5], [9.6, 0], [7.4, 7], [3.6, 16], [1, 24], [0, 27]], 16), 0x3a7ad8, { emissive: 0x2a6ae0, ei: 0.9 });
    core.add(flame);
    core.add(skin(ell(6.5, 6.5, 6.5), 0xdff2ff, { emissive: 0x9ad0ff, ei: 0.9, outline: false }));
    for (const z of [-3, 3]) core.add(skin(ell(1.2, 1.8, 1.2, 8, 6), 0x0a2040, { x: 8.6, y: 0.5, z, outline: false }));
    const wisps = [0, 1, 2].map(i => { const w = skin(lathe([[0, -2], [2.4, 0], [1, 4], [0, 6]], 10), 0x6ab8ff, { emissive: 0x4a98ff, ei: 0.9, outline: false, noXray: true }); core.add(w); return w; });
    g.userData = { core, flame, wisps };
    return g;
  },
  tengu() {
    const g = new THREE.Group(), red = 0xc8392c, white = 0xefe9dd;
    const body = grp(g);
    for (const z of [-5, 5]) { body.add(skin(ell(6, 1.6, 3.4, 10, 6), 0x5a3a24, { x: 1, y: 4.5, z })); body.add(skin(ell(1.2, 2.4, 3, 6, 5), 0x3a2618, { x: 1, y: 1.8, z, outline: false })); }
    const hakama = skin(lathe([[0, 5], [12.5, 5.4], [12, 12], [9.6, 24], [8.6, 28], [0, 29]], 18), 0x2b3058);
    body.add(hakama);
    const torso = grp(body, 0, 27, 0); torso.rotation.order = 'YXZ';
    torso.add(skin(lathe([[0, 0], [9, 1], [8.8, 8], [10.6, 15], [11, 20], [7, 24], [0, 25]], 16), white));
    for (const [y, z, c] of [[17, -3, 0xffffff], [17, 3, 0xffffff], [11, 0, 0xd83a2a]]) torso.add(skin(ell(2.6, 2.6, 2.6, 10, 8), c, { x: 10.5, y, z }));
    const wings = [-1, 1].map(s => {
      const w = grp(torso, -6, 20, s * 6);
      for (let i = 0; i < 5; i++) w.add(skin(ell(1.2, 14 - i, 4, 8, 6), i % 2 ? 0x24242e : 0x18181f, { x: -4 - i * 1.5, y: 3 - i * 2.5, z: s * (5 + i * 3.2), rx: s * (0.35 + i * 0.22), rz: 0.25 }));
      return w;
    });
    const head = grp(torso, 0, 32, 0);
    head.add(skin(ell(8.2, 8.8, 8), red));
    head.add(skin(lathe([[0, 0], [2.6, 0.8], [1.6, 12], [0.6, 17], [0, 18]], 10), red, { x: 6.5, y: -0.5, rz: -PI / 2 + 0.2 }));
    for (const z of [-1, 1]) {
      head.add(skin(ell(1, 1.5, 1, 6, 5), 0x15121a, { x: 7.2, y: 2.6, z: z * 3, outline: false }));
      head.add(skin(ell(1.6, 1.4, 3.2, 8, 6), white, { x: 7.4, y: 4.8, z: z * 3.4, rx: z * 0.3, outline: false }));
    }
    head.add(skin(lathe([[0, 0], [4.2, 0.4], [3, 4], [0, 6]], 6), 0x15151a, { x: 3, y: 8.5 }));
    head.add(skin(new THREE.SphereGeometry(1, 16, 10, 0, PI * 2, 0, 1.8).scale(8.8, 9.2, 8.6), white, { x: -2, y: 0.5, rz: 0.95 }));
    const hairBack = grp(head, -6, 0, 0); hairBack.add(skin(ell(4.6, 11, 6), white, { y: -8 }));
    const armR = arm(torso, 0, 19, 12.5, { up: 11, lo: 10, r1: 4.2, r2: 3.6, r3: 2.4, col: white, handCol: red });
    const armL = arm(torso, 0, 19, -12.5, { up: 11, lo: 10, r1: 4.2, r2: 3.6, r3: 2.4, col: white, handCol: red });
    const fan = new THREE.Mesh(new THREE.CircleGeometry(13, 14, 0, PI), tmat(0xd9c49a, { side: THREE.DoubleSide }));
    fan.position.y = -12; fan.rotation.set(0, PI / 2, PI); fan.castShadow = true; armR.hand.add(fan);
    g.userData = { body, hakama, torso, head, wings, hairBack, armR, armL };
    return g;
  },
});
Object.assign(ANIM3, {
  oni(m, e, dt, rec) {
    const u = m.userData, ph = (G.time + rec.seed) * 9;
    u.torso.rotation.set(0, 0, 0); u.torso.position.y = 36;
    setArm(u.armR, 0.5, 0.6); setArm(u.armL, 0.25, 0.4); walkLegs(u.legs, 0, 0);
    if (e.st === 'chase' && e.moving) { walkLegs(u.legs, ph, 0.5); u.torso.position.y = 36 + Math.abs(Math.sin(ph)) * 2; u.torso.rotation.y = Math.sin(ph) * 0.1; setArm(u.armL, 0.25 + Math.sin(ph) * 0.45, 0.5); }
    if (e.st === 'wind') { if (rec.st !== 'wind') rec.max = e.stT || 0.65; const k = ease3(1 - e.stT / rec.max); setArm(u.armR, lerp(0.5, 3.3, k), lerp(0.6, 0.5, k)); setArm(u.armL, lerp(0.25, 2.8, k), 0.6); u.torso.rotation.z = 0.22 * k; }
    if (e.st === 'recover') { if (rec.st !== 'recover') rec.rt = 0; rec.rt += dt; const k = Math.min(1, rec.rt * 8); setArm(u.armR, lerp(3.3, 0.7, k), lerp(0.5, 0.05, k)); setArm(u.armL, lerp(2.8, 0.9, k), 0.3); u.torso.rotation.z = -0.38 * k * Math.max(0, 1 - rec.rt * 1.4); walkLegs(u.legs, PI / 2, 0.3 * k); }
    if (e.hurtT > 0) u.torso.rotation.z += 0.25;
    rec.st = e.st;
  },
  kappa(m, e, dt, rec) {
    const u = m.userData, ph = (G.time + rec.seed) * 12;
    u.torso.rotation.set(Math.sin(ph) * 0.12, 0, 0); walkLegs(u.legs, ph, 0.6);
    setArm(u.armR, 0.5 + Math.sin(ph) * 0.4, 0.5); setArm(u.armL, 0.5 - Math.sin(ph) * 0.4, 0.5);
    u.head.rotation.z = 0;
    if (e.st === 'aim') { u.torso.rotation.z = 0.3; u.head.rotation.z = 0.25; setArm(u.armR, 1.2, 1.2); setArm(u.armL, 1.2, 1.2); }
    else if (e.shotT > 0) { u.torso.rotation.z = -0.35; u.head.rotation.z = -0.2; }
    if (e.hurtT > 0) u.torso.rotation.z = 0.3;
  },
  onibi(m, e, dt, rec) {
    const u = m.userData, t = G.time + rec.seed;
    u.flame.scale.set(1, 1 + Math.sin(t * 18) * 0.12, 1);
    u.core.position.set(e.st === 'aim' ? Math.sin(t * 70) * 1.8 : 0, 26 + Math.sin(t * 4) * 3, 0);
    u.wisps.forEach((w, i) => { const a = t * 3 + i * 2.1; w.position.set(Math.cos(a) * 13, Math.sin(t * 5 + i) * 4, Math.sin(a) * 13); });
    if (e.st === 'charge') { u.core.scale.set(1.7, 0.75, 0.75); u.flame.rotation.z = 1.35; m.rotation.y = -e.cAng; }
    else { u.core.scale.set(1, 1, 1); u.flame.rotation.z = 0.3; }
  },
  tengu(m, e, dt, rec) {
    const u = m.userData, t = G.time + rec.seed;
    u.wings.forEach((w, i) => { w.rotation.x = (i ? 1 : -1) * (0.2 + Math.sin(t * 8) * 0.25); });
    setArm(u.armR, 0.5, 0.6); setArm(u.armL, 0.2, 0.4); u.torso.rotation.set(0, 0, 0);
    if (e.st === 'throw') { const k = ease3(1 - e.stT / 0.4); setArm(u.armR, lerp(0.5, 2.9, k), lerp(0.6, 0.2, k)); u.torso.rotation.z = 0.15 * k; }
    else if (e.postT > 0) { setArm(u.armR, 0.6, 0.1, 0.8); u.torso.rotation.z = -0.25; }
    u.hairBack.rotation.z = -0.15 + Math.sin(t * 4) * 0.08;
    const a = e.st === 'vanish' || e.st === 'appear' ? e.alpha : 1;
    m.scale.set(a, a, a); m.visible = a > 0.03;
  },
});

// ───────── 보스 ─────────
// 근육질 상체 (어깨가 넓고 허리가 잘록한 옆모습 곡선)
const heroTorso = (h, wWaist, wChest) => lathe([[0, 0], [wWaist, 1], [wWaist * 0.96, h * 0.25], [wChest * 0.92, h * 0.5], [wChest, h * 0.72], [wChest * 0.8, h * 0.88], [wChest * 0.35, h * 0.98], [0, h]], 22);
Object.assign(BUILD3, {
  kagutsuchi() {
    const g = new THREE.Group(), body = 0x3a1208, dark = 0x240806, lava = 0xff6a1a;
    const root = grp(g);
    const legs = [-1, 1].map(z => leg(root, 0, 50, z * 14, { up: 24, lo: 22, r1: 11, r2: 8.5, r3: 6.5, col: dark, foot: [11, 5, 8] }));
    root.add(skin(lathe([[0, 40], [24, 41], [23, 50], [20, 56], [0, 57]], 20), 0x5a1a0e));
    const torso = grp(root, 0, 54, 0); torso.rotation.order = 'YXZ';
    torso.add(skin(heroTorso(52, 21, 29), body));
    // 용암이 흐르는 균열 (가는 빛나는 관)
    for (let i = 0; i < 6; i++) {
      const a = -0.9 + i * 0.36, r = 24.5, y0 = 12 + (i % 3) * 8;
      const pts = [0, 1, 2, 3].map(k => new THREE.Vector3(Math.cos(a + k * 0.08) * (r - k * 0.5), y0 + k * 7 + (k % 2) * 3, Math.sin(a + k * 0.08) * (r - k * 0.5)));
      torso.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 1.1, 5), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb04a : lava })));
    }
    torso.add(skin(ell(5, 5, 5), 0xffc060, { x: 20, y: 34, emissive: 0xff7a2a, outline: false }));
    const head = grp(torso, 0, 62, 0);
    head.add(skin(ell(13, 14.5, 13), 0x4a1408));
    head.add(skin(ell(9, 6, 11), 0x4a1408, { x: 4, y: -8 }));
    for (const z of [-1, 1]) head.add(skin(ell(2.6, 1.8, 2.6, 8, 6), 0xffe14a, { x: 11.5, y: 2, z: z * 5, emissive: 0xffa000, outline: false }));
    const flames = [];
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * PI * 2, big = i % 3 === 0;
      const f = skin(lathe([[0, 0], [5.5, 2], [5, 8], [2.4, 18], [0, big ? 30 : 22]], 12), i % 2 ? 0xffd36a : 0xff6a2a,
        { x: Math.cos(a) * 7 - 3, y: 9, z: Math.sin(a) * 8, rx: Math.sin(a) * 0.45, rz: -Math.cos(a) * 0.35 + 0.35, emissive: i % 2 ? 0xff9a2a : 0xff4a10, ei: 0.9, outline: false, noXray: true });
      head.add(f); flames.push(f);
    }
    const armR = arm(torso, 0, 40, 30, { up: 24, lo: 22, r1: 10, r2: 8, r3: 6.5, col: body, handCol: 0xff8a3a });
    const armL = arm(torso, 0, 40, -30, { up: 24, lo: 22, r1: 10, r2: 8, r3: 6.5, col: body, handCol: 0xff8a3a });
    for (const a of [armR, armL]) a.hand.children[0].material.emissive.setHex(0xff5a1a);
    g.userData = { root, legs, torso, head, armR, armL, flames };
    return g;
  },
  raijin() {
    const g = new THREE.Group(), body = 0x5b3fa0, dark = 0x3a2870;
    const root = grp(g);
    const legs = [-1, 1].map(z => leg(root, 0, 48, z * 14, { up: 23, lo: 21, r1: 11, r2: 8.5, r3: 6.5, col: dark, foot: [11, 5, 8] }));
    root.add(skin(lathe([[0, 38], [24, 39], [23.5, 48], [21, 55], [0, 56]], 20), 0xe8a020));
    for (const y of [42, 50]) root.add(skin(Geo.tor(23.6 - (y - 42) * 0.25, 1.4, PI * 2, 24), 0x1a1210, { y, rx: PI / 2, outline: false }));
    const torso = grp(root, 0, 53, 0); torso.rotation.order = 'YXZ';
    torso.add(skin(heroTorso(52, 21, 30), body));
    for (const z of [-1, 1]) torso.add(skin(ell(8, 9, 10), 0x6e52b4, { x: 16, y: 36, z: z * 9, outline: false }));
    const head = grp(torso, 0, 62, 0);
    head.add(skin(ell(13, 14, 13), body));
    head.add(skin(ell(9.5, 6, 11), body, { x: 4, y: -8 }));
    for (const z of [-1, 1]) {
      head.add(skin(lathe([[0, 0], [3.6, 0.5], [2.4, 9], [0, 17]], 10), 0xe8c24a, { y: 11, z: z * 7, rx: z * 0.45, rz: -0.2 }));
      head.add(skin(ell(2.6, 2, 2.6, 8, 6), 0xfff08a, { x: 11.5, y: 3, z: z * 5, emissive: 0xc0a000, outline: false }));
    }
    for (let i = 0; i < 7; i++) head.add(skin(lathe([[0, 0], [4, 1], [0, 14]], 8), 0x1a1028, { x: -5 - (i % 2) * 3, y: 6 + (i % 3) * 3, z: (i - 3) * 4, rz: 1.25, outline: false }));
    // 등 뒤의 천둥북 고리 (북은 통 모양 회전체)
    const ring = grp(torso, -26, 44, 0); ring.rotation.y = PI / 2;
    ring.add(skin(Geo.tor(50, 2.6, PI * 2, 48), 0xa8803a, { outline: false }));
    const drumGeo = lathe([[0, -5], [7, -5.2], [8.6, 0], [7, 5.2], [0, 5]], 16);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * PI * 2, d = grp(ring, Math.cos(a) * 50, Math.sin(a) * 50, 0);
      d.add(skin(drumGeo, 0x8a2a1a, { rx: PI / 2 }));
      d.add(skin(Geo.cyl(6.8, 6.8, 10.8, 16), 0xf0e2c0, { rx: PI / 2, outline: false }));
    }
    const armR = arm(torso, 0, 40, 31, { up: 23, lo: 21, r1: 10, r2: 8, r3: 6.5, col: body, handCol: dark });
    const armL = arm(torso, 0, 40, -31, { up: 23, lo: 21, r1: 10, r2: 8, r3: 6.5, col: body, handCol: dark });
    for (const a of [armR, armL]) a.hand.add(skin(lathe([[0, -24], [2.4, -23], [1.4, 0], [0, 1]], 8), 0x5a3a20, { y: -2 }));
    g.userData = { root, legs, torso, head, ring, armR, armL };
    return g;
  },
  tsukuyomi() {
    const g = new THREE.Group(), robe = 0x1c2444, white = 0xeeeae2, pale = 0xf2eee8, silver = 0xd8dce8;
    const body = grp(g, 0, 8, 0);
    body.add(skin(lathe([[0, 0], [30, 1], [29, 8], [23, 34], [17, 62], [14, 80], [0, 82]], 22), robe));
    body.add(skin(lathe([[13, 58], [17.5, 68], [18, 80], [15, 92], [8, 98], [0, 99]], 20), white));
    body.add(skin(Geo.tor(14.6, 1.6, PI * 2, 22), 0x8aa6e0, { y: 64, rx: PI / 2, outline: false }));
    const head = grp(body, 0, 110, 0);
    head.add(skin(ell(10.5, 12, 10.5), pale));
    for (const z of [-1, 1]) head.add(skin(ell(1.1, 1.8, 1.1, 8, 6), 0x7ab8ff, { x: 9.6, y: 2, z: z * 3.6, emissive: 0x3a7aff, outline: false }));
    head.add(skin(new THREE.SphereGeometry(1, 18, 12, 0, PI * 2, 0, 1.9).scale(11.5, 12.5, 11.2), silver, { x: -1.5, y: 1, rz: 0.6 }));
    const hair = grp(head, -7, 0, 0);
    hair.add(skin(lathe([[0, -52], [3, -50], [8, -30], [9, -10], [7, 0], [0, 2]], 14), silver));
    for (const z of [-1, 1]) head.add(skin(ell(2.2, 12, 3, 8, 6), silver, { x: 5, y: -9, z: z * 9 }));
    const halo = grp(head, -16, 6, 0); halo.rotation.y = PI / 2;
    halo.add(skin(Geo.tor(32, 3.4, 4.3, 36), 0xdfe9ff, { emissive: 0xaec8ff, ei: 0.9, outline: false, rz: 2.2, noXray: true }));
    const sleeve = () => lathe([[0, -26], [11, -25], [9, -12], [5.5, -2], [0, 0]], 14);
    const armR = arm(body, 0, 92, 17, { up: 18, lo: 16, r1: 5, r2: 4.2, r3: 3, col: white, handCol: pale });
    const armL = arm(body, 0, 92, -17, { up: 18, lo: 16, r1: 5, r2: 4.2, r3: 3, col: white, handCol: pale });
    for (const a of [armR, armL]) a.el.add(skin(sleeve(), white, { y: -2, x: -2 }));
    g.userData = { body, head, hair, halo, armR, armL };
    return g;
  },
  orochi() {
    const g = new THREE.Group(), green = 0x3f7a3a, light = 0x4c8a44, belly = 0xc8a070;
    const body = grp(g);
    body.add(skin(Geo.tor(50, 17, PI * 2, 36), green, { y: 15, rx: PI / 2 }));
    body.add(skin(Geo.tor(36, 15, PI * 2, 32), light, { y: 40, rx: PI / 2 }));
    body.add(skin(Geo.tor(22, 13, PI * 2, 28), green, { y: 62, rx: PI / 2 }));
    body.add(skin(ell(18, 15, 18), light, { y: 76 }));
    body.add(skin(lathe([[0, 0], [12, 2], [9, 30], [4, 60], [0, 72]], 12), green, { x: -55, y: 12, z: 26, rz: PI / 2 + 0.25, ry: 0.5 }));
    // 목: 촘촘한 비늘 구슬 사슬이라 매끈한 관처럼 보인다
    const necks = [], heads = [];
    const headGeo = lathe([[0, -4], [8.5, 0], [10.5, 8], [9, 16], [5.5, 24], [0, 29]], 16).rotateZ(-PI / 2).scale(1, 0.75, 1.1);
    const jawGeo = lathe([[0, 0], [6.5, 2], [6, 12], [3, 20], [0, 23]], 12).rotateZ(-PI / 2).scale(1, 0.5, 1);
    for (let i = 0; i < 8; i++) {
      const segs = [];
      for (let j = 0; j < 14; j++) { const sgm = skin(ell(10.5 - j * 0.3, 10.5 - j * 0.3, 10.5 - j * 0.3, 12, 10), j % 3 === 1 ? light : green, { outline: j === 0 || j === 13 }); g.add(sgm); segs.push(sgm); }
      necks.push(segs);
      const h = grp(g); h.rotation.order = 'YXZ';
      h.add(skin(headGeo, green, { x: -2 }));
      const jaw = grp(h, -2, -4, 0);
      jaw.add(skin(jawGeo, 0x7a2a2a));
      for (const z of [-1, 1]) {
        h.add(skin(ell(2.4, 2.2, 2.2, 8, 6), 0xff3a2a, { x: 11, y: 4.5, z: z * 6, emissive: 0xff1a0a, outline: false }));
        h.add(skin(lathe([[0, 0], [2, 0.4], [0, 10]], 6), 0xd8d0b0, { x: -1, y: 6, z: z * 5, rz: 1.1 }));
      }
      h.userData.jaw = jaw; heads.push(h);
    }
    g.userData = { body, necks, heads };
    return g;
  },
});
Object.assign(ANIM3, {
  kagutsuchi(m, e, dt, rec) {
    const u = m.userData, t = G.time;
    u.flames.forEach((f, i) => f.scale.set(1, 1 + Math.sin(t * 14 + i * 1.7) * 0.28, 1));
    u.torso.rotation.set(0, 0, 0); setArm(u.armR, 0.3, 0.5); setArm(u.armL, 0.3, 0.5); walkLegs(u.legs, 0, 0);
    if (!e.co && !e.hold) { const ph = t * 5; walkLegs(u.legs, ph, 0.3); u.torso.rotation.y = Math.sin(ph) * 0.08; }
    if (e.hold === 'charge') { u.torso.rotation.z = -0.6; setArm(u.armR, -0.7, 0.3); setArm(u.armL, -0.7, 0.3); walkLegs(u.legs, t * 16, 0.7); }
    if (e.act && e.act.name === 'cast') { const k = ease3(e.act.t * 4); setArm(u.armR, lerp(0.3, 2.9, k), lerp(0.5, 0.15, k)); setArm(u.armL, lerp(0.3, 2.9, k), lerp(0.5, 0.15, k)); u.torso.rotation.z = 0.15 * k; }
  },
  raijin(m, e, dt, rec) {
    const u = m.userData;
    u.ring.rotation.x += dt * 0.7;
    setArm(u.armR, 0.5, 0.5); setArm(u.armL, 0.5, 0.5); u.ring.scale.setScalar(1); m.scale.set(1, 1, 1); walkLegs(u.legs, 0, 0);
    if (!e.co) walkLegs(u.legs, G.time * 5, 0.3);
    if (e.act && e.act.name === 'drum') { const up = e.act.t < 0.08; setArm(u.armR, up ? 2.9 : 0.9, up ? 0.3 : 0.9); setArm(u.armL, up ? 2.9 : 0.9, up ? 0.3 : 0.9); u.ring.scale.setScalar(1 + Math.max(0, 0.3 - e.act.t) * 1.2); }
    if (e.act && e.act.name === 'blink') {
      const k = clamp(e.act.t / 0.2, 0, 1), s = e.act.rev ? 1 - k : k;
      m.scale.set(1 - s * 0.85, 1 + s * 0.8, 1 - s * 0.85); setFlash(m, s > 0.2);
    }
  },
  tsukuyomi(m, e, dt, rec) {
    const u = m.userData, t = G.time;
    u.body.position.y = 8 + Math.sin(t * 1.6) * 4; u.halo.rotation.x = t * 0.4; u.hair.rotation.z = -0.1 + Math.sin(t * 1.3) * 0.06;
    setArm(u.armR, 0.25, 0.5); setArm(u.armL, 0.25, 0.5);
    if (e.act && e.act.name === 'cast') { const k = ease3(e.act.t * 5); setArm(u.armR, lerp(0.25, 1.8, k), lerp(0.5, 0.1, k)); setArm(u.armL, lerp(0.25, 1.1, k), 0.4); }
  },
  orochi(m, e) {
    const u = m.userData, t = G.time, N = 14;
    m.rotation.y = 0;
    u.body.scale.y = 1 + Math.sin(t * 1.5) * 0.02;
    const bez = (a, b, c, k) => (1 - k) * (1 - k) * a + 2 * (1 - k) * k * b + k * k * c;
    for (let i = 0; i < 8; i++) {
      const hw = e.heads[i], dx = hw.x - e.x, dz = hw.y - e.y, L = e.lunge[i], wn = e.warn[i];
      const hy = 34 + Math.sin(t * 2 + i) * 4, h = u.heads[i];
      h.position.set(dx, hy, dz); h.rotation.set(0, -hw.a, -0.25);
      const open = L > 0.5 ? 1 : L > 0 ? 0.5 : wn > 0 ? (wn > 0.35 ? 0.35 : 0.75) : 0.08 + Math.sin(t * 3 + i) * 0.05;
      h.userData.jaw.rotation.z = -open * 0.85;
      const a = Math.atan2(dz, dx), bx = Math.cos(a) * 18, bz = Math.sin(a) * 18, by = 72;
      const cx = (bx + dx) / 2, cz = (bz + dz) / 2, cy = Math.max(by, hy) + 45;
      u.necks[i].forEach((s, j) => { const k = (j + 0.5) / N; s.position.set(bez(bx, cx, dx, k), bez(by, cy, hy, k), bez(bz, cz, dz, k)); });
    }
  },
});

const XRAY_OF = kind => kind === 'samurai' ? R3.xray.player : R3.xray.enemy;
