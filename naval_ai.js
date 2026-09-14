/**
 * 海戦指揮 AIラボ
 *
 * v7 変更点:
 *   - CA（重巡洋艦）追加: 集中砲火スキル
 *   - CVL（軽空母）追加: 航空2隊（小型）
 *   - 観戦モード: 敵艦隊をJSONからインポート可能に
 */

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
const DIRS8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const AIR_RANGE = 6;
const AIR_AA_RADIUS = 3;
const SELF_BUFF_TYPES = new Set(["evade", "dive", "aaBarrage"]);

// ============== ユニット諸元（v7） ==============
function makeSquadrons() {
  return [
    { type:"fighter",  label:"戦闘機隊", hp:30, maxHp:30, attackPower:20 },
    { type:"attacker", label:"攻撃機隊", hp:25, maxHp:25, attackPower:50 },
    { type:"bomber",   label:"爆撃機隊", hp:15, maxHp:15, attackPower:75 }
  ];
}
function makeSquadronsLight() {
  return [
    { type:"fighter",  label:"戦闘機隊", hp:25, maxHp:25, attackPower:20 },
    { type:"attacker", label:"攻撃機隊", hp:20, maxHp:20, attackPower:45 }
  ];
}
function makeSquadronsFor(type) {
  if (type === "CV") return makeSquadrons();
  if (type === "CVL") return makeSquadronsLight();
  return null;
}

const UNIT_TYPES = {
  BB: {
    name:"戦艦", hp:130, move:3, gunRange:5, gunPower:40, defense:10, evasion:3, vision:3,
    aa:4, asw:0, displacement:14000,
    ability:{ type:"salvo", range:5, centerPower:50, splashPower:22, uses:2, label:"大口径砲" }
  },
  CV: {
    name:"空母", hp:110, move:3, gunRange:2, gunPower:8, defense:5, evasion:5, vision:5,
    aa:6, asw:5, displacement:18000
  },
  CVL: {
    name:"軽空母", hp:80, move:3, gunRange:2, gunPower:6, defense:4, evasion:6, vision:6,
    aa:5, asw:3, displacement:11000
  },
  CA: {
    name:"重巡洋艦", hp:110, move:4, gunRange:4, gunPower:28, defense:8, evasion:10, vision:4,
    aa:8, asw:8, displacement:11000,
    torpedo:{ range:3, power:40, uses:2 },
    ability:{ type:"focusedFire", range:5, power:50, uses:2, label:"集中砲火" }
  },
  CL: {
    name:"軽巡洋艦", hp:85, move:5, gunRange:4, gunPower:18, defense:5, evasion:14, vision:4,
    aa:10, asw:14, displacement:8000,
    torpedo:{ range:3, power:30, uses:2 },
    ability:{ type:"aaBarrage", radius:2, boost:12, uses:2, label:"対空射撃" }
  },
  DD: {
    name:"駆逐艦", hp:70, move:5, gunRange:3, gunPower:12, defense:3, evasion:12, vision:4,
    aa:6, asw:18, displacement:6000,
    torpedo:{ range:3, power:36, uses:2 },
    ability:{ type:"evade", boost:15, uses:2, label:"煙幕展開" }
  },
  FF: {
    name:"フリゲート", hp:55, move:6, gunRange:3, gunPower:12, defense:2, evasion:22, vision:5,
    aa:6, asw:18, displacement:3000,
    torpedo:{ range:2, power:20, uses:2 },
    ability:{ type:"aswStrike", range:3, power:45, uses:2, label:"対潜爆雷" }
  },
  SS: {
    name:"潜水艦", hp:55, move:4, gunRange:1, gunPower:3, defense:4, evasion:10, vision:4,
    aa:0, asw:0, displacement:4000,
    torpedo:{ range:3, power:65, uses:3 },
    ability:{ type:"dive", boost:25, uses:2, label:"潜航" }
  }
};
const UNIT_KEYS = Object.keys(UNIT_TYPES);

const ICONS = {
  BB: `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="20" rx="15" ry="6" fill="var(--unit-color)"/><rect x="16" y="13" width="8" height="5" fill="var(--panel-2)"/><rect x="9" y="17" width="4" height="6" fill="var(--panel-2)"/><rect x="27" y="17" width="4" height="6" fill="var(--panel-2)"/></svg>`,
  CV: `<svg viewBox="0 0 40 40"><rect x="5" y="16" width="30" height="8" rx="3" fill="var(--unit-color)"/><rect x="23" y="9" width="6" height="8" fill="var(--panel-2)"/></svg>`,
  CVL: `<svg viewBox="0 0 40 40"><rect x="8" y="17" width="24" height="6" rx="2" fill="var(--unit-color)"/><rect x="24" y="12" width="5" height="6" fill="var(--panel-2)"/></svg>`,
  CA: `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="20" rx="15" ry="5" fill="var(--unit-color)"/><rect x="10" y="16" width="5" height="4" fill="var(--panel-2)"/><rect x="17" y="14" width="6" height="5" fill="var(--panel-2)"/><rect x="25" y="16" width="5" height="4" fill="var(--panel-2)"/></svg>`,
  CL: `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="21" rx="13" ry="5" fill="var(--unit-color)"/><rect x="14" y="15" width="6" height="4" fill="var(--panel-2)"/><rect x="22" y="17" width="3" height="5" fill="var(--panel-2)"/></svg>`,
  DD: `<svg viewBox="0 0 40 40"><polygon points="20,9 27,20 20,31 13,20" fill="var(--unit-color)"/></svg>`,
  FF: `<svg viewBox="0 0 40 40"><polygon points="20,12 24,20 20,28 16,20" fill="var(--unit-color)"/></svg>`,
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

// ============== 幾何・視界 ==============
function reachableTiles(units, unit) {
  const def = UNIT_TYPES[unit.type];
  const visited = new Map();
  visited.set(`${unit.r},${unit.c}`, 0);
  const queue = [{ r: unit.r, c: unit.c }];
  const result = new Set();
  while (queue.length) {
    const cur = queue.shift();
    const curDist = visited.get(`${cur.r},${cur.c}`);
    if (curDist >= def.move) continue;
    for (const [dr, dc] of DIRS8) {
      const nr = cur.r + dr, nc = cur.c + dc;
      if (!inBounds(nr, nc) || isLand(nr, nc)) continue;
      if (unitAt(units, nr, nc)) continue;
      const k = `${nr},${nc}`;
      if (visited.has(k)) continue;
      visited.set(k, curDist + 1);
      result.add(k);
      queue.push({ r: nr, c: nc });
    }
  }
  return result;
}

function computeVisibility(units, side) {
  const set = new Set();
  units.filter(u => u.side === side && u.hp > 0).forEach(u => {
    const vis = UNIT_TYPES[u.type].vision;
    for (let r = 0; r < MAP.rows; r++) {
      for (let c = 0; c < MAP.cols; c++) {
        if (chebyshev(u.r, u.c, r, c) <= vis) set.add(`${r},${c}`);
      }
    }
  });
  return set;
}

// ============== 対空防御 ==============
function computeAirDefense(units, side, r, c) {
  let total = 0;
  units.filter(u => u.side === side && u.hp > 0).forEach(u => {
    const dist = chebyshev(u.r, u.c, r, c);
    if (dist > AIR_AA_RADIUS) return;
    const falloff = 1 - dist * 0.2;
    total += (UNIT_TYPES[u.type].aa || 0) * falloff;
    if (u.squadrons) {
      u.squadrons.forEach(s => {
        if (s.type === "fighter" && s.hp > 0) total += (s.hp / 5) * falloff;
      });
    }
    if (u.aaBuff && u.aaBuff > 0) total += u.aaBuff * falloff;
  });
  return Math.round(total);
}

// ============== 戦闘解決 ==============
function computeDamage(power, maxRange, dist, targetDef, effectiveEvasion, ignoreDefense) {
  const rangeFactor = 1 - ((dist - 1) / Math.max(1, maxRange - 1)) * 0.4;
  const raw = power * rangeFactor;
  const afterEvasion = raw * (1 - effectiveEvasion / 100);
  const defense = ignoreDefense ? 0 : targetDef;
  return Math.max(1, Math.round(afterEvasion - defense));
}

function resolveAttack(attacker, target, weapon, attackerLabel, targetLabel, logFn, units) {
  const def = UNIT_TYPES[attacker.type];
  const tDef = UNIT_TYPES[target.type];
  const dist = chebyshev(attacker.r, attacker.c, target.r, target.c);
  let power, maxRange, label, ignoreDefense = false, isAir = false, sq = null;

  if (weapon.startsWith("air-")) {
    isAir = true;
    const sqType = weapon.substring(4);
    sq = attacker.squadrons ? attacker.squadrons.find(s => s.type === sqType && s.hp > 0) : null;
    if (!sq) return { hit:false };
    power = sq.attackPower * (sq.hp / sq.maxHp);
    maxRange = AIR_RANGE;
    label = `${sq.label}による航空攻撃`;
    ignoreDefense = true;
  } else if (weapon === "torpedo") {
    power = def.torpedo.power; maxRange = def.torpedo.range; label = "魚雷";
    attacker.torpedoUses--;
  } else if (weapon === "asw") {
    power = def.ability.power; maxRange = def.ability.range; label = def.ability.label;
    ignoreDefense = true;
    attacker.abilityUses--;
  } else if (weapon === "focused") {
    power = def.ability.power; maxRange = def.ability.range; label = def.ability.label;
    ignoreDefense = false;
    attacker.abilityUses--;
  } else {
    power = def.gunPower; maxRange = def.gunRange; label = "砲撃";
  }

  const effectiveEvasion = tDef.evasion + (target.evasionBuff || 0);
  let dmg = computeDamage(power, maxRange, dist, tDef.defense, effectiveEvasion, ignoreDefense);

  // 潜水艦への減衰 / 対潜ボーナス
  if (target.type === "SS" && weapon !== "asw") {
    const asw = def.asw || 0;
    if (asw === 0) dmg = Math.max(1, Math.floor(dmg * 0.4));
    else dmg = Math.max(1, Math.round(dmg * (1 + asw * 0.03)));
  }

  let airDef = 0;
  if (isAir) {
    airDef = computeAirDefense(units, target.side, target.r, target.c);
    dmg = Math.max(1, dmg - airDef);
  }

  target.hp = Math.max(0, target.hp - dmg);

  if (isAir && sq) {
    const aaFire = Math.max(0, Math.round(airDef * 0.6));
    if (aaFire > 0) {
      sq.hp = Math.max(0, sq.hp - aaFire);
      if (logFn) logFn(`対空砲火と戦闘機隊の反撃！${sq.label}に${aaFire}の損害。${sq.hp <= 0 ? "（撃墜）" : ""}`);
    }
  }

  if (logFn) logFn(`${attackerLabel}の${label}が${targetLabel}に命中、${dmg}ダメージ！${target.hp <= 0 ? "（撃沈）" : ""}`);
  return { hit:true, dmg, sunk: target.hp <= 0 };
}

// 大口径砲（3×3範囲攻撃）
function resolveSalvo(attacker, centerR, centerC, units, logFn) {
  const def = UNIT_TYPES[attacker.type];
  const ab = def.ability;
  const attackerLabel = unitLabel(attacker, "pvai");
  const results = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = centerR + dr, c = centerC + dc;
      if (!inBounds(r, c)) continue;
      const target = unitAt(units, r, c);
      if (!target || target.side === attacker.side) continue;
      const dist = chebyshev(attacker.r, attacker.c, r, c);
      if (dist > ab.range) continue;
      const isCenter = (dr === 0 && dc === 0);
      const basePower = isCenter ? ab.centerPower : ab.splashPower;
      const rangeFactor = 1 - ((dist - 1) / Math.max(1, ab.range - 1)) * 0.4;
      const power = basePower * rangeFactor;
      const tDef = UNIT_TYPES[target.type];
      const effEvasion = tDef.evasion + (target.evasionBuff || 0);
      let dmg = Math.max(1, Math.round(power * (1 - effEvasion / 100) - tDef.defense));
      if (target.type === "SS") {
        const asw = def.asw || 0;
        dmg = asw === 0 ? Math.max(1, Math.floor(dmg * 0.4)) : Math.max(1, Math.round(dmg * (1 + asw * 0.03)));
      }
      target.hp = Math.max(0, target.hp - dmg);
      results.push({ target, dmg, isCenter });
      if (logFn) logFn(`${attackerLabel}の大口径砲が${unitLabel(target, "pvai")}に命中、${dmg}ダメージ！${target.hp <= 0 ? "（撃沈）" : ""}`);
    }
  }
  attacker.abilityUses--;
  return results;
}

function estimateDamage(attackerType, targetType, dist, range, power, weapon, targetEvasionBuff) {
  const tDef = UNIT_TYPES[targetType];
  const effectiveEvasion = tDef.evasion + (targetEvasionBuff || 0);
  const isAir = weapon.startsWith("air-");
  let dmg = computeDamage(power, range, dist, tDef.defense, effectiveEvasion, isAir || weapon === "asw");
  if (targetType === "SS" && weapon !== "asw") {
    const asw = UNIT_TYPES[attackerType].asw || 0;
    if (asw === 0) dmg = Math.max(1, Math.floor(dmg * 0.4));
    else dmg = Math.max(1, Math.round(dmg * (1 + asw * 0.03)));
  }
  return dmg;
}

// ============== 攻撃候補の選択 ==============
function pickBestAttack(unit, oppVisible, weights) {
  const def = UNIT_TYPES[unit.type];
  let best = null;

  const consider = (weapon, range, power) => {
    if (range == null || range <= 0) return;
    oppVisible.forEach(t => {
      const dist = chebyshev(unit.r, unit.c, t.r, t.c);
      if (dist > range) return;
      const tDef = UNIT_TYPES[t.type];
      const hpFrac = t.hp / tDef.hp;
      const estDmg = estimateDamage(unit.type, t.type, dist, range, power, weapon, t.evasionBuff);
      let score = estDmg * 0.04
                + weights.preferLowHp * (1 - hpFrac)
                + weights.preferFlagship * (t.flagship ? 1 : 0)
                + weights.preferHighValue * (tDef.gunPower / 40)
                - dist * 0.05;
      if (weapon === "torpedo") score += weights.torpedoBias;
      if (weapon.startsWith("air-")) score *= weights.airPriority;
      if (t.type === "SS" && (def.asw || 0) === 0) score *= 0.35;
      if (!best || score > best.score) best = { target: t, weapon, score };
    });
  };

  consider("gun", def.gunRange, def.gunPower);
  if (def.torpedo && unit.torpedoUses > 0) consider("torpedo", def.torpedo.range, def.torpedo.power);

  // 大口径砲
  if (def.ability && def.ability.type === "salvo" && unit.abilityUses > 0) {
    oppVisible.forEach(t => {
      const dist = chebyshev(unit.r, unit.c, t.r, t.c);
      if (dist > def.ability.range) return;
      let enemiesInArea = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (oppVisible.find(o => o.r === t.r + dr && o.c === t.c + dc)) enemiesInArea++;
        }
      }
      if (enemiesInArea < 2) return;
      const estDmg = estimateDamage(unit.type, t.type, dist, def.ability.range, def.ability.centerPower, "gun", t.evasionBuff);
      const tDef = UNIT_TYPES[t.type];
      const hpFrac = t.hp / tDef.hp;
      const score = estDmg * 0.04
                  + weights.preferLowHp * (1 - hpFrac)
                  + weights.preferFlagship * (t.flagship ? 1 : 0)
                  + enemiesInArea * 0.5
                  - dist * 0.05;
      if (!best || score > best.score) best = { target: t, weapon: "salvo", score };
    });
  }

  // 集中砲火（CA）
  if (def.ability && def.ability.type === "focusedFire" && unit.abilityUses > 0) {
    oppVisible.forEach(t => {
      const dist = chebyshev(unit.r, unit.c, t.r, t.c);
      if (dist > def.ability.range) return;
      const tDef = UNIT_TYPES[t.type];
      const hpFrac = t.hp / tDef.hp;
      const estDmg = estimateDamage(unit.type, t.type, dist, def.ability.range, def.ability.power, "gun", t.evasionBuff);
      const score = estDmg * 0.05
                  + weights.preferLowHp * (1 - hpFrac)
                  + weights.preferFlagship * (t.flagship ? 1 : 0)
                  + weights.preferHighValue * (tDef.gunPower / 40)
                  - dist * 0.05;
      if (!best || score > best.score) best = { target: t, weapon: "focused", score };
    });
  }

  // 対潜爆雷（FF）
  if (def.ability && def.ability.type === "aswStrike" && unit.abilityUses > 0) {
    oppVisible.forEach(t => {
      if (t.type !== "SS") return;
      const dist = chebyshev(unit.r, unit.c, t.r, t.c);
      if (dist > def.ability.range) return;
      const tDef = UNIT_TYPES[t.type];
      const hpFrac = t.hp / tDef.hp;
      const estDmg = computeDamage(def.ability.power, def.ability.range, dist, tDef.defense, tDef.evasion, true);
      const score = estDmg * 0.08
                  + weights.preferLowHp * (1 - hpFrac)
                  + weights.preferFlagship * (t.flagship ? 1 : 0)
                  - dist * 0.05;
      if (!best || score > best.score) best = { target: t, weapon: "asw", score };
    });
  }

  // 航空攻撃
  if (unit.squadrons) {
    unit.squadrons.forEach(sq => {
      if (sq.hp <= 0) return;
      const power = sq.attackPower * (sq.hp / sq.maxHp);
      consider("air-" + sq.type, AIR_RANGE, power);
    });
  }

  return best;
}

// ============== AI 意思決定 ==============
function aiActUnit(units, unit, side, weights, visibleSet, mode, observerVisible, logFn) {
  if (unit.hp <= 0) return;
  const def = UNIT_TYPES[unit.type];
  const oppSide = side === "A" ? "B" : "A";
  const hidden = mode === "pvai" && !!observerVisible;
  const wasObserverVisible = hidden ? observerVisible.has(`${unit.r},${unit.c}`) : true;

  const oppVisible = units.filter(u => u.side === oppSide && u.hp > 0 && visibleSet.has(`${u.r},${u.c}`));
  const hpFrac = unit.hp / def.hp;
  const wantsRetreat = hpFrac < weights.retreatThreshold;

  let goal;
  if (oppVisible.length) {
    goal = oppVisible.slice().sort((a, b) => {
      const da = chebyshev(unit.r, unit.c, a.r, a.c) - chebyshev(unit.r, unit.c, b.r, b.c);
      if (da !== 0) return da;
      return (a.id < b.id ? -1 : 1);
    })[0];
  } else {
    goal = side === "A" ? { r: Math.floor(MAP.rows / 2), c: MAP.cols - 1 } : { r: Math.floor(MAP.rows / 2), c: 0 };
  }

  const reachable = reachableTiles(units, unit);
  const candidates = [{ r: unit.r, c: unit.c }].concat(Array.from(reachable).map(k => {
    const [r, c] = k.split(",").map(Number); return { r, c };
  }));

  let bestTile = { r: unit.r, c: unit.c }, bestScore = -Infinity;
  candidates.forEach(t => {
    const d = chebyshev(t.r, t.c, goal.r, goal.c);
    let score = -d * weights.aggression;
    if (wantsRetreat) score += d * weights.retreatWeight;
    if (score > bestScore || (score === bestScore && (t.r < bestTile.r || (t.r === bestTile.r && t.c < bestTile.c)))) {
      bestScore = score; bestTile = t;
    }
  });

  const moved = (bestTile.r !== unit.r || bestTile.c !== unit.c);
  if (moved) {
    const destObserverVisible = hidden ? observerVisible.has(`${bestTile.r},${bestTile.c}`) : true;
    if (logFn && (!hidden || wasObserverVisible || destObserverVisible)) {
      const label = (hidden && !wasObserverVisible && !destObserverVisible) ? "正体不明の艦" : unitLabel(unit, mode);
      logFn(`${label}が(${bestTile.r + 1},${bestTile.c + 1})付近へ移動した。`);
    }
    unit.r = bestTile.r; unit.c = bestTile.c;
  }
  unit.hasMoved = true;

  const oppVisibleNow = units.filter(u => u.side === oppSide && u.hp > 0 && visibleSet.has(`${u.r},${u.c}`));
  const atk = pickBestAttack(unit, oppVisibleNow, weights);

  const lowHp = unit.hp / def.hp < 0.5;
  const evadeLike = def.ability && (def.ability.type === "evade" || def.ability.type === "dive");
  const wantsEvade = evadeLike && lowHp && unit.abilityUses > 0 && oppVisibleNow.length > 0;

  const atkObserverVisible = hidden ? observerVisible.has(`${unit.r},${unit.c}`) : true;
  const actorLabel = (hidden && !atkObserverVisible) ? "正体不明の敵" : unitLabel(unit, mode);

  if (atk && !wantsEvade) {
    if (atk.weapon === "salvo") {
      const res = resolveSalvo(unit, atk.target.r, atk.target.c, units, logFn);
      unit.hasActed = true;
      return res;
    } else {
      const targetLabel = unitLabel(atk.target, mode);
      resolveAttack(unit, atk.target, atk.weapon, actorLabel, targetLabel, logFn, units);
      unit.hasActed = true;
      return;
    }
  }

  if (wantsEvade) {
    unit.evasionBuff = (unit.evasionBuff || 0) + def.ability.boost;
    unit.abilityUses--;
    unit.hasActed = true;
    if (logFn && (!hidden || atkObserverVisible)) logFn(`${unitLabel(unit, mode)}が${def.ability.label}を展開、回避力が上昇した。`);
    return;
  }

  if (def.ability && def.ability.type === "aaBarrage" && unit.abilityUses > 0) {
    if (oppVisibleNow.some(t => t.squadrons && t.squadrons.some(s => s.hp > 0))) {
      unit.aaBuff = (unit.aaBuff || 0) + def.ability.boost;
      unit.abilityUses--;
      unit.hasActed = true;
      if (logFn && (!hidden || wasObserverVisible)) logFn(`${unitLabel(unit, mode)}が${def.ability.label}を展開、周辺の対空火力が上昇した。`);
      return;
    }
  }

  unit.hasActed = true;
}

function runAISidePhase(battle, side, weights, observerSide) {
  const units = battle.units;
  units.forEach(u => {
    if (u.side === side) { u.hasMoved = false; u.hasActed = false; u.evasionBuff = 0; u.aaBuff = 0; }
  });
  const visible = computeVisibility(units, side);
  const observerVisible = observerSide ? computeVisibility(units, observerSide) : null;
  const logFn = battle.log || null;
  units.filter(u => u.side === side && u.hp > 0).forEach(unit => {
    aiActUnit(units, unit, side, weights, visible, battle.mode, observerVisible, logFn);
  });
}

function checkOutcome(battle) {
  const aAlive = battle.units.filter(u => u.side === "A" && u.hp > 0).length;
  const bAlive = battle.units.filter(u => u.side === "B" && u.hp > 0).length;
  if (aAlive === 0 && bAlive === 0) return { done:true, winner:null };
  if (aAlive === 0) return { done:true, winner:"B" };
  if (bAlive === 0) return { done:true, winner:"A" };
  if (battle.turn > MAP.turnLimit) {
    const aHp = battle.units.filter(u => u.side === "A").reduce((s, u) => s + u.hp, 0);
    const bHp = battle.units.filter(u => u.side === "B").reduce((s, u) => s + u.hp, 0);
    if (aHp === bHp) return { done:true, winner:null };
    return { done:true, winner: aHp > bHp ? "A" : "B" };
  }
  return null;
}

// ============== 編成配備 ==============
function formationPositions(side, count, randomize) {
  let rows;
  if (count === 1) rows = [4];
  else if (count === 2) rows = [3, 5];
  else if (count === 3) rows = [2, 4, 6];
  else if (count === 4) rows = [1, 3, 5, 7];
  else if (count === 5) rows = [1, 3, 5, 6, 7];
  else rows = [1, 2, 3, 5, 6, 7];
  const positions = [];
  for (let i = 0; i < count; i++) {
    const r = rows[i];
    let c;
    if (side === "A") {
      c = randomize ? (Math.random() < 0.5 ? 0 : 1) : (i % 2 === 0 ? 0 : 1);
    } else {
      c = randomize ? (Math.random() < 0.5 ? MAP.cols - 1 : MAP.cols - 2) : (i % 2 === 0 ? MAP.cols - 1 : MAP.cols - 2);
    }
    positions.push([r, c]);
  }
  return positions;
}

function deployFleet(units, side, seq, fleet, opts) {
  const randomize = !!(opts && opts.randomize);
  const positions = formationPositions(side, fleet.length, randomize);
  fleet.forEach((t, i) => {
    const def = UNIT_TYPES[t];
    const [r, c] = positions[i];
    units.push({
      id: `${side}-${seq.n++}`, side, type: t, r, c,
      hp: def.hp, maxHp: def.hp, flagship: i === 0,
      hasMoved:false, hasActed:false, evasionBuff:0, aaBuff:0,
      torpedoUses: def.torpedo ? def.torpedo.uses : 0,
      abilityUses: def.ability ? def.ability.uses : 0,
      squadrons: makeSquadronsFor(t)
    });
  });
}

// ============== 高速シミュレーション ==============
function simulateMatch(genomeA, genomeB, opts) {
  const randomize = !opts || opts.randomize !== false;
  const seq = { n: 0 };
  const units = [];
  deployFleet(units, "A", seq, genomeA.fleet, { randomize });
  deployFleet(units, "B", seq, genomeB.fleet, { randomize });
  const battle = { units, turn: 1, mode: "sim", log: null };
  let guard = 0;
  while (guard < 400) {
    guard++;
    runAISidePhase(battle, "A", genomeA.weights, null);
    let oc = checkOutcome(battle);
    if (oc) return { winner: oc.winner, turns: battle.turn };
    runAISidePhase(battle, "B", genomeB.weights, null);
    oc = checkOutcome(battle);
    if (oc) return { winner: oc.winner, turns: battle.turn };
    battle.turn++;
    oc = checkOutcome(battle);
    if (oc) return { winner: oc.winner, turns: battle.turn };
  }
  return { winner: null, turns: battle.turn };
}

// ============== アプリ本体 ==============
const SAVE_VERSION = 3;

class NavalApp {
  constructor() {
    this.screen = "modeSelect";
    this.champion = { weights: cloneWeights(DEFAULT_WEIGHTS), fleet: DEFAULT_FLEET.slice() };
    this.baseline = { weights: cloneWeights(DEFAULT_WEIGHTS), fleet: DEFAULT_FLEET.slice() };
    this.hasTrained = false;
    this.trainingHistory = [];
    this.trainingLog = [];
    this.fleetHistory = [];
    this.isTraining = false;
    this.stopRequested = false;
    this.trainingMode = "both";
    this.spectatePlaying = false;
    this.spectateSpeed = 700;
    this.spectateState = null;
    this.spectateEnemyFleet = null;  // インポートされた敵艦隊
    this.render();
  }

  pushLog(msg) {
    if (!this.battle) return;
    this.battle.logLines.push(msg);
    if (this.battle.logLines.length > 300) this.battle.logLines.shift();
  }

  goModeSelect() {
    this.stopSpectateAuto();
    this.isTraining = false;
    this.screen = "modeSelect";
    this.render();
  }

  resetChampion() {
    if (this.isTraining) return;
    this.champion = { weights: cloneWeights(DEFAULT_WEIGHTS), fleet: DEFAULT_FLEET.slice() };
    this.hasTrained = false;
    this.trainingHistory = [];
    this.trainingLog = [];
    this.fleetHistory = [];
    this.toast("学習済みAIをリセットしました", "info");
    this.render();
  }

  exportSave() {
    if (this.isTraining) return;
    const data = {
      version: SAVE_VERSION,
      exportedAt: new Date().toISOString(),
      champion: this.champion,
      baseline: this.baseline,
      hasTrained: this.hasTrained,
      trainingHistory: this.trainingHistory,
      fleetHistory: this.fleetHistory,
      trainingLog: this.trainingLog.slice(-200),
      trainingMode: this.trainingMode
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `naval_ai_save_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.toast("セーブデータをエクスポートしました", "success");
  }

  handleImportFile(input) {
    if (this.isTraining) return;
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || !data.champion || !data.champion.fleet || !data.champion.weights) {
          throw new Error("フォーマットが不正です");
        }
        if (!fleetIsValid(data.champion.fleet)) {
          throw new Error("編成が現在のルールで無効です");
        }
        this.champion = cloneGenome(data.champion);
        if (data.baseline && fleetIsValid(data.baseline.fleet)) {
          this.baseline = cloneGenome(data.baseline);
        }
        this.hasTrained = !!data.hasTrained;
        this.trainingHistory = Array.isArray(data.trainingHistory) ? data.trainingHistory : [];
        this.fleetHistory = Array.isArray(data.fleetHistory) ? data.fleetHistory : [];
        this.trainingLog = Array.isArray(data.trainingLog) ? data.trainingLog : [];
        if (data.trainingMode) this.trainingMode = data.trainingMode;
        this.toast("セーブデータをロードしました", "success");
        this.render();
      } catch (err) {
        this.toast("読み込み失敗: " + err.message, "danger");
      } finally {
        input.value = "";
      }
    };
    reader.readAsText(file);
  }

  // ---------- 観戦用: 敵艦隊インポート ----------
  importSpectateEnemy(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        let fleet = null;
        if (Array.isArray(data)) {
          fleet = data;
        } else if (data && data.champion && Array.isArray(data.champion.fleet)) {
          fleet = data.champion.fleet;
        } else if (data && Array.isArray(data.fleet)) {
          fleet = data.fleet;
        }
        if (!fleet || fleet.length === 0) {
          throw new Error("有効な艦隊データが見つかりません");
        }
        if (!fleet.every(t => UNIT_TYPES[t])) {
          throw new Error("未知の艦種が含まれています");
        }
        if (!fleetIsValid(fleet)) {
          throw new Error("編成が現在のルールで無効です（予算超過など）");
        }
        this.spectateEnemyFleet = fleet.slice();
        this.toast(`敵艦隊を設定: ${fleetDisplayString(fleet)}`, "success");
        // 観戦中なら再起動
        if (this.screen === "battle" && this.battle && this.battle.mode === "spectate") {
          this.startSpectate();
        } else {
          this.render();
        }
      } catch (err) {
        this.toast("読み込み失敗: " + err.message, "danger");
      } finally {
        input.value = "";
      }
    };
    reader.readAsText(file);
  }

  clearSpectateEnemy() {
    this.spectateEnemyFleet = null;
    this.toast("敵艦隊を初期AIに戻しました", "info");
    if (this.screen === "battle" && this.battle && this.battle.mode === "spectate") {
      this.startSpectate();
    } else {
      this.render();
    }
  }

  // ---------- プレイヤー対AI ----------
  startPvAIDeploy() {
    this.deployUnits = [];
    this.pendingType = null;
    this.screen = "pvaiDeploy";
    this.render();
  }
  deployedShipsCount() { return this.deployUnits.length; }
  deployedDisplacement() { return this.deployUnits.reduce((s, u) => s + UNIT_TYPES[u.type].displacement, 0); }
  selectPendingType(t) { this.pendingType = t; this.render(); }
  onDeployTileClick(r, c) {
    const existing = this.deployUnits.find(u => u.r === r && u.c === c);
    if (existing) { this.deployUnits = this.deployUnits.filter(u => u !== existing); this.render(); return; }
    if (!this.pendingType) return this.toast("配備する艦種を選択してください", "info");
    if (!zoneOf("A", r, c)) return this.toast("配備範囲外です", "danger");
    if (isLand(r, c)) return this.toast("陸地には配備できません", "danger");
    const def = UNIT_TYPES[this.pendingType];
    if (this.deployedShipsCount() + 1 > MAP.budget.maxShips) return this.toast("艦艇数の上限です", "danger");
    if (this.deployedDisplacement() + def.displacement > MAP.budget.maxDisplacement) return this.toast("排水量の上限です", "danger");
    this.deployUnits.push({ type: this.pendingType, r, c });
    this.render();
  }
  applyDeployPreset(fleet) {
    this.deployUnits = [];
    const positions = formationPositions("A", fleet.length, false);
    fleet.forEach((t, i) => {
      const [r, c] = positions[i];
      this.deployUnits.push({ type: t, r, c });
    });
    this.render();
  }
  clearDeploy() { this.deployUnits = []; this.render(); }

  startPvAIBattle() {
    if (this.deployUnits.length === 0) return this.toast("最低1隻は配備してください", "danger");
    const seq = { n: 0 };
    const units = [];
    this.deployUnits.forEach((p, i) => {
      const def = UNIT_TYPES[p.type];
      units.push({
        id: `A-${seq.n++}`, side:"A", type:p.type, r:p.r, c:p.c,
        hp:def.hp, maxHp:def.hp, flagship:i === 0, hasMoved:false, hasActed:false, evasionBuff:0, aaBuff:0,
        torpedoUses: def.torpedo ? def.torpedo.uses : 0,
        abilityUses: def.ability ? def.ability.uses : 0,
        squadrons: makeSquadronsFor(p.type)
      });
    });
    deployFleet(units, "B", seq, this.champion.fleet, { randomize: false });
    this.battle = { units, turn:1, mode:"pvai", logLines:[], selectedUnitId:null, uiMode:"idle", highlight:new Set(), tempRevealed:new Set() };
    this.battle.log = (msg) => this.pushLog(msg);
    this.screen = "battle";
    this.startSideATurn();
  }

  startSideATurn() {
    this.battle.units.forEach(u => { if (u.side === "A") { u.hasMoved = false; u.hasActed = false; u.evasionBuff = 0; u.aaBuff = 0; } });
    this.battle.tempRevealed = new Set();
    this.battle.baseVisible = computeVisibility(this.battle.units, "A");
    this.pushLog(`--- ターン${this.battle.turn} 作戦開始 ---`);
    this.render();
  }

  endSideATurn() {
    runAISidePhase(this.battle, "B", this.champion.weights, "A");
    if (this.battle.selectedUnitId && !this.selectedUnit()) {
      this.battle.selectedUnitId = null;
      this.battle.uiMode = "idle";
      this.battle.highlight = new Set();
    }
    let oc = checkOutcome(this.battle);
    if (oc) { this.finishBattle(oc); return; }
    this.battle.turn++;
    oc = checkOutcome(this.battle);
    if (oc) { this.finishBattle(oc); return; }
    this.startSideATurn();
  }

  finishBattle(oc) {
    this.stopSpectateAuto();
    this.resultOutcome = oc;
    this.screen = "result";
    this.render();
  }

  // ---------- プレイヤー操作 ----------
  selectUnit(id) { this.battle.selectedUnitId = id; this.battle.uiMode = "idle"; this.battle.highlight = new Set(); this.render(); }
  selectedUnit() {
    const u = this.battle.units.find(u => u.id === this.battle.selectedUnitId);
    return (u && u.hp > 0) ? u : null;
  }
  isVisibleTile(r, c) { const k = `${r},${c}`; return this.battle.baseVisible.has(k) || this.battle.tempRevealed.has(k); }
  visibleUnitAt(r, c) {
    const u = unitAt(this.battle.units, r, c);
    if (!u) return null;
    return (u.side === "A" || this.isVisibleTile(r, c)) ? u : null;
  }

  onCellClick(r, c) {
    const key = `${r},${c}`;
    if (!this.battle.selectedUnitId) {
      const u = this.visibleUnitAt(r, c);
      if (u) this.toast(`${unitLabel(u, "pvai")}  HP:${u.hp}/${UNIT_TYPES[u.type].hp}`, "info");
      if (u && u.side === "A") this.selectUnit(u.id);
      return;
    }
    const unit = this.selectedUnit();
    if (!unit) { this.battle.selectedUnitId = null; this.battle.uiMode = "idle"; this.battle.highlight = new Set(); this.render(); return; }
    const mode = this.battle.uiMode;
    if (mode === "move") { if (this.battle.highlight.has(key)) this.moveUnit(unit, r, c); return; }
    if (mode === "gun") { if (this.battle.highlight.has(key)) { const t = unitAt(this.battle.units, r, c); if (t) this.executeAttack(unit, t, "gun"); } return; }
    if (mode === "torpedo") { if (this.battle.highlight.has(key)) { const t = unitAt(this.battle.units, r, c); if (t) this.executeAttack(unit, t, "torpedo"); } return; }
    if (mode.startsWith("squadron-")) {
      if (this.battle.highlight.has(key)) {
        const idx = parseInt(mode.substring(9));
        const t = unitAt(this.battle.units, r, c);
        if (t) this.executeSquadronAttack(unit, idx, t);
      }
      return;
    }
    if (mode === "ability") { if (this.battle.highlight.has(key)) this.executeAbility(unit, r, c); return; }
    const clicked = this.visibleUnitAt(r, c);
    if (clicked && clicked.side === "A") this.selectUnit(clicked.id);
  }

  enterMoveMode() {
    const u = this.selectedUnit(); if (!u || u.hasMoved) return;
    this.battle.uiMode = "move"; this.battle.highlight = reachableTiles(this.battle.units, u); this.render();
  }
  enterGunMode() {
    const u = this.selectedUnit(); if (!u || u.hasActed) return;
    const def = UNIT_TYPES[u.type];
    const set = new Set();
    this.battle.units.filter(e => e.side === "B" && e.hp > 0).forEach(e => {
      if (chebyshev(u.r, u.c, e.r, e.c) <= def.gunRange && this.isVisibleTile(e.r, e.c)) set.add(`${e.r},${e.c}`);
    });
    this.battle.uiMode = "gun"; this.battle.highlight = set;
    if (set.size === 0) this.toast("射程内に敵艦がいません", "danger");
    this.render();
  }
  enterTorpedoMode() {
    const u = this.selectedUnit(); if (!u || u.hasActed) return;
    const def = UNIT_TYPES[u.type]; if (!def.torpedo || u.torpedoUses <= 0) return;
    const set = new Set();
    this.battle.units.filter(e => e.side === "B" && e.hp > 0).forEach(e => {
      if (chebyshev(u.r, u.c, e.r, e.c) <= def.torpedo.range && this.isVisibleTile(e.r, e.c)) set.add(`${e.r},${e.c}`);
    });
    this.battle.uiMode = "torpedo"; this.battle.highlight = set;
    if (set.size === 0) this.toast("射程内に敵艦がいません", "danger");
    this.render();
  }
  enterSquadronMode(idx) {
    const u = this.selectedUnit(); if (!u || u.hasActed || !u.squadrons) return;
    const sq = u.squadrons[idx]; if (!sq || sq.hp <= 0) return;
    const set = new Set();
    this.battle.units.filter(e => e.side === "B" && e.hp > 0).forEach(e => {
      if (chebyshev(u.r, u.c, e.r, e.c) <= AIR_RANGE && this.isVisibleTile(e.r, e.c)) set.add(`${e.r},${e.c}`);
    });
    this.battle.uiMode = "squadron-" + idx; this.battle.highlight = set;
    if (set.size === 0) this.toast("射程内に敵艦がいません", "danger");
    this.render();
  }
  enterAbilityMode() {
    const u = this.selectedUnit(); if (!u || u.hasActed) return;
    const def = UNIT_TYPES[u.type]; if (!def.ability || u.abilityUses <= 0) return;
    const ab = def.ability;

    if (SELF_BUFF_TYPES.has(ab.type)) {
      this.executeAbility(u, u.r, u.c);
      return;
    }

    const set = new Set();
    if (ab.type === "salvo") {
      for (let r = 0; r < MAP.rows; r++) {
        for (let c = 0; c < MAP.cols; c++) {
          if (chebyshev(u.r, u.c, r, c) <= ab.range && !isLand(r, c)) set.add(`${r},${c}`);
        }
      }
    } else if (ab.type === "aswStrike") {
      this.battle.units.filter(e => e.side === "B" && e.hp > 0 && e.type === "SS").forEach(e => {
        if (chebyshev(u.r, u.c, e.r, e.c) <= ab.range && this.isVisibleTile(e.r, e.c)) set.add(`${e.r},${e.c}`);
      });
      if (set.size === 0) {
        this.toast("射程内に敵潜水艦がいません", "danger");
        return;
      }
    } else if (ab.type === "focusedFire") {
      this.battle.units.filter(e => e.side === "B" && e.hp > 0).forEach(e => {
        if (chebyshev(u.r, u.c, e.r, e.c) <= ab.range && this.isVisibleTile(e.r, e.c)) set.add(`${e.r},${e.c}`);
      });
      if (set.size === 0) {
        this.toast("射程内に敵艦がいません", "danger");
        return;
      }
    }
    this.battle.uiMode = "ability"; this.battle.highlight = set;
    if (set.size === 0) this.toast("発動可能な対象がありません", "danger");
    this.render();
  }
  cancelMode() { this.battle.uiMode = "idle"; this.battle.highlight = new Set(); this.render(); }
  waitUnit() {
    const u = this.selectedUnit(); if (!u) return;
    u.hasMoved = true; u.hasActed = true;
    this.battle.selectedUnitId = null; this.battle.uiMode = "idle"; this.battle.highlight = new Set();
    this.render();
  }
  moveUnit(unit, r, c) {
    unit.r = r; unit.c = c; unit.hasMoved = true;
    this.battle.baseVisible = computeVisibility(this.battle.units, "A");
    this.battle.uiMode = "idle"; this.battle.highlight = new Set();
    this.render();
  }
  executeAttack(unit, target, weapon) {
    const attackerLabel = unitLabel(unit, "pvai"), targetLabel = unitLabel(target, "pvai");
    resolveAttack(unit, target, weapon, attackerLabel, targetLabel, (m) => this.pushLog(m), this.battle.units);
    if (target.hp <= 0) this.toast(`${targetLabel}撃沈！`, "success");
    unit.hasActed = true;
    this.battle.uiMode = "idle"; this.battle.highlight = new Set();
    const oc = checkOutcome(this.battle);
    if (oc) { this.finishBattle(oc); return; }
    this.render();
  }
  executeSquadronAttack(cv, idx, target) {
    const sq = cv.squadrons[idx];
    if (!sq || sq.hp <= 0) return;
    const weapon = "air-" + sq.type;
    const targetLabel = unitLabel(target, "pvai");
    const beforeHp = sq.hp;
    resolveAttack(cv, target, weapon, unitLabel(cv, "pvai"), targetLabel, (m) => this.pushLog(m), this.battle.units);
    if (target.hp <= 0) this.toast(`${targetLabel}撃沈！`, "success");
    if (sq.hp <= 0 && beforeHp > 0) this.toast(`${sq.label}が撃墜された`, "danger");
    cv.hasActed = true;
    this.battle.uiMode = "idle"; this.battle.highlight = new Set();
    const oc = checkOutcome(this.battle);
    if (oc) { this.finishBattle(oc); return; }
    this.render();
  }
  executeAbility(unit, r, c) {
    const ab = UNIT_TYPES[unit.type].ability;
    if (ab.type === "salvo") {
      const results = resolveSalvo(unit, r, c, this.battle.units, (m) => this.pushLog(m));
      if (results.length === 0) { this.toast("範囲内に敵艦がいません", "danger"); return; }
      this.toast(`${ab.label}発動！ ${results.length}隻に命中`, "event");
      unit.hasActed = true;
      const oc = checkOutcome(this.battle);
      if (oc) { this.finishBattle(oc); return; }
    } else if (ab.type === "aswStrike") {
      const target = unitAt(this.battle.units, r, c);
      if (!target || target.side !== "B" || target.type !== "SS" || target.hp <= 0) return;
      resolveAttack(unit, target, "asw", unitLabel(unit, "pvai"), unitLabel(target, "pvai"), (m) => this.pushLog(m), this.battle.units);
      if (target.hp <= 0) this.toast(`${unitLabel(target, "pvai")}撃沈！`, "success");
      this.toast(`${ab.label}発動！`, "event");
      unit.hasActed = true;
      const oc = checkOutcome(this.battle);
      if (oc) { this.finishBattle(oc); return; }
    } else if (ab.type === "focusedFire") {
      const target = unitAt(this.battle.units, r, c);
      if (!target || target.side !== "B" || target.hp <= 0) return;
      resolveAttack(unit, target, "focused", unitLabel(unit, "pvai"), unitLabel(target, "pvai"), (m) => this.pushLog(m), this.battle.units);
      if (target.hp <= 0) this.toast(`${unitLabel(target, "pvai")}撃沈！`, "success");
      this.toast(`${ab.label}発動！`, "event");
      unit.hasActed = true;
      const oc = checkOutcome(this.battle);
      if (oc) { this.finishBattle(oc); return; }
    } else if (ab.type === "evade" || ab.type === "dive") {
      unit.evasionBuff = (unit.evasionBuff || 0) + ab.boost;
      this.pushLog(`${unitLabel(unit, "pvai")}が${ab.label}を展開、回避力が上昇した。`);
      this.toast(`${ab.label}発動！`, "event");
      unit.abilityUses--; unit.hasActed = true;
    } else if (ab.type === "aaBarrage") {
      unit.aaBuff = (unit.aaBuff || 0) + ab.boost;
      this.pushLog(`${unitLabel(unit, "pvai")}が${ab.label}を展開、周辺の対空火力が上昇した。`);
      this.toast(`${ab.label}発動！`, "event");
      unit.abilityUses--; unit.hasActed = true;
    }
    this.battle.uiMode = "idle"; this.battle.highlight = new Set();
    this.render();
  }

  // ---------- AI観戦モード ----------
  startSpectate() {
    const seq = { n: 0 };
    const units = [];
    const enemyFleet = this.spectateEnemyFleet || this.baseline.fleet;
    deployFleet(units, "A", seq, this.champion.fleet, { randomize: false });
    deployFleet(units, "B", seq, enemyFleet, { randomize: false });
    this.battle = { units, turn:1, mode:"spectate", logLines:[] };
    this.battle.log = (msg) => this.pushLog(msg);
    this.spectateState = null;
    this.spectatePlaying = false;
    const enemyLabel = this.spectateEnemyFleet ? "インポート敵艦隊" : "初期AI";
    this.pushLog(`--- 観戦開始：青軍(${this.hasTrained ? "学習済みAI" : "初期AI"}) vs 赤軍(${enemyLabel}) ---`);
    this.pushLog(`青軍編成: ${fleetDisplayString(this.champion.fleet)} ／ 赤軍編成: ${fleetDisplayString(enemyFleet)}`);
    this.screen = "battle";
    this.render();
  }

  spectateNextStep() {
    const b = this.battle;
    if (!b || b.mode !== "spectate" || this.screen !== "battle") return;
    if (!this.spectateState) {
      this.spectateState = { phase: "A-start", side: "A", unitQueue: [], unitIndex: 0, visible: null, weights: null };
    }
    const s = this.spectateState;

    if (s.phase === "turn-end") {
      const oc = checkOutcome(b);
      if (oc) { this.stopSpectateAuto(); this.finishBattle(oc); return; }
      b.turn++;
      const oc2 = checkOutcome(b);
      if (oc2) { this.stopSpectateAuto(); this.finishBattle(oc2); return; }
      s.phase = "A-start";
      return;
    }
    if (s.phase === "A-start") {
      b.units.forEach(u => { if (u.side === "A") { u.hasMoved = false; u.hasActed = false; u.evasionBuff = 0; u.aaBuff = 0; } });
      s.side = "A"; s.weights = this.champion.weights;
      s.visible = computeVisibility(b.units, "A");
      s.unitQueue = b.units.filter(u => u.side === "A" && u.hp > 0);
      s.unitIndex = 0; s.phase = "act";
      this.pushLog(`--- ターン${b.turn} 青軍の行動 ---`);
      return;
    }
    if (s.phase === "B-start") {
      b.units.forEach(u => { if (u.side === "B") { u.hasMoved = false; u.hasActed = false; u.evasionBuff = 0; u.aaBuff = 0; } });
      s.side = "B"; s.weights = this.baseline.weights;
      s.visible = computeVisibility(b.units, "B");
      s.unitQueue = b.units.filter(u => u.side === "B" && u.hp > 0);
      s.unitIndex = 0; s.phase = "act";
      this.pushLog(`--- ターン${b.turn} 赤軍の行動 ---`);
      return;
    }
    if (s.phase === "act") {
      if (s.unitIndex >= s.unitQueue.length) {
        const oc = checkOutcome(b);
        if (oc) { this.stopSpectateAuto(); this.finishBattle(oc); return; }
        if (s.side === "A") s.phase = "B-start"; else s.phase = "turn-end";
        return;
      }
      const unit = s.unitQueue[s.unitIndex++];
      if (unit.hp > 0) aiActUnit(b.units, unit, s.side, s.weights, s.visible, b.mode, null, b.log);
      s.visible = computeVisibility(b.units, s.side);
      return;
    }
  }

  spectateStepOnce() {
    if (this.screen !== "battle" || this.battle.mode !== "spectate") return;
    this.stopSpectateAuto();
    this.spectateNextStep();
    if (this.screen === "battle") this.render();
  }
  spectateAdvanceTurn() {
    if (this.screen !== "battle" || this.battle.mode !== "spectate") return;
    this.stopSpectateAuto();
    const startTurn = this.battle.turn;
    let guard = 0;
    while (guard++ < 300 && this.screen === "battle") {
      this.spectateNextStep();
      if (this.battle.turn !== startTurn) break;
    }
    if (this.screen === "battle") this.render();
  }
  toggleSpectateAuto() {
    if (this.spectatePlaying) { this.stopSpectateAuto(); this.render(); return; }
    this.spectatePlaying = true;
    this.spectateTimer = setInterval(() => {
      if (this.screen !== "battle" || this.battle.mode !== "spectate") { this.stopSpectateAuto(); return; }
      this.spectateNextStep();
      if (this.screen === "battle") this.render();
    }, this.spectateSpeed);
    this.render();
  }
  stopSpectateAuto() {
    this.spectatePlaying = false;
    if (this.spectateTimer) clearInterval(this.spectateTimer);
    this.spectateTimer = null;
  }
  setSpectateSpeed(v) {
    this.spectateSpeed = Number(v);
    if (this.spectatePlaying) { this.stopSpectateAuto(); this.toggleSpectateAuto(); }
  }
  spectateSkipToEnd() {
    if (this.screen !== "battle" || this.battle.mode !== "spectate") return;
    this.stopSpectateAuto();
    let guard = 0;
    while (guard++ < 800 && this.screen === "battle") this.spectateNextStep();
    if (this.screen === "battle") this.render();
  }

  // ---------- AI学習モード ----------
  startTrainingScreen() { this.screen = "training"; this.render(); }

  async runTraining() {
    if (this.isTraining) return;
    if (!fleetIsValid(this.champion.fleet)) {
      this.champion = { weights: cloneWeights(DEFAULT_WEIGHTS), fleet: DEFAULT_FLEET.slice() };
      this.hasTrained = false;
      this.trainingHistory = [];
      this.fleetHistory = [];
      this.trainingLog.push("※ 現在のチャンピオン編成が新ルールで無効なため、初期AIにリセットしました。");
    }

    const genInput = document.getElementById("genCount");
    const matchInput = document.getElementById("matchCount");
    const modeSelect = document.getElementById("trainingMode");
    const generations = clamp(parseInt(genInput.value) || 20, 1, 300);
    const matchesPerGen = clamp(parseInt(matchInput.value) || 20, 2, 200);
    const mode = modeSelect ? modeSelect.value : "both";
    this.trainingMode = mode;

    this.isTraining = true; this.stopRequested = false;
    this.trainingProgress = { gen: 0, total: generations };
    this.render();

    const modeLabel = mode === "fleet" ? "編成のみ" : mode === "weights" ? "行動のみ" : "行動＋編成";
    this.trainingLog.push(`--- 学習開始（対象: ${modeLabel} / 世代:${generations} / 1世代:${matchesPerGen}戦）---`);

    for (let g = 1; g <= generations; g++) {
      if (this.stopRequested) break;
      const challenger = mutateGenome(this.champion, 0.25, mode);
      const changedW = !weightsEqual(challenger.weights, this.champion.weights);
      const changedF = !fleetsEqual(challenger.fleet, this.champion.fleet);
      let typeLabel = "なし";
      if (changedW && changedF) typeLabel = "行動+編成";
      else if (changedW) typeLabel = "行動";
      else if (changedF) typeLabel = "編成";
      const prevFleet = this.champion.fleet.slice();

      let cWins = 0, cLosses = 0, cDraws = 0;
      for (let m = 0; m < matchesPerGen; m++) {
        const challengerSide = m % 2 === 0 ? "A" : "B";
        const res = challengerSide === "A"
          ? simulateMatch(challenger, this.champion)
          : simulateMatch(this.champion, challenger);
        if (res.winner === null) cDraws++;
        else if (res.winner === challengerSide) cWins++;
        else cLosses++;
      }
      const total = cWins + cLosses + cDraws;
      const challengerRate = total ? (cWins + cDraws * 0.5) / total : 0.5;
      const adopted = challengerRate > 0.5;
      if (adopted) this.champion = challenger;
      if (adopted && changedF) this.fleetHistory.push({ gen: g, fleet: this.champion.fleet.slice() });

      const testN = 6;
      let bWins = 0, bLosses = 0, bDraws = 0;
      for (let m = 0; m < testN; m++) {
        const champSide = m % 2 === 0 ? "A" : "B";
        const res = champSide === "A"
          ? simulateMatch(this.champion, this.baseline)
          : simulateMatch(this.baseline, this.champion);
        if (res.winner === null) bDraws++;
        else if (res.winner === champSide) bWins++;
        else bLosses++;
      }
      const baselineRate = (bWins + bDraws * 0.5) / testN;
      this.trainingHistory.push({ gen: g, rate: baselineRate });

      const adoptedStr = adopted ? "採用" : "維持";
      const prevStr = fleetDisplayString(prevFleet);
      const nowStr = fleetDisplayString(this.champion.fleet);
      const fleetDetail = (adopted && changedF) ? `${prevStr} → ${nowStr}` : prevStr;
      this.trainingLog.push(
        `世代${g}: [${typeLabel}] 挑戦者勝率${Math.round(challengerRate * 100)}% ${adoptedStr} ｜ 編成: ${fleetDetail} ｜ 初期AI比勝率 ${Math.round(baselineRate * 100)}%`
      );
      if (this.trainingLog.length > 200) this.trainingLog.shift();
      this.trainingProgress.gen = g;
      this.render();
      await new Promise(r => setTimeout(r, 0));
    }
    this.isTraining = false;
    this.hasTrained = true;
    this.render();
  }
  stopTraining() { this.stopRequested = true; }

  // ---------- 描画 ----------
  render() {
    const app = document.getElementById("app");
    if (this.screen === "modeSelect") app.innerHTML = this.modeSelectHTML();
    else if (this.screen === "pvaiDeploy") app.innerHTML = this.deployHTML();
    else if (this.screen === "battle") app.innerHTML = this.battleHTML();
    else if (this.screen === "training") app.innerHTML = this.trainingHTML();
    else if (this.screen === "result") app.innerHTML = this.resultHTML();
    const logEl = document.getElementById("log");
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
    const tlogEl = document.getElementById("trainingLog");
    if (tlogEl) tlogEl.scrollTop = tlogEl.scrollHeight;
  }

  modeSelectHTML() {
    return `
      <header id="topbar"><h1>海戦指揮 AIラボ</h1><div class="meta"><span>モードを選択</span></div></header>
      <div class="stage-select">
        <div class="stage-card">
          <h2>⚔ AI観戦モード</h2>
          <p class="stage-desc">学習済みAI（青軍）と敵艦隊（赤軍）を自動対戦させます。敵艦隊はJSONからインポート可能です。</p>
          <p class="stage-meta">${this.hasTrained ? `学習済み編成: ${fleetDisplayString(this.champion.fleet)}` : "まだ学習していません（初期AI同士の対戦になります）"}${this.spectateEnemyFleet ? `<br>敵艦隊: ${fleetDisplayString(this.spectateEnemyFleet)}` : ""}</p>
          <button onclick="game.startSpectate()">観戦を始める</button>
        </div>
        <div class="stage-card">
          <h2>🧠 AI学習モード</h2>
          <p class="stage-desc">行動パラメータと艦隊編成を進化させます。学習対象は「行動＋編成／編成のみ／行動のみ」から選択可能です。</p>
          <p class="stage-meta">${this.hasTrained ? `学習済み世代数：${this.trainingHistory.length}　編成: ${fleetDisplayString(this.champion.fleet)}` : "未学習（初期状態のAI）"}</p>
          <button onclick="game.startTrainingScreen()">学習を始める</button>
        </div>
        <div class="stage-card">
          <h2>🎮 プレイヤー対AI</h2>
          <p class="stage-desc">自分で自由に艦隊を編成し、学習済みAIの艦隊と直接対戦します。</p>
          <p class="stage-meta">配備上限: 艦${MAP.budget.maxShips}隻 ／ ${MAP.budget.maxDisplacement.toLocaleString()}t　目標: 敵AI艦隊を殲滅せよ</p>
          <button onclick="game.startPvAIDeploy()">出撃する</button>
        </div>
      </div>
    `;
  }

  deployMapHTML() {
    let html = `<table class="mapgrid">`;
    for (let r = 0; r < MAP.rows; r++) {
      html += "<tr>";
      for (let c = 0; c < MAP.cols; c++) {
        const land = isLand(r, c);
        const cls = [land ? "land" : "sea"];
        if (zoneOf("A", r, c) && !land) cls.push("deploy-zone");
        const existing = this.deployUnits.find(u => u.r === r && u.c === c);
        const content = existing ? `<div class="unit-wrap" style="--unit-color:var(--player-blue)">${ICONS[existing.type]}</div>` : "";
        html += `<td class="${cls.join(" ")}" onclick="game.onDeployTileClick(${r},${c})">${content}</td>`;
      }
      html += "</tr>";
    }
    html += "</table>";
    return html;
  }

  deployHTML() {
    const usedShips = this.deployedShipsCount();
    const usedDisp = this.deployedDisplacement();
    return `
      <header id="topbar">
        <h1>艦隊配備（自由編成）</h1>
        <div class="meta"><span>目標: 敵AI艦隊を殲滅せよ</span></div>
      </header>
      <main class="battle-main">
        <section class="map-panel">${this.deployMapHTML()}</section>
        <section class="side-panel">
          <div class="budget-box">
            <div class="stat-grid">
              <div class="stat"><span class="stat-label">艦艇数</span><span class="stat-value">${usedShips} / ${MAP.budget.maxShips}</span></div>
              <div class="stat"><span class="stat-label">排水量</span><span class="stat-value">${usedDisp.toLocaleString()} / ${MAP.budget.maxDisplacement.toLocaleString()} t</span></div>
            </div>
          </div>
          <div class="roster">
            ${UNIT_KEYS.map(t => {
              const def = UNIT_TYPES[t];
              const disabled = (usedShips + 1 > MAP.budget.maxShips) || (usedDisp + def.displacement > MAP.budget.maxDisplacement);
              const extra = (t === "CV" || t === "CVL") ? `航空${makeSquadronsFor(t).length}隊` : `AA${def.aa}/ASW${def.asw}`;
              return `
                <button class="roster-btn ${this.pendingType === t ? "active" : ""}" ${disabled ? "disabled" : ""} onclick="game.selectPendingType('${t}')">
                  <span class="b-icon">${ICONS[t]}</span>
                  <span class="b-name">${def.name}<br><small style="color:var(--ink-dim)">移動${def.move}・射程${def.gunRange}・HP${def.hp}・${extra}</small></span>
                  <span class="b-price">${def.displacement.toLocaleString()}t</span>
                </button>`;
            }).join("")}
          </div>
          <div>
            <div class="hint" style="margin-bottom:6px;">プリセット（自動配置）:</div>
            <div class="quick-row">
              <button onclick="game.applyDeployPreset(['BB','CV','DD'])">戦艦・空母・駆逐</button>
              <button onclick="game.applyDeployPreset(['BB','CA','DD','FF'])">護衛付き戦艦</button>
              <button onclick="game.applyDeployPreset(['CA','CA','CL','DD'])">重巡戦隊</button>
              <button onclick="game.applyDeployPreset(['CVL','CVL','DD','FF','FF'])">軽空母機動</button>
              <button onclick="game.applyDeployPreset(['CV','CVL','CA','DD','FF'])">空母機動艦隊</button>
              <button onclick="game.applyDeployPreset(['SS','SS','DD','CL','FF'])">潜水艦隊</button>
              <button onclick="game.clearDeploy()">クリア</button>
            </div>
          </div>
          <p class="hint">艦種を選んで左のマップの自軍海域（青枠）をクリックして配備。相手は学習済みAIの編成（現在: ${fleetDisplayString(this.champion.fleet)}）です。</p>
          <button class="end-turn" onclick="game.startPvAIBattle()">戦闘開始</button>
          <button class="back" onclick="game.goModeSelect()">モード選択に戻る</button>
        </section>
      </main>
    `;
  }

  battleHTML() {
    return this.battle.mode === "pvai" ? this.pvaiBattleHTML() : this.spectateBattleHTML();
  }

  mapTableHTML() {
    let html = `<table class="mapgrid">`;
    for (let r = 0; r < MAP.rows; r++) {
      html += "<tr>";
      for (let c = 0; c < MAP.cols; c++) html += this.cellHTML(r, c);
      html += "</tr>";
    }
    html += "</table>";
    return html;
  }

  cellHTML(r, c) {
    const land = isLand(r, c);
    const key = `${r},${c}`;
    const classes = [land ? "land" : "sea"];
    if (this.battle.highlight && this.battle.highlight.has(key)) {
      classes.push(this.battle.uiMode === "move" ? "move-range" : this.battle.uiMode === "ability" ? "ability-range" : "attack-range");
    }
    const su = this.selectedUnit();
    if (su && su.r === r && su.c === c) classes.push("selected");

    let content = "";
    const unit = unitAt(this.battle.units, r, c);
    if (unit) {
      let show = true;
      if (this.battle.mode === "pvai" && unit.side === "B") show = this.isVisibleTile(r, c);
      if (show) content = this.unitIconHTML(unit);
    }
    const onclick = this.battle.mode === "pvai" ? `game.onCellClick(${r},${c})` : "";
    return `<td class="${classes.join(" ")}" onclick="${onclick}">${content}</td>`;
  }

  unitIconHTML(unit) {
    const def = UNIT_TYPES[unit.type];
    const colorVar = unit.side === "A" ? "--player-blue" : "--enemy-red";
    const hpPct = Math.max(0, Math.round((unit.hp / def.hp) * 100));
    const barColor = hpPct > 50 ? "var(--success)" : hpPct > 25 ? "var(--warn)" : "var(--danger)";
    return `
      <div class="unit-wrap" style="--unit-color:var(${colorVar})">
        ${unit.flagship ? '<span class="flag-mark">★</span>' : ""}
        ${(unit.evasionBuff || unit.aaBuff) ? '<span class="buff-mark">⌾</span>' : ""}
        ${ICONS[unit.type]}
        <div class="hpbar"><div class="hpbar-fill" style="width:${hpPct}%;background:${barColor}"></div></div>
      </div>
    `;
  }

  unitPanelHTML(unit) {
    const def = UNIT_TYPES[unit.type];
    const ab = def.ability;
    let buttons = "";
    buttons += `<button ${unit.hasMoved ? "disabled" : ""} onclick="game.enterMoveMode()">移動 (最大${def.move}マス)</button>`;
    buttons += `<button ${unit.hasActed ? "disabled" : ""} onclick="game.enterGunMode()">砲撃 (射程${def.gunRange}・威力${def.gunPower})</button>`;
    if (def.torpedo) buttons += `<button ${unit.hasActed || unit.torpedoUses <= 0 ? "disabled" : ""} onclick="game.enterTorpedoMode()">魚雷 (射程${def.torpedo.range}・威力${def.torpedo.power}・残${unit.torpedoUses})</button>`;
    if (unit.squadrons) {
      unit.squadrons.forEach((sq, i) => {
        const disabled = unit.hasActed || sq.hp <= 0;
        const hpPct = Math.round(sq.hp / sq.maxHp * 100);
        buttons += `<button ${disabled ? "disabled" : ""} onclick="game.enterSquadronMode(${i})">${sq.label} (HP${sq.hp}/${sq.maxHp} ${hpPct}%・威力${sq.attackPower})</button>`;
      });
    }
    if (ab) {
      let label;
      if (ab.type === "salvo") label = `${ab.label} (中心${ab.centerPower}/範囲${ab.splashPower})`;
      else if (ab.type === "aswStrike") label = `${ab.label} (対潜特効・射程${ab.range}・威力${ab.power})`;
      else if (ab.type === "focusedFire") label = `${ab.label} (射程${ab.range}・威力${ab.power})`;
      else label = ab.label;
      buttons += `<button ${unit.hasActed || unit.abilityUses <= 0 ? "disabled" : ""} onclick="game.enterAbilityMode()">${label} (残${unit.abilityUses})</button>`;
    }
    buttons += `<button ${unit.hasMoved && unit.hasActed ? "disabled" : ""} onclick="game.waitUnit()">待機（行動終了）</button>`;
    if (this.battle.uiMode !== "idle") buttons += `<button class="back" onclick="game.cancelMode()">キャンセル</button>`;
    return `
      <h3>${unitLabel(unit, "pvai")}</h3>
      <div class="stat-grid">
        <div class="stat"><span class="stat-label">HP</span><span class="stat-value">${unit.hp}/${def.hp}</span></div>
        <div class="stat"><span class="stat-label">移動</span><span class="stat-value">${def.move}</span></div>
        <div class="stat"><span class="stat-label">砲撃力</span><span class="stat-value">${def.gunPower}</span></div>
        <div class="stat"><span class="stat-label">回避</span><span class="stat-value">${def.evasion}%${unit.evasionBuff ? ` (+${unit.evasionBuff})` : ""}</span></div>
        <div class="stat"><span class="stat-label">対空</span><span class="stat-value">${def.aa}${unit.aaBuff ? ` (+${unit.aaBuff})` : ""}</span></div>
        <div class="stat"><span class="stat-label">対潜</span><span class="stat-value">${def.asw}</span></div>
        <div class="stat"><span class="stat-label">視界</span><span class="stat-value">${def.vision}</span></div>
        ${def.torpedo ? `<div class="stat"><span class="stat-label">魚雷威力</span><span class="stat-value">${def.torpedo.power}</span></div>` : ""}
      </div>
      <div class="action-list">${buttons}</div>
    `;
  }

  fleetRowHTML(u, readOnly) {
    const def = UNIT_TYPES[u.type];
    const clickable = !readOnly && u.side === "A";
    let sqInfo = "";
    if (u.squadrons) sqInfo = " " + u.squadrons.map(s => `${s.label[0]}${s.hp}`).join("/");
    return `<div class="fleet-row ${this.battle.selectedUnitId === u.id ? "active" : ""}" ${clickable ? `onclick="game.selectUnit('${u.id}')"` : ""}>
      <span>${def.name}${u.flagship ? "★" : ""}${sqInfo}</span><span class="hp-mini">${u.hp}/${def.hp}</span>
    </div>`;
  }

  pvaiBattleHTML() {
    const unit = this.selectedUnit();
    return `
      <header id="topbar">
        <h1>プレイヤー対AI</h1>
        <div class="meta"><span>ターン ${this.battle.turn} / ${MAP.turnLimit}</span><span>目標: 敵AI艦隊を殲滅せよ</span></div>
      </header>
      <main class="battle-main">
        <section class="map-panel">${this.mapTableHTML()}</section>
        <section class="side-panel">
          <div class="unit-panel">
            ${unit ? this.unitPanelHTML(unit) : `<p class="hint">自軍艦をクリックして選択してください。移動・砲撃・魚雷・特殊能力・航空攻撃を組み合わせて敵AI艦隊を撃破しましょう。</p>`}
          </div>
          <button class="end-turn" onclick="game.endSideATurn()">ターン終了</button>
          <div class="fleet-list">
            <h3>自軍艦隊</h3>
            ${this.battle.units.filter(u => u.side === "A" && u.hp > 0).map(u => this.fleetRowHTML(u)).join("")}
          </div>
        </section>
      </main>
      <section class="log-panel">
        <h3>戦闘記録</h3>
        <div id="log">${this.battle.logLines.map(l => `<div class="log-line">${l}</div>`).join("")}</div>
      </section>
    `;
  }

  spectateBattleHTML() {
    const enemyLabel = this.spectateEnemyFleet ? "インポート敵艦隊" : "初期AI";
    return `
      <header id="topbar">
        <h1>AI観戦モード</h1>
        <div class="meta">
          <span>ターン ${this.battle.turn} / ${MAP.turnLimit}</span>
          <span class="side-tag A">青軍：${this.hasTrained ? "学習済みAI" : "初期AI"}</span>
          <span class="side-tag B">赤軍：${enemyLabel}</span>
        </div>
      </header>
      <main class="battle-main">
        <section class="map-panel">${this.mapTableHTML()}</section>
        <section class="side-panel">
          <div class="unit-panel">
            <h3>観戦コントロール</h3>
            <div class="spectate-controls">
              <button class="primary" onclick="game.toggleSpectateAuto()">${this.spectatePlaying ? "一時停止" : "自動再生"}</button>
              <button onclick="game.spectateStepOnce()" ${this.spectatePlaying ? "disabled" : ""}>1ステップ（1艦）</button>
              <button onclick="game.spectateAdvanceTurn()" ${this.spectatePlaying ? "disabled" : ""}>1ターン進める</button>
              <button onclick="game.spectateSkipToEnd()">即終了まで進める</button>
            </div>
            <div class="field">
              <label>再生速度</label>
              <select onchange="game.setSpectateSpeed(this.value)">
                <option value="1200" ${this.spectateSpeed === 1200 ? "selected" : ""}>遅い</option>
                <option value="700" ${this.spectateSpeed === 700 ? "selected" : ""}>普通</option>
                <option value="250" ${this.spectateSpeed === 250 ? "selected" : ""}>速い</option>
              </select>
            </div>
            <button class="back" style="margin-top:10px;" onclick="game.goModeSelect()">モード選択に戻る</button>
          </div>
          <div class="unit-panel">
            <h3>敵艦隊の設定</h3>
            <p class="hint">セーブデータ（JSON）をインポートすると、赤軍として使用します。<br>現在: <strong style="color:var(--gold)">${this.spectateEnemyFleet ? fleetDisplayString(this.spectateEnemyFleet) : "初期AI（BB・CV・DD）"}</strong></p>
            <div class="spectate-controls" style="margin-top:8px;">
              <button onclick="document.getElementById('spectateEnemyFile').click()">敵艦隊をインポート</button>
              ${this.spectateEnemyFleet ? `<button onclick="game.clearSpectateEnemy()">初期AIに戻す</button>` : ""}
            </div>
            <input id="spectateEnemyFile" type="file" accept=".json,application/json" style="display:none" onchange="game.importSpectateEnemy(this)">
          </div>
          <div class="fleet-list">
            <h3>青軍（${fleetDisplayString(this.champion.fleet)}）</h3>
            ${this.battle.units.filter(u => u.side === "A" && u.hp > 0).map(u => this.fleetRowHTML(u, true)).join("")}
          </div>
          <div class="fleet-list">
            <h3>赤軍（${fleetDisplayString(this.spectateEnemyFleet || this.baseline.fleet)}）</h3>
            ${this.battle.units.filter(u => u.side === "B" && u.hp > 0).map(u => this.fleetRowHTML(u, true)).join("")}
          </div>
        </section>
      </main>
      <section class="log-panel">
        <h3>戦闘記録</h3>
        <div id="log">${this.battle.logLines.map(l => `<div class="log-line">${l}</div>`).join("")}</div>
      </section>
    `;
  }

  trainingChartSVG() {
    const w = 600, h = 160, pad = 30;
    const hist = this.trainingHistory;
    if (hist.length === 0) {
      return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:140px;"><text x="${w / 2}" y="${h / 2}" fill="var(--ink-dim)" font-size="13" text-anchor="middle">学習を開始すると、ここに初期AI比の勝率推移が表示されます</text></svg>`;
    }
    const maxGen = hist[hist.length - 1].gen;
    const xScale = g => pad + (maxGen <= 1 ? 0 : (g - 1) / (maxGen - 1)) * (w - pad * 2);
    const yScale = rate => h - pad - rate * (h - pad * 2);
    const points = hist.map(p => `${xScale(p.gen)},${yScale(p.rate)}`).join(" ");
    const gridY = [0, 0.25, 0.5, 0.75, 1].map(v =>
      `<line x1="${pad}" y1="${yScale(v)}" x2="${w - pad}" y2="${yScale(v)}" stroke="var(--border)" stroke-width="1"/><text x="${pad - 6}" y="${yScale(v) + 4}" fill="var(--ink-dim)" font-size="10" text-anchor="end">${Math.round(v * 100)}%</text>`
    ).join("");
    const dots = hist.map(p => `<circle cx="${xScale(p.gen)}" cy="${yScale(p.rate)}" r="2.5" fill="var(--gold)"/>`).join("");
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:140px;">
      ${gridY}
      <line x1="${pad}" y1="${yScale(0.5)}" x2="${w - pad}" y2="${yScale(0.5)}" stroke="var(--ink-dim)" stroke-width="1" stroke-dasharray="4 3"/>
      <polyline points="${points}" fill="none" stroke="var(--gold)" stroke-width="2"/>
      ${dots}
      <text x="${pad}" y="${h - 8}" fill="var(--ink-dim)" font-size="10">世代1</text>
      <text x="${w - pad}" y="${h - 8}" fill="var(--ink-dim)" font-size="10" text-anchor="end">世代${maxGen}</text>
    </svg>`;
  }

  fleetHistoryHTML() {
    if (this.fleetHistory.length === 0) {
      return `<div style="color:var(--ink-dim)">まだ編成変更はありません（初期: ${fleetDisplayString(DEFAULT_FLEET)}）</div>`;
    }
    return this.fleetHistory.slice(-12).reverse().map(h =>
      `<div><strong>世代${h.gen}</strong> → ${fleetDisplayString(h.fleet)}</div>`
    ).join("");
  }

  trainingHTML() {
    const progressPct = this.trainingProgress ? Math.round(100 * this.trainingProgress.gen / this.trainingProgress.total) : 0;
    const mode = this.trainingMode;
    const modeNote =
      mode === "fleet"   ? "編成のみを変異：行動パラメータは固定のまま、艦隊構成の良し悪しだけを評価します。" :
      mode === "weights" ? "行動のみを変異：艦隊編成は固定のまま、行動パラメータの改善だけを評価します。" :
                           "行動＋編成を変異：行動50% / 編成40% / 両方10% の割合でランダムに変異します。";
    return `
      <header id="topbar"><h1>AI学習モード</h1><div class="meta"><span>行動＋編成を進化</span></div></header>
      <div class="training-panel">
        <p class="hint">各世代で1つの挑戦者を作り、現チャンピオンと対戦させます。勝率が50%を超えれば新しいチャンピオンとして採用します。訓練時は初期配置をランダム化することで、決定論的戦闘でも多様な試行になります。</p>
        <div class="training-form">
          <div class="field"><label>学習対象</label>
            <select id="trainingMode" ${this.isTraining ? "disabled" : ""}>
              <option value="both" ${mode === "both" ? "selected" : ""}>行動＋編成</option>
              <option value="fleet" ${mode === "fleet" ? "selected" : ""}>編成のみ</option>
              <option value="weights" ${mode === "weights" ? "selected" : ""}>行動のみ</option>
            </select>
          </div>
          <div class="field"><label>世代数</label><input id="genCount" type="number" min="1" max="300" value="40" ${this.isTraining ? "disabled" : ""}></div>
          <div class="field"><label>1世代あたりの対戦数</label><input id="matchCount" type="number" min="2" max="200" value="30" ${this.isTraining ? "disabled" : ""}></div>
          <button onclick="game.runTraining()" ${this.isTraining ? "disabled" : ""}>学習開始</button>
          ${this.isTraining ? `<button class="stop" onclick="game.stopTraining()">停止</button>` : ""}
          <button class="ghost" onclick="game.resetChampion()" ${this.isTraining ? "disabled" : ""}>学習をリセット</button>
        </div>
        <div class="mode-note">現在の学習対象: ${mode === "fleet" ? "編成のみ" : mode === "weights" ? "行動のみ" : "行動＋編成"} — ${modeNote}</div>
        ${this.isTraining ? `
          <div>
            <div class="progress-outer"><div class="progress-inner" style="width:${progressPct}%"></div></div>
            <p class="hint">世代 ${this.trainingProgress.gen} / ${this.trainingProgress.total} 進行中…</p>
          </div>` : ""}
        <div class="chart-box">${this.trainingChartSVG()}</div>
        <div class="stat-grid" style="grid-template-columns:1fr 1fr;">
          <div class="stat"><span class="stat-label">学習済み世代数</span><span class="stat-value">${this.trainingHistory.length}</span></div>
          <div class="stat"><span class="stat-label">直近の初期AI比勝率</span><span class="stat-value">${this.trainingHistory.length ? Math.round(this.trainingHistory[this.trainingHistory.length - 1].rate * 100) + "%" : "-"}</span></div>
        </div>
        <h3 style="font-size:1em;">現在の学習済みAI編成</h3>
        <div class="fleet-display">${fleetDisplayString(this.champion.fleet)}　<span style="color:var(--ink-dim);font-size:0.85em;">／ 排水量 ${fleetDisplacement(this.champion.fleet).toLocaleString()}t ・ ${this.champion.fleet.length}隻</span></div>
        <h3 style="font-size:1em;">編成の変遷（世代ごと）</h3>
        <div class="fleet-history">${this.fleetHistoryHTML()}</div>
        <h3 style="font-size:1em;">現在の学習済みAIパラメータ</h3>
        <div class="weight-readout">
          ${WEIGHT_META.map(m => `<div>${m.label}</div><div>${this.champion.weights[m.key].toFixed(2)}</div>`).join("")}
        </div>
        <h3 style="font-size:1em;">セーブデータ</h3>
        <div class="training-form">
          <button class="ghost" onclick="game.exportSave()" ${this.isTraining ? "disabled" : ""}>セーブをエクスポート</button>
          <button class="ghost" onclick="document.getElementById('importFile').click()" ${this.isTraining ? "disabled" : ""}>セーブをインポート</button>
          <input id="importFile" type="file" accept=".json,application/json" style="display:none" onchange="game.handleImportFile(this)">
        </div>
        <p class="hint" style="margin-top:-6px;">エクスポートしたJSONには、現在のチャンピオン（行動＋編成）、初期AI、学習履歴、学習ログが含まれます。</p>
      </div>
      <section class="log-panel">
        <h3>学習ログ（[行動] / [編成] / [行動+編成] で変異タイプを表示）</h3>
        <div id="trainingLog" style="height:180px;overflow-y:auto;background:rgba(0,0,0,0.28);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-family:'JetBrains Mono',monospace;font-size:0.78em;display:flex;flex-direction:column;gap:2px;">
          ${this.trainingLog.map(l => `<div class="log-line">${l}</div>`).join("")}
        </div>
      </section>
      <button class="back" onclick="game.goModeSelect()">モード選択に戻る</button>
    `;
  }

  resultHTML() {
    const oc = this.resultOutcome;
    const mode = this.battle ? this.battle.mode : "pvai";
    let title, text, lose = false;
    if (mode === "pvai") {
      const won = oc.winner === "A";
      lose = !won;
      title = won ? "作戦成功" : (oc.winner === null ? "痛み分け" : "作戦失敗");
      text = won ? "敵AI艦隊を撃破した！" : (oc.winner === null ? "両軍相討ちに終わった。" : "自艦隊が壊滅、あるいは制限ターン内に目標を果たせなかった。");
    } else {
      const enemyLabel = this.spectateEnemyFleet ? "インポート敵艦隊" : "初期AI";
      title = oc.winner === "A" ? `青軍（${this.hasTrained ? "学習済みAI" : "初期AI"}）の勝利` : oc.winner === "B" ? `赤軍（${enemyLabel}）の勝利` : "引き分け";
      text = `観戦終了：${this.battle.turn}ターン目で決着。`;
      lose = oc.winner === "B";
    }
    return `
      <div class="result-overlay">
        <div class="overlay-card ${lose ? "lose" : ""}">
          <h2>${title}</h2>
          <p>${text}</p>
          ${mode === "pvai" ? `<button onclick="game.startPvAIDeploy()">再挑戦する</button>` : `<button onclick="game.startSpectate()">もう一度観戦する</button>`}
          <button onclick="game.goModeSelect()">モード選択に戻る</button>
        </div>
      </div>
    `;
  }

  toast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    const t = document.createElement("div");
    t.className = `toast toast-${type}`;
    t.textContent = message;
    container.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
  }
}

const game = new NavalApp();