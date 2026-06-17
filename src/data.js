// 全部遊戲數值的單一事實來源（純資料，無邏輯）。

export const TOWERS = {
  archer: {
    name: '箭塔',
    color: '#b5854b',
    damageType: 'physical',
    hitsFlying: true,
    levels: [
      { cost: 70,  damage: 8,  range: 130, rate: 0.5 },
      { cost: 110, damage: 14, range: 140, rate: 0.5 },
      { cost: 160, damage: 22, range: 155, rate: 0.5 },
    ],
  },
  cannon: {
    name: '砲塔',
    color: '#5d6d7e',
    damageType: 'physical',
    hitsFlying: false,
    levels: [
      { cost: 100, damage: 20, range: 110, rate: 1.5, splash: 45 },
      { cost: 160, damage: 34, range: 120, rate: 1.5, splash: 50 },
      { cost: 230, damage: 52, range: 130, rate: 1.5, splash: 60 },
    ],
  },
  mage: {
    name: '魔法塔',
    color: '#8e6bbf',
    damageType: 'magic',
    hitsFlying: true,
    levels: [
      { cost: 120, damage: 22, range: 120, rate: 1.1 },
      { cost: 180, damage: 36, range: 130, rate: 1.1 },
      { cost: 260, damage: 56, range: 145, rate: 1.1 },
    ],
  },
  frost: {
    name: '冰霜塔',
    color: '#5dade2',
    damageType: 'magic',
    hitsFlying: true,
    levels: [
      { cost: 80,  damage: 0, range: 100, rate: 1.0, slow: 0.4, slowDur: 1.5 },
      { cost: 120, damage: 0, range: 115, rate: 1.0, slow: 0.5, slowDur: 1.5 },
      { cost: 170, damage: 0, range: 130, rate: 1.0, slow: 0.6, slowDur: 1.5 },
    ],
  },
  tesla: {
    name: '雷電塔',
    color: '#4ea0e0',
    damageType: 'magic',     // 閃電無視護甲
    hitsFlying: true,
    levels: [
      // chain：可連鎖的敵人數；chainFalloff：每跳衰減
      { cost: 130, damage: 12, range: 120, rate: 0.8, chain: 3, chainFalloff: 0.7 },
      { cost: 190, damage: 18, range: 130, rate: 0.8, chain: 4, chainFalloff: 0.72 },
      { cost: 270, damage: 28, range: 145, rate: 0.8, chain: 5, chainFalloff: 0.75 },
    ],
  },
  poison: {
    name: '毒塔',
    color: '#7aa83a',
    damageType: 'physical',  // 直擊微傷；DoT 另計、無視護甲
    hitsFlying: true,
    levels: [
      // poison：每秒毒傷；poisonDur：持續秒數（可續命刷新）
      { cost: 90,  damage: 3, range: 115, rate: 1.0, splash: 35, poison: 7,  poisonDur: 3 },
      { cost: 140, damage: 5, range: 125, rate: 1.0, splash: 40, poison: 12, poisonDur: 3 },
      { cost: 200, damage: 8, range: 140, rate: 1.0, splash: 48, poison: 20, poisonDur: 3 },
    ],
  },
};

export const ENEMIES = {
  goblin: { name: '哥布林', hp: 40,   speed: 75, armor: 0,    bounty: 6,   livesCost: 1, flying: false, radius: 13, color: '#7dab4c' },
  orc:    { name: '獸人',   hp: 110,  speed: 50, armor: 0.15, bounty: 12,  livesCost: 1, flying: false, radius: 16, color: '#4e7d3a' },
  knight: { name: '重甲騎士', hp: 260, speed: 35, armor: 0.6,  bounty: 22,  livesCost: 1, flying: false, radius: 16, color: '#95a5a6' },
  bat:    { name: '蝙蝠',   hp: 70,   speed: 65, armor: 0,    bounty: 10,  livesCost: 1, flying: true,  radius: 12, color: '#6c567b' },
  // 狼：高速衝刺，逼玩家用減速塔
  wolf:   { name: '惡狼',   hp: 85,   speed: 130, armor: 0,   bounty: 9,   livesCost: 1, flying: false, radius: 13, color: '#8a7a66' },
  // 薩滿：定期治療範圍內友軍，要優先點殺
  shaman: { name: '薩滿',   hp: 150,  speed: 46, armor: 0.1,  bounty: 20,  livesCost: 1, flying: false, radius: 15, color: '#9b59b6',
            heal: 14, healRange: 90, healRate: 1.2 },
  // 史萊姆：死亡分裂成兩隻小史萊姆
  slime:  { name: '史萊姆', hp: 120,  speed: 42, armor: 0,    bounty: 10,  livesCost: 1, flying: false, radius: 17, color: '#5fc26a', splitInto: 'slimelet', splitCount: 2 },
  slimelet:{ name: '小史萊姆', hp: 32, speed: 64, armor: 0,   bounty: 3,   livesCost: 1, flying: false, radius: 10, color: '#7ad884' },
  // 石像鬼：飛行＋護甲，砲塔打不到又難打穿
  gargoyle:{ name: '石像鬼', hp: 180, speed: 52, armor: 0.4,  bounty: 24,  livesCost: 1, flying: true,  radius: 15, color: '#8693a3' },
  // 巨魔王：低血狂暴（加速）＋定期召喚哥布林小弟
  boss:   { name: '巨魔王', hp: 3200, speed: 22, armor: 0.3,  bounty: 300, livesCost: 5, flying: false, radius: 28, color: '#a93226',
            summonEvery: 7, summonType: 'goblin', summonCount: 2, enrageAt: 0.4, enrageSpeed: 1.7 },
};

export const RULES = {
  startLives: 20,
  sellRatio: 0.7,
  waveCountdown: 12,     // 波間倒數秒數
  callBonusPerSec: 3,    // 提前召喚每秒獎勵
  star3Lives: 18,
  star2Lives: 10,
};

// 難度：影響怪血量、起始金錢/生命、賞金。普通＝原始數值。
export const DIFFICULTY = {
  easy:   { name: '簡單', hpMul: 0.78, goldMul: 1.25, livesAdd: 10, bountyMul: 1.2 },
  normal: { name: '普通', hpMul: 1.0,  goldMul: 1.0,  livesAdd: 0,  bountyMul: 1.0 },
  hard:   { name: '困難', hpMul: 1.45, goldMul: 0.9,  livesAdd: -6, bountyMul: 0.9 },
};

// 星星商店永久升級：每級的加成（index 0 = 未購買）。
export const SHOP = {
  gold:  { name: '起始金錢', icon: '💰', costs: [3, 6, 10], add: [0, 0.10, 0.20, 0.32] },   // 起始金錢 +%
  dmg:   { name: '全塔傷害', icon: '⚔️', costs: [4, 8, 14], add: [0, 0.06, 0.13, 0.22] },   // 全塔傷害 +%
  lives: { name: '起始生命', icon: '❤️', costs: [3, 6, 10], add: [0, 3, 6, 10] },           // 起始生命 +N
};
