// 純邏輯模組：不碰 DOM / Canvas，全部可在 node --test 下執行。
import { RULES } from './data.js';

export function damageTo(enemy, damage, damageType) {
  if (damageType === 'physical') return damage * (1 - enemy.armor);
  return damage;
}

export function sellRefund(totalSpent) {
  // +1e-9 避免 180 * 0.7 = 125.999... 這類浮點誤差被 floor 吃掉
  return Math.floor(totalSpent * RULES.sellRatio + 1e-9);
}

export function starsForLives(lives) {
  if (lives >= RULES.star3Lives) return 3;
  if (lives >= RULES.star2Lives) return 2;
  return 1;
}

export function callBonus(remainingSeconds) {
  return Math.floor(remainingSeconds * RULES.callBonusPerSec);
}

// Catmull-Rom 平滑：把折線路徑變成有機曲線（取樣回折線）。
export function smoothPath(pts, samples = 10) {
  if (pts.length < 3) return pts;
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const cr = (a, b, c, d, t) =>
    0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const out = [];
  for (let i = 0; i < P.length - 3; i++) {
    for (let j = 0; j < samples; j++) {
      const t = j / samples;
      out.push([
        cr(P[i][0], P[i + 1][0], P[i + 2][0], P[i + 3][0], t),
        cr(P[i][1], P[i + 1][1], P[i + 2][1], P[i + 3][1], t),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// 把路徑點列預先處理成可用距離查詢的結構。
export function buildPath(points) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, len, start: total, angle: Math.atan2(y2 - y1, x2 - x1) });
    total += len;
  }
  return { segs, total, points };
}

// 距離 → 座標與行進角度；超出範圍時夾在頭尾。
export function pointAt(path, dist) {
  const d = Math.max(0, Math.min(dist, path.total));
  let seg = path.segs[path.segs.length - 1];
  for (const s of path.segs) {
    if (d <= s.start + s.len) { seg = s; break; }
  }
  const t = seg.len === 0 ? 0 : (d - seg.start) / seg.len;
  return {
    x: seg.x1 + (seg.x2 - seg.x1) * t,
    y: seg.y1 + (seg.y2 - seg.y1) * t,
    angle: seg.angle,
  };
}
