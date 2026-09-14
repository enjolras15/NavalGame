/**
 * naval_config.js
 * 定数 / ユニット諸元 / マップ / AI 重み定義 / 編成ヘルパー
 */

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
const DIRS8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const AIR_RANGE = 6;
const AIR_AA_RADIUS = 3;
const SELF_BUFF_TYPES = new Set(["evade", "dive", "aaBarrage"]);
const FIGHTER_TYPES = new Set(["fighter", "seaplaneFighter"]);

// ============== 航空隊ファクトリ ==============
function makeSquadrons() {
  return [
    { type:"fighter",  label:"戦闘機隊", hp:30, maxHp:30, attackPower:20, airAttack:40 },
    { type:"attacker", label:"攻撃機隊", hp:25, maxHp:25, attackPower:50, airAttack:12 },
    { type:"bomber",   label:"爆撃機隊", hp:15, maxHp:15, attackPower:75, airAttack:4 }
  ];
}
function makeSquadronsLight() {
  return [
    { type:"fighter",  label:"戦闘機隊", hp:25, maxHp:25, attackPower:20, airAttack:35 },
    { type:"attacker", label:"攻撃機隊", hp:20, maxHp:20, attackPower:45, airAttack:10 }
  ];
}
function makeSquadronsSeaplane() {
  return [
    { type:"seaplaneFighter", label:"水上戦闘機隊", hp:20, maxHp:20, attackPower:15, airAttack:25 },
    { type:"patrol",          label:"哨戒機隊",     hp:20, maxHp:20, attackPower:8,  airAttack:6, aswPower:40 }
  ];
}
function makeSquadronsFor(type) {
  if (type === "CV") return makeSquadrons();
  if (type === "CVL") return makeSquadronsLight();
  if (type === "AV") return makeSquadronsSeaplane();
  return null;
}

// ============== ユニット諸元 ==============
const UNIT_TYPES = {
  BB: { name:"戦艦", hp:130, move:3, gunRange:5, gunPower:40, defense:10, evasion:3, vision:3,
        aa:4, asw:0, displacement:14000,
        ability:{ type:"salvo", range:5, centerPower:50, splashPower:22, uses:2, label:"大口径砲" } },
  CV: { name:"空母", hp:110, move:3, gunRange:2, gunPower:8, defense:5, evasion:5, vision:5,
        aa:6, asw:5, displacement:18000 },
  CVL: { name:"軽空母", hp:80, move:3, gunRange:2, gunPower:6, defense:4, evasion:6, vision:6,
        aa:4, asw:8, displacement:11000 },
  AV: { name:"水上機母艦", hp:75, move:4, gunRange:1, gunPower:6, defense:4, evasion:8, vision:6,
        aa:4, asw:6, displacement:9000 },
  CA: { name:"重巡洋艦", hp:110, move:4, gunRange:4, gunPower:28, defense:8, evasion:10, vision:4,
        aa:6, asw:4, displacement:11000,
        torpedo:{ range:3, power:40, uses:2 },
        ability:{ type:"focusedFire", range:5, power:50, uses:2, label:"集中砲火" } },
  CL: { name:"軽巡洋艦", hp:85, move:5, gunRange:4, gunPower:18, defense:5, evasion:14, vision:4,
        aa:8, asw:14, displacement:8000,
        torpedo:{ range:3, power:30, uses:2 },
        ability:{ type:"aaBarrage", radius:2, boost:12, uses:2, label:"対空射撃" } },
  DD: { name:"駆逐艦", hp:70, move:5, gunRange:3, gunPower:12, defense:3, evasion:12, vision:4,
        aa:6, asw:18, displacement:6000,
        torpedo:{ range:3, power:36, uses:2 },
        ability:{ type:"evade", boost:15, uses:2, label:"煙幕展開" } },
  FF: { name:"フリゲート", hp:55, move:6, gunRange:3, gunPower:12, defense:2, evasion:22, vision:5,
        aa:6, asw:18, displacement:3000,
        torpedo:{ range:2, power:20, uses:2 },
        ability:{ type:"aswStrike", range:3, power:45, uses:2, label:"対潜爆雷" } },
  AO: { name:"補給艦", hp:90, move:3, gunRange:1, gunPower:4, defense:4, evasion:6, vision:3,
        aa:4, asw:0, displacement:10000,
        ability:{ type:"resupply", range:2, heal:20, uses:2, label:"洋上補給" } },
  SS: { name:"潜水艦", hp:55, move:4, gunRange:1, gunPower:3, defense:4, evasion:10, vision:4,
        aa:0, asw:0, displacement:4000,
        torpedo:{ range:3, power:65, uses:3 },
        ability:{ type:"dive", boost:25, uses:2, label:"潜航" } }
};
const UNIT_KEYS = Object.keys(UNIT_TYPES);

const ICONS = {
  BB: `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="20" rx="15" ry="6" fill="var(--unit-color)"/><rect x="16" y="13" width="8" height="5" fill="var(--panel-2)"/><rect x="9" y="17" width="4" height="6" fill="var(--panel-2)"/><rect x="27" y="17" width="4" height="6" fill="var(--panel-2)"/></svg>`,
  CV: `<svg viewBox="0 0 40 40"><rect x="5" y="16" width="30" height="8" rx="3" fill="var(--unit-color)"/><rect x="23" y="9" width="6" height="8" fill="var(--panel-2)"/></svg>`,
  CVL: `<svg viewBox="0 0 40 40"><rect x="8" y="17" width="24" height="6" rx="2" fill="var(--unit-color)"/><rect x="24" y="12" width="5" height="6" fill="var(--panel-2)"/></svg>`,
  AV: `<svg viewBox="0 0 40 40"><rect x="10" y="18" width="20" height="5" rx="2" fill="var(--unit-color)"/><rect x="14" y="12" width="4" height="6" fill="var(--panel-2)"/><rect x="22" y="12" width="4" height="6" fill="var(--panel-2)"/></svg>`,
  CA: `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="20" rx="15" ry="5" fill="var(--unit-color)"/><rect x="10" y="16" width="5" height="4" fill="var(--panel-2)"/><rect x="17" y="14" width="6" height="5" fill="var(--panel-2)"/><rect x="25" y="16" width="5" height="4" fill="var(--panel-2)"/></svg>`,
  CL: `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="21" rx="13" ry="5" fill="var(--unit-color)"/><rect x="14" y="15" width="6" height="4" fill="var(--panel-2)"/><rect x="22" y="17" width="3" height="5" fill="var(--panel-2)"/></svg>`,
  DD: `<svg viewBox="0 0 40 40"><polygon points="20,9 27,20 20,31 13,20" fill="var(--unit-color)"/></svg>`,
  FF: `<svg viewBox="0 0 40 40"><polygon points="20,12 24,20 20,28 16,20" fill="var(--unit-color)"/></svg>`,
  AO: `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="22" rx="14" ry="5" fill="var(--unit-color)"/><rect x="10" y="15" width="5" height="5" fill="var(--panel-2)"/><rect x="18" y="13" width="4" height="7" fill="var(--panel-2)"/><rect x="25" y="15" width="5" height="5" fill="var(--panel-2)"/></svg>`,
  SS: `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="23" rx="15" ry="5" fill="var(--unit-color)"/><rect x="17" y="11" width="6" height="8" fill="var(--panel-2)"/><rect x="19" y="9" width="2" height="4" fill="var(--unit-color)"/></svg>`
};

// ============== 固定海域 ==============
const MAP = {
  rows: 9, cols: 14,
  land: [[1,3],[2,3],[1,10],[2,10],[6,3],[7,3],[6,10],[7,10],[4,6],[4,7]],
  budget: { maxShips: 6, maxDisplacement: 45000 },
  turnLimit: 50
};
MAP.landSet = new Set(MAP.land.map(([r,c]) => `${r},${c}`));

// ============== 幾何ヘルパー ==============
function inBounds(r, c) { return r >= 0 && r < MAP.rows && c >= 0 && c < MAP.cols; }
function isLand(r, c) { return MAP.landSet.has(`${r},${c}`); }
function zoneOf(side, r, c) { return side === "A" ? c <= 1 : c >= MAP.cols - 2; }
function chebyshev(r1, c1, r2, c2) { return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)); }
function unitAt(units, r, c) { return units.find(u => u.r === r && u.c === c && u.hp > 0); }

function unitLabel(unit, mode) {
  const def = UNIT_TYPES[unit.type];
  const side = mode === "pvai" ? (unit.side === "A" ? "味方" : "敵") : (unit.side === "A" ? "青軍" : "赤軍");
  return `${side}${def.name}${unit.flagship ? "(旗艦)" : ""}`;
}

function fleetDisplacement(fleet) { return fleet.reduce((s, t) => s + UNIT_TYPES[t].displacement, 0); }
function fleetIsValid(fleet) {
  if (!fleet || fleet.length === 0) return false;
  if (fleet.length > MAP.budget.maxShips) return false;
  if (!fleet.every(t => UNIT_TYPES[t])) return false;
  if (fleetDisplacement(fleet) > MAP.budget.maxDisplacement) return false;
  return true;
}
function fleetDisplayString(fleet) {
  const counts = {};
  fleet.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  return Object.entries(counts).map(([t, n]) => `${UNIT_TYPES[t].name}×${n}`).join(" ・ ");
}

// ============== AI 行動パラメータ ==============
const WEIGHT_META = [
  { key:"aggression", label:"積極性（接近）", min:0.2, max:3.0 },
  { key:"retreatWeight", label:"退避重視度", min:0, max:3.0 },
  { key:"retreatThreshold", label:"退避HP閾値", min:0.05, max:0.6 },
  { key:"preferLowHp", label:"低HP優先度", min:0, max:2.0 },
  { key:"preferFlagship", label:"旗艦優先度", min:0, max:3.0 },
  { key:"preferHighValue", label:"強艦優先度", min:0, max:2.0 },
  { key:"torpedoBias", label:"魚雷選好度", min:-1.0, max:2.0 },
  { key:"abilityPriority", label:"能力使用優先度", min:0, max:1.0 },
  { key:"airPriority", label:"航空攻撃優先度", min:0, max:2.0 }
];
const DEFAULT_WEIGHTS = {
  aggression:1.4, retreatWeight:0.2, retreatThreshold:0.15, preferLowHp:0.6,
  preferFlagship:1.0, preferHighValue:0.5, torpedoBias:0.3, abilityPriority:0.25, airPriority:1.0
};
const DEFAULT_FLEET = ["BB", "CV", "DD"];

function cloneWeights(w) { return Object.assign({}, w); }
function mutateWeights(w, rate) {
  const out = cloneWeights(w);
  WEIGHT_META.forEach(m => {
    const span = m.max - m.min;
    const delta = (Math.random() - Math.random()) * span * rate;
    out[m.key] = clamp(out[m.key] + delta, m.min, m.max);
  });
  return out;
}
function weightsEqual(a, b) { return WEIGHT_META.every(m => Math.abs(a[m.key] - b[m.key]) < 1e-9); }

// ============== 艦隊編成 ==============
function mutateFleet(fleet) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const out = fleet.slice();
    const op = Math.random();
    if (op < 0.30 && out.length < MAP.budget.maxShips) {
      const t = UNIT_KEYS[Math.floor(Math.random() * UNIT_KEYS.length)];
      if (fleetDisplacement(out) + UNIT_TYPES[t].displacement <= MAP.budget.maxDisplacement) {
        out.push(t); return out;
      }
    } else if (op < 0.60 && out.length > 1) {
      out.splice(Math.floor(Math.random() * out.length), 1);
      return out;
    } else {
      const i = Math.floor(Math.random() * out.length);
      const t = UNIT_KEYS[Math.floor(Math.random() * UNIT_KEYS.length)];
      const nf = out.slice(); nf[i] = t;
      if (fleetDisplacement(nf) <= MAP.budget.maxDisplacement) return nf;
    }
  }
  return fleet.slice();
}
function fleetsEqual(a, b) {
  if (a.length !== b.length) return false;
  const sa = a.slice().sort(), sb = b.slice().sort();
  return sa.every((v, i) => v === sb[i]);
}

// ============== ゲノム ==============
function cloneGenome(g) { return { weights: cloneWeights(g.weights), fleet: g.fleet.slice() }; }

function mutateGenome(g, rate, mode) {
  const out = cloneGenome(g);
  if (mode === "fleet") {
    const mf = mutateFleet(g.fleet);
    out.fleet = fleetIsValid(mf) ? mf : g.fleet.slice();
    return out;
  }
  if (mode === "weights") {
    out.weights = mutateWeights(g.weights, rate);
    return out;
  }
  const r = Math.random();
  if (r < 0.50) {
    out.weights = mutateWeights(g.weights, rate);
  } else if (r < 0.90) {
    const mf = mutateFleet(g.fleet);
    out.fleet = fleetIsValid(mf) ? mf : g.fleet.slice();
  } else {
    out.weights = mutateWeights(g.weights, rate);
    const mf = mutateFleet(g.fleet);
    out.fleet = fleetIsValid(mf) ? mf : g.fleet.slice();
  }
  return out;
}

function randomFleet() {
  const fleet = [];
  let guard = 0;
  while (fleet.length < MAP.budget.maxShips && guard++ < 40) {
    const t = UNIT_KEYS[Math.floor(Math.random() * UNIT_KEYS.length)];
    const d = UNIT_TYPES[t].displacement;
    if (fleetDisplacement(fleet) + d > MAP.budget.maxDisplacement) continue;
    fleet.push(t);
    if (Math.random() < 0.30) break;
  }
  if (fleet.length === 0) fleet.push("FF");
  return fleet;
}

const SAVE_VERSION = 5;