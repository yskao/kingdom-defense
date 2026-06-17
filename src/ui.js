// DOM UI：HUD、環形建塔選單、升級/賣塔選單、橫幅與結算畫面。
import { TOWERS } from './data.js';
import { sellRefund, callBonus, starsForLives } from './sim.js';

const ICONS = { archer: '🏹', cannon: '💣', mage: '🔮', frost: '❄️', tesla: '⚡', poison: '☠️' };
const TARGET_MODES = ['first', 'last', 'strong', 'near'];
const TARGET_LABEL = { first: '最前', last: '最後', strong: '最強', near: '最近' };
const TARGET_ICON = { first: '🎯', last: '🐢', strong: '💪', near: '📍' };

export class UI {
  // toScreen: 邏輯座標 → overlay 內 px 的轉換函式
  constructor({ overlay, toScreen, onExit, onReplay }) {
    this.overlay = overlay;
    this.toScreen = toScreen;
    this.onExit = onExit;
    this.onReplay = onReplay;
    this.game = null;
    this.selection = null; // { kind:'spot'|'tower', spotIndex, tower? }
    this.banner = document.createElement('div');
    this.banner.id = 'banner';
    overlay.appendChild(this.banner);

    this.els = {
      lives: document.getElementById('hud-lives'),
      gold: document.getElementById('hud-gold'),
      wave: document.getElementById('hud-wave'),
      call: document.getElementById('btn-call'),
      callBonus: document.getElementById('call-bonus'),
    };
  }

  attach(game) {
    this.game = game;
    this.clearSelection();
    this.overlay.querySelector('.endcard')?.remove();
    game.onEvent = kind => {
      this.refreshHUD();
      if (kind === 'wave') this.showBanner(`第 ${game.waveIndex + 1} / ${game.totalWaves} 波來襲！`);
      if (kind === 'end') this.showEnd();
    };
    this.refreshHUD();
  }

  refreshHUD() {
    const g = this.game;
    this.els.lives.textContent = g.lives;
    this.els.gold.textContent = g.gold;
    this.els.wave.textContent = `${Math.max(0, g.waveIndex + 1)}/${g.totalWaves}`;
    // 提前召喚按鈕（第一波也適用，但不給獎勵時隱藏文字邏輯簡化為同一顆）
    const showCall = g.state === 'playing' && g.countdown > 0 && g.waveIndex + 1 < g.totalWaves;
    this.els.call.hidden = !showCall;
    if (showCall) this.els.callBonus.textContent = g.waveIndex >= 0 ? callBonus(g.countdown) : 0;
    // 選單按鈕的可負擔狀態
    this.overlay.querySelectorAll('.menu-btn[data-cost]').forEach(btn => {
      btn.disabled = g.gold < +btn.dataset.cost;
    });
  }

  showBanner(text) {
    this.banner.textContent = text;
    this.banner.style.opacity = 1;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (this.banner.style.opacity = 0), 1800);
  }

  // ----- 點擊處理（main 轉好邏輯座標再呼叫）-----

  handleTap(lx, ly) {
    const g = this.game;
    if (!g || g.state !== 'playing') return;
    // 點到塔位？
    let hit = -1;
    g.level.spots.forEach(([sx, sy], i) => {
      if (Math.hypot(lx - sx, ly - sy) < 30) hit = i;
    });
    if (hit < 0) { this.clearSelection(); return; }
    const tower = g.towerAt(hit);
    this.clearSelection();
    if (tower) this.openTowerMenu(hit, tower);
    else this.openBuildMenu(hit);
  }

  clearSelection() {
    this.selection = null;
    this.overlay.querySelectorAll('.menu-btn').forEach(b => b.remove());
  }

  // 環形選單半徑（螢幕 px，固定大小→任何螢幕都不重疊）。按鈕約 58px，6 顆需半徑 ~80+。
  ringRadius(count) {
    const btn = 58;
    // 相鄰按鈕間距 = 2R·sin(π/count)，要 >= btn+10
    const need = (btn + 12) / (2 * Math.sin(Math.PI / Math.max(count, 2)));
    return Math.max(76, need);
  }

  openBuildMenu(spotIndex) {
    const g = this.game;
    const [sx, sy] = g.level.spots[spotIndex];
    this.selection = { kind: 'spot', spotIndex };
    const types = Object.keys(TOWERS);
    const center = this.toScreen(sx, sy);
    const R = this.ringRadius(types.length);
    types.forEach((type, i) => {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / types.length;
      const cost = TOWERS[type].levels[0].cost;
      this.addMenuBtn({
        x: center.x + Math.cos(angle) * R,
        y: center.y + Math.sin(angle) * R,
        icon: ICONS[type], label: TOWERS[type].name, cost,
        onTap: () => { if (g.build(spotIndex, type)) this.clearSelection(); },
      });
    });
  }

  openTowerMenu(spotIndex, tower) {
    const g = this.game;
    const [sx, sy] = g.level.spots[spotIndex];
    this.selection = { kind: 'tower', spotIndex, tower };
    const center = this.toScreen(sx, sy);
    const R = 76;
    const up = g.upgradeCost(tower);
    if (up != null) {
      this.addMenuBtn({
        x: center.x, y: center.y - R, icon: '⬆️', label: '升級', cost: up,
        onTap: () => {
          if (g.upgrade(tower)) { this.clearSelection(); this.openTowerMenu(spotIndex, tower); }
        },
      });
    }
    this.addMenuBtn({
      x: center.x, y: center.y + R, icon: '💰', label: `賣 +${sellRefund(tower.spent)}`,
      sell: true,
      onTap: () => { g.sell(tower); this.clearSelection(); },
    });
    // 目標模式（最前/最後/最強/最近）：點擊循環切換
    const mode = tower.targetMode || 'first';
    this.addMenuBtn({
      x: center.x - R, y: center.y, icon: TARGET_ICON[mode], label: TARGET_LABEL[mode],
      onTap: () => {
        const i = TARGET_MODES.indexOf(tower.targetMode || 'first');
        tower.targetMode = TARGET_MODES[(i + 1) % TARGET_MODES.length];
        this.clearSelection();
        this.openTowerMenu(spotIndex, tower);
      },
    });
  }

  // x,y 為螢幕像素座標（已含環形偏移）
  addMenuBtn({ x, y, icon, label, cost, onTap, sell }) {
    const btn = document.createElement('button');
    btn.className = 'menu-btn' + (sell ? ' sell' : '');
    btn.innerHTML = `<span class="icon">${icon}</span><span>${label}</span>` +
      (cost != null ? `<span class="cost">${cost}💰</span>` : '');
    if (cost != null) {
      btn.dataset.cost = cost;
      btn.disabled = this.game.gold < cost;
    }
    // 夾在覆蓋層可視範圍內，確保按鈕永遠完整可點
    const PAD = 36;
    const ow = this.overlay.clientWidth, oh = this.overlay.clientHeight;
    btn.style.left = `${Math.max(PAD, Math.min(x, ow - PAD))}px`;
    btn.style.top = `${Math.max(PAD, Math.min(y, oh - PAD))}px`;
    btn.addEventListener('pointerdown', ev => { ev.stopPropagation(); onTap(); });
    this.overlay.appendChild(btn);
  }

  // 重新定位選單（視窗縮放時由 main 呼叫）
  reposition() {
    if (!this.selection) return;
    const sel = this.selection;
    this.clearSelection();
    if (sel.kind === 'spot') this.openBuildMenu(sel.spotIndex);
    else this.openTowerMenu(sel.spotIndex, sel.tower);
  }

  showEnd() {
    const g = this.game;
    const won = g.state === 'won';
    const stars = won ? starsForLives(g.lives) : 0;
    const card = document.createElement('div');
    card.className = 'endcard';
    const starsHtml = won
      ? `<div class="stars">${Array.from({ length: 3 }, (_, i) =>
          i < stars ? '<span class="s">★</span>' : '<span class="off">★</span>').join('')}</div>`
      : '';
    card.innerHTML = `
      <div class="panel">
        <h2 class="${won ? 'win' : 'lose'}">${won ? '勝 利' : '城門失守'}</h2>
        ${starsHtml}
        <div class="row">
          <button data-act="replay">重玩本關</button>
          <button data-act="exit">回關卡選擇</button>
        </div>
      </div>`;
    card.addEventListener('pointerdown', ev => {
      const act = ev.target.dataset?.act;
      if (act === 'replay') this.onReplay();
      if (act === 'exit') this.onExit();
    });
    this.overlay.appendChild(card);
    return stars;
  }
}
