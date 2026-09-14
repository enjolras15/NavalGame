/**
 * naval_core.js
 * 移動範囲 / 視界 / 対空防御 / ダメージ計算 / 各種攻撃解決 / 勝敗判定
 */

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

function computeAirDefense(units, side, r, c) {
  let total = 0;
  units.filter(u => u.side === side && u.hp > 0).forEach(u => {
    const dist = chebyshev(u.r, u.c, r, c);
    if (dist > AIR_AA_RADIUS) return;
    const falloff = 1 - dist * 0.2;
    total += (UNIT_TYPES[u.type].aa || 0) * falloff;
    if (u.squadrons) {
      u.squadrons.forEach(s => {
        if (FIGHTER_TYPES.has(s.type) && s.hp > 0) total += (s.hp / 5) * falloff;
      });
    }
    if (u.aaBuff && u.aaBuff > 0) total += u.aaBuff * falloff;
  });
  return Math.round(total);
}

function computeDamage(power, maxRange, dist, targetDef, effectiveEvasion, ignoreDefense) {
  const rangeFactor = 1 - ((dist - 1) / Math.max(1, maxRange - 1)) * 0.4;
  const raw = power * rangeFactor;
  const afterEvasion = raw * (1 - effectiveEvasion / 100);
  const defense = ignoreDefense ? 0 : targetDef;
  return Math.max(1, Math.round(afterEvasion - defense));
}

function formatLossList(squadrons, hpBefore) {
  return squadrons.map((sq, i) => {
    const lost = hpBefore[i] - sq.hp;
    return lost > 0 ? `${sq.label}${lost}機` : null;
  }).filter(Boolean).join("・");
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
    if (sq.type === "patrol" && target.type === "SS") power = sq.aswPower * (sq.hp / sq.maxHp);
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

  if (target.type === "SS" && weapon !== "asw" && weapon !== "air-patrol") {
    const asw = def.asw || 0;
    if (asw === 0) dmg = Math.max(1, Math.floor(dmg * 0.4));
    else dmg = Math.max(1, Math.round(dmg * (1 + asw * 0.03)));
  }

  let sqHpBefore = sq ? sq.hp : 0;
  let defenderFighters = [];
  let defFighterHpBefore = [];
  let aaDamage = 0;

  if (isAir && sq) {
    const airDef = computeAirDefense(units, target.side, target.r, target.c);
    dmg = Math.max(1, dmg - airDef);

    aaDamage = Math.max(0, Math.round(airDef * 0.6));
    if (aaDamage > 0) sq.hp = Math.max(0, sq.hp - aaDamage);

    if (sq.hp > 0) {
      const defenders = [];
      units.filter(u => u.side === target.side && u.hp > 0 && u.squadrons && u.id !== attacker.id).forEach(u => {
        u.squadrons.forEach(dsq => {
          if (FIGHTER_TYPES.has(dsq.type) && dsq.hp > 0) {
            const d = chebyshev(u.r, u.c, target.r, target.c);
            if (d <= AIR_AA_RADIUS) defenders.push({ sq: dsq, dist: d });
          }
        });
      });
      defenderFighters = defenders.map(d => d.sq);
      defFighterHpBefore = defenderFighters.map(s => s.hp);
      if (defenders.length > 0) {
        let atkLoss = 0;
        defenders.forEach(df => {
          const falloff = 1 - df.dist * 0.2;
          atkLoss += df.sq.airAttack * (df.sq.hp / df.sq.maxHp) * falloff;
        });
        atkLoss = Math.round(atkLoss);
        if (atkLoss > 0) sq.hp = Math.max(0, sq.hp - atkLoss);
        if (sq.hp > 0 && sq.airAttack > 0) {
          const atkPower = sq.airAttack * (sq.hp / sq.maxHp);
          const perFighter = atkPower / defenders.length;
          defenders.forEach(df => { df.sq.hp = Math.max(0, df.sq.hp - perFighter); });
        }
      }
    }
  }

  target.hp = Math.max(0, target.hp - dmg);

  if (logFn) {
    let msg = `${attackerLabel}の${label}が${targetLabel}に命中、${dmg}ダメージ！`;
    if (isAir && sq) {
      const parts = [];
      const sqLoss = sqHpBefore - sq.hp;
      if (sqLoss > 0) parts.push(`自軍${sq.label}${sqLoss}機損耗`);
      const defLossStr = formatLossList(defenderFighters, defFighterHpBefore);
      if (defLossStr) parts.push(`敵${defLossStr}損耗`);
      if (parts.length > 0) msg += parts.join("、") + "。";
      if (sq.hp <= 0) msg += `（${sq.label}全滅）`;
      if (target.hp <= 0) msg += "（撃沈）";
    } else {
      msg += target.hp <= 0 ? "（撃沈）" : "";
    }
    logFn(msg);
  }
  return { hit:true, dmg, sunk: target.hp <= 0 };
}

function resolveCombinedAirAttack(attacker, squadronIndices, target, logFn, units) {
  const attackerLabel = unitLabel(attacker, "pvai");
  const targetLabel = unitLabel(target, "pvai");
  const dist = chebyshev(attacker.r, attacker.c, target.r, target.c);

  const participants = squadronIndices
    .map(i => attacker.squadrons[i])
    .filter(sq => sq && sq.hp > 0);
  if (participants.length === 0) return { hit:false };

  const sqHpBefore = participants.map(sq => sq.hp);

  const rangeFactor = 1 - ((dist - 1) / Math.max(1, AIR_RANGE - 1)) * 0.4;
  let totalPower = 0;
  participants.forEach(sq => { totalPower += sq.attackPower * (sq.hp / sq.maxHp); });
  totalPower *= rangeFactor;

  if (target.type === "SS") {
    let patrolPower = 0;
    participants.forEach(sq => {
      if (sq.type === "patrol" && sq.aswPower) patrolPower += sq.aswPower * (sq.hp / sq.maxHp);
    });
    if (patrolPower > 0) totalPower = Math.max(totalPower, patrolPower * rangeFactor);
  }

  const airDef = computeAirDefense(units, target.side, target.r, target.c);
  const dmg = Math.max(1, Math.round(totalPower - airDef));
  target.hp = Math.max(0, target.hp - dmg);

  const enemyFighters = [];
  units.filter(u => u.side === target.side && u.hp > 0 && u.squadrons && u.id !== attacker.id).forEach(u => {
    u.squadrons.forEach(dsq => {
      if (FIGHTER_TYPES.has(dsq.type) && dsq.hp > 0) {
        const d = chebyshev(u.r, u.c, target.r, target.c);
        if (d <= AIR_AA_RADIUS) enemyFighters.push({ sq: dsq, dist: d });
      }
    });
  });
  const enemyHpBefore = enemyFighters.map(f => f.sq.hp);

  const aaDamage = Math.max(0, Math.round(airDef * 0.6));
  if (aaDamage > 0) {
    const totalFrac = participants.reduce((s, sq) => s + (sq.hp / sq.maxHp), 0);
    if (totalFrac > 0) {
      participants.forEach(sq => {
        const share = (sq.hp / sq.maxHp) / totalFrac;
        sq.hp = Math.max(0, sq.hp - Math.round(aaDamage * share));
      });
    }
  }

  if (enemyFighters.length > 0) {
    const ourFighters = participants.filter(sq => FIGHTER_TYPES.has(sq.type) && sq.hp > 0);

    if (ourFighters.length > 0 && enemyFighters.some(f => f.sq.hp > 0)) {
      let ourAir = 0;
      ourFighters.forEach(sq => { ourAir += sq.airAttack * (sq.hp / sq.maxHp); });
      let theirAir = 0;
      enemyFighters.forEach(ef => { theirAir += ef.sq.airAttack * (ef.sq.hp / ef.sq.maxHp) * (1 - ef.dist * 0.2); });

      const totalOurHp = ourFighters.reduce((s, sq) => s + sq.hp, 0);
      if (totalOurHp > 0) {
        ourFighters.forEach(sq => {
          const share = sq.hp / totalOurHp;
          sq.hp = Math.max(0, sq.hp - Math.round(theirAir * 0.7 * share));
        });
      }
      const totalTheirHp = enemyFighters.reduce((s, ef) => s + ef.sq.hp, 0);
      if (totalTheirHp > 0) {
        enemyFighters.forEach(ef => {
          const share = ef.sq.hp / totalTheirHp;
          ef.sq.hp = Math.max(0, ef.sq.hp - Math.round(ourAir * 0.7 * share));
        });
      }
    }

    const stillEnemy = enemyFighters.filter(f => f.sq.hp > 0);
    const nonFighters = participants.filter(sq => !FIGHTER_TYPES.has(sq.type) && sq.hp > 0);
    if (stillEnemy.length > 0 && nonFighters.length > 0) {
      let theirAir = 0;
      stillEnemy.forEach(ef => { theirAir += ef.sq.airAttack * (ef.sq.hp / ef.sq.maxHp) * (1 - ef.dist * 0.2); });
      const totalAtkHp = nonFighters.reduce((s, sq) => s + sq.hp, 0);
      if (totalAtkHp > 0) {
        nonFighters.forEach(sq => {
          const share = sq.hp / totalAtkHp;
          sq.hp = Math.max(0, sq.hp - Math.round(theirAir * 0.6 * share));
        });
      }
    }

    const stillEnemy2 = enemyFighters.filter(f => f.sq.hp > 0);
    if (stillEnemy2.length > 0) {
      let ourCounter = 0;
      participants.forEach(sq => { if (sq.hp > 0) ourCounter += sq.airAttack * (sq.hp / sq.maxHp); });
      const totalEnemyHp = stillEnemy2.reduce((s, f) => s + f.sq.hp, 0);
      if (totalEnemyHp > 0 && ourCounter > 0) {
        stillEnemy2.forEach(ef => {
          const share = ef.sq.hp / totalEnemyHp;
          ef.sq.hp = Math.max(0, ef.sq.hp - Math.round(ourCounter * 0.5 * share));
        });
      }
    }
  }

  if (logFn) {
    const atkLossStr = formatLossList(participants, sqHpBefore);
    const defLossStr = formatLossList(enemyFighters.map(f => f.sq), enemyHpBefore);

    let msg = `${attackerLabel}の${participants.length}隊による航空攻撃が${targetLabel}に命中、${dmg}ダメージ！`;
    const parts = [];
    if (atkLossStr) parts.push(`自軍${atkLossStr}損耗`);
    if (defLossStr) parts.push(`敵${defLossStr}損耗`);
    if (parts.length > 0) msg += parts.join("、") + "。";
    const wiped = participants.filter(sq => sq.hp <= 0).map(sq => sq.label).join("・");
    if (wiped) msg += `（${wiped}全滅）`;
    if (target.hp <= 0) msg += "（撃沈）";
    logFn(msg);
  }
  return { hit:true, dmg, sunk: target.hp <= 0 };
}

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
  if (targetType === "SS" && weapon !== "asw" && weapon !== "air-patrol") {
    const asw = UNIT_TYPES[attackerType].asw || 0;
    if (asw === 0) dmg = Math.max(1, Math.floor(dmg * 0.4));
    else dmg = Math.max(1, Math.round(dmg * (1 + asw * 0.03)));
  }
  return dmg;
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