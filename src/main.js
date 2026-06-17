// 進入點：畫面切換、縮放、主迴圈、輸入轉換。
import { LEVELS } from './levels.js';
import { TOWERS, DIFFICULTY, SHOP } from './data.js';
import { preloadAssets } from './assets.js';
import { resumeAudio, startMusic, toggleMute, isMuted, sfx } from './sound.js';
import { buildPath, smoothPath, starsForLives } from './sim.js';
import { Game, STEP } from './game.js';
import { UI } from './ui.js';
import * as R from './render.js';
import { getStars, recordStars, isUnlocked, getDifficulty, setDifficulty, getShop, availableStars, buyUpgrade } from './storage.js';

// 難度＋星星商店升級 → 綜合加成，傳進 Game
function computeMods() {
  const diff = DIFFICULTY[getDifficulty()] || DIFFICULTY.normal;
  const shop = getShop();
  const gAdd = SHOP.gold.add[shop.gold] ?? 0;
  const dAdd = SHOP.dmg.add[shop.dmg] ?? 0;
  const lAdd = SHOP.lives.add[shop.lives] ?? 0;
  return {
    hpMul: diff.hpMul,
    goldMul: diff.goldMul * (1 + gAdd),
    livesAdd: diff.livesAdd + lAdd,
    bountyMul: diff.bountyMul,
    dmgMul: 1 + dAdd,
  };
}

// 預先建好路徑結構：折線 → Catmull-Rom 平滑曲線（地圖圖層由 render 內部離屏快取）
for (const lv of LEVELS) {
  lv.pathsBuilt = lv.paths.map(p => buildPath(smoothPath(p)));
}

const screenSelect = document.getElementById('screen-select');
const screenGame = document.getElementById('screen-game');
const canvas = document.getElementById('game-canvas');
const wrap = document.getElementById('canvas-wrap');
const overlay = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

let game = null;
let currentLevel = null;
let scale = 1, offsetX = 0, offsetY = 0;
let speed = 1, paused = false;
let acc = 0, lastTime = 0, rafId = 0;

// ---------- 縮放 ----------

function resize() {
  const bw = wrap.clientWidth, bh = wrap.clientHeight;
  scale = Math.min(bw / R.W, bh / R.H);
  const cw = Math.floor(R.W * scale), ch = Math.floor(R.H * scale);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  const rect = canvas.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  offsetX = rect.left - wrapRect.left;
  offsetY = rect.top - wrapRect.top;
  ui.reposition();
}

function toScreen(lx, ly) {
  return { x: offsetX + lx * scale, y: offsetY + ly * scale };
}

function toLogic(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
}

// ---------- UI ----------

const ui = new UI({
  overlay,
  toScreen,
  onExit: showSelect,
  onReplay: () => startLevel(currentLevel),
});

canvas.addEventListener('pointerdown', ev => {
  const { x, y } = toLogic(ev.clientX, ev.clientY);
  ui.handleTap(x, y);
});

// 首次使用者互動啟動音訊（瀏覽器自動播放政策）+ 開始背景音樂
let audioStarted = false;
function kickAudio() {
  if (audioStarted) return;
  audioStarted = true;
  resumeAudio();
  if (!isMuted()) startMusic();
}
window.addEventListener('pointerdown', kickAudio, { once: false });

document.getElementById('btn-back').addEventListener('click', () => { sfx('click'); showSelect(); });
document.getElementById('btn-call').addEventListener('click', () => {
  sfx('click');
  game?.startNextWave(true);
  ui.refreshHUD();
});
const btnSpeed = document.getElementById('btn-speed');
btnSpeed.addEventListener('click', () => {
  sfx('click');
  speed = speed === 1 ? 2 : 1;
  btnSpeed.textContent = `${speed}x`;
});
const btnSound = document.getElementById('btn-sound');
btnSound.textContent = isMuted() ? '🔇' : '🔊';
btnSound.addEventListener('click', () => {
  const m = toggleMute();
  btnSound.textContent = m ? '🔇' : '🔊';
  if (!m) startMusic();
});
const btnPause = document.getElementById('btn-pause');
btnPause.addEventListener('click', () => {
  sfx('click');
  paused = !paused;
  btnPause.textContent = paused ? '▶️' : '⏸';
});

// ---------- 關卡選擇 ----------

function renderLevelCards() {
  const box = document.getElementById('level-cards');
  box.innerHTML = '';
  for (const lv of LEVELS) {
    const unlocked = isUnlocked(lv.id);
    const stars = getStars(lv.id);
    const card = document.createElement('div');
    card.className = 'level-card' + (unlocked ? '' : ' locked');
    card.innerHTML = `
      <div class="pad">
        <div class="num">${unlocked ? lv.id : '🔒'}</div>
        <div class="stars">${'★'.repeat(stars)}<span class="off">${'★'.repeat(3 - stars)}</span></div>
      </div>
      <div class="name">${lv.name}</div>`;
    if (unlocked) card.addEventListener('click', () => startLevel(lv));
    box.appendChild(card);
  }
}

function renderDifficulty() {
  const cur = getDifficulty();
  document.querySelectorAll('#difficulty .diff-btn').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.diff === cur);
  });
}
document.querySelectorAll('#difficulty .diff-btn').forEach(btn => {
  btn.addEventListener('click', () => { sfx('click'); setDifficulty(btn.dataset.diff); renderDifficulty(); });
});

// ----- 星星商店 -----
const shopModal = document.getElementById('shop');
function renderShop() {
  const shop = getShop();
  const avail = availableStars();
  document.getElementById('shop-avail').textContent = avail;
  const box = document.getElementById('shop-items');
  box.innerHTML = '';
  for (const key of Object.keys(SHOP)) {
    const def = SHOP[key];
    const lvl = shop[key] ?? 0;
    const maxed = lvl >= 3;
    const cost = maxed ? null : def.costs[lvl];
    const eff = key === 'lives'
      ? `+${def.add[lvl]} 生命`
      : `+${Math.round(def.add[lvl] * 100)}%`;
    const pips = [0, 1, 2].map(i => `<span class="pip${i < lvl ? ' on' : ''}"></span>`).join('');
    const btn = maxed
      ? `<span class="shop-max">已滿級</span>`
      : `<button class="shop-buy" data-key="${key}" data-cost="${cost}" ${avail < cost ? 'disabled' : ''}>${cost}★</button>`;
    const row = document.createElement('div');
    row.className = 'shop-item';
    row.innerHTML = `
      <div class="shop-ic">${def.icon}</div>
      <div class="shop-info">
        <div class="shop-name">${def.name} <span class="shop-eff">目前 ${eff}</span></div>
        <div class="shop-pips">${pips}</div>
      </div>
      ${btn}`;
    box.appendChild(row);
  }
  box.querySelectorAll('.shop-buy').forEach(b => {
    b.addEventListener('click', () => {
      if (buyUpgrade(b.dataset.key, +b.dataset.cost)) { sfx('upgrade'); renderShop(); }
      else sfx('click');
    });
  });
}
function openShop() { sfx('click'); renderShop(); shopModal.hidden = false; }
function closeShop() { sfx('click'); shopModal.hidden = true; }
document.getElementById('btn-shop').addEventListener('click', openShop);
document.getElementById('shop-close').addEventListener('click', closeShop);
shopModal.addEventListener('click', e => { if (e.target === shopModal) closeShop(); });

function showSelect() {
  cancelAnimationFrame(rafId);
  game = null;
  screenGame.hidden = true;
  screenSelect.hidden = false;
  renderDifficulty();
  renderLevelCards();
}

// ---------- 遊戲迴圈 ----------

function startLevel(level) {
  // 釋放其他關卡的離屏地圖快取，避免高超取樣下記憶體累積
  for (const lv of LEVELS) if (lv !== level) lv._map = null;
  currentLevel = level;
  game = new Game(level, computeMods());
  speed = 1; paused = false; acc = 0;
  btnSpeed.textContent = '1x';
  btnPause.textContent = '⏸';
  screenSelect.hidden = true;
  screenGame.hidden = false;
  ui.attach(game);
  // 勝利時記錄星數
  const prevOnEvent = game.onEvent;
  game.onEvent = kind => {
    prevOnEvent(kind);
    if (kind === 'end' && game.state === 'won') {
      recordStars(level.id, starsForLives(game.lives));
    }
  };
  resize();
  lastTime = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(frame);
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  if (game && !paused && game.state === 'playing') {
    acc += dt * speed;
    while (acc >= STEP) {
      game.step(STEP);
      acc -= STEP;
    }
    ui.refreshHUD();
  }
  draw();
}

function draw() {
  if (!game) return;
  const time = performance.now() / 1000;
  ctx.clearRect(0, 0, R.W, R.H);
  R.drawMap(ctx, currentLevel, time);
  // 選取中的塔顯示射程
  const sel = ui.selection;
  if (sel?.kind === 'tower') {
    const lv = sel.tower;
    const def = lvDef(lv);
    R.drawRange(ctx, lv.x, lv.y - 6, def.range);
  }
  for (const t of game.towers) R.drawTower(ctx, t, time);
  // 地面敵人先畫、飛行後畫（在上層）
  const ground = game.enemies.filter(e => !e.def.flying).sort((a, b) => a.pos.y - b.pos.y);
  const air = game.enemies.filter(e => e.def.flying);
  for (const e of ground) R.drawEnemy(ctx, e);
  for (const p of game.projectiles) R.drawProjectile(ctx, p);
  for (const e of air) R.drawEnemy(ctx, e);
  for (const fx of game.effects) R.drawEffect(ctx, fx);
  // 除錯：疊出規劃路徑線（window.__debugPath = true 開啟）
  if (window.__debugPath) {
    for (const path of currentLevel.pathsBuilt) {
      ctx.strokeStyle = 'rgba(255,0,180,0.9)';
      ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      path.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
    }
  }
  // 倒數提示
  if (game.state === 'playing' && game.countdown > 0 && game.waveIndex + 1 < game.totalWaves) {
    ctx.fillStyle = 'rgba(20,27,39,0.75)';
    ctx.fillRect(R.W / 2 - 110, 8, 220, 30);
    ctx.fillStyle = '#ffe9b0';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`下一波 ${Math.ceil(game.countdown)} 秒後來襲`, R.W / 2, 23);
  }
}

function lvDef(tower) {
  return TOWERS[tower.type].levels[tower.level];
}

// debug 鉤子：背景分頁 rAF 凍結時仍可手動推進模擬（測試用）
window.__kd = {
  game: () => game,
  tick(seconds) {
    if (!game) return;
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n && game.state === 'playing'; i++) game.step(STEP);
    ui.refreshHUD();
    draw();
  },
};

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 100));

preloadAssets();
showSelect();
