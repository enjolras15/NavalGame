/**
 * naval_ai.js
 * AI の意思決定（行動選択 / 攻撃候補選択 / 陣営フェーズ）
 */

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
      if (t.type === "SS" && (def.asw || 0) === 0 && !weapon.startsWith("air-")) score *= 0.35;
      if (!best || score > best.score) best = { target: t, weapon, score };
    });
  };

  consider("gun", def.gunRange, def.gunPower);
  if (def.torpedo && unit.torpedoUses > 0) consider("torpedo", def.torpedo.range, def.torpedo.power);

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
      const score = estDmg * 0.04 + weights.preferLowHp * (1 - hpFrac)
                  + weights.preferFlagship * (t.flagship ? 1 : 0)
                  + enemiesInArea * 0.5 - dist * 0.05;
      if (!best || score > best.score) best = { target: t, weapon: "salvo", score };
    });
  }

  if (def.ability && def.ability.type === "focusedFire" && unit.abilityUses > 0) {
    oppVisible.forEach(t => {
      const dist = chebyshev(unit.r, unit.c, t.r, t.c);
      if (dist > def.ability.range) return;
      const tDef = UNIT_TYPES[t.type];
      const hpFrac = t.hp / tDef.hp;
      const estDmg = estimateDamage(unit.type, t.type, dist, def.ability.range, def.ability.power, "gun", t.evasionBuff);
      const score = estDmg * 0.05 + weights.preferLowHp * (1 - hpFrac)
                  + weights.preferFlagship * (t.flagship ? 1 : 0)
                  + weights.preferHighValue * (tDef.gunPower / 40) - dist * 0.05;
      if (!best || score > best.score) best = { target: t, weapon: "focused", score };
    });
  }

  if (def.ability && def.ability.type === "aswStrike" && unit.abilityUses > 0) {
    oppVisible.forEach(t => {
      if (t.type !== "SS") return;
      const dist = chebyshev(unit.r, unit.c, t.r, t.c);
      if (dist > def.ability.range) return;
      const tDef = UNIT_TYPES[t.type];
      const hpFrac = t.hp / tDef.hp;
      const estDmg = computeDamage(def.ability.power, def.ability.range, dist, tDef.defense, tDef.evasion, true);
      const score = estDmg * 0.08 + weights.preferLowHp * (1 - hpFrac)
                  + weights.preferFlagship * (t.flagship ? 1 : 0) - dist * 0.05;
      if (!best || score > best.score) best = { target: t, weapon: "asw", score };
    });
  }

  if (unit.squadrons) {
    unit.squadrons.forEach(sq => {
      if (sq.hp <= 0) return;
      const isPatrolSS = (sq.type === "patrol" && sq.aswPower);
      oppVisible.forEach(t => {
        const dist = chebyshev(unit.r, unit.c, t.r, t.c);
        if (dist > AIR_RANGE) return;
        let effPower = sq.attackPower * (sq.hp / sq.maxHp);
        if (isPatrolSS && t.type === "SS") effPower = sq.aswPower * (sq.hp / sq.maxHp);
        const estDmg = estimateDamage(unit.type, t.type, dist, AIR_RANGE, effPower, "air-" + sq.type, t.evasionBuff);
        const tDef = UNIT_TYPES[t.type];
        const hpFrac = t.hp / tDef.hp;
        let score = estDmg * 0.04 * weights.airPriority
                  + weights.preferLowHp * (1 - hpFrac)
                  + weights.preferFlagship * (t.flagship ? 1 : 0)
                  + weights.preferHighValue * (tDef.gunPower / 40)
                  - dist * 0.05;
        if (!best || score > best.score) best = { target: t, weapon: "air-" + sq.type, score };
      });
    });
  }

  return best;
}

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

  if (def.ability && def.ability.type === "resupply" && unit.abilityUses > 0) {
    const allies = units.filter(u => u.side === side && u.hp > 0 && u.id !== unit.id);
    const nearby = allies.filter(a => chebyshev(unit.r, unit.c, a.r, a.c) <= def.ability.range);
    const damaged = nearby.filter(a => a.hp < UNIT_TYPES[a.type].hp * 0.7);
    if (damaged.length > 0) {
      damaged.sort((a, b) => (a.hp / UNIT_TYPES[a.type].hp) - (b.hp / UNIT_TYPES[b.type].hp));
      const target = damaged[0];
      const tdef = UNIT_TYPES[target.type];
      target.hp = Math.min(tdef.hp, target.hp + def.ability.heal);
      if (tdef.torpedo && target.torpedoUses < tdef.torpedo.uses) target.torpedoUses++;
      if (tdef.ability && target.abilityUses < tdef.ability.uses) target.abilityUses++;
      unit.abilityUses--;
      unit.hasActed = true;
      if (logFn && (!hidden || wasObserverVisible)) logFn(`${unitLabel(unit, mode)}が${def.ability.label}を実行、${unitLabel(target, mode)}を補給した。`);
      return;
    }
  }

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