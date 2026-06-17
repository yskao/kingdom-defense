// 真實美術 sprite 的載入與快取（瀏覽器端；node 測試不會載入此檔）。
const ENEMY_TYPES = ['goblin', 'orc', 'knight', 'bat', 'wolf', 'shaman', 'slime', 'gargoyle', 'boss'];
const FRAMES = 20;

const BG_THEMES = ['grass', 'forest', 'canyon', 'snow', 'swamp', 'volcano'];

const enemyAnims = {};   // type -> [Image x20]
const bgImages = {};     // theme -> Image
let total = 0, loaded = 0;

function load(src) {
  const img = new Image();
  total++;
  img.onload = img.onerror = () => { loaded++; };
  img.src = src;
  return img;
}

export function preloadAssets() {
  for (const type of ENEMY_TYPES) {
    enemyAnims[type] = [];
    for (let i = 0; i < FRAMES; i++) {
      enemyAnims[type].push(load(`assets/enemies/${type}/walk_${String(i).padStart(3, '0')}.png`));
    }
  }
  for (const theme of BG_THEMES) {
    bgImages[theme] = load(`assets/bg/${theme}.png`);
  }
}

// 主題背景圖（載入完成且可用才回傳，否則 null → 退回向量地圖）
export function bgImage(theme) {
  const img = bgImages[theme];
  return img && img.complete && img.naturalWidth ? img : null;
}

// slimelet 借用 slime 的動畫
export function enemyFrames(type) {
  return enemyAnims[type === 'slimelet' ? 'slime' : type] ?? null;
}

export function assetsReady() {
  return total > 0 && loaded >= total;
}

export function assetsProgress() {
  return total ? loaded / total : 0;
}
