/**
 * naval_ui.js
 * NavalApp クラス（画面描画・操作・学習ループ）
 *
 * v10 変更点:
 *   - エクスポートを File System Access API 対応（フォルダ選択可能）
 *   - プレイヤー配備: ランダム編成ボタン
 *   - 観戦: 赤軍ランダム編成ボタン
 *   - 行動パラメータのセッション限定上書き（PVAI敵 / 観戦A / 観戦B）
 */

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
    this.spectateEnemyFleet = null;
    // セッション限定の重みオーバーライド（null なら既定）
    this.customEnemyWeights = null;
    this.customSpectateWeightsA = null;
    this.customSpectateWeightsB = null;
    this.render();
    this.spectateEnemyFleet = null;
    this.pvaiEnemyFleet = null;
    // セッション限定の重みオーバーライド（null なら既定）
  }

  // ---------- 重みオーバーライド ----------
  getEnemyWeights() { return this.customEnemyWeights || this.champion.weights; }
  getSpectateWeightsA() { return this.customSpectateWeightsA || this.champion.weights; }
  getSpectateWeightsB() {
    if (this.customSpectateWeightsB) return this.customSpectateWeightsB;
    return this.spectateEnemyFleet ? DEFAULT_WEIGHTS : this.baseline.weights;
  }
  getCustomWeights(side) {
    if (side === "enemy") return this.customEnemyWeights;
    if (side === "A") return this.customSpectateWeightsA;
    if (side === "B") return this.customSpectateWeightsB;
    return null;
  }
  enableCustomWeights(side) {
    if (side === "enemy" && !this.customEnemyWeights) this.customEnemyWeights = cloneWeights(this.champion.weights);
    if (side === "A" && !this.customSpectateWeightsA) this.customSpectateWeightsA = cloneWeights(this.champion.weights);
    if (side === "B" && !this.customSpectateWeightsB) {
      const base = this.spectateEnemyFleet ? DEFAULT_WEIGHTS : this.baseline.weights;
      this.customSpectateWeightsB = cloneWeights(base);
    }
    this.render();
  }
  resetCustomWeights(side) {
    if (side === "enemy") this.customEnemyWeights = null;
    if (side === "A") this.customSpectateWeightsA = null;
    if (side === "B") this.customSpectateWeightsB = null;
    this.render();
  }
  setWeight(side, key, value) {
    const w = this.getCustomWeights(side);
    if (!w) return;
    w[key] = Number(value);
    this.render();
  }

  aiSettingsPanelHTML(side, title) {
    const custom = this.getCustomWeights(side);
    if (!custom) {
      return `
        <div style="padding:8px 0;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="font-size:0.9em;">${title}</strong>
            <button class="ghost" style="font-size:0.8em; padding:4px 10px;" onclick="game.enableCustomWeights('${side}')">編集する</button>
          </div>
          <p class="hint" style="margin:0;">既定のAIを使用します。編集するとこのセッションのみカスタム値で動作します。</p>
        </div>`;
    }
    return `
      <div style="padding:8px 0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:0.9em;">${title}（カスタム）</strong>
          <button class="ghost" style="font-size:0.8em; padding:4px 10px;" onclick="game.resetCustomWeights('${side}')">既定に戻す</button>
        </div>
        ${WEIGHT_META.map(m => `
          <div style="display:flex; align-items:center; gap:8px; padding:2px 0; font-size:0.8em;">
            <span style="flex:1; color:var(--ink-dim);">${m.label}</span>
            <input type="range" min="${m.min}" max="${m.max}" step="0.05" value="${custom[m.key]}" oninput="game.setWeight('${side}','${m.key}', this.value)" style="width:100px;">
            <span style="font-family:'JetBrains Mono',monospace; width:2.8em; text-align:right;">${custom[m.key].toFixed(2)}</span>
          </div>`).join("")}
      </div>`;
  }

  // ---------- ランダム編成 ----------
  randomizePlayerFleet() {
    const fleet = randomFleet();
    this.deployUnits = [];
    const positions = formationPositions("A", fleet.length, false);
    fleet.forEach((t, i) => {
      const [r, c] = positions[i];
      this.deployUnits.push({ type: t, r, c });
    });
    this.toast(`ランダム編成: ${fleetDisplayString(fleet)}`, "info");
    this.render();
  }

  randomizeSpectateEnemy() {
    const fleet = randomFleet();
    this.spectateEnemyFleet = fleet.slice();
    this.toast(`敵艦隊をランダム設定: ${fleetDisplayString(fleet)}`, "success");
    if (this.screen === "battle" && this.battle && this.battle.mode === "spectate") {
      this.startSpectate();
    } else {
      this.render();
    }
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

  // ---------- セーブデータ ----------
  async exportSave() {
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
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `naval_ai_save_${stamp}.json`;

    // File System Access API（フォルダ選択可能）
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "JSON ファイル", accept: { "application/json": [".json"] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        this.toast("セーブデータを保存しました", "success");
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return; // ユーザーがキャンセル
        // 他のエラーはフォールバックへ
      }
    }

    // フォールバック: ブラウザのダウンロード
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.toast("セーブデータをダウンロードしました", "success");
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

  importSpectateEnemy(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        let fleet = null;
        if (Array.isArray(data)) fleet = data;
        else if (data && data.champion && Array.isArray(data.champion.fleet)) fleet = data.champion.fleet;
        else if (data && Array.isArray(data.fleet)) fleet = data.fleet;
        if (!fleet || fleet.length === 0) throw new Error("有効な艦隊データが見つかりません");
        if (!fleet.every(t => UNIT_TYPES[t])) throw new Error("未知の艦種が含まれています");
        if (!fleetIsValid(fleet)) throw new Error("編成が現在のルールで無効です（予算超過など）");
        this.spectateEnemyFleet = fleet.slice();
        this.toast(`敵艦隊を設定: ${fleetDisplayString(fleet)}`, "success");
        if (this.screen === "battle" && this.battle && this.battle.mode === "spectate") this.startSpectate();
        else this.render();
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
    if (this.screen === "battle" && this.battle && this.battle.mode === "spectate") this.startSpectate();
    else this.render();
  }

    // ---------- PVAI用: 敵編成の設定 ----------
  randomizePvAIEnemy() {
    const fleet = randomFleet();
    this.pvaiEnemyFleet = fleet.slice();
    this.toast(`敵編成をランダム設定: ${fleetDisplayString(fleet)}`, "success");
    this.render();
  }

  importPvAIEnemy(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        let fleet = null;
        if (Array.isArray(data)) fleet = data;
        else if (data && data.champion && Array.isArray(data.champion.fleet)) fleet = data.champion.fleet;
        else if (data && Array.isArray(data.fleet)) fleet = data.fleet;
        if (!fleet || fleet.length === 0) throw new Error("有効な艦隊データが見つかりません");
        if (!fleet.every(t => UNIT_TYPES[t])) throw new Error("未知の艦種が含まれています");
        if (!fleetIsValid(fleet)) throw new Error("編成が現在のルールで無効です（予算超過など）");
        this.pvaiEnemyFleet = fleet.slice();
        this.toast(`敵編成を設定: ${fleetDisplayString(fleet)}`, "success");
        this.render();
      } catch (err) {
        this.toast("読み込み失敗: " + err.message, "danger");
      } finally {
        input.value = "";
      }
    };
    reader.readAsText(file);
  }

  clearPvAIEnemy() {
    this.pvaiEnemyFleet = null;
    this.toast("敵編成を学習済みAIに戻しました", "info");
    this.render();
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
    const enemyFleet = this.pvaiEnemyFleet || this.champion.fleet;
    deployFleet(units, "B", seq, enemyFleet, { randomize: false });
    this.battle = { units, turn:1, mode:"pvai", logLines:[], selectedUnitId:null, inspectUnitId:null, uiMode:"idle", highlight:new Set(), tempRevealed:new Set(), squadronSelection:new Set() };
    this.battle.log = (msg) => this.pushLog(msg);
    this.screen = "battle";
    this.startSideATurn();
  }

  startSideATurn() {
    this.battle.units.forEach(u => { if (u.side === "A") { u.hasMoved = false; u.hasActed = false; u.evasionBuff = 0; u.aaBuff = 0; } });
    this.battle.tempRevealed = new Set();
    this.battle.squadronSelection = new Set();
    this.battle.baseVisible = computeVisibility(this.battle.units, "A");
    this.pushLog(`--- ターン${this.battle.turn} 作戦開始 ---`);
    this.render();
  }

  endSideATurn() {
    runAISidePhase(this.battle, "B", this.getEnemyWeights(), "A");
    if (this.battle.selectedUnitId && !this.selectedUnit()) {
      this.battle.selectedUnitId = null;
      this.battle.uiMode = "idle";
      this.battle.highlight = new Set();
    }
    if (this.battle.inspectUnitId && !this.battle.units.find(u => u.id === this.battle.inspectUnitId && u.hp > 0)) {
      this.battle.inspectUnitId = null;
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
  selectUnit(id) {
    this.battle.selectedUnitId = id;
    this.battle.inspectUnitId = null;
    this.battle.uiMode = "idle";
    this.battle.highlight = new Set();
    this.battle.squadronSelection = new Set();
    this.render();
  }
  selectedUnit() {
    const u = this.battle.units.find(u => u.id === this.battle.selectedUnitId);
    return (u && u.hp > 0) ? u : null;
  }
  inspectedUnit() {
    if (!this.battle.inspectUnitId) return null;
    const u = this.battle.units.find(u => u.id === this.battle.inspectUnitId);
    return (u && u.hp > 0) ? u : null;
  }
  isVisibleTile(r, c) { const k = `${r},${c}`; return this.battle.baseVisible.has(k) || this.battle.tempRevealed.has(k); }
  visibleUnitAt(r, c) {
    const u = unitAt(this.battle.units, r, c);
    if (!u) return null;
    return (u.side === "A" || this.isVisibleTile(r, c)) ? u : null;
  }

  toggleSquadronSelection(idx) {
    const u = this.selectedUnit(); if (!u || !u.squadrons) return;
    if (!this.battle.squadronSelection) this.battle.squadronSelection = new Set();
    if (this.battle.squadronSelection.has(idx)) this.battle.squadronSelection.delete(idx);
    else this.battle.squadronSelection.add(idx);
    this.render();
  }

  onCellClick(r, c) {
    const key = `${r},${c}`;
    if (!this.battle.selectedUnitId) {
      const u = this.visibleUnitAt(r, c);
      if (u && u.side === "A") this.selectUnit(u.id);
      else if (u && u.side === "B") {
        this.battle.inspectUnitId = u.id;
        this.battle.uiMode = "idle";
        this.battle.highlight = new Set();
        this.render();
      } else {
        this.battle.inspectUnitId = null;
        this.render();
      }
      return;
    }
    const unit = this.selectedUnit();
    if (!unit) { this.battle.selectedUnitId = null; this.battle.uiMode = "idle"; this.battle.highlight = new Set(); this.render(); return; }
    const mode = this.battle.uiMode;
    if (mode === "move") { if (this.battle.highlight.has(key)) this.moveUnit(unit, r, c); return; }
    if (mode === "gun") { if (this.battle.highlight.has(key)) { const t = unitAt(this.battle.units, r, c); if (t) this.executeAttack(unit, t, "gun"); } return; }
    if (mode === "torpedo") { if (this.battle.highlight.has(key)) { const t = unitAt(this.battle.units, r, c); if (t) this.executeAttack(unit, t, "torpedo"); } return; }
    if (mode.startsWith("squadron-") && mode !== "squadron-multi") {
      if (this.battle.highlight.has(key)) {
        const idx = parseInt(mode.substring(9));
        const t = unitAt(this.battle.units, r, c);
        if (t) this.executeSquadronAttack(unit, idx, t);
      }
      return;
    }
    if (mode === "squadron-multi") {
      if (this.battle.highlight.has(key)) {
        const t = unitAt(this.battle.units, r, c);
        if (t) this.executeMultiSquadronAttack(unit, t);
      }
      return;
    }
    if (mode === "ability") { if (this.battle.highlight.has(key)) this.executeAbility(unit, r, c); return; }
    const clicked = this.visibleUnitAt(r, c);
    if (clicked && clicked.side === "A") this.selectUnit(clicked.id);
    else if (clicked && clicked.side === "B") {
      this.battle.inspectUnitId = clicked.id;
      this.battle.selectedUnitId = null;
      this.battle.uiMode = "idle";
      this.battle.highlight = new Set();
      this.render();
    }
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
  enterMultiSquadronMode() {
    const u = this.selectedUnit(); if (!u || u.hasActed || !u.squadrons) return;
    const sel = Array.from(this.battle.squadronSelection || []);
    const active = sel.filter(i => u.squadrons[i] && u.squadrons[i].hp > 0);
    if (active.length < 2) return;
    const set = new Set();
    this.battle.units.filter(e => e.side === "B" && e.hp > 0).forEach(e => {
      if (chebyshev(u.r, u.c, e.r, e.c) <= AIR_RANGE && this.isVisibleTile(e.r, e.c)) set.add(`${e.r},${e.c}`);
    });
    this.battle.uiMode = "squadron-multi"; this.battle.highlight = set;
    if (set.size === 0) this.toast("射程内に敵艦がいません", "danger");
    this.render();
  }
  enterAbilityMode() {
    const u = this.selectedUnit(); if (!u || u.hasActed) return;
    const def = UNIT_TYPES[u.type]; if (!def.ability || u.abilityUses <= 0) return;
    const ab = def.ability;
    if (SELF_BUFF_TYPES.has(ab.type)) { this.executeAbility(u, u.r, u.c); return; }
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
      if (set.size === 0) { this.toast("射程内に敵潜水艦がいません", "danger"); return; }
    } else if (ab.type === "focusedFire") {
      this.battle.units.filter(e => e.side === "B" && e.hp > 0).forEach(e => {
        if (chebyshev(u.r, u.c, e.r, e.c) <= ab.range && this.isVisibleTile(e.r, e.c)) set.add(`${e.r},${e.c}`);
      });
      if (set.size === 0) { this.toast("射程内に敵艦がいません", "danger"); return; }
    } else if (ab.type === "resupply") {
      this.battle.units.filter(e => e.side === "A" && e.hp > 0 && e.id !== u.id).forEach(e => {
        if (chebyshev(u.r, u.c, e.r, e.c) <= ab.range) set.add(`${e.r},${e.c}`);
      });
      if (set.size === 0) { this.toast("射程内に味方がいません", "danger"); return; }
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
    this.battle.squadronSelection = new Set();
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
    if (sq.hp <= 0 && beforeHp > 0) this.toast(`${sq.label}が全滅`, "danger");
    cv.hasActed = true;
    this.battle.squadronSelection = new Set();
    this.battle.uiMode = "idle"; this.battle.highlight = new Set();
    const oc = checkOutcome(this.battle);
    if (oc) { this.finishBattle(oc); return; }
    this.render();
  }
  executeMultiSquadronAttack(cv, target) {
    const sel = Array.from(this.battle.squadronSelection || []);
    const active = sel.filter(i => cv.squadrons[i] && cv.squadrons[i].hp > 0);
    if (active.length < 2) return;
    const beforeHps = active.map(i => cv.squadrons[i].hp);
    resolveCombinedAirAttack(cv, active, target, (m) => this.pushLog(m), this.battle.units);
    const targetLabel = unitLabel(target, "pvai");
    if (target.hp <= 0) this.toast(`${targetLabel}撃沈！`, "success");
    active.forEach((i, k) => {
      const sq = cv.squadrons[i];
      if (sq.hp <= 0 && beforeHps[k] > 0) this.toast(`${sq.label}が全滅`, "danger");
    });
    cv.hasActed = true;
    this.battle.squadronSelection = new Set();
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
    } else if (ab.type === "resupply") {
      const target = unitAt(this.battle.units, r, c);
      if (!target || target.side !== "A" || target.hp <= 0 || target.id === unit.id) return;
      const tdef = UNIT_TYPES[target.type];
      const before = target.hp;
      target.hp = Math.min(tdef.hp, target.hp + ab.heal);
      const healAmount = target.hp - before;
      const resupplied = [];
      if (tdef.torpedo && target.torpedoUses < tdef.torpedo.uses) { target.torpedoUses++; resupplied.push("魚雷1"); }
      if (tdef.ability && target.abilityUses < tdef.ability.uses) { target.abilityUses++; resupplied.push("能力1"); }
      this.pushLog(`${unitLabel(unit, "pvai")}が${ab.label}を実行、${unitLabel(target, "pvai")}のHPを${healAmount}回復${resupplied.length ? "、" + resupplied.join("・") + "補充" : ""}。`);
      this.toast(`${ab.label}発動！`, "event");
      unit.abilityUses--; unit.hasActed = true;
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
      s.side = "A"; s.weights = this.getSpectateWeightsA();
      s.visible = computeVisibility(b.units, "A");
      s.unitQueue = b.units.filter(u => u.side === "A" && u.hp > 0);
      s.unitIndex = 0; s.phase = "act";
      this.pushLog(`--- ターン${b.turn} 青軍の行動 ---`);
      return;
    }
    if (s.phase === "B-start") {
      b.units.forEach(u => { if (u.side === "B") { u.hasMoved = false; u.hasActed = false; u.evasionBuff = 0; u.aaBuff = 0; } });
      s.side = "B"; s.weights = this.getSpectateWeightsB();
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
          <p class="stage-desc">学習済みAI（青軍）と敵艦隊（赤軍）を自動対戦させます。敵艦隊はJSONからインポート、またはランダム生成できます。</p>
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
              const isCarrier = (t === "CV" || t === "CVL" || t === "AV");
              const extra = isCarrier ? `航空${makeSquadronsFor(t).length}隊` : `AA${def.aa}/ASW${def.asw}`;
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
              <button onclick="game.applyDeployPreset(['CVL','AV','DD','FF','FF'])">軽空母機動</button>
              <button onclick="game.applyDeployPreset(['CV','CVL','CA','DD','FF'])">空母機動艦隊</button>
              <button onclick="game.applyDeployPreset(['BB','CV','AO','DD','FF'])">補給支援艦隊</button>
              <button onclick="game.applyDeployPreset(['SS','SS','DD','CL','FF'])">潜水艦隊</button>
              <button onclick="game.randomizePlayerFleet()">🎲 ランダム</button>
              <button onclick="game.clearDeploy()">クリア</button>
            </div>
          </div>
          <div class="unit-panel" style="padding:10px;">
            ${this.aiSettingsPanelHTML("enemy", "敵AIの行動パラメータ")}
          </div>
          <div class="unit-panel">
            <h3>敵編成の設定</h3>
            <p class="hint">現在: <strong style="color:var(--gold)">${this.pvaiEnemyFleet ? fleetDisplayString(this.pvaiEnemyFleet) : `学習済みAI（${fleetDisplayString(this.champion.fleet)}）`}</strong></p>
            <div class="spectate-controls" style="margin-top:8px; flex-wrap:wrap;">
              <button onclick="document.getElementById('pvaiEnemyFile').click()">JSONからインポート</button>
              <button onclick="game.randomizePvAIEnemy()">🎲 ランダム編成</button>
              ${this.pvaiEnemyFleet ? `<button onclick="game.clearPvAIEnemy()">学習済みAIに戻す</button>` : ""}
            </div>
            <input id="pvaiEnemyFile" type="file" accept=".json,application/json" style="display:none" onchange="game.importPvAIEnemy(this)">
          </div>
          <p class="hint">艦種を選んで左のマップの自軍海域（青枠）をクリックして配備。相手編成は「敵編成の設定」から変更できます。</p>
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

  inspectPanelHTML(unit) {
    const def = UNIT_TYPES[unit.type];
    return `
      <div class="unit-panel" style="border-color: var(--enemy-red);">
        <h3 style="color: var(--enemy-red);">🔍 ${unitLabel(unit, "pvai")} の情報</h3>
        <div class="stat-grid">
          <div class="stat"><span class="stat-label">HP</span><span class="stat-value">${unit.hp}/${def.hp}</span></div>
          <div class="stat"><span class="stat-label">移動</span><span class="stat-value">${def.move}</span></div>
          <div class="stat"><span class="stat-label">砲撃力</span><span class="stat-value">${def.gunPower}</span></div>
          <div class="stat"><span class="stat-label">射程</span><span class="stat-value">${def.gunRange}</span></div>
          <div class="stat"><span class="stat-label">回避</span><span class="stat-value">${def.evasion}%${unit.evasionBuff ? ` (+${unit.evasionBuff})` : ""}</span></div>
          <div class="stat"><span class="stat-label">防御</span><span class="stat-value">${def.defense}</span></div>
          <div class="stat"><span class="stat-label">対空</span><span class="stat-value">${def.aa}${unit.aaBuff ? ` (+${unit.aaBuff})` : ""}</span></div>
          <div class="stat"><span class="stat-label">対潜</span><span class="stat-value">${def.asw}</span></div>
          <div class="stat"><span class="stat-label">視界</span><span class="stat-value">${def.vision}</span></div>
          ${def.torpedo ? `<div class="stat"><span class="stat-label">魚雷威力</span><span class="stat-value">${def.torpedo.power}</span></div>` : ""}
          ${def.torpedo ? `<div class="stat"><span class="stat-label">魚雷残</span><span class="stat-value">${unit.torpedoUses}</span></div>` : ""}
          ${def.ability ? `<div class="stat"><span class="stat-label">能力</span><span class="stat-value">${def.ability.label} 残${unit.abilityUses}</span></div>` : ""}
        </div>
        ${unit.squadrons ? `
          <div class="hint" style="margin-top:6px;">搭載航空隊:</div>
          <div class="stat-grid" style="grid-template-columns:1fr;">
            ${unit.squadrons.map(sq => `<div class="stat"><span class="stat-label">${sq.label}</span><span class="stat-value">${sq.hp}/${sq.maxHp}（対艦${sq.attackPower}/対空${sq.airAttack}）</span></div>`).join("")}
          </div>` : ""}
        <p class="hint" style="margin-top:8px;">クリックで選択解除。自軍艦をクリックすると操作できます。</p>
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
        const checked = this.battle.squadronSelection && this.battle.squadronSelection.has(i);
        buttons += `
          <div style="display:flex; gap:6px; align-items:stretch;">
            <label title="同時出撃に追加" style="display:flex; align-items:center; padding:0 6px; background:rgba(0,0,0,0.22); border:1px solid var(--border); border-radius:6px; cursor:${disabled ? "not-allowed" : "pointer"};">
              <input type="checkbox" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} onclick="event.stopPropagation(); game.toggleSquadronSelection(${i});">
            </label>
            <button style="flex:1;" ${disabled ? "disabled" : ""} onclick="game.enterSquadronMode(${i})">${sq.label} (HP${sq.hp}/${sq.maxHp} ${hpPct}%・対艦${sq.attackPower}・対空${sq.airAttack})</button>
          </div>`;
      });
      const activeCount = Array.from(this.battle.squadronSelection || []).filter(i => unit.squadrons[i] && unit.squadrons[i].hp > 0).length;
      if (activeCount >= 2) {
        buttons += `<button class="end-turn" ${unit.hasActed ? "disabled" : ""} onclick="game.enterMultiSquadronMode()">選択した${activeCount}隊で同時攻撃</button>`;
      }
    }
    if (ab) {
      let label;
      if (ab.type === "salvo") label = `${ab.label} (中心${ab.centerPower}/範囲${ab.splashPower})`;
      else if (ab.type === "aswStrike") label = `${ab.label} (対潜特効・射程${ab.range}・威力${ab.power})`;
      else if (ab.type === "focusedFire") label = `${ab.label} (射程${ab.range}・威力${ab.power})`;
      else if (ab.type === "resupply") label = `${ab.label} (射程${ab.range}・回復${ab.heal})`;
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
    const inspected = this.inspectedUnit();
    let panelHTML;
    if (unit) panelHTML = this.unitPanelHTML(unit);
    else if (inspected && inspected.side === "B") panelHTML = this.inspectPanelHTML(inspected);
    else panelHTML = `<p class="hint">自軍艦をクリックして選択してください。敵艦をクリックすると情報を表示します。移動・砲撃・魚雷・特殊能力・航空攻撃を組み合わせて敵AI艦隊を撃破しましょう。</p>`;
    return `
      <header id="topbar">
        <h1>プレイヤー対AI</h1>
        <div class="meta"><span>ターン ${this.battle.turn} / ${MAP.turnLimit}</span><span>目標: 敵AI艦隊を殲滅せよ</span></div>
      </header>
      <main class="battle-main">
        <section class="map-panel">${this.mapTableHTML()}</section>
        <section class="side-panel">
          <div class="unit-panel">${panelHTML}</div>
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
            <p class="hint">現在: <strong style="color:var(--gold)">${this.spectateEnemyFleet ? fleetDisplayString(this.spectateEnemyFleet) : "初期AI（BB・CV・DD）"}</strong></p>
            <div class="spectate-controls" style="margin-top:8px; flex-wrap:wrap;">
              <button onclick="document.getElementById('spectateEnemyFile').click()">JSONからインポート</button>
              <button onclick="game.randomizeSpectateEnemy()">🎲 ランダム編成</button>
              ${this.spectateEnemyFleet ? `<button onclick="game.clearSpectateEnemy()">初期AIに戻す</button>` : ""}
            </div>
            <input id="spectateEnemyFile" type="file" accept=".json,application/json" style="display:none" onchange="game.importSpectateEnemy(this)">
          </div>
          <div class="unit-panel" style="padding:10px;">
            ${this.aiSettingsPanelHTML("A", "青軍AIの行動パラメータ")}
          </div>
          <div class="unit-panel" style="padding:10px;">
            ${this.aiSettingsPanelHTML("B", "赤軍AIの行動パラメータ")}
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
        <p class="hint" style="margin-top:-6px;">エクスポートボタンで保存先ダイアログが開きます（対応ブラウザ）。非対応の場合はダウンロードフォルダに保存されます。</p>
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