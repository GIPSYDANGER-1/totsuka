'use strict';
// ───────── 게임 데이터: 신(보스)·권능·보상·지역·영구 강화 ─────────
// 밸런스 조정은 대부분 이 파일에서 하면 된다.

const SLOTS = { attack: '공격', special: '특수', dash: '대시', cast: '주술' };
const SLOT_ORDER = ['attack', 'special', 'dash', 'cast'];
const SLOT_KEYS = { attack: '좌클릭', special: '우클릭', dash: 'Space', cast: 'Q' };

// 신을 쓰러뜨리면 그 신의 권능 4개 중 3개가 제시되고, 하나를 고른다.
// 같은 슬롯(공격/특수/대시/주술)에 이미 권능이 있으면 교체된다 (하데스의 축복 슬롯 방식).
const GODS = {
  kagutsuchi: {
    name: '카구츠치', title: '불의 신', kanji: '火', color: '#ff6a2a',
    lore: '태어나며 어머니 이자나미를 불태운 신. 아버지 이자나기가 토츠카의 검으로 베었다.',
    powers: [
      { id: 'fire_atk', slot: 'attack', name: '염인(炎刃)', desc: '베기가 적을 불태운다. 화상: 초당 5 피해, 중첩 시 최대 20.' },
      { id: 'fire_sp', slot: 'special', name: '염화선풍', desc: '회전베기가 사방으로 화염구 8발을 흩뿌린다.' },
      { id: 'fire_dash', slot: 'dash', name: '불길 질주', desc: '대시한 자리에 2.5초간 불길이 남아 적을 태운다.' },
      { id: 'fire_cast', slot: 'cast', name: '분화(噴火)', cd: 6, desc: '커서 위치에 화산이 폭발한다. 50 피해 + 화상.' },
    ],
  },
  raijin: {
    name: '라이진', title: '뇌신', kanji: '雷', color: '#a98bff',
    lore: '등에 짊어진 천둥북을 두드려 하늘을 찢는 번개의 신.',
    powers: [
      { id: 'thunder_atk', slot: 'attack', name: '뇌인(雷刃)', desc: '베기 적중 시 30% 확률로 주변 적 3명에게 연쇄 번개. (14 피해)' },
      { id: 'thunder_sp', slot: 'special', name: '천뢰(天雷)', desc: '회전베기 시 주변 적 최대 4명에게 낙뢰가 떨어진다. (22 피해)' },
      { id: 'thunder_dash', slot: 'dash', name: '뇌광보', desc: '대시가 끝나는 자리에 번개가 내리친다. (26 피해)' },
      { id: 'thunder_cast', slot: 'cast', name: '뇌신의 북', cd: 9, desc: '2.4초간 적들에게 낙뢰 8회. (각 24 피해)' },
    ],
  },
  tsukuyomi: {
    name: '츠쿠요미', title: '달의 신', kanji: '月', color: '#bcd2ff',
    lore: '밤의 나라를 다스리는 스사노오의 형. 차가운 달빛으로 모든 것을 멈춘다.',
    powers: [
      { id: 'moon_atk', slot: 'attack', name: '월영참', desc: '3번째 연속 베기가 적을 관통하는 초승달 검기를 날린다. (20 피해)' },
      { id: 'moon_sp', slot: 'special', name: '만월', desc: '회전베기 범위 +60%, 맞은 적을 2초간 둔화시킨다.' },
      { id: 'moon_dash', slot: 'dash', name: '월하보', desc: '대시 후 1.5초 안의 첫 공격이 치명타가 된다. (피해 2배)' },
      { id: 'moon_cast', slot: 'cast', name: '월식', cd: 12, desc: '4초간 적과 적 탄환의 시간이 55% 느려진다.' },
    ],
  },
  orochi: {
    name: '야마타노오로치', title: '여덟 머리의 대사(大蛇)', kanji: '蛇', color: '#7fd46a',
    lore: '여덟 개의 머리와 여덟 개의 꼬리. 이즈모의 딸들을 삼켜온 재앙.',
    powers: [],
  },
};

// 방을 클리어하면 받는 보상. 다음 방으로 가는 문 위에 표시된다.
const REWARDS = {
  heal: { name: '오니기리', kanji: '飯', color: '#f2e6c9', desc: '체력 35 회복', apply(p) { p.hp = Math.min(p.maxHp, p.hp + 35); } },
  maxhp: { name: '곡옥(勾玉)', kanji: '玉', color: '#5fd38a', desc: '최대 체력 +20', apply(p) { p.maxHp += 20; p.hp += 20; } },
  sake: { name: '신주(神酒)', kanji: '酒', color: '#ffd36a', desc: '모든 피해 +10%', apply(p) { p.dmgMul += 0.1; } },
  whet: { name: '숫돌', kanji: '砥', color: '#9fc6e6', desc: '특수·주술 재사용 대기시간 -12%', apply(p) { p.cdMul *= 0.88; } },
  soul: { name: '혼(魂)', kanji: '魂', color: '#8fd8ff', desc: '혼 +20 (영구 강화 재화)', apply() { G.runSouls += 20; } },
};

const STAGES = [
  { name: '요미 히라사카', sub: '불타는 황천의 언덕', boss: 'kagutsuchi', env: 'yomi', enemies: ['oni', 'onibi', 'kappa', 'onibi'],
    wall: '#140806', floor: '#2b1611', tile: 'rgba(0,0,0,0.28)', accent: '#ff6a2a', deco: 'lava' },
  { name: '뇌운의 고원', sub: '천둥이 잠들지 않는 곳', boss: 'raijin', env: 'thunder', enemies: ['oni', 'kappa', 'tengu', 'onibi'],
    wall: '#0b0914', floor: '#1d1a2c', tile: 'rgba(0,0,0,0.3)', accent: '#a98bff', deco: 'spark' },
  { name: '월하의 신궁', sub: '달빛만이 허락된 궁', boss: 'tsukuyomi', env: 'moon', enemies: ['tengu', 'onibi', 'kappa', 'oni'],
    wall: '#070a12', floor: '#161c2a', tile: 'rgba(255,255,255,0.05)', accent: '#bcd2ff', deco: 'moon' },
  { name: '이즈모 히이카와', sub: '여덟 골짜기를 휘감은 강', boss: 'orochi', env: 'izumo', enemies: ['oni', 'kappa', 'tengu', 'onibi', 'oni'],
    wall: '#050c08', floor: '#14211a', tile: 'rgba(0,0,0,0.3)', accent: '#7fd46a', deco: 'water' },
];
const ROOMS_PER_STAGE = 4; // 전투 3 + 보스 1

// 영구 강화 (죽어도 유지). 혼(魂)으로 구매.
const META = [
  { id: 'hp', name: '체력 단련', desc: '최대 체력 +10', max: 5, cost: l => 15 + l * 15 },
  { id: 'str', name: '검술 수련', desc: '모든 피해 +8%', max: 5, cost: l => 20 + l * 20 },
  { id: 'dash', name: '질풍보', desc: '대시 충전 +1', max: 1, cost: () => 70 },
  { id: 'revive', name: '불굴(不屈)', desc: '쓰러져도 1회 부활 (체력 50%)', max: 2, cost: l => 60 + l * 60 },
];

// ───────── 난이도 ─────────
// enemyHp/enemyDmg: 적 체력·피해 배율, tele: 공격 예고 시간 배율(클수록 여유), bullet: 탄속·충격파 속도 배율,
// rest: 보스 패턴 사이 휴식 배율, budget: 방마다 적 수 가감, playerHp: 시작 최대 체력 가감,
// choiceHeal: 권능 선택 시 회복 비율, souls: 런 종료 시 혼 배율, revive: 불굴 추가 횟수, noRevive: 불굴 사용 불가
const DIFFICULTIES = {
  easy: {
    name: '쉬움', color: '#7fd46a', desc: '적이 약하고 공격 예고가 길다. 불굴(부활) +1회. 처음 하는 분께.',
    enemyHp: 0.7, enemyDmg: 0.6, tele: 1.3, bullet: 0.85, rest: 1.35, budget: -2, playerHp: 30, choiceHeal: 0.5, souls: 0.75, revive: 1,
  },
  normal: {
    name: '일반', color: '#e8dcc4', desc: '기본 밸런스.',
    enemyHp: 1, enemyDmg: 1, tele: 1, bullet: 1, rest: 1, budget: 0, playerHp: 0, choiceHeal: 0.3, souls: 1, revive: 0,
  },
  hard: {
    name: '어려움', color: '#ffb04a', desc: '적이 더 강하고 빠르며 더 많이 몰려온다. 혼 1.4배.',
    enemyHp: 1.3, enemyDmg: 1.4, tele: 0.85, bullet: 1.12, rest: 0.8, budget: 3, playerHp: 0, choiceHeal: 0.2, souls: 1.4, revive: 0,
  },
  hardcore: {
    name: '하드코어', color: '#ff4a3a', desc: '불굴(부활) 불가, 권능 선택 시 회복 없음, 적 피해 1.8배. 혼 2배.',
    enemyHp: 1.6, enemyDmg: 1.8, tele: 0.75, bullet: 1.22, rest: 0.65, budget: 5, playerHp: -20, choiceHeal: 0, souls: 2, revive: 0, noRevive: true,
  },
};
const DIFF_ORDER = ['easy', 'normal', 'hard', 'hardcore'];
function D() { return DIFFICULTIES[(typeof G !== 'undefined' && G.difficulty) || 'normal']; }
