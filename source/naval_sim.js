/**
 * naval_sim.js
 * 陣形配置 / 艦隊配備 / 高速シミュレーション
 */

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