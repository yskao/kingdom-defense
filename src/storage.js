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
