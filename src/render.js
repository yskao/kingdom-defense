// 全部 Canvas 繪製。邏輯座標 960×540，呼叫端負責 scale。
// 靜態地圖預先畫進 2x 離屏 canvas（每關一次），每幀貼圖 + 動態物件。
// 美術語言：厚深色描邊 + 漸層兩段上色 + 誇張比例（手繪奇幻卡通）。
import { TOWERS } from './data.js';
import { enemyFrames, bgImage } from './assets.js';

export const W = 960;
export const H = 540;
const TAU = Math.PI * 2;
const OUT = '#2a1c12'; // 全域描邊色

function stk(ctx, w = 2.4) {
  ctx.strokeStyle = OUT;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

function shade(hex, amt) { // amt: -1(黑)~1(白)
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => {
    const t = amt < 0 ? 0 : 255;
    return Math.round(c + (t - c) * Math.abs(amt));
  };
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

function ballGrad(ctx, x, y, r, base) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.15, x, y, r * 1.05);
  g.addColorStop(0, shade(base, 0.28));
  g.addColorStop(1, shade(base, -0.18));
  return g;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToPaths(level, x, y) {
  let min = Infinity;
  for (const path of level.pathsBuilt) {
    for (const s of path.segs) {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / (dx * dx + dy * dy || 1)));
      min = Math.min(min, Math.hypot(x - (s.x1 + dx * t), y - (s.y1 + dy * t)));
    }
  }
  return min;
}

// ---------- 主題 ----------

const THEMES = {
  grass: {
    grassA: '#7fb55c', grassB: '#76ac54', patch: '#8cc168', tuft: '#69a14b',
    path: '#cfa96e', pathEdge: '#8d6e40', pathWorn: '#dcb87f', pebble: '#b6925c',
    treeFol: ['#39702f', '#478840', '#56a04e'], trunk: '#6e4a2f',
    rockA: '#9a958a', rockB: '#b8b3a6',
    flowers: ['#f4e9bb', '#e89ab0', '#ffffff', '#e8c95a'],
  },
  forest: {
    grassA: '#5e9450', grassB: '#578b49', patch: '#699e58', tuft: '#4a7d3e',
    path: '#b99a61', pathEdge: '#7c5f36', pathWorn: '#c9ab72', pebble: '#a08152',
    treeFol: ['#27521f', '#33662b', '#3f7a37'], trunk: '#5c3d26',
    rockA: '#8a877c', rockB: '#a5a195',
    flowers: ['#cfe3a8', '#9fc6e8', '#ffffff'],
  },
  canyon: {
    grassA: '#c79b62', grassB: '#bf9258', patch: '#d2a76e', tuft: '#a87f48',
    path: '#e3c389', pathEdge: '#9c7a45', pathWorn: '#efd49d', pebble: '#c3a268',
    treeFol: ['#6e7d34', '#7e8e3e', '#8e9f49'], trunk: '#7a5230',
    rockA: '#a3795a', rockB: '#c0926e',
    flowers: ['#e0b154', '#d98b58'],
  },
  snow: {
    grassA: '#d9e6ee', grassB: '#cfdfe9', patch: '#e8f1f6', tuft: '#b6cdd8',
    path: '#b9c6d0', pathEdge: '#8295a3', pathWorn: '#d2dde4', pebble: '#9fb0bb',
    treeFol: ['#2c5a44', '#357055', '#3f8566'], trunk: '#5c4434',
    rockA: '#a8b2ba', rockB: '#c6cdd3',
    flowers: ['#ffffff', '#cfe3f4', '#bcd6ec'],
  },
  swamp: {
    grassA: '#5a7148', grassB: '#536a43', patch: '#647a4f', tuft: '#445839',
    path: '#7d7150', pathEdge: '#534b32', pathWorn: '#8d815c', pebble: '#6b6044',
    treeFol: ['#33472a', '#3f5733', '#4a673c'], trunk: '#42301f',
    rockA: '#6f7560', rockB: '#878c75',
    flowers: ['#c4d86a', '#9fb84a', '#d8d06a'],
  },
  volcano: {
    grassA: '#4a3f3c', grassB: '#443a37', patch: '#574744', tuft: '#3a302e',
    path: '#6e5a4c', pathEdge: '#3e312a', pathWorn: '#806a58', pebble: '#5a4a40',
    treeFol: ['#5a3a2a', '#6e4632', '#7a5038'], trunk: '#3a2a22',
    rockA: '#5e5450', rockB: '#7a6e68',
    flowers: ['#e8923a', '#d8603a', '#ffb24a'],
  },
};

// ---------- 靜態地圖（離屏快取）----------

export function getMapCanvas(level) {
  if (level._map) return level._map;
  // 超取樣倍率：依裝置像素比提高銳利度（高 DPI / 4K 螢幕更細緻），上限 3
  const SS = Math.min(3, Math.max(2, Math.ceil((window.devicePixelRatio || 1) * 1.5)));
  const cv = document.createElement('canvas');
  cv.width = W * SS; cv.height = H * SS;
  const ctx = cv.getContext('2d');
  ctx.scale(SS, SS);
  const th = THEMES[level.theme];
  const rnd = mulberry32(level.id * 7919);
  level._dyn = { ponds: [], lavas: [], torches: [], windmills: [] };

  // 草地
  ctx.fillStyle = th.grassA;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th.grassB;
  for (let gx = 0; gx < W; gx += 48) {
    for (let gy = (gx / 48) % 2 ? 0 : 48; gy < H; gy += 96) ctx.fillRect(gx, gy, 48, 48);
  }
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = th.patch;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(rnd() * W, rnd() * H, 30 + rnd() * 60, 18 + rnd() * 30, rnd() * 3, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.tuft;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (let i = 0; i < 240; i++) {
    const x = rnd() * W, y = rnd() * H;
    if (distToPaths(level, x, y) < 32) continue;
    for (let b = -1; b <= 1; b++) {
      ctx.beginPath();
      ctx.moveTo(x + b * 2.2, y);
      ctx.lineTo(x + b * 3.5, y - 4 - rnd() * 3);
      ctx.stroke();
    }
  }

  // 地形高低起伏（懸崖/高台）：畫在草地之上、路徑之下，營造立體高度
  for (const t of (level.terrain ?? [])) drawCliff(ctx, level.theme, t);

  // 路徑（曲線）：陰影、邊緣、主體、磨損、上緣亮線
  for (const path of level.pathsBuilt) {
    const trace = () => {
      ctx.beginPath();
      path.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(40,30,10,0.25)'; ctx.lineWidth = 50;
    ctx.save(); ctx.translate(0, 3); trace(); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = th.pathEdge; ctx.lineWidth = 47; trace(); ctx.stroke();
    ctx.strokeStyle = th.path; ctx.lineWidth = 40; trace(); ctx.stroke();
    ctx.strokeStyle = th.pathWorn; ctx.globalAlpha = 0.55; ctx.lineWidth = 14; trace(); ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.save(); ctx.translate(0, -19); trace(); ctx.stroke(); ctx.restore();
    ctx.globalAlpha = 1;
  }
  // 路面碎石
  for (const path of level.pathsBuilt) {
    for (let d = 14; d < path.total; d += 26 + rnd() * 30) {
      const p = pathPointAt(path, d);
      ctx.fillStyle = th.pebble;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.ellipse(p.x + (rnd() - 0.5) * 26, p.y + (rnd() - 0.5) * 26, 1.6 + rnd() * 2.2, 1.2 + rnd() * 1.6, rnd() * 3, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // 大型場景物件（手動擺位，先畫北邊的）
  const sp = (level.setpieces ?? []).slice().sort((a, b) => a.y - b.y);
  for (const piece of sp) drawSetpiece(ctx, th, level, piece);

  // 隨機小裝飾：避開路徑、塔位、場景物件
  const blocked = (x, y, r) => {
    if (distToPaths(level, x, y) < 38 + r) return true;
    for (const [sx, sy] of level.spots) if (Math.hypot(x - sx, y - sy) < 44 + r) return true;
    for (const p of level.setpieces ?? []) {
      if (Math.hypot(x - p.x, y - p.y) < (p.rx ?? 50) + 26 + r) return true;
    }
    return false;
  };
  const decos = [];
  for (let i = 0; i < 130 && decos.length < 40; i++) {
    const x = 18 + rnd() * (W - 36), y = 18 + rnd() * (H - 36);
    const k = rnd();
    const kind = k < 0.34 ? 'tree' : k < 0.52 ? 'bush' : k < 0.72 ? 'rock' : k < 0.9 ? 'flower' : 'stump';
    const r = kind === 'tree' ? 16 + rnd() * 10 : kind === 'bush' ? 9 + rnd() * 5 : kind === 'rock' ? 7 + rnd() * 6 : 4;
    if (blocked(x, y, r)) continue;
    if (decos.some(d => Math.hypot(x - d.x, y - d.y) < d.r + r + 6)) continue;
    decos.push({ x, y, r, kind, v: rnd() });
  }
  decos.sort((a, b) => a.y - b.y);
  for (const d of decos) drawDeco(ctx, th, d);

  // 塔位石台
  for (const [x, y] of level.spots) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(x + 2, y + 5, 24, 16, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8d8678';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 24, 17, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#aaa294';
    ctx.beginPath(); ctx.ellipse(x, y, 23, 16, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c4bcac';
    ctx.beginPath(); ctx.ellipse(x, y - 1, 18, 12, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#948c7e'; ctx.lineWidth = 1.5;
    for (let a = 0; a < TAU; a += TAU / 9) {
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 18, y - 1 + Math.sin(a) * 12);
      ctx.lineTo(x + Math.cos(a) * 23, y + Math.sin(a) * 16);
      ctx.stroke();
    }
    ctx.fillStyle = '#7e7668';
    ctx.font = 'bold 17px Georgia';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+', x, y - 1);
  }

  // 出怪口與城堡
  for (const path of level.pathsBuilt) {
    const [sx, sy] = path.points[0];
    drawCave(ctx, Math.max(sx, 2), sy);
  }
  drawCastle(ctx, level);

  // 暖色光照（左上）+ 暗角
  const lg = ctx.createRadialGradient(W * 0.25, H * 0.15, 60, W * 0.25, H * 0.15, W * 0.9);
  lg.addColorStop(0, 'rgba(255,240,200,0.13)');
  lg.addColorStop(0.5, 'rgba(255,240,200,0)');
  lg.addColorStop(1, 'rgba(30,40,60,0.14)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.55, W / 2, H / 2, H * 1.05);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(20,30,15,0.3)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  level._map = cv;
  return cv;
}

function pathPointAt(path, d) {
  let seg = path.segs[path.segs.length - 1];
  for (const s of path.segs) if (d <= s.start + s.len) { seg = s; break; }
  const t = seg.len ? (d - seg.start) / seg.len : 0;
  return { x: seg.x1 + (seg.x2 - seg.x1) * t, y: seg.y1 + (seg.y2 - seg.y1) * t };
}

// ---------- 場景物件 ----------

function drawSetpiece(ctx, th, level, p) {
  const s = p.s ?? 1;
  if (p.kind === 'mountain') drawMountain(ctx, p.x, p.y, s);
  else if (p.kind === 'house') drawHouse(ctx, p.x, p.y, s);
  else if (p.kind === 'windmill') { drawWindmillBody(ctx, p.x, p.y, s); level._dyn.windmills.push(p); }
  else if (p.kind === 'hay') drawHay(ctx, p.x, p.y, s);
  else if (p.kind === 'pond') { drawPond(ctx, p); level._dyn.ponds.push(p); }
  else if (p.kind === 'lavapool') { drawLava(ctx, p); level._dyn.lavas.push(p); }
  else if (p.kind === 'bigtree') drawBigTree(ctx, th, p.x, p.y, s);
  else if (p.kind === 'mushrooms') drawMushrooms(ctx, p.x, p.y, s);
  else if (p.kind === 'stones') drawStoneCircle(ctx, p.x, p.y, s);
  else if (p.kind === 'bones') drawBones(ctx, p.x, p.y, s);
  else if (p.kind === 'deadtree') drawDeadTree(ctx, p.x, p.y, s);
  else if (p.kind === 'torch') { drawTorchPole(ctx, p.x, p.y, s); level._dyn.torches.push(p); }
}

// 懸崖/高台：頂面 + 岩壁立面 + 投影，營造高度起伏。
const CLIFF = {
  grass:   { top: '#83bd5e', topD: '#6fa94c', face: '#9a8b70', faceD: '#6f6253', rim: '#b8e08a' },
  forest:  { top: '#4f8443', topD: '#3f6e35', face: '#8a7d62', faceD: '#5e533f', rim: '#6fa85a' },
  canyon:  { top: '#d8af68', topD: '#c49a54', face: '#a47c4a', faceD: '#6f5232', rim: '#ecc886' },
  snow:    { top: '#e8f1f8', topD: '#d2e0ec', face: '#8c98a4', faceD: '#5e6a77', rim: '#ffffff' },
  swamp:   { top: '#5d784a', topD: '#4c6440', face: '#6e6044', faceD: '#473c2a', rim: '#7a9a58' },
  volcano: { top: '#5c4c43', topD: '#4a3c34', face: '#4a3a32', faceD: '#2e221c', rim: '#7a5040' },
};

// 產生環繞中心的有機封閉輪廓點（可加垂直偏移畫不同圖層）
function blobOutline(x, y, w, h, seed, n = 10) {
  const rnd = mulberry32(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = 0.82 + rnd() * 0.36;
    pts.push([x + Math.cos(a) * w * 0.5 * rr, y + Math.sin(a) * h * 0.5 * rr]);
  }
  return pts;
}

function traceBlob(ctx, pts, dy = 0) {
  ctx.beginPath();
  for (let i = 0; i <= pts.length; i++) {
    const p0 = pts[i % pts.length], p1 = pts[(i + 1) % pts.length];
    const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2 + dy;
    if (i === 0) ctx.moveTo(mx, my);
    else ctx.quadraticCurveTo(p0[0], p0[1] + dy, mx, my);
  }
  ctx.closePath();
}

function drawCliff(ctx, themeKey, p) {
  const c = CLIFF[themeKey] ?? CLIFF.grass;
  const lift = p.lift ?? 26;
  const pts = blobOutline(p.x, p.y, p.w, p.h, (p.x * 31 + p.y * 7) | 0);
  // 投影
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  traceBlob(ctx, pts, lift + 12); ctx.fill();
  // 岩壁立面（下層、深色）
  ctx.fillStyle = c.faceD;
  traceBlob(ctx, pts, lift); ctx.fill();
  ctx.fillStyle = c.face;
  traceBlob(ctx, pts, lift * 0.5); ctx.fill();
  // 立面裂紋
  ctx.strokeStyle = c.faceD; ctx.lineWidth = 2;
  const rnd = mulberry32((p.x | 0) + 3);
  for (let i = 0; i < pts.length; i += 3) {
    const px = pts[i][0], py = pts[i][1];
    if (py < p.y) continue; // 只在下緣
    ctx.beginPath(); ctx.moveTo(px, py + 2); ctx.lineTo(px + (rnd() - 0.5) * 8, py + lift * 0.7); ctx.stroke();
  }
  // 頂面（上層、亮色 = 地表抬升）
  ctx.fillStyle = c.top;
  traceBlob(ctx, pts, 0); ctx.fill();
  stk(ctx, 2.6); ctx.stroke();
  // 頂面內側陰影 + 上緣高光
  ctx.fillStyle = c.topD; ctx.globalAlpha = 0.5;
  traceBlob(ctx, pts.map(q => [q[0], q[1] + 4]), 0); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.top;
  traceBlob(ctx, pts.map(q => [q[0], q[1] - 2]), 0); ctx.fill();
  ctx.strokeStyle = c.rim; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.7;
  traceBlob(ctx, pts.map(q => [q[0], q[1] - 1]), 0); ctx.stroke();
  ctx.globalAlpha = 1;
  // 頂面點綴小石
  ctx.fillStyle = c.faceD;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(p.x + (mulberry32(p.x + i * 9)() - 0.5) * p.w * 0.5, p.y + (mulberry32(p.y + i * 5)() - 0.5) * p.h * 0.4, 2.5, 0, TAU);
    ctx.fill();
  }
}

function drawMountain(ctx, x, y, s) {
  const peaks = [[-46, 26, 0.72], [38, 22, 0.6], [0, 0, 1]];
  for (const [ox, oy, ps] of peaks) {
    const px = x + ox * s, py = y + oy * s, h = 84 * s * ps, w = 62 * s * ps;
    ctx.fillStyle = '#6e6a78';
    ctx.beginPath();
    ctx.moveTo(px - w, py + h * 0.55);
    ctx.lineTo(px - w * 0.1, py - h * 0.45);
    ctx.lineTo(px + w, py + h * 0.55);
    ctx.closePath(); ctx.fill();
    stk(ctx, 2.6); ctx.stroke();
    ctx.fillStyle = '#8a8696';
    ctx.beginPath();
    ctx.moveTo(px - w * 0.1, py - h * 0.45);
    ctx.lineTo(px + w, py + h * 0.55);
    ctx.lineTo(px + w * 0.25, py + h * 0.55);
    ctx.closePath(); ctx.fill();
    // 雪頂
    ctx.fillStyle = '#f4f6fa';
    ctx.beginPath();
    ctx.moveTo(px - w * 0.32, py - h * 0.16);
    ctx.lineTo(px - w * 0.1, py - h * 0.45);
    ctx.lineTo(px + w * 0.3, py - h * 0.1);
    ctx.lineTo(px + w * 0.12, py - h * 0.02);
    ctx.lineTo(px, py - h * 0.14);
    ctx.lineTo(px - w * 0.14, py - h * 0.02);
    ctx.closePath(); ctx.fill();
  }
}

function drawHouse(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(2, 26, 40, 12, 0, 0, TAU); ctx.fill();
  // 牆
  ctx.fillStyle = '#e8d9b8';
  ctx.fillRect(-28, -10, 56, 34);
  stk(ctx); ctx.strokeRect(-28, -10, 56, 34);
  // 屋頂
  ctx.fillStyle = '#b3593a';
  ctx.beginPath();
  ctx.moveTo(-36, -8); ctx.lineTo(0, -38); ctx.lineTo(36, -8);
  ctx.closePath(); ctx.fill();
  stk(ctx); ctx.stroke();
  ctx.fillStyle = shade('#b3593a', -0.25);
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(36, -8); ctx.lineTo(14, -8); ctx.closePath(); ctx.fill();
  // 門窗
  ctx.fillStyle = '#5c3d26';
  ctx.beginPath(); ctx.arc(-10, 14, 8, Math.PI, 0); ctx.rect(-18, 14, 16, 10); ctx.fill();
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(8, 0, 12, 11);
  stk(ctx, 1.8); ctx.strokeRect(8, 0, 12, 11);
  ctx.restore();
}

function drawWindmillBody(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(2, 30, 34, 11, 0, 0, TAU); ctx.fill();
  // 塔身（梯形石塔）
  ctx.fillStyle = '#d9c9a8';
  ctx.beginPath();
  ctx.moveTo(-22, 28); ctx.lineTo(-13, -34); ctx.lineTo(13, -34); ctx.lineTo(22, 28);
  ctx.closePath(); ctx.fill();
  stk(ctx); ctx.stroke();
  ctx.fillStyle = shade('#d9c9a8', -0.18);
  ctx.beginPath();
  ctx.moveTo(13, -34); ctx.lineTo(22, 28); ctx.lineTo(6, 28); ctx.lineTo(3, -34);
  ctx.closePath(); ctx.fill();
  // 帽
  ctx.fillStyle = '#8a5a3a';
  ctx.beginPath(); ctx.arc(0, -34, 15, Math.PI, 0); ctx.fill();
  stk(ctx); ctx.stroke();
  ctx.fillStyle = '#5c3d26';
  ctx.beginPath(); ctx.arc(-6, 4, 7, Math.PI, 0); ctx.rect(-13, 4, 14, 14); ctx.fill();
  ctx.restore();
}

function drawHay(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(2, 10, 22, 7, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#dcb85e';
  ctx.beginPath(); ctx.arc(0, -2, 16, Math.PI, 0); ctx.rect(-16, -2, 32, 10); ctx.fill();
  stk(ctx); ctx.stroke();
  ctx.strokeStyle = '#b8923c'; ctx.lineWidth = 1.6;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath(); ctx.arc(i * 8, -2, 13, Math.PI * 1.15, Math.PI * 1.6); ctx.stroke();
  }
  ctx.restore();
}

function drawPond(ctx, p) {
  ctx.fillStyle = '#7a6a4a';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, p.rx + 5, p.ry + 5, 0, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(p.x - p.rx * 0.3, p.y - p.ry * 0.3, 4, p.x, p.y, p.rx);
  g.addColorStop(0, '#7fc4d8');
  g.addColorStop(1, '#3a7fa0');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  // 蓮葉
  ctx.fillStyle = '#5fae62';
  for (const [ox, oy, r] of [[-p.rx * 0.4, p.ry * 0.25, 6], [p.rx * 0.45, -p.ry * 0.2, 5]]) {
    ctx.beginPath();
    ctx.arc(p.x + ox, p.y + oy, r, 0.25, TAU - 0.25);
    ctx.lineTo(p.x + ox, p.y + oy);
    ctx.closePath(); ctx.fill();
  }
}

function drawLava(ctx, p) {
  ctx.fillStyle = '#3a2620';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, p.rx + 6, p.ry + 6, 0, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(p.x, p.y, 3, p.x, p.y, p.rx);
  g.addColorStop(0, '#ffd23e');
  g.addColorStop(0.5, '#ff8c2e');
  g.addColorStop(1, '#c4421e');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  // 岩塊
  ctx.fillStyle = '#4a322a';
  for (const [ox, oy, r] of [[-p.rx * 0.5, -p.ry * 0.1, 5], [p.rx * 0.35, p.ry * 0.3, 6]]) {
    ctx.beginPath(); ctx.arc(p.x + ox, p.y + oy, r, 0, TAU); ctx.fill();
  }
}

function drawBigTree(ctx, th, x, y, s) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(4, 16, 44, 14, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = th.trunk;
  ctx.beginPath();
  ctx.moveTo(-12, 14);
  ctx.quadraticCurveTo(-8, -16, -16, -34);
  ctx.lineTo(16, -34);
  ctx.quadraticCurveTo(8, -16, 12, 14);
  ctx.closePath(); ctx.fill();
  stk(ctx); ctx.stroke();
  for (const [ox, oy, r, ci] of [[-26, -48, 26, 0], [26, -46, 24, 0], [0, -66, 30, 1], [0, -44, 26, 2]]) {
    ctx.fillStyle = th.treeFol[ci];
    ctx.beginPath(); ctx.arc(ox, oy, r, 0, TAU); ctx.fill();
    stk(ctx, 2.2); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath(); ctx.arc(-10, -70, 12, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawMushrooms(ctx, x, y, s) {
  for (const [ox, oy, r, c] of [[-14, 4, 8, '#d8604a'], [10, 8, 11, '#d8604a'], [22, -4, 6, '#e8a84a']]) {
    const px = x + ox * s, py = y + oy * s, pr = r * s;
    ctx.fillStyle = '#e8ddc8';
    ctx.fillRect(px - pr * 0.3, py - pr * 0.2, pr * 0.6, pr * 0.9);
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(px, py - pr * 0.3, pr, Math.PI, 0); ctx.fill();
    stk(ctx, 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px - pr * 0.4, py - pr * 0.6, pr * 0.2, 0, TAU); ctx.fill();
  }
}

function drawStoneCircle(ctx, x, y, s) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const px = x + Math.cos(a) * 26 * s, py = y + Math.sin(a) * 13 * s;
    ctx.fillStyle = i % 2 ? '#9a958a' : '#86817a';
    ctx.beginPath();
    ctx.moveTo(px - 6 * s, py + 7 * s);
    ctx.lineTo(px - 4 * s, py - 9 * s);
    ctx.lineTo(px + 5 * s, py - 7 * s);
    ctx.lineTo(px + 6 * s, py + 7 * s);
    ctx.closePath(); ctx.fill();
    stk(ctx, 2); ctx.stroke();
  }
}

function drawBones(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  // 頭骨
  ctx.fillStyle = '#e8e2d0';
  ctx.beginPath(); ctx.arc(0, -4, 11, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.rect(-7, 2, 14, 7); ctx.fill();
  stk(ctx, 2); ctx.stroke();
  ctx.fillStyle = OUT;
  ctx.beginPath(); ctx.arc(-4, -5, 2.6, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(4, -5, 2.6, 0, TAU); ctx.fill();
  // 肋骨
  ctx.strokeStyle = '#d8d2c0'; ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.arc(20 + i * 7, 6, 8 - i * 1.5, Math.PI * 0.2, Math.PI * 1.1); ctx.stroke();
  }
  ctx.restore();
}

function drawDeadTree(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(2, 4, 18, 6, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#5a4636'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(-2, -28); ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-2, -16); ctx.lineTo(-16, -30); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-2, -24); ctx.lineTo(10, -38); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(10, -38); ctx.lineTo(16, -40); ctx.stroke();
  ctx.restore();
}

function drawTorchPole(ctx, x, y, s) {
  ctx.strokeStyle = '#5c4a33'; ctx.lineWidth = 4 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y + 14 * s); ctx.lineTo(x, y - 14 * s); ctx.stroke();
  ctx.fillStyle = '#39404a';
  ctx.beginPath(); ctx.arc(x, y - 16 * s, 5 * s, Math.PI, 0); ctx.fill();
}

function drawDeco(ctx, th, d) {
  const { x, y, r, kind, v } = d;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + r * 0.55, r, r * 0.4, 0, 0, TAU); ctx.fill();
  if (kind === 'tree') {
    ctx.fillStyle = th.trunk;
    ctx.fillRect(x - 2.5, y - 4, 5, r * 0.6 + 4);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = th.treeFol[i];
      ctx.beginPath(); ctx.arc(x, y - r * 0.5 - i * r * 0.38, r * (1 - i * 0.26), 0, TAU); ctx.fill();
      if (i === 0) { stk(ctx, 1.8); ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 1.1, r * 0.32, 0, TAU); ctx.fill();
  } else if (kind === 'bush') {
    for (const [ox, oy, s2] of [[-r * 0.5, 0, 0.8], [r * 0.5, 0, 0.8], [0, -r * 0.35, 1]]) {
      ctx.fillStyle = th.treeFol[1];
      ctx.beginPath(); ctx.arc(x + ox, y + oy, r * s2, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.5, r * 0.4, 0, TAU); ctx.fill();
  } else if (kind === 'rock') {
    ctx.fillStyle = th.rockA;
    ctx.beginPath();
    ctx.moveTo(x - r, y + r * 0.5);
    ctx.lineTo(x - r * 0.6, y - r * 0.7);
    ctx.lineTo(x + r * 0.3, y - r);
    ctx.lineTo(x + r, y + r * 0.4);
    ctx.closePath(); ctx.fill();
    stk(ctx, 1.8); ctx.stroke();
    ctx.fillStyle = th.rockB;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.6, y - r * 0.7);
    ctx.lineTo(x + r * 0.3, y - r);
    ctx.lineTo(x + r * 0.5, y - r * 0.1);
    ctx.lineTo(x - r * 0.4, y + r * 0.05);
    ctx.closePath(); ctx.fill();
  } else if (kind === 'flower') {
    const c = th.flowers[Math.floor(v * th.flowers.length)];
    for (const [ox, oy] of [[0, 0], [7, 3], [-6, 4], [3, -5]]) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x + ox, y + oy, 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(120,90,30,0.9)';
      ctx.beginPath(); ctx.arc(x + ox, y + oy, 0.9, 0, TAU); ctx.fill();
    }
  } else { // stump
    ctx.fillStyle = th.trunk;
    ctx.beginPath(); ctx.ellipse(x, y, 6, 4.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(th.trunk, 0.35);
    ctx.beginPath(); ctx.ellipse(x, y - 1.5, 5, 3.5, 0, 0, TAU); ctx.fill();
  }
}

function drawCave(ctx, x, y) {
  ctx.fillStyle = '#5b544c';
  ctx.beginPath(); ctx.ellipse(x, y, 32, 36, 0, -Math.PI / 2, Math.PI / 2); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
  ctx.fillStyle = '#46403a';
  ctx.beginPath(); ctx.ellipse(x, y, 25, 29, 0, -Math.PI / 2, Math.PI / 2); ctx.fill();
  ctx.fillStyle = '#191512';
  ctx.beginPath(); ctx.ellipse(x, y, 17, 22, 0, -Math.PI / 2, Math.PI / 2); ctx.fill();
  ctx.strokeStyle = '#6e665c'; ctx.lineWidth = 2;
  for (let a = -1.2; a <= 1.2; a += 0.6) {
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 25, y + Math.sin(a) * 29);
    ctx.lineTo(x + Math.cos(a) * 32, y + Math.sin(a) * 36);
    ctx.stroke();
  }
  // 洞口尖刺（威脅感）
  ctx.fillStyle = '#e8e2d0';
  for (const [oy, len] of [[-14, 7], [-4, 9], [7, 7]]) {
    ctx.beginPath();
    ctx.moveTo(x + 2, y + oy - 3);
    ctx.lineTo(x + 2 + len, y + oy);
    ctx.lineTo(x + 2, y + oy + 3);
    ctx.closePath(); ctx.fill();
  }
}

function drawCastle(ctx, level) {
  const ends = level.pathsBuilt.map(p => p.points[p.points.length - 1]);
  const x = Math.min(ends[0][0], W - 14);
  const y = ends.reduce((a, e) => a + e[1], 0) / ends.length;
  const stone = '#9a917f', dark = '#7c7464', light = '#b5ab97';
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(x, y + 36, 78, 18, 0, 0, TAU); ctx.fill();
  // 後方主樓
  ctx.fillStyle = dark;
  ctx.fillRect(x - 22, y - 88, 44, 70);
  stk(ctx); ctx.strokeRect(x - 22, y - 88, 44, 70);
  for (let i = 0; i < 3; i++) { ctx.fillStyle = dark; ctx.fillRect(x - 22 + i * 16, y - 98, 11, 11); stk(ctx, 1.8); ctx.strokeRect(x - 22 + i * 16, y - 98, 11, 11); }
  ctx.fillStyle = '#27313f';
  ctx.beginPath(); ctx.arc(x, y - 70, 5, 0, TAU); ctx.fill();
  // 兩側塔樓
  for (const side of [-1, 1]) {
    const tx = x + side * 38;
    ctx.fillStyle = stone;
    ctx.fillRect(tx - 14, y - 62, 28, 92);
    stk(ctx); ctx.strokeRect(tx - 14, y - 62, 28, 92);
    ctx.fillStyle = light;
    ctx.fillRect(tx - 14, y - 62, 8, 92);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = stone;
      ctx.fillRect(tx - 15 + i * 11, y - 73, 8, 12);
      stk(ctx, 1.6); ctx.strokeRect(tx - 15 + i * 11, y - 73, 8, 12);
    }
    ctx.fillStyle = '#27313f';
    ctx.beginPath(); ctx.arc(tx, y - 42, 4, 0, TAU); ctx.fill();
  }
  // 主體城牆
  ctx.fillStyle = stone;
  ctx.fillRect(x - 36, y - 38, 72, 68);
  stk(ctx); ctx.strokeRect(x - 36, y - 38, 72, 68);
  ctx.fillStyle = light; ctx.fillRect(x - 36, y - 38, 72, 7);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = stone;
    ctx.fillRect(x - 36 + i * 16, y - 48, 10, 11);
    stk(ctx, 1.6); ctx.strokeRect(x - 36 + i * 16, y - 48, 10, 11);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 1;
  for (let yy = y - 26; yy < y + 28; yy += 11) {
    ctx.beginPath(); ctx.moveTo(x - 36, yy); ctx.lineTo(x + 36, yy); ctx.stroke();
  }
  // 大門 + 鐵閘
  ctx.fillStyle = '#4a3520';
  ctx.beginPath(); ctx.arc(x, y + 12, 17, Math.PI, 0); ctx.rect(x - 17, y + 12, 34, 18); ctx.fill();
  stk(ctx, 2.2);
  ctx.beginPath(); ctx.arc(x, y + 12, 17, Math.PI, 0); ctx.stroke();
  ctx.strokeStyle = '#2e2113'; ctx.lineWidth = 1.8;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath(); ctx.moveTo(x + i * 9, y - 2); ctx.lineTo(x + i * 9, y + 30); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(x - 17, y + 12); ctx.lineTo(x + 17, y + 12); ctx.stroke();
  // 牆面盾徽
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.moveTo(x - 8, y - 30); ctx.lineTo(x + 8, y - 30); ctx.lineTo(x + 8, y - 18); ctx.lineTo(x, y - 10); ctx.lineTo(x - 8, y - 18);
  ctx.closePath(); ctx.fill();
  stk(ctx, 1.8); ctx.stroke();
  ctx.fillStyle = '#ffd35e';
  ctx.beginPath(); ctx.arc(x, y - 21, 3.4, 0, TAU); ctx.fill();
  level._flagBase = [x, y - 98];
}

// 可建塔位標記（手繪背景上用；低調石台 + 脈動光環）
function drawSpotMarker(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(x, y + 4, 21, 13, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(120,110,92,0.55)';
  ctx.beginPath(); ctx.ellipse(x, y, 20, 13, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(190,180,156,0.55)';
  ctx.beginPath(); ctx.ellipse(x, y - 1, 15, 9, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,240,200,0.5)';
  ctx.lineWidth = 1.6; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.ellipse(x, y, 18, 11, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,240,200,0.7)';
  ctx.font = 'bold 15px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('+', x, y - 1);
  ctx.restore();
}

// ---------- 每幀地圖（貼快取 + 動態元素）----------

export function drawMap(ctx, level, time) {
  // 已描圖的關卡用手繪背景（商業美術）；未描圖者仍用向量地圖
  if (level.painted) {
    const bg = bgImage(level.theme);
    if (bg) {
      ctx.drawImage(bg, 0, 0, W, H);
      for (const [x, y] of level.spots) drawSpotMarker(ctx, x, y);
      return;
    }
  }
  ctx.drawImage(getMapCanvas(level), 0, 0, W, H);
  const dyn = level._dyn ?? {};
  // 雲影
  for (let i = 0; i < 3; i++) {
    const cx = ((time * 9 + i * 420) % (W + 360)) - 180;
    const cy = 90 + i * 170;
    ctx.fillStyle = 'rgba(20,30,60,0.07)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 130, 46, 0, 0, TAU);
    ctx.ellipse(cx + 70, cy + 18, 90, 34, 0, 0, TAU);
    ctx.fill();
  }
  // 風車葉片
  for (const p of dyn.windmills ?? []) {
    const s = p.s ?? 1;
    ctx.save();
    ctx.translate(p.x, p.y - 34 * s);
    ctx.rotate(time * 0.9);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(TAU / 4);
      ctx.fillStyle = '#e8d9b8';
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.lineTo(34 * s, -10 * s);
      ctx.lineTo(34 * s, 4 * s);
      ctx.lineTo(0, 3);
      ctx.closePath(); ctx.fill();
      stk(ctx, 1.8); ctx.stroke();
    }
    ctx.fillStyle = '#5c3d26';
    ctx.beginPath(); ctx.arc(0, 0, 4.5 * s, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // 水面波光
  for (const p of dyn.ponds ?? []) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      const ph = (time * 0.7 + i / 3) % 1;
      ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.6;
      ctx.beginPath();
      ctx.ellipse(p.x - p.rx * 0.3 + i * p.rx * 0.3, p.y - p.ry * 0.2 + i * p.ry * 0.3, 8 + ph * 7, 2.4, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // 熔岩脈動
  for (const p of dyn.lavas ?? []) {
    const pulse = 0.5 + Math.sin(time * 2.2 + p.x) * 0.5;
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.rx * 1.5);
    g.addColorStop(0, `rgba(255,150,40,${0.18 + pulse * 0.16})`);
    g.addColorStop(1, 'rgba(255,150,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx * 1.5, p.ry * 1.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(255,220,90,${0.4 + pulse * 0.5})`;
    for (let i = 0; i < 2; i++) {
      const bx = p.x + Math.sin(time * 1.3 + i * 2.4) * p.rx * 0.4;
      const by = p.y + Math.cos(time * 1.7 + i * 1.8) * p.ry * 0.4;
      ctx.beginPath(); ctx.arc(bx, by, 2.5 + pulse * 1.6, 0, TAU); ctx.fill();
    }
  }
  // 火炬火焰
  for (const p of dyn.torches ?? []) {
    const s = p.s ?? 1;
    const fy = p.y - 20 * s;
    const flick = Math.sin(time * 11 + p.y) * 2 + Math.sin(time * 23) * 1;
    ctx.fillStyle = 'rgba(255,150,40,0.25)';
    ctx.beginPath(); ctx.arc(p.x, fy, 13 + flick, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff9a2e';
    ctx.beginPath();
    ctx.moveTo(p.x - 5, fy + 4);
    ctx.quadraticCurveTo(p.x - 6, fy - 6 - flick, p.x, fy - 11 - flick);
    ctx.quadraticCurveTo(p.x + 6, fy - 6 - flick * 0.6, p.x + 5, fy + 4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.moveTo(p.x - 2.5, fy + 3);
    ctx.quadraticCurveTo(p.x - 2.5, fy - 3 - flick * 0.5, p.x, fy - 6 - flick * 0.5);
    ctx.quadraticCurveTo(p.x + 2.5, fy - 3, p.x + 2.5, fy + 3);
    ctx.closePath(); ctx.fill();
  }
  // 城堡旗幟
  const fb = level._flagBase;
  if (fb) {
    const [x, y] = fb;
    ctx.strokeStyle = '#5c4a33'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 30); ctx.stroke();
    const wav = Math.sin(time * 5) * 3;
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.moveTo(x, y - 30);
    ctx.quadraticCurveTo(x + 13, y - 28 + wav, x + 26, y - 25 + wav * 1.4);
    ctx.lineTo(x + 26, y - 15 + wav * 1.4);
    ctx.quadraticCurveTo(x + 13, y - 18 + wav, x, y - 20);
    ctx.closePath(); ctx.fill();
    stk(ctx, 1.6); ctx.stroke();
  }
}

// ---------- 塔 ----------

export function drawTower(ctx, t, time) {
  const lv = t.level;
  const { x, y } = t;
  ctx.save();
  ctx.fillStyle = '#c4bcac';
  ctx.beginPath(); ctx.ellipse(x, y - 1, 18, 12, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + 6, 19, 11, 0, 0, TAU); ctx.fill();

  if (t.type === 'archer') drawArcherTower(ctx, t, lv, time);
  else if (t.type === 'cannon') drawCannonTower(ctx, t, lv);
  else if (t.type === 'mage') drawMageTower(ctx, t, lv, time);
  else if (t.type === 'tesla') drawTeslaTower(ctx, t, lv, time);
  else if (t.type === 'poison') drawPoisonTower(ctx, t, lv, time);
  else drawFrostTower(ctx, t, lv, time);
  ctx.restore();

  for (let i = 0; i <= lv; i++) {
    const bx = x - 8 + i * 8, by = y + 16;
    ctx.fillStyle = '#1d2733';
    ctx.beginPath(); ctx.arc(bx, by, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffd35e';
    ctx.beginPath();
    ctx.moveTo(bx, by - 3); ctx.lineTo(bx + 2.6, by); ctx.lineTo(bx, by + 3); ctx.lineTo(bx - 2.6, by);
    ctx.closePath(); ctx.fill();
  }
}

function drawArcherTower(ctx, t, lv, time) {
  const { x, y } = t;
  const h = 26 + lv * 7;
  const wood = '#9c6b3d', woodD = '#7a4f2a', roof = ['#b3593a', '#a04e85', '#3f7ec2'][lv];
  ctx.strokeStyle = woodD; ctx.lineWidth = 5.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 12, y + 4); ctx.lineTo(x - 7, y - h + 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 12, y + 4); ctx.lineTo(x + 7, y - h + 8); ctx.stroke();
  ctx.strokeStyle = wood; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x - 10, y - h * 0.45); ctx.lineTo(x + 10, y - h * 0.45); ctx.stroke();
  ctx.fillStyle = woodD; ctx.fillRect(x - 16, y - h + 2, 32, 7);
  ctx.fillStyle = wood; ctx.fillRect(x - 16, y - h, 32, 5);
  stk(ctx, 1.8); ctx.strokeRect(x - 16, y - h, 32, 9);
  ctx.fillStyle = wood;
  for (let i = -1; i <= 1; i++) ctx.fillRect(x + i * 10 - 1.5, y - h - 6, 3, 7);
  // 屋頂
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x - 18, y - h - 5);
  ctx.lineTo(x, y - h - 23 - lv * 2);
  ctx.lineTo(x + 18, y - h - 5);
  ctx.closePath(); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  ctx.fillStyle = shade(roof, -0.25);
  ctx.beginPath();
  ctx.moveTo(x, y - h - 23 - lv * 2);
  ctx.lineTo(x + 18, y - h - 5);
  ctx.lineTo(x + 9, y - h - 5);
  ctx.closePath(); ctx.fill();
  // 弓箭手（待機微浮動）
  const ay = y - h - 1 + Math.sin(time * 2 + x) * 0.8;
  ctx.fillStyle = '#e8c9a0';
  ctx.beginPath(); ctx.arc(x, ay - 8, 4, 0, TAU); ctx.fill();
  stk(ctx, 1.6); ctx.stroke();
  ctx.fillStyle = '#7a8c52';
  ctx.beginPath(); ctx.roundRect(x - 4, ay - 5, 8, 8, 2); ctx.fill();
  stk(ctx, 1.6); ctx.stroke();
  ctx.save();
  ctx.translate(x, ay - 3);
  ctx.rotate(t.aim ?? 0);
  ctx.strokeStyle = '#4a3018'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(5, 0, 7, -1.15, 1.15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(10, 0); ctx.stroke();
  ctx.restore();
}

function drawCannonTower(ctx, t, lv) {
  const { x, y } = t;
  const stone = '#7d8794', metal = '#39404a';
  const r = 15 + lv * 1.5;
  ctx.fillStyle = shade(stone, -0.25);
  ctx.beginPath(); ctx.ellipse(x, y - 2, r + 2, (r + 2) * 0.72, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  ctx.fillStyle = stone;
  ctx.beginPath(); ctx.ellipse(x, y - 5, r, r * 0.7, 0, 0, TAU); ctx.fill();
  stk(ctx, 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.2;
  for (let a = 0.4; a < TAU; a += TAU / 7) {
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.55, y - 5 + Math.sin(a) * r * 0.4);
    ctx.lineTo(x + Math.cos(a) * r, y - 5 + Math.sin(a) * r * 0.7);
    ctx.stroke();
  }
  ctx.fillStyle = shade(stone, 0.25);
  ctx.beginPath(); ctx.ellipse(x, y - 9, r * 0.72, r * 0.45, 0, 0, TAU); ctx.fill();
  const recoil = (t.recoil ?? 0) * 5;
  ctx.save();
  ctx.translate(x, y - 11);
  ctx.rotate(t.aim ?? -Math.PI / 4);
  ctx.translate(-recoil, 0);
  ctx.fillStyle = metal;
  ctx.beginPath(); ctx.roundRect(-2, -4.5 - lv * 0.5, 19 + lv * 2, 9 + lv, 3); ctx.fill();
  stk(ctx, 2); ctx.stroke();
  ctx.fillStyle = shade(metal, 0.3);
  ctx.fillRect(0, -4 - lv * 0.5, 16 + lv * 2, 3);
  ctx.fillStyle = metal;
  ctx.beginPath(); ctx.arc(17 + lv * 2, 0, 5.5 + lv * 0.7, 0, TAU); ctx.fill();
  stk(ctx, 2); ctx.stroke();
  ctx.fillStyle = '#14181d';
  ctx.beginPath(); ctx.arc(17 + lv * 2, 0, 3 + lv * 0.5, 0, TAU); ctx.fill();
  ctx.fillStyle = shade(metal, 0.45);
  ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, TAU); ctx.fill();
  stk(ctx, 1.8); ctx.stroke();
  ctx.restore();
}

function drawMageTower(ctx, t, lv, time) {
  const { x, y } = t;
  const h = 30 + lv * 7;
  const body = '#7464a8', trimC = '#cabffa';
  ctx.fillStyle = shade(body, -0.25);
  ctx.beginPath();
  ctx.moveTo(x - 13, y + 4);
  ctx.quadraticCurveTo(x - 9, y - h * 0.6, x - 4, y - h);
  ctx.lineTo(x + 4, y - h);
  ctx.quadraticCurveTo(x + 9, y - h * 0.6, x + 13, y + 4);
  ctx.closePath(); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x - 10, y + 4);
  ctx.quadraticCurveTo(x - 7, y - h * 0.6, x - 3, y - h);
  ctx.lineTo(x + 2, y - h);
  ctx.quadraticCurveTo(x + 5, y - h * 0.6, x + 8, y + 4);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath(); ctx.arc(x - 1, y - h * 0.45, 2.8, 0, TAU); ctx.fill();
  stk(ctx, 1.4); ctx.stroke();
  ctx.fillStyle = trimC;
  for (let i = 0; i <= lv; i++) {
    ctx.beginPath(); ctx.arc(x - 4 + i * 4, y - 4, 1.6, 0, TAU); ctx.fill();
  }
  const fy = y - h - 10 + Math.sin(time * 2.4 + x) * 2.5;
  const glow = 0.5 + Math.sin(time * 3 + x) * 0.2;
  ctx.fillStyle = `rgba(170,120,255,${glow * 0.35})`;
  ctx.beginPath(); ctx.arc(x, fy, 12 + lv * 1.5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#b388ff';
  ctx.beginPath();
  ctx.moveTo(x, fy - 8 - lv); ctx.lineTo(x + 5.5, fy); ctx.lineTo(x, fy + 8 + lv); ctx.lineTo(x - 5.5, fy);
  ctx.closePath(); ctx.fill();
  stk(ctx, 1.8); ctx.stroke();
  ctx.fillStyle = '#e6d9ff';
  ctx.beginPath();
  ctx.moveTo(x, fy - 8 - lv); ctx.lineTo(x + 5.5, fy); ctx.lineTo(x, fy); ctx.closePath(); ctx.fill();
}

function drawFrostTower(ctx, t, lv, time) {
  const { x, y } = t;
  ctx.fillStyle = 'rgba(170,225,255,0.3)';
  ctx.beginPath(); ctx.ellipse(x, y + 2, 20, 12, 0, 0, TAU); ctx.fill();
  const shards = [
    [-9, 3, 9 + lv * 2, -0.35],
    [9, 3, 9 + lv * 2, 0.35],
    [-4, 5, 6 + lv, -0.15],
    [5, 5, 6 + lv, 0.2],
    [0, 0, 13 + lv * 3, 0],
  ];
  for (const [ox, oy, len, rot] of shards) {
    ctx.save();
    ctx.translate(x + ox, y + oy);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(0, 0, 0, -len * 2);
    g.addColorStop(0, '#5fa8d8');
    g.addColorStop(1, '#e8f8ff');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-5, 0); ctx.lineTo(0, -len * 2); ctx.lineTo(5, 0);
    ctx.quadraticCurveTo(0, 3.5, -5, 0);
    ctx.fill();
    stk(ctx, 1.8); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -len * 1.8); ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < 3; i++) {
    const a = time * 1.4 + i * 2.1;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 15, y - 17 + Math.sin(a * 1.7) * 8, 1.5, 0, TAU);
    ctx.fill();
  }
}

function drawTeslaTower(ctx, t, lv, time) {
  const { x, y } = t;
  const h = 28 + t.level * 6;
  const metal = '#566270', metalL = '#7d8a98';
  // 三腳金屬塔架
  ctx.strokeStyle = metal; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 13, y + 4); ctx.lineTo(x, y - h * 0.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 13, y + 4); ctx.lineTo(x, y - h * 0.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x, y - h * 0.5); ctx.stroke();
  ctx.strokeStyle = metalL; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x - 8, y - h * 0.28); ctx.lineTo(x + 8, y - h * 0.28); ctx.stroke();
  // 頂端銅球（特斯拉線圈）
  const by = y - h - 4;
  const g = ctx.createRadialGradient(x - 3, by - 3, 2, x, by, 12);
  g.addColorStop(0, '#bfeaff'); g.addColorStop(0.5, '#5aa8d8'); g.addColorStop(1, '#2c6a9a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, by, 9 + t.level, 0, TAU); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  // 環繞電弧
  ctx.strokeStyle = `rgba(150,220,255,${0.6 + Math.sin(time * 9) * 0.3})`;
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 3; i++) {
    const a0 = time * 6 + i * 2.1;
    ctx.beginPath();
    let px = x + Math.cos(a0) * (10 + t.level), py = by + Math.sin(a0) * (10 + t.level);
    ctx.moveTo(px, py);
    for (let k = 1; k <= 4; k++) {
      const a = a0 + k * 0.5;
      const rr = (10 + t.level) + (k % 2 ? 5 : -3);
      ctx.lineTo(x + Math.cos(a) * rr, by + Math.sin(a) * rr);
    }
    ctx.stroke();
  }
  // 火花核心
  ctx.fillStyle = '#eaffff';
  ctx.beginPath(); ctx.arc(x, by, 3.5, 0, TAU); ctx.fill();
}

function drawPoisonTower(ctx, t, lv, time) {
  const { x, y } = t;
  const h = 24 + t.level * 5;
  const wood = '#5e7038', woodD = '#46562a';
  // 木桶 / 大鍋座
  ctx.fillStyle = woodD;
  ctx.beginPath(); ctx.moveTo(x - 16, y + 6); ctx.lineTo(x - 12, y - h); ctx.lineTo(x + 12, y - h); ctx.lineTo(x + 16, y + 6); ctx.closePath(); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
  ctx.fillStyle = wood;
  ctx.beginPath(); ctx.moveTo(x - 13, y + 4); ctx.lineTo(x - 10, y - h + 2); ctx.lineTo(x + 4, y - h + 2); ctx.lineTo(x + 6, y + 4); ctx.closePath(); ctx.fill();
  // 鐵箍
  ctx.strokeStyle = '#3a4a22'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x - 14, y - h * 0.4); ctx.lineTo(x + 14, y - h * 0.4); ctx.stroke();
  // 桶口毒液
  ctx.fillStyle = '#8ad84a';
  ctx.beginPath(); ctx.ellipse(x, y - h, 12, 5, 0, 0, TAU); ctx.fill();
  stk(ctx, 1.8); ctx.stroke();
  ctx.fillStyle = '#a8f060';
  ctx.beginPath(); ctx.ellipse(x, y - h - 1, 8, 3, 0, 0, TAU); ctx.fill();
  // 冒泡 + 毒氣
  for (let i = 0; i < 3; i++) {
    const ph = (time * 0.9 + i / 3) % 1;
    ctx.fillStyle = `rgba(140,216,74,${0.5 * (1 - ph)})`;
    ctx.beginPath(); ctx.arc(x - 5 + i * 5, y - h - 4 - ph * 16, 2 + ph * 4, 0, TAU); ctx.fill();
  }
  // 桶面骷髏標
  ctx.fillStyle = '#e8e2d0';
  ctx.beginPath(); ctx.arc(x - 3, y - h * 0.5, 3.4, 0, TAU); ctx.fill();
  ctx.fillStyle = woodD;
  ctx.beginPath(); ctx.arc(x - 4.2, y - h * 0.5 - 0.5, 1, 0, TAU); ctx.arc(x - 1.8, y - h * 0.5 - 0.5, 1, 0, TAU); ctx.fill();
}

// ---------- 敵人 ----------

// 各怪 sprite 內容底部(腳)在幀高的比例（量測 walk 幀；用來精準對地）
const FOOT_FRAC = {
  orc: 0.84, goblin: 0.94, knight: 0.95, bat: 0.93, wolf: 0.94,
  shaman: 0.92, slime: 0.91, slimelet: 0.91, gargoyle: 0.92, boss: 0.95,
};

export function drawEnemy(ctx, e) {
  const { x, y } = e.pos;
  const r = e.def.radius;
  const walk = Math.sin(e.dist / 7 + (e.seed ?? 0));
  const fly = e.def.flying ? -18 + Math.sin(e.dist / 12) * 3.5 : 0;
  const dir = Math.cos(e.pos.angle) >= 0 ? 1 : -1;
  // 壓縮回彈（squash & stretch）
  const sq = e.def.flying ? 0 : Math.abs(Math.sin(e.dist / 7)) * 0.07;

  // 優先用真實美術 sprite；尚未載入則退回程式向量繪製
  const frames = enemyFrames(e.type);
  let img = null;
  if (frames && frames.length) {
    const idx = Math.floor(e.dist / 8 + (e.seed ?? 0)) % frames.length;
    img = frames[idx];
    if (!img.complete || !img.naturalWidth) img = frames.find(f => f.complete && f.naturalWidth) || null;
  }

  // 非飛行怪的腳再往下壓一點，確實踩在地板上
  const ground = e.def.flying ? 0 : r * 0.42;
  // 影子：sprite 畫在腳下(地面點)；向量敵人畫在 y+r*0.72
  const shadowY = img ? y + ground + 2 : y + r * 0.72;
  ctx.fillStyle = `rgba(0,0,0,${e.def.flying ? 0.12 : 0.22})`;
  ctx.beginPath(); ctx.ellipse(x, shadowY, r * (1.0 + sq), r * 0.4, 0, 0, TAU); ctx.fill();

  let drewSprite = false;
  if (img) {
    const scale = (e.type === 'slimelet' ? r * 3.0 : r * 3.7) / 285;
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    // 每種怪內容底部(腳)的幀高比例，把腳對到地面點再下壓 ground
    const foot = FOOT_FRAC[e.type] ?? 0.93;
    ctx.save();
    ctx.translate(x, y + fly + ground);
    if (e.hitT > 0) ctx.filter = 'brightness(1.8) saturate(0.7)';
    if (dir < 0) ctx.scale(-1, 1);
    ctx.drawImage(img, -dw / 2, -dh * foot, dw, dh);
    ctx.restore();
    drewSprite = true;
  }
  if (!drewSprite) drawVectorEnemy(ctx, e, r, walk, dir, fly, sq);

  // 中毒綠色暈染（疊在任一畫法上）
  if (e.poisonT > 0) {
    ctx.save();
    ctx.translate(x, y + fly);
    ctx.globalAlpha = 0.3 + Math.sin(e.dist * 0.5) * 0.1;
    ctx.fillStyle = '#8ad84a';
    ctx.beginPath(); ctx.ellipse(0, -r * 0.5, r * 1.0, r * 1.3, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  if (e.slowT > 0) {
    ctx.strokeStyle = 'rgba(130,210,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.6, r + 4, (r + 4) * 0.45, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(190,235,255,0.9)';
    for (let i = 0; i < 3; i++) {
      const a = e.slowT * 5 + i * 2.1;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * (r + 4), y + fly + Math.sin(a) * 4 - r, 1.8, 0, TAU); ctx.fill();
    }
  }

  if (e.hp < e.maxHp) {
    const w = Math.max(22, r * 2);
    const pct = Math.max(0, e.hp / e.maxHp);
    const bx = x - w / 2, by = y + fly - r - 13;
    ctx.fillStyle = 'rgba(15,18,25,0.85)';
    ctx.beginPath(); ctx.roundRect(bx - 1, by - 1, w + 2, 6.5, 3); ctx.fill();
    ctx.fillStyle = pct > 0.55 ? '#5ecf52' : pct > 0.25 ? '#e8b33a' : '#e0503e';
    ctx.beginPath(); ctx.roundRect(bx, by, w * pct, 4.5, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.roundRect(bx, by, w * pct, 1.8, 1); ctx.fill();
  }
}

// 程式向量畫法（sprite 未載入時的後備）
function drawVectorEnemy(ctx, e, r, walk, dir, fly, sq) {
  ctx.save();
  ctx.translate(e.pos.x, e.pos.y + fly);
  ctx.scale(1 + sq * 0.6, 1 - sq);
  if (e.hitT > 0) ctx.filter = 'brightness(1.9) saturate(0.6)';
  if (e.type === 'goblin') drawGoblin(ctx, r, walk, dir);
  else if (e.type === 'orc') drawOrc(ctx, r, walk, dir);
  else if (e.type === 'knight') drawKnight(ctx, r, walk, dir);
  else if (e.type === 'bat') drawBat(ctx, e, r, dir);
  else if (e.type === 'wolf') drawWolf(ctx, r, walk, dir);
  else if (e.type === 'shaman') drawShaman(ctx, r, walk, dir, e);
  else if (e.type === 'slime' || e.type === 'slimelet') drawSlime(ctx, r, e, dir);
  else if (e.type === 'gargoyle') drawGargoyle(ctx, e, r, dir);
  else drawBoss(ctx, r, walk, dir);
  ctx.restore();
}

// 共用：圓身 + 漸層 + 描邊（原點為角色中心）
function body(ctx, r, base, squashX = 1, squashY = 1) {
  ctx.fillStyle = ballGrad(ctx, 0, 0, r, base);
  ctx.beginPath(); ctx.ellipse(0, 0, r * squashX, r * squashY, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
}

function cartoonEyes(ctx, r, dir, opts = {}) {
  const { angry = false, red = false, spread = 0.24, size = 0.2 } = opts;
  for (const s of [-1, 1]) {
    const ex = dir * r * 0.36 + s * r * spread, ey = -r * 0.28;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex, ey, r * size, 0, TAU); ctx.fill();
    stk(ctx, 1.4); ctx.stroke();
    ctx.fillStyle = red ? '#c0392b' : '#1d2430';
    ctx.beginPath(); ctx.arc(ex + dir * r * 0.07, ey, r * size * 0.5, 0, TAU); ctx.fill();
  }
  if (angry) {
    stk(ctx, 2);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * r * 0.36 + s * r * (spread + 0.16), -r * 0.56);
      ctx.lineTo(dir * r * 0.36 + s * r * (spread - 0.12), -r * 0.42);
      ctx.stroke();
    }
  }
}

function limb(ctx, x1, y1, x2, y2, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

// 人形敵人通用：頭與軀幹分離、可見四肢與站姿，打破「圓球」輪廓。
// 原點為角色中心；腳落在 ~+r、頭頂約 -r*1.5。

function drawGoblin(ctx, r, walk, dir) {
  const skin = '#7bb04a', skinD = shade(skin, -0.3), cloth = '#8a5a2e';
  // 佝僂前傾的小個子：細腿碎步
  limb(ctx, -r * 0.26, r * 0.45, -r * 0.32 + walk * r * 0.4, r * 1.05, r * 0.2, skinD);
  limb(ctx, r * 0.26, r * 0.45, r * 0.2 - walk * r * 0.4, r * 1.05, r * 0.2, skinD);
  // 後臂揮動
  limb(ctx, -dir * r * 0.3, -r * 0.05, -dir * r * 0.75, r * 0.25 - walk * r * 0.25, r * 0.16, skinD);
  // 小軀幹（前傾、瘦長蛋形）
  ctx.save();
  ctx.rotate(dir * 0.14);
  ctx.fillStyle = ballGrad(ctx, 0, r * 0.25, r * 0.55, skin);
  ctx.beginPath(); ctx.ellipse(0, r * 0.28, r * 0.5, r * 0.58, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
  // 腰布
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(-r * 0.46, r * 0.55); ctx.lineTo(r * 0.46, r * 0.55);
  ctx.lineTo(r * 0.32, r * 0.92); ctx.lineTo(0, r * 0.78); ctx.lineTo(-r * 0.32, r * 0.92);
  ctx.closePath(); ctx.fill();
  stk(ctx, 1.8); ctx.stroke();
  ctx.restore();
  // 頭（獨立、偏大、前傾）
  const hx = dir * r * 0.18, hy = -r * 0.45, hr = r * 0.6;
  // 大尖耳
  for (const s of [-1, 1]) {
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(hx + s * hr * 0.7, hy - hr * 0.1);
    ctx.quadraticCurveTo(hx + s * hr * 2.0, hy - hr * 0.9, hx + s * hr * 2.1, hy - hr * 0.2);
    ctx.quadraticCurveTo(hx + s * hr * 1.3, hy + hr * 0.1, hx + s * hr * 0.55, hy + hr * 0.2);
    ctx.closePath(); ctx.fill();
    stk(ctx, 2); ctx.stroke();
  }
  ctx.fillStyle = ballGrad(ctx, hx, hy, hr, skin);
  ctx.beginPath(); ctx.ellipse(hx, hy, hr, hr * 0.95, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
  // 勾鼻
  ctx.fillStyle = shade(skin, -0.12);
  ctx.beginPath();
  ctx.moveTo(hx + dir * hr * 0.15, hy);
  ctx.quadraticCurveTo(hx + dir * hr * 0.9, hy + hr * 0.1, hx + dir * hr * 0.55, hy + hr * 0.55);
  ctx.quadraticCurveTo(hx + dir * hr * 0.2, hy + hr * 0.4, hx + dir * hr * 0.15, hy);
  ctx.closePath(); ctx.fill();
  stk(ctx, 1.6); ctx.stroke();
  // 瞇眼壞笑
  ctx.fillStyle = '#ffe14a';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(hx + dir * hr * 0.05 + s * hr * 0.32, hy - hr * 0.2, hr * 0.2, hr * 0.16, 0, 0, TAU); ctx.fill();
    stk(ctx, 1.4); ctx.stroke();
    ctx.fillStyle = '#1d2430';
    ctx.beginPath(); ctx.arc(hx + dir * hr * 0.12 + s * hr * 0.32, hy - hr * 0.2, hr * 0.07, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe14a';
  }
  stk(ctx, 1.8);
  ctx.beginPath(); ctx.arc(hx + dir * hr * 0.2, hy + hr * 0.5, hr * 0.4, 0.1, Math.PI - 0.5); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(hx + dir * hr * 0.0, hy + hr * 0.85);
  ctx.lineTo(hx + dir * hr * 0.12, hy + hr * 0.6);
  ctx.lineTo(hx + dir * hr * 0.24, hy + hr * 0.85);
  ctx.closePath(); ctx.fill();
  // 前臂 + 鏽匕首
  const gx = dir * r * 0.7, gy = r * 0.25 + walk * r * 0.15;
  limb(ctx, dir * r * 0.35, r * 0.05, gx, gy, r * 0.16, skinD);
  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(dir * (-0.7 + walk * 0.3));
  ctx.fillStyle = '#5a4636';
  ctx.fillRect(-r * 0.05, -r * 0.04, r * 0.22, r * 0.12);
  ctx.fillStyle = '#c2bdb0';
  ctx.beginPath();
  ctx.moveTo(dir * r * 0.15, -r * 0.13); ctx.lineTo(dir * r * 0.85, -r * 0.42); ctx.lineTo(dir * r * 0.2, r * 0.08);
  ctx.closePath(); ctx.fill();
  stk(ctx, 1.6); ctx.stroke();
  ctx.restore();
}

function drawOrc(ctx, r, walk, dir) {
  const skin = '#5f8f46', skinD = shade(skin, -0.32), armor = '#6e5638';
  // 粗壯雙腿
  limb(ctx, -r * 0.34, r * 0.5, -r * 0.34 + walk * r * 0.32, r * 1.08, r * 0.3, skinD);
  limb(ctx, r * 0.34, r * 0.5, r * 0.34 - walk * r * 0.32, r * 1.08, r * 0.3, skinD);
  // 後臂
  limb(ctx, -dir * r * 0.55, -r * 0.15, -dir * r * 1.05, r * 0.2, r * 0.26, skinD);
  // 倒梯形壯碩軀幹（寬肩窄腰）
  ctx.fillStyle = ballGrad(ctx, 0, 0, r * 0.95, skin);
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, -r * 0.55);
  ctx.quadraticCurveTo(-r * 1.05, r * 0.1, -r * 0.5, r * 0.62);
  ctx.lineTo(r * 0.5, r * 0.62);
  ctx.quadraticCurveTo(r * 1.05, r * 0.1, r * 0.95, -r * 0.55);
  ctx.quadraticCurveTo(0, -r * 0.85, -r * 0.95, -r * 0.55);
  ctx.closePath(); ctx.fill();
  stk(ctx, 2.6); ctx.stroke();
  // 肚甲腰帶
  ctx.fillStyle = armor;
  ctx.beginPath(); ctx.ellipse(0, r * 0.5, r * 0.55, r * 0.26, 0, Math.PI, 0, true); ctx.fill();
  stk(ctx, 2); ctx.stroke();
  ctx.fillStyle = '#caa24a';
  ctx.beginPath(); ctx.arc(0, r * 0.4, r * 0.12, 0, TAU); ctx.fill();
  stk(ctx, 1.6); ctx.stroke();
  // 鉚釘肩甲（前肩）
  const px = dir * r * 0.7;
  ctx.fillStyle = '#7a6242';
  ctx.beginPath(); ctx.ellipse(px, -r * 0.55, r * 0.5, r * 0.38, dir * 0.3, 0, TAU); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  ctx.fillStyle = '#caa24a';
  for (const a of [-0.5, 0, 0.5]) {
    ctx.beginPath(); ctx.arc(px + dir * Math.cos(a) * r * 0.3, -r * 0.55 + Math.sin(a) * r * 0.22, r * 0.055, 0, TAU); ctx.fill();
  }
  // 小頭埋進肩膀（下顎前突）
  const hx = dir * r * 0.05, hy = -r * 0.72, hr = r * 0.5;
  ctx.fillStyle = ballGrad(ctx, hx, hy, hr, skin);
  ctx.beginPath(); ctx.ellipse(hx, hy, hr, hr * 0.85, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
  // 突出下顎
  ctx.fillStyle = shade(skin, -0.1);
  ctx.beginPath(); ctx.ellipse(hx + dir * hr * 0.2, hy + hr * 0.45, hr * 0.7, hr * 0.42, 0, 0, TAU); ctx.fill();
  stk(ctx, 2); ctx.stroke();
  // 向上獠牙
  ctx.fillStyle = '#f4eedd';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hx + dir * hr * 0.15 + s * hr * 0.32, hy + hr * 0.6);
    ctx.lineTo(hx + dir * hr * 0.15 + s * hr * 0.4, hy - hr * 0.05);
    ctx.lineTo(hx + dir * hr * 0.15 + s * hr * 0.08, hy + hr * 0.45);
    ctx.closePath(); ctx.fill();
    stk(ctx, 1.6); ctx.stroke();
  }
  // 怒目
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath(); ctx.ellipse(hx + dir * hr * 0.18 + s * hr * 0.26, hy - hr * 0.12, hr * 0.2, hr * 0.15, 0, 0, TAU); ctx.fill();
    stk(ctx, 1.4); ctx.stroke();
    ctx.fillStyle = '#1d2430';
    ctx.beginPath(); ctx.arc(hx + dir * hr * 0.26 + s * hr * 0.26, hy - hr * 0.12, hr * 0.08, 0, TAU); ctx.fill();
  }
  stk(ctx, 2);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hx + dir * hr * 0.18 + s * hr * 0.5, hy - hr * 0.5);
    ctx.lineTo(hx + dir * hr * 0.18 + s * hr * 0.12, hy - hr * 0.28);
    ctx.stroke();
  }
  // 前臂揮巨棒
  const gx = dir * r * 0.95, gy = r * 0.1 + walk * r * 0.16;
  limb(ctx, dir * r * 0.55, -r * 0.1, gx, gy, r * 0.28, skinD);
  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(dir * (0.7 + walk * 0.18));
  ctx.strokeStyle = '#6e4a2f'; ctx.lineWidth = r * 0.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 1.0); ctx.stroke();
  ctx.fillStyle = '#5d4a3a';
  ctx.beginPath();
  ctx.moveTo(-r * 0.32, -r * 1.0); ctx.lineTo(0, -r * 1.35); ctx.lineTo(r * 0.32, -r * 1.0);
  ctx.quadraticCurveTo(0, -r * 0.82, -r * 0.32, -r * 1.0);
  ctx.closePath(); ctx.fill();
  stk(ctx, 2); ctx.stroke();
  ctx.restore();
}

function drawKnight(ctx, r, walk, dir) {
  const steel = '#bcc4ce', steelD = shade(steel, -0.32), steelL = shade(steel, 0.18);
  // 鎧甲腿（護脛）
  for (const s of [-1, 1]) {
    const lx = s * r * 0.34, swing = s === (walk > 0 ? 1 : -1) ? Math.abs(walk) * r * 0.3 : 0;
    limb(ctx, lx, r * 0.5, lx + s * swing * 0.4, r * 1.08, r * 0.26, steelD);
    ctx.fillStyle = '#3a3f47';
    ctx.beginPath(); ctx.ellipse(lx + s * swing * 0.4, r * 1.12, r * 0.18, r * 0.1, 0, 0, TAU); ctx.fill();
  }
  // 後臂持劍
  ctx.save();
  ctx.translate(-dir * r * 0.62, -r * 0.2);
  ctx.rotate(-dir * (0.5 + walk * 0.1));
  ctx.fillStyle = '#dde3ea';
  ctx.beginPath();
  ctx.moveTo(-r * 0.07, r * 0.1); ctx.lineTo(-r * 0.07, -r * 1.15); ctx.lineTo(0, -r * 1.38); ctx.lineTo(r * 0.07, -r * 1.15); ctx.lineTo(r * 0.07, r * 0.1);
  ctx.closePath(); ctx.fill();
  stk(ctx, 1.8); ctx.stroke();
  ctx.fillStyle = '#caa24a';
  ctx.fillRect(-r * 0.24, r * 0.02, r * 0.48, r * 0.12);
  stk(ctx, 1.6); ctx.strokeRect(-r * 0.24, r * 0.02, r * 0.48, r * 0.12);
  ctx.restore();
  // 軀幹胸甲（梯形板甲）
  ctx.fillStyle = ballGrad(ctx, 0, 0, r * 0.85, steel);
  ctx.beginPath();
  ctx.moveTo(-r * 0.78, -r * 0.5);
  ctx.quadraticCurveTo(-r * 0.7, r * 0.3, 0, r * 0.66);
  ctx.quadraticCurveTo(r * 0.7, r * 0.3, r * 0.78, -r * 0.5);
  ctx.quadraticCurveTo(0, -r * 0.78, -r * 0.78, -r * 0.5);
  ctx.closePath(); ctx.fill();
  stk(ctx, 2.6); ctx.stroke();
  // 胸甲中脊與肌理
  ctx.strokeStyle = steelD; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -r * 0.5); ctx.lineTo(0, r * 0.6); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -r * 0.2, r * 0.5, 0.45, Math.PI - 0.45); ctx.stroke();
  ctx.fillStyle = steelL;
  ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.2, r * 0.16, r * 0.3, 0.2, 0, TAU); ctx.fill();
  // 肩甲（雙肩護片）
  for (const s of [-1, 1]) {
    ctx.fillStyle = steel;
    ctx.beginPath(); ctx.ellipse(s * r * 0.7, -r * 0.5, r * 0.34, r * 0.26, s * 0.3, 0, TAU); ctx.fill();
    stk(ctx, 2.2); ctx.stroke();
  }
  // 頭盔（獨立、騎士帽 + 面甲 + 紅纓）
  const hx = dir * r * 0.06, hy = -r * 0.78, hr = r * 0.5;
  // 紅纓向後飄
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.moveTo(hx, hy - hr * 0.7);
  ctx.quadraticCurveTo(hx - dir * hr * 1.3, hy - hr * 1.8 + walk * hr * 0.2, hx - dir * hr * 2.1, hy - hr * 0.2);
  ctx.quadraticCurveTo(hx - dir * hr * 1.1, hy - hr * 0.7, hx, hy - hr * 0.3);
  ctx.closePath(); ctx.fill();
  stk(ctx, 1.8); ctx.stroke();
  // 盔體
  ctx.fillStyle = ballGrad(ctx, hx, hy, hr, steelL);
  ctx.beginPath(); ctx.ellipse(hx, hy, hr, hr * 1.05, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
  // 面甲（深色橫帶 + 透氣縫）
  ctx.fillStyle = '#2b3038';
  ctx.beginPath(); ctx.ellipse(hx + dir * hr * 0.1, hy + hr * 0.15, hr * 0.78, hr * 0.45, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffd23e';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(hx + dir * hr * 0.1 + s * hr * 0.3, hy + hr * 0.05, hr * 0.12, hr * 0.08, 0, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = '#1a1e24'; ctx.lineWidth = 1.6;
  for (const o of [-0.25, 0.05, 0.35]) {
    ctx.beginPath(); ctx.moveTo(hx + dir * hr * 0.1 + o * hr, hy + hr * 0.3); ctx.lineTo(hx + dir * hr * 0.1 + o * hr, hy + hr * 0.55); ctx.stroke();
  }
  // 盔頂脊
  ctx.fillStyle = steelD;
  ctx.beginPath(); ctx.ellipse(hx, hy - hr * 0.55, hr * 0.5, hr * 0.18, 0, 0, TAU); ctx.fill();
  // 鳶形盾（前臂、金十字徽）
  const sx = dir * r * 0.92, sy = r * 0.05;
  limb(ctx, dir * r * 0.5, r * 0.0, sx, sy, r * 0.2, steelD);
  ctx.fillStyle = '#9a3b2e';
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.42, sy - r * 0.5);
  ctx.lineTo(sx + r * 0.42, sy - r * 0.5);
  ctx.quadraticCurveTo(sx + r * 0.42, sy + r * 0.4, sx, sy + r * 0.8);
  ctx.quadraticCurveTo(sx - r * 0.42, sy + r * 0.4, sx - r * 0.42, sy - r * 0.5);
  ctx.closePath(); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
  ctx.fillStyle = '#e8d9a0';
  ctx.fillRect(sx - r * 0.07, sy - r * 0.42, r * 0.14, r * 0.95);
  ctx.fillRect(sx - r * 0.28, sy - r * 0.12, r * 0.56, r * 0.14);
}

function drawBat(ctx, e, r, dir) {
  const flap = Math.sin(e.dist / 4.5) * 0.9;
  const c = '#6d5688';
  // 翅膀（雙骨膜翅）
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.scale(s, 1);
    ctx.rotate(-flap * 0.5);
    ctx.fillStyle = shade(c, -0.28);
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.15);
    ctx.quadraticCurveTo(r * 1.5, -r * 1.3, r * 2.5, -r * 0.5);
    ctx.quadraticCurveTo(r * 1.95, -r * 0.1, r * 1.6, -r * 0.12);
    ctx.quadraticCurveTo(r * 1.25, r * 0.35, r * 0.9, r * 0.12);
    ctx.quadraticCurveTo(r * 0.6, r * 0.35, r * 0.3, r * 0.18);
    ctx.closePath(); ctx.fill();
    stk(ctx, 2); ctx.stroke();
    // 翅骨
    ctx.strokeStyle = shade(c, -0.45); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(r * 0.35, -r * 0.1); ctx.quadraticCurveTo(r * 1.3, -r * 0.9, r * 2.3, -r * 0.5); ctx.stroke();
    ctx.restore();
  }
  body(ctx, r, c);
  // 大耳
  for (const s of [-1, 1]) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(s * r * 0.45, -r * 0.5);
    ctx.lineTo(s * r * 0.8, -r * 1.45);
    ctx.lineTo(s * r * 0.06, -r * 0.78);
    ctx.closePath(); ctx.fill();
    stk(ctx, 1.8); ctx.stroke();
    ctx.fillStyle = '#e8a8b8';
    ctx.beginPath();
    ctx.moveTo(s * r * 0.42, -r * 0.62);
    ctx.lineTo(s * r * 0.62, -r * 1.15);
    ctx.lineTo(s * r * 0.2, -r * 0.74);
    ctx.closePath(); ctx.fill();
  }
  cartoonEyes(ctx, r, dir, { red: true, size: 0.2 });
  // 尖牙
  ctx.fillStyle = '#fff';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(dir * r * 0.3 + s * r * 0.2, r * 0.3);
    ctx.lineTo(dir * r * 0.3 + s * r * 0.11, r * 0.62);
    ctx.lineTo(dir * r * 0.3 + s * r * 0.02, r * 0.3);
    ctx.closePath(); ctx.fill();
  }
}

function drawBoss(ctx, r, walk, dir) {
  const skin = '#a64c3c', skinD = shade(skin, -0.32), belly = '#d8a07a';
  // 巨柱腿 + 護甲腳
  for (const s of [-1, 1]) {
    limb(ctx, s * r * 0.42, r * 0.55, s * r * 0.42 + (s > 0 ? walk : -walk) * r * 0.18, r * 1.1, r * 0.4, skinD);
    ctx.fillStyle = '#4a2f28';
    ctx.beginPath(); ctx.ellipse(s * r * 0.42 + (s > 0 ? walk : -walk) * r * 0.18, r * 1.16, r * 0.26, r * 0.14, 0, 0, TAU); ctx.fill();
  }
  // 背後巨刺（肩後伸出）
  ctx.fillStyle = '#7a3328';
  for (let i = -1; i <= 1; i++) {
    const bx = -dir * r * 0.5 + i * r * 0.34;
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.14, -r * 0.5);
    ctx.lineTo(bx, -r * 1.15 - (1 - Math.abs(i)) * r * 0.25);
    ctx.lineTo(bx + r * 0.14, -r * 0.5);
    ctx.closePath(); ctx.fill();
    stk(ctx, 2); ctx.stroke();
  }
  // 後臂
  limb(ctx, -dir * r * 0.7, -r * 0.2, -dir * r * 1.15, r * 0.3, r * 0.34, skinD);
  // 巨大梯形軀幹（駝背壯漢）
  ctx.fillStyle = ballGrad(ctx, 0, 0, r * 1.05, skin);
  ctx.beginPath();
  ctx.moveTo(-r * 1.05, -r * 0.5);
  ctx.quadraticCurveTo(-r * 1.15, r * 0.3, -r * 0.55, r * 0.7);
  ctx.lineTo(r * 0.55, r * 0.7);
  ctx.quadraticCurveTo(r * 1.15, r * 0.3, r * 1.05, -r * 0.5);
  ctx.quadraticCurveTo(0, -r * 0.95, -r * 1.05, -r * 0.5);
  ctx.closePath(); ctx.fill();
  stk(ctx, 2.8); ctx.stroke();
  // 大肚皮
  ctx.fillStyle = belly;
  ctx.beginPath(); ctx.ellipse(0, r * 0.42, r * 0.62, r * 0.42, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  ctx.strokeStyle = shade(belly, -0.2); ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(0, r * 0.1); ctx.lineTo(0, r * 0.7); ctx.stroke();
  // 鉚釘肩甲
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#6e5638';
    ctx.beginPath(); ctx.ellipse(s * r * 0.85, -r * 0.5, r * 0.42, r * 0.32, s * 0.3, 0, TAU); ctx.fill();
    stk(ctx, 2.4); ctx.stroke();
    ctx.fillStyle = '#caa24a';
    for (const a of [-0.6, 0, 0.6]) {
      ctx.beginPath(); ctx.arc(s * r * 0.85 + Math.cos(a) * s * r * 0.26, -r * 0.5 + Math.sin(a) * r * 0.2, r * 0.05, 0, TAU); ctx.fill();
    }
  }
  // 頭（埋進肩、突出下顎）
  const hx = dir * r * 0.08, hy = -r * 0.62, hr = r * 0.58;
  ctx.fillStyle = ballGrad(ctx, hx, hy, hr, skin);
  ctx.beginPath(); ctx.ellipse(hx, hy, hr, hr * 0.9, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.6); ctx.stroke();
  // 突顎
  ctx.fillStyle = shade(skin, -0.1);
  ctx.beginPath(); ctx.ellipse(hx + dir * hr * 0.2, hy + hr * 0.45, hr * 0.72, hr * 0.42, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  // 巨獠牙
  ctx.fillStyle = '#f4eedd';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hx + dir * hr * 0.15 + s * hr * 0.35, hy + hr * 0.62);
    ctx.lineTo(hx + dir * hr * 0.15 + s * hr * 0.46, hy - hr * 0.12);
    ctx.lineTo(hx + dir * hr * 0.15 + s * hr * 0.06, hy + hr * 0.4);
    ctx.closePath(); ctx.fill();
    stk(ctx, 1.8); ctx.stroke();
  }
  // 怒目（紅）
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath(); ctx.ellipse(hx + dir * hr * 0.16 + s * hr * 0.3, hy - hr * 0.12, hr * 0.2, hr * 0.16, 0, 0, TAU); ctx.fill();
    stk(ctx, 1.6); ctx.stroke();
    ctx.fillStyle = '#c0392b';
    ctx.beginPath(); ctx.arc(hx + dir * hr * 0.24 + s * hr * 0.3, hy - hr * 0.12, hr * 0.09, 0, TAU); ctx.fill();
  }
  stk(ctx, 2.2);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hx + dir * hr * 0.16 + s * hr * 0.52, hy - hr * 0.5);
    ctx.lineTo(hx + dir * hr * 0.16 + s * hr * 0.12, hy - hr * 0.26);
    ctx.stroke();
  }
  // 金王冠（紅寶石）
  ctx.fillStyle = '#ffd35e';
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.85, hy - hr * 0.62);
  for (let i = 0; i < 3; i++) {
    ctx.lineTo(hx - hr * 0.85 + (i + 0.5) * hr * 0.57, hy - hr * 1.25);
    ctx.lineTo(hx - hr * 0.85 + (i + 1) * hr * 0.57, hy - hr * 0.62);
  }
  ctx.lineTo(hx + hr * 0.85, hy - hr * 0.45);
  ctx.lineTo(hx - hr * 0.85, hy - hr * 0.45);
  ctx.closePath(); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = ['#e0503e', '#4ea0e0', '#5ecf52'][i];
    ctx.beginPath(); ctx.arc(hx - hr * 0.85 + (i + 0.5) * hr * 0.57, hy - hr * 0.95, hr * 0.1, 0, TAU); ctx.fill();
    stk(ctx, 1.2); ctx.stroke();
  }
  // 前臂巨棒（帶尖刺鐵球）
  const gx = dir * r * 1.1, gy = r * 0.15 + walk * r * 0.12;
  limb(ctx, dir * r * 0.6, -r * 0.15, gx, gy, r * 0.36, skinD);
  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(dir * (0.55 + walk * 0.12));
  ctx.strokeStyle = '#6e4a2f'; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 1.2); ctx.stroke();
  ctx.fillStyle = '#52555e';
  ctx.beginPath(); ctx.arc(0, -r * 1.35, r * 0.36, 0, TAU); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  ctx.fillStyle = '#c9cdd4';
  for (let a = 0; a < TAU; a += TAU / 7) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.36, -r * 1.35 + Math.sin(a) * r * 0.36);
    ctx.lineTo(Math.cos(a) * r * 0.52, -r * 1.35 + Math.sin(a) * r * 0.52);
    ctx.lineTo(Math.cos(a + 0.2) * r * 0.36, -r * 1.35 + Math.sin(a + 0.2) * r * 0.36);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawWolf(ctx, r, walk, dir) {
  const fur = '#8a7a66', furD = shade(fur, -0.3);
  ctx.save();
  ctx.scale(dir, 1); // 一律朝右畫，再依方向翻轉
  // 四條奔跑腿（前後交錯）
  const g1 = walk * r * 0.5, g2 = -walk * r * 0.5;
  ctx.strokeStyle = furD; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round';
  for (const [bx, sw] of [[-r * 0.55, g1], [-r * 0.35, g2], [r * 0.5, g2], [r * 0.7, g1]]) {
    ctx.beginPath(); ctx.moveTo(bx, r * 0.2); ctx.lineTo(bx + sw, r * 1.0); ctx.stroke();
  }
  // 尾巴
  ctx.strokeStyle = fur; ctx.lineWidth = r * 0.3;
  ctx.beginPath(); ctx.moveTo(-r * 0.7, -r * 0.1); ctx.quadraticCurveTo(-r * 1.4, -r * 0.2 + walk * r * 0.2, -r * 1.5, -r * 0.6); ctx.stroke();
  // 拉長身軀
  ctx.fillStyle = ballGrad(ctx, 0, 0, r, fur);
  ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.78, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
  // 頭（前方、低伏）
  const hx = r * 0.95, hy = -r * 0.25;
  ctx.fillStyle = fur;
  ctx.beginPath(); ctx.ellipse(hx, hy, r * 0.55, r * 0.5, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  // 吻部
  ctx.fillStyle = furD;
  ctx.beginPath(); ctx.moveTo(hx + r * 0.2, hy - r * 0.1); ctx.lineTo(hx + r * 0.95, hy + r * 0.05); ctx.lineTo(hx + r * 0.2, hy + r * 0.3); ctx.closePath(); ctx.fill();
  stk(ctx, 1.8); ctx.stroke();
  // 尖耳
  ctx.fillStyle = fur;
  for (const o of [-0.2, 0.2]) {
    ctx.beginPath(); ctx.moveTo(hx + o * r, hy - r * 0.4); ctx.lineTo(hx + o * r - r * 0.05, hy - r * 0.85); ctx.lineTo(hx + o * r + r * 0.22, hy - r * 0.45); ctx.closePath(); ctx.fill();
    stk(ctx, 1.6); ctx.stroke();
  }
  // 凶眼 + 獠牙
  ctx.fillStyle = '#ffd23e';
  ctx.beginPath(); ctx.ellipse(hx + r * 0.25, hy - r * 0.05, r * 0.14, r * 0.1, -0.3, 0, TAU); ctx.fill();
  ctx.fillStyle = '#1d2430';
  ctx.beginPath(); ctx.arc(hx + r * 0.3, hy - r * 0.05, r * 0.05, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(hx + r * 0.55, hy + r * 0.2); ctx.lineTo(hx + r * 0.62, hy + r * 0.45); ctx.lineTo(hx + r * 0.7, hy + r * 0.2); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawShaman(ctx, r, walk, dir, e) {
  const robe = '#9b59b6', robeD = shade(robe, -0.3), robeL = shade(robe, 0.2);
  // 飄動長袍下襬
  ctx.fillStyle = ballGrad(ctx, 0, r * 0.2, r, robe);
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, -r * 0.4);
  ctx.quadraticCurveTo(-r * 0.95, r * 0.6, -r * 0.55, r * 1.05);
  ctx.quadraticCurveTo(0, r * 0.85, r * 0.55, r * 1.05);
  ctx.quadraticCurveTo(r * 0.95, r * 0.6, r * 0.7, -r * 0.4);
  ctx.quadraticCurveTo(0, -r * 0.7, -r * 0.7, -r * 0.4);
  ctx.closePath(); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
  // 袍襬鑲邊
  ctx.strokeStyle = '#ffd35e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-r * 0.5, r * 0.95); ctx.quadraticCurveTo(0, r * 0.78, r * 0.5, r * 0.95); ctx.stroke();
  // 兜帽頭
  const hx = dir * r * 0.05, hy = -r * 0.55, hr = r * 0.5;
  ctx.fillStyle = robeD;
  ctx.beginPath(); ctx.ellipse(hx, hy, hr * 1.1, hr * 1.15, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.2); ctx.stroke();
  // 帽尖
  ctx.fillStyle = robe;
  ctx.beginPath(); ctx.moveTo(hx - hr * 0.4, hy - hr * 0.7); ctx.quadraticCurveTo(hx - dir * hr, hy - hr * 2.0, hx + dir * hr * 0.3, hy - hr * 0.6); ctx.closePath(); ctx.fill();
  stk(ctx, 1.8); ctx.stroke();
  // 兜帽陰影臉 + 發光眼
  ctx.fillStyle = '#1c1226';
  ctx.beginPath(); ctx.ellipse(hx + dir * hr * 0.15, hy + hr * 0.25, hr * 0.7, hr * 0.6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#b9ff6a';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(hx + dir * hr * 0.2 + s * hr * 0.22, hy + hr * 0.2, hr * 0.12, 0, TAU); ctx.fill(); }
  // 法杖 + 治療水晶
  const sx = dir * r * 0.85;
  ctx.strokeStyle = '#6e4a2f'; ctx.lineWidth = r * 0.14; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sx, r * 0.9); ctx.lineTo(sx + dir * r * 0.1, -r * 0.9); ctx.stroke();
  const cy = -r * 1.0;
  const glow = e ? 0.5 + Math.sin(e.dist * 0.4) * 0.3 : 0.6;
  ctx.fillStyle = `rgba(150,255,120,${glow * 0.5})`;
  ctx.beginPath(); ctx.arc(sx + dir * r * 0.1, cy, r * 0.4, 0, TAU); ctx.fill();
  ctx.fillStyle = '#9bff6a';
  ctx.beginPath(); ctx.arc(sx + dir * r * 0.1, cy, r * 0.18, 0, TAU); ctx.fill();
  stk(ctx, 1.6); ctx.stroke();
}

function drawSlime(ctx, r, e, dir) {
  const wob = e ? Math.sin(e.dist * 0.3) * 0.12 : 0;
  const base = e ? e.def.color : '#5fc26a';
  const rx = r * (1.05 + wob), ry = r * (0.95 - wob);
  // 半透明膠狀身體
  const g = ctx.createRadialGradient(-rx * 0.3, -ry * 0.4, 2, 0, 0, rx);
  g.addColorStop(0, shade(base, 0.4)); g.addColorStop(1, base);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-rx, ry * 0.5);
  ctx.quadraticCurveTo(-rx, -ry, 0, -ry);
  ctx.quadraticCurveTo(rx, -ry, rx, ry * 0.5);
  ctx.quadraticCurveTo(rx, ry, rx * 0.5, ry);
  ctx.quadraticCurveTo(rx * 0.25, ry * 0.8, 0, ry);
  ctx.quadraticCurveTo(-rx * 0.25, ry * 0.8, -rx * 0.5, ry);
  ctx.quadraticCurveTo(-rx, ry, -rx, ry * 0.5);
  ctx.closePath(); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
  // 高光
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath(); ctx.ellipse(-rx * 0.35, -ry * 0.35, rx * 0.22, ry * 0.16, -0.4, 0, TAU); ctx.fill();
  // 內部氣泡
  ctx.fillStyle = shade(base, -0.15);
  ctx.beginPath(); ctx.arc(rx * 0.3, ry * 0.1, r * 0.12, 0, TAU); ctx.fill();
  // 眼睛
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(dir * r * 0.12 + s * r * 0.28, -r * 0.1, r * 0.18, 0, TAU); ctx.fill();
    stk(ctx, 1.4); ctx.stroke();
    ctx.fillStyle = '#1d2430';
    ctx.beginPath(); ctx.arc(dir * r * 0.18 + s * r * 0.28, -r * 0.1, r * 0.08, 0, TAU); ctx.fill();
  }
}

function drawGargoyle(ctx, e, r, dir) {
  const flap = Math.sin(e.dist / 5) * 0.7;
  const stone = '#8693a3', stoneD = shade(stone, -0.3);
  // 石翼
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.scale(s, 1);
    ctx.rotate(-flap * 0.4);
    ctx.fillStyle = stoneD;
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.2);
    ctx.lineTo(r * 1.8, -r * 1.0);
    ctx.lineTo(r * 1.7, -r * 0.3);
    ctx.lineTo(r * 2.0, -r * 0.1);
    ctx.lineTo(r * 1.5, r * 0.1);
    ctx.lineTo(r * 1.6, r * 0.45);
    ctx.lineTo(r * 1.0, r * 0.2);
    ctx.lineTo(r * 0.5, r * 0.3);
    ctx.closePath(); ctx.fill();
    stk(ctx, 2); ctx.stroke();
    ctx.restore();
  }
  // 石身
  ctx.fillStyle = ballGrad(ctx, 0, 0, r, stone);
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.92, r, 0, 0, TAU); ctx.fill();
  stk(ctx, 2.4); ctx.stroke();
  // 石紋
  ctx.strokeStyle = stoneD; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.4); ctx.lineTo(-r * 0.1, r * 0.2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(r * 0.35, -r * 0.3); ctx.lineTo(r * 0.2, r * 0.4); ctx.stroke();
  // 犄角
  ctx.fillStyle = stone;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(s * r * 0.4, -r * 0.7); ctx.lineTo(s * r * 0.7, -r * 1.3); ctx.lineTo(s * r * 0.2, -r * 0.6); ctx.closePath(); ctx.fill();
    stk(ctx, 1.6); ctx.stroke();
  }
  // 兇眼 + 獠牙
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#e8503e';
    ctx.beginPath(); ctx.ellipse(dir * r * 0.2 + s * r * 0.26, -r * 0.18, r * 0.15, r * 0.1, 0, 0, TAU); ctx.fill();
    stk(ctx, 1.2); ctx.stroke();
  }
  ctx.fillStyle = '#e8e2d0';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(dir * r * 0.1 + s * r * 0.2, r * 0.25); ctx.lineTo(dir * r * 0.1 + s * r * 0.12, r * 0.5); ctx.lineTo(dir * r * 0.1 + s * r * 0.28, r * 0.3); ctx.closePath(); ctx.fill();
  }
}

// ---------- 投射物 ----------

export function drawProjectile(ctx, p) {
  const a = Math.atan2(p.vy, p.vx);
  if (p.kind === 'arrow') {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(a);
    ctx.strokeStyle = '#6e4a2f'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(7, 0); ctx.stroke();
    ctx.fillStyle = '#c9cdd4';
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(4, -2.8); ctx.lineTo(4, 2.8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-12, -3); ctx.lineTo(-7, 0); ctx.lineTo(-12, 3); ctx.closePath(); ctx.fill();
    ctx.restore();
  } else if (p.kind === 'cannonball') {
    ctx.fillStyle = 'rgba(40,46,56,0.25)';
    ctx.beginPath(); ctx.arc(p.x - p.vx * 0.02, p.y - p.vy * 0.02, 5.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2c333d';
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, TAU); ctx.fill();
    stk(ctx, 1.8); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(p.x - 2, p.y - 2, 2, 0, TAU); ctx.fill();
  } else if (p.kind === 'gas') {
    for (let i = 3; i >= 1; i--) {
      ctx.fillStyle = `rgba(140,216,74,${0.12 * i})`;
      ctx.beginPath();
      ctx.arc(p.x - p.vx * 0.014 * i, p.y - p.vy * 0.014 * i, 8 - i, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(120,200,60,0.5)';
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#cdf08a';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, TAU); ctx.fill();
  } else {
    for (let i = 3; i >= 1; i--) {
      ctx.fillStyle = `rgba(168,120,255,${0.14 * i})`;
      ctx.beginPath();
      ctx.arc(p.x - p.vx * 0.012 * i, p.y - p.vy * 0.012 * i, 7 - i, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(186,134,255,0.45)';
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#efe6ff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.6, 0, TAU); ctx.fill();
  }
}

// ---------- 特效 ----------

export function drawEffect(ctx, fx) {
  const t = fx.t / fx.dur;
  if (fx.type === 'splash') {
    if (t < 0.25) {
      ctx.fillStyle = `rgba(255,236,170,${1 - t * 4})`;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius * 0.55 * (0.4 + t * 2.4), 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = `rgba(255,150,60,${(1 - t) * 0.9})`;
    ctx.lineWidth = 4 * (1 - t) + 1;
    ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius * (0.3 + t * 0.8), 0, TAU); ctx.stroke();
    const rnd = mulberry32(fx.seed ?? 1);
    for (let i = 0; i < 6; i++) {
      const a = rnd() * TAU, d = fx.radius * (0.25 + rnd() * 0.5) * t;
      ctx.fillStyle = `rgba(90,82,72,${(1 - t) * 0.55})`;
      ctx.beginPath();
      ctx.arc(fx.x + Math.cos(a) * d, fx.y + Math.sin(a) * d - t * 14, 5 + rnd() * 6 + t * 5, 0, TAU);
      ctx.fill();
    }
  } else if (fx.type === 'frost') {
    ctx.strokeStyle = `rgba(150,215,255,${0.85 * (1 - t)})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius * (0.35 + t * 0.65), 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgba(220,245,255,${0.5 * (1 - t)})`;
    ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius * (0.2 + t * 0.65), 0, TAU); ctx.stroke();
    const rnd = mulberry32(fx.seed ?? 2);
    ctx.fillStyle = `rgba(235,250,255,${1 - t})`;
    for (let i = 0; i < 8; i++) {
      const a = rnd() * TAU, d = fx.radius * t * (0.5 + rnd() * 0.5);
      ctx.beginPath(); ctx.arc(fx.x + Math.cos(a) * d, fx.y + Math.sin(a) * d, 1.8, 0, TAU); ctx.fill();
    }
  } else if (fx.type === 'coin') {
    const rise = t * 26;
    ctx.globalAlpha = 1 - t * t;
    ctx.fillStyle = '#ffd35e';
    ctx.beginPath(); ctx.arc(fx.x - 14, fx.y - 10 - rise, 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(fx.x - 14, fx.y - 10 - rise, 3.2, 0, TAU); ctx.stroke();
    ctx.font = 'bold 13px Trebuchet MS';
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(60,40,0,0.9)'; ctx.lineWidth = 3;
    ctx.strokeText(`+${fx.amount}`, fx.x - 6, fx.y - 6 - rise);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(`+${fx.amount}`, fx.x - 6, fx.y - 6 - rise);
    ctx.globalAlpha = 1;
  } else if (fx.type === 'death') {
    const rnd = mulberry32(fx.seed ?? 3);
    const n = fx.big ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      const sp = (20 + rnd() * 50) * (fx.big ? 1.6 : 1);
      const px = fx.x + Math.cos(a) * sp * t;
      const py = fx.y + Math.sin(a) * sp * t + 36 * t * t;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,' + (1 - t) + ')' : fx.color;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath(); ctx.arc(px, py, (fx.big ? 4 : 2.6) * (1 - t * 0.5), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = (1 - t) * 0.5;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(fx.x, fx.y, (fx.big ? 26 : 13) * t + 4, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (fx.type === 'spark') {
    ctx.strokeStyle = `rgba(255,245,200,${1 - t})`;
    ctx.lineWidth = 1.8;
    for (let i = 0; i < 4; i++) {
      const a = (fx.seed ?? 0) + i * TAU / 4;
      const d1 = 2 + t * 7, d2 = 5 + t * 9;
      ctx.beginPath();
      ctx.moveTo(fx.x + Math.cos(a) * d1, fx.y + Math.sin(a) * d1);
      ctx.lineTo(fx.x + Math.cos(a) * d2, fx.y + Math.sin(a) * d2);
      ctx.stroke();
    }
  } else if (fx.type === 'lightning') {
    // 沿鏈節點畫鋸齒閃電
    const a = 1 - t;
    const pts = fx.pts;
    for (const pass of [[6, `rgba(150,220,255,${a * 0.4})`], [2.5, `rgba(220,245,255,${a})`]]) {
      ctx.strokeStyle = pass[1]; ctx.lineWidth = pass[0]; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < pts.length - 1; i++) {
        const A = pts[i], B = pts[i + 1];
        ctx.moveTo(A.x, A.y);
        const segs = 4;
        for (let k = 1; k <= segs; k++) {
          const f = k / segs;
          const jx = (k < segs) ? (Math.sin(i * 7 + k * 13) * 6) : 0;
          const jy = (k < segs) ? (Math.cos(i * 5 + k * 11) * 6) : 0;
          ctx.lineTo(A.x + (B.x - A.x) * f + jx, A.y + (B.y - A.y) * f + jy);
        }
      }
      ctx.stroke();
    }
    // 節點火花
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    for (const p of pts.slice(1)) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, TAU); ctx.fill(); }
  } else if (fx.type === 'gas') {
    const rnd = mulberry32(fx.seed ?? 7);
    for (let i = 0; i < 7; i++) {
      const a0 = rnd() * TAU, d = fx.radius * (0.2 + rnd() * 0.7) * (0.5 + t * 0.7);
      ctx.fillStyle = `rgba(130,200,70,${(1 - t) * 0.5})`;
      ctx.beginPath(); ctx.arc(fx.x + Math.cos(a0) * d, fx.y + Math.sin(a0) * d - t * 8, 6 + rnd() * 6, 0, TAU); ctx.fill();
    }
  } else if (fx.type === 'heal') {
    ctx.strokeStyle = `rgba(150,255,120,${(1 - t) * 0.7})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.radius * (0.3 + t * 0.7), 0, TAU); ctx.stroke();
    ctx.fillStyle = `rgba(180,255,140,${1 - t})`;
    for (let i = 0; i < 5; i++) {
      const a = i * TAU / 5 - t * 2;
      const d = fx.radius * 0.5 * t;
      // 上升的小十字
      const px = fx.x + Math.cos(a) * d, py = fx.y + Math.sin(a) * d - t * 16;
      ctx.fillRect(px - 1.4, py - 4, 2.8, 8);
      ctx.fillRect(px - 4, py - 1.4, 8, 2.8);
    }
  }
}

export function drawRange(ctx, x, y, range) {
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.arc(x, y, range, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([7, 5]);
  ctx.beginPath(); ctx.arc(x, y, range, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
}
