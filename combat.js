'use strict';
const { ABILITIES, ITEMS } = require('./content');

function rng(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── effective stats including equipment ───
function effStats(p) {
  const s = { atk: p.atk, def: p.def, spd: p.spd, maxHp: p.maxHp, maxMp: p.maxMp };
  for (const slot of ['weapon', 'armor', 'trinket']) {
    const it = p.equip[slot] && ITEMS[p.equip[slot]];
    if (it && it.stats) for (const k in it.stats) s[k] += it.stats[k];
  }
  // status modifiers
  if (hasStatus(p, 'weaken')) s.atk = Math.floor(s.atk * 0.7);
  return s;
}

function hasStatus(entity, type) { return (entity.status || []).some(s => s.type === type); }
function getStatus(entity, type) { return (entity.status || []).find(s => s.type === type); }
function addStatus(entity, status) {
  entity.status = entity.status || [];
  // stacking poison/burn -> add new instance; others refresh
  if (status.stack) { entity.status.push(status); }
  else {
    const ex = entity.status.find(s => s.type === status.type);
    if (ex) { ex.rounds = Math.max(ex.rounds, status.rounds); ex.power = Math.max(ex.power || 0, status.power || 0); }
    else entity.status.push(status);
  }
}
function clearDebuffs(entity) {
  entity.status = (entity.status || []).filter(s => ['regen', 'shield', 'evasion', 'hawkeye', 'markdmg'].includes(s.type) || s.good);
}

function equipSpecial(p, special) {
  for (const slot of ['weapon', 'armor', 'trinket']) {
    const it = p.equip[slot] && ITEMS[p.equip[slot]];
    if (it && it.special === special) return true;
  }
  return false;
}

// ─── damage application with shields/vulnerable/dodge ───
function dealToEnemy(enemy, raw, log, srcName, opts = {}) {
  let dmg = Math.max(1, Math.floor(raw));
  if (hasStatus(enemy, 'vulnerable')) dmg = Math.floor(dmg * 1.4);
  const mark = getStatus(enemy, 'markdmg');
  if (mark) dmg = Math.floor(dmg * (1 + mark.power));
  // enemy shield
  const sh = getStatus(enemy, 'shield');
  if (sh && sh.power > 0) {
    const absorbed = Math.min(sh.power, dmg);
    sh.power -= absorbed; dmg -= absorbed;
    if (sh.power <= 0) enemy.status = enemy.status.filter(s => s !== sh);
  }
  enemy.hp = Math.max(0, enemy.hp - dmg);
  return dmg;
}

function dealToPlayer(p, raw, opts = {}) {
  let dmg = Math.max(0, Math.floor(raw));
  // dodge
  if (!opts.trueDmg) {
    if (hasStatus(p, 'evasion')) {
      const ev = getStatus(p, 'evasion'); ev.power -= 1;
      if (ev.power <= 0) p.status = p.status.filter(s => s !== ev);
      return { dmg: 0, dodged: true };
    }
    if (equipSpecial(p, 'dodge15') && Math.random() < 0.15) return { dmg: 0, dodged: true };
  }
  if (hasStatus(p, 'vulnerable')) dmg = Math.floor(dmg * 1.4);
  const sh = getStatus(p, 'shield');
  if (sh && sh.power > 0 && !opts.trueDmg) {
    const absorbed = Math.min(sh.power, dmg);
    sh.power -= absorbed; dmg -= absorbed;
    if (sh.power <= 0) p.status = p.status.filter(s => s !== sh);
  }
  p.hp = Math.max(0, p.hp - dmg);
  return { dmg, dodged: false };
}

// ─── ABILITY EXECUTION ───
// returns array of log lines {msg,type}
function useAbility(abilityId, player, enemy, party, targetId) {
  const log = [];
  const A = ABILITIES[abilityId];
  const es = effStats(player);
  const push = (msg, type = 'player') => log.push({ msg, type });

  const critChance = (equipSpecial(player, 'crit10') ? 0.1 : 0) + (hasStatus(player, 'hawkeye') ? 1 : 0);
  const rollCrit = (base = 0) => Math.random() < (base + critChance);
  const consumeHawk = () => { const h = getStatus(player, 'hawkeye'); if (h) { h.power -= 1; if (h.power <= 0) player.status = player.status.filter(s => s !== h); } };

  function basicHitFx() {
    if (equipSpecial(player, 'burn_on_hit')) { addStatus(enemy, { type:'burn', rounds:3, power:8, stack:true }); }
    if (equipSpecial(player, 'poison_on_hit')) { addStatus(enemy, { type:'poison', rounds:3, power:8, stack:true }); }
  }

  switch (abilityId) {
    // BASIC
    case 'attack': {
      let crit = rollCrit(); consumeHawk();
      let d = es.atk * (crit ? 2 : 1) - enemy.def + rng(-2, 4);
      const dealt = dealToEnemy(enemy, d, log, player.name);
      basicHitFx();
      push(`${player.name} attacks for ${dealt}${crit ? ' ⚡CRIT' : ''} damage!`); break;
    }
    // WARRIOR
    case 'cleave': { let d = es.atk * 1.4 - enemy.def; const x = dealToEnemy(enemy, d, log, player.name); basicHitFx(); push(`${player.name} cleaves for ${x} damage!`); break; }
    case 'shieldwall': { addStatus(player, { type:'shield', power:40, rounds:99, good:true }); push(`${player.name} raises a Shield Wall (40 absorb)!`, 'heal'); break; }
    case 'taunt': { addStatus(player, { type:'shield', power:30, rounds:99, good:true }); enemy.tauntedBy = player.id; push(`${player.name} taunts the enemy and braces (30 shield)!`, 'heal'); break; }
    case 'bash': { let d = es.atk - enemy.def; const x = dealToEnemy(enemy, d, log, player.name); push(`${player.name} bashes for ${x} damage!`); if (Math.random()<0.5){ addStatus(enemy,{type:'stun',rounds:1}); push('The enemy is STUNNED!','heal'); } break; }
    case 'earthshatter': { let d = es.atk*2.2 - enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'vulnerable',rounds:3}); push(`${player.name} ERUPTS for ${x} damage! Enemy is Vulnerable!`); break; }
    case 'bloodlust': { let d=es.atk*1.5-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); const heal=Math.floor(x*0.6); player.hp=Math.min(es.maxHp,player.hp+heal); push(`${player.name} strikes for ${x} and drains ${heal} HP!`); break; }
    case 'unbreakable': { addStatus(player,{type:'shield',power:80,rounds:99,good:true}); addStatus(player,{type:'regen',rounds:3,power:15,good:true}); push(`${player.name} becomes Unbreakable! 80 shield + Regen!`,'heal'); break; }
    // MAGE
    case 'firebolt': { let d=es.atk*1.6-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'burn',rounds:3,power:8,stack:true}); push(`${player.name} hurls a Firebolt for ${x}! Enemy is Burning!`); break; }
    case 'frostshard': { let d=es.atk*1.2-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'stun',rounds:1}); push(`${player.name} freezes the enemy for ${x}! It's Frozen!`); break; }
    case 'arcaneorb': { let d=es.atk*1.8; const x=dealToEnemy(enemy,d,log,player.name,{ignoreDef:true}); push(`${player.name}'s Arcane Orb deals ${x} unblockable damage!`); break; }
    case 'manashield': { const sp=Math.floor(player.mp*0.5); addStatus(player,{type:'shield',power:sp,rounds:99,good:true}); push(`${player.name} converts mana into a ${sp} shield!`,'heal'); break; }
    case 'meteor': { let d=es.atk*3-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'burn',rounds:3,power:14,stack:true}); push(`☄️ ${player.name} calls down a METEOR for ${x}! Massive Burn!`); break; }
    case 'timewarp': { addStatus(enemy,{type:'stun',rounds:2}); player.extraTurn=true; push(`${player.name} warps time! Enemy stunned 2 rounds, and acts again!`,'heal'); break; }
    case 'soulburn': { const missing=1-(enemy.hp/enemy.maxHp); const mult=1+missing*3; let d=es.atk*mult; const x=dealToEnemy(enemy,d,log,player.name,{ignoreDef:true}); push(`${player.name}'s Soul Burn deals ${x} (×${mult.toFixed(1)})!`); break; }
    // ROGUE
    case 'backstab': { let crit=rollCrit(0.4); let d=es.atk*1.5*(crit?2:1)-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); basicHitFx(); push(`${player.name} backstabs for ${x}${crit?' ⚡CRIT':''}!`); break; }
    case 'poisonblade': { let d=es.atk-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'poison',rounds:4,power:12,stack:true}); push(`${player.name} poisons the enemy for ${x} + venom!`); break; }
    case 'smokebomb': { addStatus(player,{type:'evasion',power:2,rounds:99,good:true}); push(`${player.name} vanishes in smoke (dodge next 2 hits)!`,'heal'); break; }
    case 'shadowstep': { let d=es.atk*1.2-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); clearDebuffs(player); push(`${player.name} shadow-steps for ${x} and sheds all debuffs!`); break; }
    case 'thousandcuts': { let total=0; for(let i=0;i<5;i++){ let crit=rollCrit(0.15); let d=es.atk*0.5*(crit?2:1)-enemy.def; total+=dealToEnemy(enemy,d,log,player.name);} push(`${player.name} unleashes Thousand Cuts for ${total} total!`); break; }
    case 'venomnova': { let d=es.atk-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'poison',rounds:5,power:25,stack:true}); push(`☠️ ${player.name}'s Venom Nova hits ${x} + lethal poison!`); break; }
    case 'deathmark': { addStatus(enemy,{type:'markdmg',rounds:3,power:0.6}); let d=es.atk-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); push(`🎯 ${player.name} marks the enemy (+60% dmg taken) and hits ${x}!`); break; }
    // RANGER
    case 'pierceshot': { let d=es.atk*1.5-enemy.def*0.5; const x=dealToEnemy(enemy,d,log,player.name); basicHitFx(); push(`${player.name}'s Pierce Shot deals ${x} (armor-piercing)!`); break; }
    case 'healingwind': { const t=party.find(p=>p.id===targetId)||player; const heal=35; t.hp=Math.min(effStats(t).maxHp,t.hp+heal); addStatus(t,{type:'regen',rounds:3,power:10,good:true}); push(`${player.name} heals ${t.name} for ${heal} + Regen!`,'heal'); break; }
    case 'entangle': { let d=es.atk-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'weaken',rounds:3}); push(`${player.name} entangles the enemy for ${x}! It's Weakened!`); break; }
    case 'hawkeye': { addStatus(player,{type:'hawkeye',power:2,rounds:99,good:true}); push(`${player.name} takes aim — next 2 attacks will CRIT!`,'heal'); break; }
    case 'arrowstorm': { let d=es.atk*2.5-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'bleed',rounds:4,power:Math.floor(es.atk*0.3),stack:true}); push(`🌧️ ${player.name}'s Arrow Storm rains ${x} + Bleed!`); break; }
    case 'lifebloom': { party.forEach(a=>{ if(a.hp>0){ a.hp=Math.min(effStats(a).maxHp,a.hp+40); addStatus(a,{type:'regen',rounds:3,power:15,good:true}); }}); push(`🌸 ${player.name}'s Lifebloom heals the whole party 40 + Regen!`,'heal'); break; }
    case 'naturewrath': { let d=es.atk*1.4-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'poison',rounds:4,power:14,stack:true}); addStatus(enemy,{type:'weaken',rounds:3}); addStatus(enemy,{type:'vulnerable',rounds:3}); push(`🌳 ${player.name} unleashes Nature's Wrath for ${x} + Poison + Weaken + Vulnerable!`); break; }
    // ===== TIER 3 =====
    // WARRIOR
    case 'warcry': { party.forEach(a=>{ if(a.hp>0){ addStatus(a,{type:'regen',rounds:3,power:12,good:true}); addStatus(a,{type:'shield',power:30,rounds:99,good:true}); }}); push(`📯 ${player.name}'s War Cry rallies the party — Regen + 30 shield each!`,'heal'); break; }
    case 'executioner': { const low=enemy.hp/enemy.maxHp<0.4; let d=es.atk*3*(low?2:1)-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); basicHitFx(); push(`🪦 ${player.name} EXECUTES for ${x}${low?' (the enemy was weak!)':''}!`); break; }
    // MAGE
    case 'chainlightning': { let d=es.atk*2; const x=dealToEnemy(enemy,d,log,player.name,{ignoreDef:true}); addStatus(enemy,{type:'stun',rounds:1}); push(`⚡ ${player.name}'s Chain Lightning strikes for ${x} and Stuns!`); break; }
    case 'blizzard': { let d=es.atk*1.8-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'stun',rounds:1}); addStatus(enemy,{type:'vulnerable',rounds:3}); push(`🌨️ ${player.name}'s Blizzard hits ${x}, Freezes and exposes the enemy!`); break; }
    // ROGUE
    case 'assassinate': { let crit=rollCrit(0.7); let d=es.atk*2.5*(crit?2:1); const x=dealToEnemy(enemy,d,log,player.name,{ignoreDef:true}); push(`🔪 ${player.name} attempts to Assassinate — ${x} damage${crit?' ⚡CRIT!':'!'}`); break; }
    case 'noxiouscloud': { let d=es.atk-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'poison',rounds:5,power:30,stack:true}); addStatus(enemy,{type:'weaken',rounds:3}); addStatus(enemy,{type:'vulnerable',rounds:3}); push(`🟢 ${player.name} releases a Noxious Cloud — ${x} + heavy Poison, Weaken & Vulnerable!`); break; }
    // RANGER
    case 'stormvolley': { let d=es.atk*3-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); if(Math.random()<0.5){ addStatus(enemy,{type:'stun',rounds:1}); } push(`⛈️ ${player.name}'s Storm Volley batters for ${x}!`); break; }
    case 'sanctuary': { party.forEach(a=>{ if(a.hp>0){ a.hp=Math.min(effStats(a).maxHp,a.hp+60); addStatus(a,{type:'shield',power:40,rounds:99,good:true}); }}); push(`🕊️ ${player.name} calls a Sanctuary — heal 60 + 40 shield to all!`,'heal'); break; }
    // ===== TIER 4 =====
    case 'ragnarok': { let d=es.atk*4-enemy.def; const x=dealToEnemy(enemy,d,log,player.name); addStatus(enemy,{type:'vulnerable',rounds:3}); const heal=Math.floor(x*0.4); player.hp=Math.min(es.maxHp,player.hp+heal); push(`☄️ ${player.name} brings RAGNAROK for ${x}! Heals ${heal}, enemy Vulnerable!`); break; }
    case 'apocalypse': { let d=es.atk*4.5; const x=dealToEnemy(enemy,d,log,player.name,{ignoreDef:true}); addStatus(enemy,{type:'burn',rounds:4,power:30,stack:true}); push(`🌌 ${player.name} unleashes APOCALYPSE — ${x} unblockable + searing Burn!`); break; }
    case 'oblivion': { let total=0; for(let i=0;i<7;i++){ let crit=rollCrit(0.2); let d=es.atk*0.6*(crit?2:1)-enemy.def; total+=dealToEnemy(enemy,d,log,player.name);} addStatus(enemy,{type:'markdmg',rounds:3,power:0.6}); push(`♠️ ${player.name} descends into OBLIVION — ${total} total + Death Mark!`); break; }
    case 'worldtree': { party.forEach(a=>{ if(a.hp>0){ a.hp=effStats(a).maxHp; addStatus(a,{type:'regen',rounds:3,power:20,good:true}); addStatus(a,{type:'shield',power:60,rounds:99,good:true}); }}); push(`🌲 ${player.name} channels the World-Tree — party fully healed + Regen + 60 shield!`,'heal'); break; }
    default: push(`${player.name} hesitates...`, 'system');
  }
  return log;
}

// ─── ITEM USE ───
function useItem(itemId, player, enemy, party) {
  const log = [];
  const es = effStats(player);
  switch (itemId) {
    case 'hpotion': { const g=Math.min(60,es.maxHp-player.hp); player.hp+=g; log.push({msg:`${player.name} drinks a Health Potion (+${g} HP)!`,type:'heal'}); break; }
    case 'mpotion': { const g=Math.min(50,es.maxMp-player.mp); player.mp+=g; log.push({msg:`${player.name} drinks a Mana Potion (+${g} MP)!`,type:'heal'}); break; }
    case 'greaterhp': { const g=Math.min(130,es.maxHp-player.hp); player.hp+=g; log.push({msg:`${player.name} uses Greater Heal (+${g} HP)!`,type:'heal'}); break; }
    case 'elixir': { player.hp=es.maxHp; player.mp=es.maxMp; log.push({msg:`${player.name} drinks an Elixir — fully restored!`,type:'heal'}); break; }
    case 'antidote': { clearDebuffs(player); player.hp=Math.min(es.maxHp,player.hp+20); log.push({msg:`${player.name} uses Antidote — debuffs cleared (+20 HP)!`,type:'heal'}); break; }
    case 'bomb': { const x=dealToEnemy(enemy,70,log,player.name,{ignoreDef:true}); log.push({msg:`${player.name} throws a Fire Bomb for ${x}!`,type:'player'}); break; }
    case 'megabomb': { const x=dealToEnemy(enemy,150,log,player.name,{ignoreDef:true}); log.push({msg:`${player.name} hurls an Inferno Bomb for ${x}!`,type:'player'}); break; }
    default: log.push({msg:`${player.name} fumbles with an item.`,type:'system'});
  }
  return log;
}

// ─── TICK STATUS EFFECTS (start of an entity's turn) ───
function tickStatus(entity, isEnemy, log) {
  if (!entity.status) return false;
  let skip = false;
  const es = isEnemy ? null : effStats(entity);
  const maxHp = isEnemy ? entity.maxHp : es.maxHp;
  for (const s of [...entity.status]) {
    if (s.type === 'poison' || s.type === 'burn' || s.type === 'bleed') {
      const dmg = s.power;
      entity.hp = Math.max(0, entity.hp - dmg);
      const label = s.type === 'poison' ? '🐍 Poison' : s.type === 'burn' ? '🔥 Burn' : '🩸 Bleed';
      log.push({ msg: `${entity.name} takes ${dmg} ${label} damage!`, type: isEnemy ? 'player' : 'enemy' });
    }
    if (s.type === 'regen') {
      const heal = Math.min(s.power, maxHp - entity.hp);
      if (heal > 0) { entity.hp += heal; log.push({ msg: `${entity.name} regenerates ${heal} HP.`, type: 'heal' }); }
    }
    if (s.type === 'stun' || s.type === 'freeze') skip = true;
    if (s.rounds !== 99) { s.rounds -= 1; }
  }
  entity.status = entity.status.filter(s => s.rounds > 0 || s.rounds === 99);
  return skip;
}

module.exports = { rng, clamp, effStats, hasStatus, getStatus, addStatus, clearDebuffs, equipSpecial, dealToEnemy, dealToPlayer, useAbility, useItem, tickStatus };
