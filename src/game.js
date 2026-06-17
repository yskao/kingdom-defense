// 遊戲狀態與模擬：波次出怪、敵人移動、塔攻擊、投射物、勝負。
import { ENEMIES, TOWERS, RULES } from './data.js';
import { pointAt, damageTo, sellRefund, callBonus } from './sim.js';
import { sfx } from './sound.js';

export const STEP = 1 / 60;
const FIRST_WAVE_DELAY = 6;

export class Game {
  constructor(level, mods = {}) {
    this.level = level;
    // 難度＋星星商店的綜合加成（由 main.js 算好傳入；預設＝普通、無升級）
    this.mods = {
      hpMul: mods.hpMul ?? 1, goldMul: mods.goldMul ?? 1,
      livesAdd: mods.livesAdd ?? 0, bountyMul: mods.bountyMul ?? 1,
      dmgMul: mods.dmgMul ?? 1,
    };
    this.gold = Math.round(level.startGold * this.mods.goldMul);
    this.lives = Math.max(1, RULES.startLives + this.mods.livesAdd);
    this.waveIndex = -1;            // 目前進行中的波（-1 = 還沒開始）
    this.countdown = FIRST_WAVE_DELAY; // >0 表示下一波倒數中
    this.enemies = [];
    this.towers = [];
    this.projectiles = [];
    this.effects = [];
    this.spawners = [];
    this.state = 'playing';        // playing | won | lost
    this.onEvent = null;           // ui 掛 hook：('wave'|'gold'|'lives'|'end')
  }

  get totalWaves() { return this.level.waves.length; }

  emit(kind) { if (this.onEvent) this.onEvent(kind); }

  // ----- 波次 -----

  startNextWave(early = false) {
    if (this.waveIndex + 1 >= this.totalWaves || this.state !== 'playing') return;
    if (early && this.countdown > 0 && this.waveIndex >= 0) {
      const bonus = callBonus(this.countdown);
      this.gold += bonus;
    }
    this.waveIndex++;
    this.countdown = 0;
    for (const g of this.level.waves[this.waveIndex]) {
      this.spawners.push({ ...g, path: g.path ?? 0, spawned: 0, timer: g.delay ?? 0 });
    }
    this.emit('wave');
    sfx('wave');
  }

  spawn(type, pathIndex, startDist = 0, hpScale = 1) {
    const def = ENEMIES[type];
    this._eid = (this._eid ?? 0) + 1;
    const hp = def.hp * this.level.hpMul * hpScale * this.mods.hpMul;
    this.enemies.push({
      type, def, pathIndex,
      hp, maxHp: hp,
      dist: startDist,
      slowT: 0, slowPct: 0, hitT: 0,
      poisonT: 0, poisonDps: 0,        // 毒 DoT 狀態
      healCd: def.healRate ?? 0,       // 薩滿治療冷卻
      seed: this._eid * 2.39996,
      pos: pointAt(this.level.pathsBuilt[pathIndex], startDist),
    });
  }

  // ----- 塔操作（由 ui 呼叫）-----

  towerAt(spotIndex) { return this.towers.find(t => t.spotIndex === spotIndex); }

  build(spotIndex, type) {
    const cost = TOWERS[type].levels[0].cost;
    if (this.gold < cost || this.towerAt(spotIndex)) return false;
    const [x, y] = this.level.spots[spotIndex];
    this.gold -= cost;
    this.towers.push({ spotIndex, type, level: 0, x, y, cooldown: 0, spent: cost, aim: 0 });
    this.emit('gold');
    sfx('build');
    return true;
  }

  upgradeCost(tower) {
    return tower.level >= 2 ? null : TOWERS[tower.type].levels[tower.level + 1].cost;
  }

  upgrade(tower) {
    const cost = this.upgradeCost(tower);
    if (cost == null || this.gold < cost) return false;
    this.gold -= cost;
    tower.level++;
    tower.spent += cost;
    this.emit('gold');
    sfx('upgrade');
    return true;
  }

  sell(tower) {
    this.gold += sellRefund(tower.spent);
    this.towers = this.towers.filter(t => t !== tower);
    this.emit('gold');
    sfx('sell');
  }

  // ----- 主模擬步 -----

  step(dt) {
    if (this.state !== 'playing') return;

    // 倒數與自動開波
    if (this.countdown > 0) {
      this.countdown -= dt;
      if (this.countdown <= 0) this.startNextWave();
    }

    // 出怪
    for (const s of this.spawners) {
      s.timer -= dt;
      while (s.timer <= 0 && s.spawned < s.count) {
        this.spawn(s.type, s.path);
        s.spawned++;
        s.timer += s.gap;
      }
    }
    this.spawners = this.spawners.filter(s => s.spawned < s.count);

    // 本波出完且還有下一波 → 開始倒數
    if (this.spawners.length === 0 && this.countdown <= 0 &&
        this.waveIndex >= 0 && this.waveIndex + 1 < this.totalWaves) {
      this.countdown = RULES.waveCountdown;
    }

    // 敵人移動 + 狀態結算（減速、毒、薩滿治療）
    for (const e of this.enemies) {
      if (e.slowT > 0) e.slowT -= dt;
      if (e.hitT > 0) e.hitT -= dt;
      // 毒 DoT：無視護甲的真實傷害，不觸發閃白
      if (e.poisonT > 0) {
        e.poisonT -= dt;
        this.applyDamage(e, e.poisonDps * dt, false);
      }
      // 薩滿：定期治療範圍內友軍（含自己）
      if (e.def.heal && e.hp > 0) {
        e.healCd -= dt;
        if (e.healCd <= 0) {
          e.healCd = e.def.healRate;
          let healed = false;
          for (const o of this.enemies) {
            if (o.hp <= 0 || o.reached) continue;
            if (Math.hypot(o.pos.x - e.pos.x, o.pos.y - e.pos.y) <= e.def.healRange) {
              if (o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + e.def.heal); healed = true; }
            }
          }
          if (healed) this.effects.push({ type: 'heal', x: e.pos.x, y: e.pos.y, radius: e.def.healRange, t: 0, dur: 0.6 });
        }
      }
      const slow = e.slowT > 0 ? e.slowPct : 0;
      e.dist += e.def.speed * (1 - slow) * dt;
      const path = this.level.pathsBuilt[e.pathIndex];
      e.pos = pointAt(path, e.dist);
      if (e.dist >= path.total) {
        e.reached = true;
        this.lives = Math.max(0, this.lives - e.def.livesCost);
        this.emit('lives');
        sfx('lifeLost');
      }
    }
    this.enemies = this.enemies.filter(e => !e.reached && e.hp > 0);

    // 塔攻擊
    for (const t of this.towers) {
      t.cooldown -= dt;
      if (t.recoil > 0) t.recoil -= dt * 6;
      if (t.cooldown > 0) continue;
      const def = TOWERS[t.type];
      const lv = def.levels[t.level];
      const target = this.pickTarget(t, def, lv);
      if (!target) continue;
      t.cooldown = lv.rate;
      if (t.type === 'frost') {
        // 範圍脈衝減速
        for (const e of this.enemies) {
          if (this.inRange(t, e, lv.range)) { e.slowT = lv.slowDur; e.slowPct = lv.slow; }
        }
        this.effects.push({ type: 'frost', x: t.x, y: t.y - 6, radius: lv.range, t: 0, dur: 0.5 });
      } else if (t.type === 'tesla') {
        this.fireTesla(t, lv, target);
        sfx('tesla');
      } else {
        t.aim = Math.atan2(target.pos.y - t.y, target.pos.x - t.x);
        if (t.type === 'cannon') t.recoil = 1;
        sfx(t.type === 'cannon' ? 'cannon' : t.type === 'poison' ? 'poison' : t.type === 'mage' ? 'magic' : 'arrow');
        const kind = t.type === 'archer' ? 'arrow' : t.type === 'cannon' ? 'cannonball'
          : t.type === 'poison' ? 'gas' : 'bolt';
        const speed = t.type === 'cannon' ? 260 : t.type === 'poison' ? 300 : 420;
        this.projectiles.push({
          kind, x: t.x, y: t.y - 14, vx: 0, vy: 0, speed,
          target, damage: lv.damage * this.mods.dmgMul, damageType: def.damageType, splash: lv.splash ?? 0,
          poison: (lv.poison ?? 0) * this.mods.dmgMul, poisonDur: lv.poisonDur ?? 0,
        });
      }
    }

    // 投射物
    for (const p of this.projectiles) {
      const tx = p.target.hp > 0 && !p.target.reached ? p.target.pos.x : p.lastX ?? p.x;
      const ty = p.target.hp > 0 && !p.target.reached ? p.target.pos.y : p.lastY ?? p.y;
      p.lastX = tx; p.lastY = ty;
      const dx = tx - p.x, dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      const stepLen = p.speed * dt;
      if (d <= stepLen + 6) {
        this.impact(p, tx, ty);
        p.done = true;
      } else {
        p.vx = (dx / d) * p.speed; p.vy = (dy / d) * p.speed;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.done);

    // 特效計時
    for (const fx of this.effects) fx.t += dt;
    this.effects = this.effects.filter(fx => fx.t < fx.dur);

    // 勝負
    if (this.lives <= 0) {
      this.state = 'lost';
      this.emit('end');
      sfx('lose');
    } else if (this.waveIndex + 1 >= this.totalWaves &&
               this.spawners.length === 0 && this.enemies.length === 0) {
      this.state = 'won';
      this.emit('end');
      sfx('win');
    }
  }

  inRange(t, e, range) {
    return Math.hypot(e.pos.x - t.x, e.pos.y - (t.y - 6)) <= range + e.def.radius;
  }

  // 索敵：射程內最接近城門（dist 最大）者；砲塔跳過飛行單位。
  pickTarget(t, def, lv) {
    let best = null;
    for (const e of this.enemies) {
      if (e.def.flying && !def.hitsFlying) continue;
      if (!this.inRange(t, e, lv.range)) continue;
      if (!best || e.dist > best.dist) best = e;
    }
    return best;
  }

  // 連鎖閃電：擊中目標後跳向最近、尚未命中的敵人，傷害逐跳衰減。
  fireTesla(t, lv, target) {
    const origin = { x: t.x, y: t.y - 14 };
    const chainPts = [origin];
    const hitSet = new Set();
    let current = target;
    let dmg = lv.damage * this.mods.dmgMul;
    for (let i = 0; i < lv.chain && current; i++) {
      hitSet.add(current);
      chainPts.push({ x: current.pos.x, y: current.pos.y });
      this.hurt(current, dmg, 'magic');
      dmg *= lv.chainFalloff;
      // 找下一跳：離 current 最近、未命中、距離 <90 的敵人
      let next = null, best = 90;
      for (const e of this.enemies) {
        if (hitSet.has(e) || e.hp <= 0) continue;
        if (e.def.flying && !TOWERS.tesla.hitsFlying) continue;
        const d = Math.hypot(e.pos.x - current.pos.x, e.pos.y - current.pos.y);
        if (d < best) { best = d; next = e; }
      }
      current = next;
    }
    this.effects.push({ type: 'lightning', pts: chainPts, t: 0, dur: 0.2 });
  }

  impact(p, x, y) {
    if (p.splash > 0) {
      const isGas = p.kind === 'gas';
      this.effects.push({ type: isGas ? 'gas' : 'splash', x, y, radius: p.splash, t: 0, dur: isGas ? 0.5 : 0.35, seed: x + y });
      for (const e of this.enemies) {
        if (e.def.flying && !isGas) continue; // 砲塔濺射打不到飛行；毒氣可以
        if (Math.hypot(e.pos.x - x, e.pos.y - y) <= p.splash + e.def.radius) {
          this.hurt(e, p.damage, p.damageType);
          if (p.poison > 0) { e.poisonDps = Math.max(e.poisonDps, p.poison); e.poisonT = p.poisonDur; }
        }
      }
    } else if (p.target.hp > 0 && !p.target.reached) {
      this.hurt(p.target, p.damage, p.damageType);
      this.effects.push({ type: 'spark', x, y, t: 0, dur: 0.22, seed: x + y });
    }
  }

  hurt(e, damage, damageType) {
    const dealt = damageTo(e.def, damage, damageType);
    this.applyDamage(e, dealt, true);
    // 命中跳傷害數字（手感回饋）
    const n = Math.round(dealt);
    if (n >= 1) {
      this._txtSeed = (this._txtSeed ?? 0) + 1;
      this.effects.push({
        type: 'dmgText', x: e.pos.x, y: e.pos.y - e.def.radius - 4,
        amount: n, dt: damageType, t: 0, dur: 0.6, seed: this._txtSeed,
      });
    }
  }

  // 集中傷害結算：扣血、閃白、死亡（賞金、特效、史萊姆分裂）。
  applyDamage(e, amount, flash) {
    if (e.hp <= 0) return;
    e.hp -= amount;
    if (flash) e.hitT = 0.12;
    if (e.hp <= 0 && !e.bountyPaid) {
      e.bountyPaid = true;
      this.gold += Math.round(e.def.bounty * this.mods.bountyMul);
      this.effects.push({
        type: 'death', x: e.pos.x, y: e.pos.y, t: 0, dur: 0.65,
        color: e.def.color, seed: e.seed * 1000, big: e.type === 'boss',
      });
      this.effects.push({ type: 'coin', x: e.pos.x, y: e.pos.y, amount: e.def.bounty, t: 0, dur: 0.9 });
      this.emit('gold');
      sfx(e.type === 'boss' ? 'cannon' : 'death'); sfx('coin');
      // 史萊姆死亡分裂
      if (e.def.splitInto) {
        const path = this.level.pathsBuilt[e.pathIndex];
        for (let i = 0; i < e.def.splitCount; i++) {
          const off = (i - (e.def.splitCount - 1) / 2) * 24;
          const d = Math.max(0, Math.min(path.total - 1, e.dist + off));
          this.spawn(e.def.splitInto, e.pathIndex, d);
        }
      }
    }
  }
}
