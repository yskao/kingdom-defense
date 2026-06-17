// localStorage 進度：各關星數與解鎖判定。
const KEY = 'kingdom-defense-progress';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? { stars: {} }; }
  catch { return { stars: {} }; }
}

export function getStars(levelId) {
  return load().stars[levelId] ?? 0;
}

export function recordStars(levelId, stars) {
  const p = load();
  p.stars[levelId] = Math.max(p.stars[levelId] ?? 0, stars);
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function isUnlocked(levelId) {
  return levelId === 1 || getStars(levelId - 1) > 0;
}

// ---- 設定（難度）與星星商店（永久升級）----
const META_KEY = 'kingdom-defense-meta';
const DEFAULT_META = { difficulty: 'normal', shop: { gold: 0, dmg: 0, lives: 0 }, spent: 0 };

function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY));
    return { ...DEFAULT_META, ...m, shop: { ...DEFAULT_META.shop, ...(m && m.shop) } };
  } catch { return { ...DEFAULT_META, shop: { ...DEFAULT_META.shop } }; }
}
function saveMeta(m) { localStorage.setItem(META_KEY, JSON.stringify(m)); }

export function getDifficulty() { return loadMeta().difficulty; }
export function setDifficulty(d) { const m = loadMeta(); m.difficulty = d; saveMeta(m); }

// 玩家累積拿到的總星數（各關最佳星數加總）
export function totalStars() {
  const s = load().stars;
  return Object.values(s).reduce((a, b) => a + b, 0);
}
export function getShop() { return loadMeta().shop; }
export function spentStars() { return loadMeta().spent; }
export function availableStars() { return Math.max(0, totalStars() - spentStars()); }

// 嘗試購買某項升級一級；成功回 true（花星星，不影響各關星數→不影響解鎖）
export function buyUpgrade(key, cost) {
  const m = loadMeta();
  if ((m.shop[key] ?? 0) >= 3) return false;          // 每項最多 3 級
  if (totalStars() - m.spent < cost) return false;    // 星星不足
  m.shop[key] = (m.shop[key] ?? 0) + 1;
  m.spent += cost;
  saveMeta(m);
  return true;
}
