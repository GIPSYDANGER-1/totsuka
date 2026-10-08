'use strict';
// ───────── 쿼터뷰(아이소메트릭) 투영 ─────────
// 게임 판정은 전부 평평한 월드 좌표(x, y)에서 하고, 그릴 때만 화면 좌표로 투영한다 (하데스 방식).
// 월드 x축 → 화면 오른쪽 아래, 월드 y축 → 화면 왼쪽 아래. 방은 화면에서 마름모로 보인다.

const ISO = { K: 0.7, OX: W / 2, OY: 115, WW: 780, WD: 780, WALL: 54 };
const VIEW = { sx: 0, sy: 0 }; // 화면 흔들림 오프셋

// 월드 → 화면. h는 지면에서의 높이(화면 위쪽으로 올라감)
function iso(wx, wy, h = 0) {
  return { x: ISO.OX + (wx - wy) * ISO.K, y: ISO.OY + (wx + wy) * ISO.K * 0.5 - h };
}
// 화면 → 월드 (지면 기준)
function unIso(sx, sy) {
  const u = (sx - ISO.OX) / ISO.K, v = (sy - ISO.OY) / (ISO.K * 0.5);
  return { x: (u + v) / 2, y: (v - u) / 2 };
}
// 월드 방향각 → 화면에서 보이는 각도
function isoAng(a) { const c = Math.cos(a), s = Math.sin(a); return Math.atan2((c + s) * 0.5, c - s); }
// 화면 기준 입력 방향(WASD) → 월드 이동 방향 (정규화)
function screenDirToWorld(dx, dy) {
  const wx = dx + 2 * dy, wy = 2 * dy - dx, l = Math.hypot(wx, wy) || 1;
  return { x: wx / l, y: wy / l };
}

// 바닥에 눕는 것(예고 범위, 장판, 베기 궤적)은 월드 좌표 그대로 그리면 바닥 평면에 투영된다.
function groundTransform() {
  const K = ISO.K;
  ctx.setTransform(K, K * 0.5, -K, K * 0.5, ISO.OX + VIEW.sx, ISO.OY + VIEW.sy);
}
function screenTransform() { ctx.setTransform(1, 0, 0, 1, VIEW.sx, VIEW.sy); }
// 서 있는 것(캐릭터, 탄환)은 투영된 위치로 옮긴 뒤 자기 월드 좌표 기준으로 그린다.
// (e.x, e.y)에 그린 것이 화면의 투영 위치에 나타나도록 평행이동만 한다.
function uprightAt(e, h = 0) {
  const p = iso(e.x, e.y, h);
  ctx.setTransform(1, 0, 0, 1, VIEW.sx + p.x - e.x, VIEW.sy + p.y - e.y);
}
// uprightAt(owner) 상태에서 다른 월드 지점의 위치를 구할 때 (오로치 머리 등)
function isoLocal(owner, wx, wy, h = 0) {
  const p = iso(wx, wy, h), o = iso(owner.x, owner.y);
  return { x: p.x - o.x + owner.x, y: p.y - o.y + owner.y };
}
