'use strict';
const { derive, SKILLS, CLASSES, SECRET_CLASSES, ITEMS } = require('./content');

function rng(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }

// ─── resolve a player's full live class node (base/super/ultra) ───
function classNode(p){
  const base = CLASSES[p.cls] || SECRET_CLASSES[p.cls];
  if(!base) return null;
  if(p.tier===0 || !base.supers) return base;
  const sup = base.supers[p.superKey];
  if(p.tier===1 || !sup) return sup||base;
  const ult = sup.ultras && sup.ultras[p.ultraKey];
  return ult || sup || base;
}

// aggregate the 6 core stats from base + chosen super + chosen ultra + equipment + buffs
function coreStats(p){
  const base = CLASSES[p.cls] || SECRET_CLASSES[p.cls];
  const acc = {STR:0,DEX:0,INT:0,VIT:0,WIS:0,LUK:0};
  const add = s=>{ if(s) for(const k in s) acc[k]=(acc[k]||0)+s[k]; };
  if(base){ add(base.stats);
    if(p.tier>=1 && base.supers && base.supers[p.superKey]){ add(base.supers[p.superKey].stats);
      if(p.tier>=2 && base.supers[p.superKey].ultras && base.supers[p.superKey].ultras[p.ultraKey]) add(base.supers[p.superKey].ultras[p.ultraKey].stats);
    }
  }
  // per-level minor growth
  const lvl=p.level||1;
  acc.STR+=Math.floor(lvl*0.7); acc.INT+=Math.floor(lvl*0.7); acc.VIT+=Math.floor(lvl*0.9);
  acc.DEX+=Math.floor(lvl*0.45); acc.WIS+=Math.floor(lvl*0.45); acc.LUK+=Math.floor(lvl*0.25);
  // equipment
  for(const slot of ['weapon','armor','trinket']){
    const it = p.equip&&p.equip[slot]&&ITEMS[p.equip[slot]];
    if(it&&it.stats) add(it.stats);
  }
  return acc;
}

// full derived combat stats incl. buffs
function stats(p){
  const d = derive(coreStats(p));
  // buff modifiers
  if(hasBuff(p,'atkup')){ d.patk*=1.35; d.matk*=1.35; }
  if(hasBuff(p,'critup')){ d.crit+=0.3; }
  if(hasBuff(p,'accup')){ d.crit+=0.25; d.acc+=0.25; }
  if(hasBuff(p,'spdup')){ d.spd*=1.4; }
  if(hasBuff(p,'fortress')){ d.def*=1.5; }
  if(equipSpecial(p,'crit_up')) d.crit+=0.1;
  if(hasStatus(p,'weaken')){ d.patk*=0.7; d.matk*=0.7; }
  d.patk=Math.round(d.patk); d.matk=Math.round(d.matk); d.def=Math.round(d.def); d.spd=Math.round(d.spd);
  return d;
}

function hasStatus(e,t){ return (e.status||[]).some(s=>s.type===t); }
function getStatus(e,t){ return (e.status||[]).find(s=>s.type===t); }
function hasBuff(p,b){ return (p.buffs||[]).some(x=>x.buff===b); }
function addStatus(e,s){ e.status=e.status||[];
  if(s.stack) e.status.push(s);
  else { const ex=e.status.find(x=>x.type===s.type); if(ex){ ex.rounds=Math.max(ex.rounds,s.rounds); ex.power=Math.max(ex.power||0,s.power||0);} else e.status.push(s); }
}
function addBuff(p,buff,rounds,extra){ p.buffs=p.buffs||[]; const ex=p.buffs.find(b=>b.buff===buff); if(ex){ex.rounds=Math.max(ex.rounds,rounds);} else p.buffs.push(Object.assign({buff,rounds},extra||{})); }
function clearDebuffs(e){ e.status=(e.status||[]).filter(s=>['regen'].includes(s.type)); }
function equipSpecial(p,sp){ for(const slot of ['weapon','armor','trinket']){ const it=p.equip&&p.equip[slot]&&ITEMS[p.equip[slot]]; if(it&&it.special===sp) return true;} return false; }

// damage to enemy with crit/pierce/vulnerable/shield
function hitEnemy(enemy,raw,opts={}){
  let dmg=Math.max(1,Math.floor(raw));
  if(hasStatus(enemy,'vulnerable')) dmg=Math.floor(dmg*1.4);
  const sh=getStatus(enemy,'shield');
  if(sh&&sh.power>0){ const ab=Math.min(sh.power,dmg); sh.power-=ab; dmg-=ab; if(sh.power<=0) enemy.status=enemy.status.filter(s=>s!==sh); }
  enemy.hp=Math.max(0,enemy.hp-dmg);
  return dmg;
}
function hitPlayer(p,raw,opts={}){
  let dmg=Math.max(0,Math.floor(raw));
  if(!opts.trueDmg){
    if(equipSpecial(p,'dodge')&&Math.random()<0.18) return {dmg:0,dodged:true};
  }
  if(hasStatus(p,'vulnerable')) dmg=Math.floor(dmg*1.35);
  const sh=getStatus(p,'shield');
  if(sh&&sh.power>0&&!opts.trueDmg){ const ab=Math.min(sh.power,dmg); sh.power-=ab; dmg-=ab; if(sh.power<=0) p.status=p.status.filter(s=>s!==sh); }
  p.hp=Math.max(0,p.hp-dmg);
  return {dmg,dodged:false};
}

// ─── USE A SKILL ───
// player p uses skill on enemy / ally target. party=array of player objs. returns log lines.
function useSkill(skillId, p, enemy, party, targetId){
  const log=[]; const push=(m,t='player')=>log.push({msg:m,type:t});
  const sk = SKILLS[skillId]; if(!sk){ push(`${p.name} hesitates...`, 'system'); return log; }
  const st = stats(p);
  const atkStat = sk.scale==='int' ? st.matk : sk.scale==='mix' ? (st.patk+st.matk)/2 : st.patk;
  const critChance = clamp(st.crit + (sk.critBonus||0), 0, 0.95);

  // healing / buff skills
  if(sk.type==='heal'){
    let tgt = party.find(x=>x.id===targetId) || lowestAlly(party) || p;
    const amt = rng(sk.heal[0],sk.heal[1]) + Math.floor(st.matk*0.5);
    const mx = stats(tgt).maxHp;
    const healed=Math.min(amt,mx-tgt.hp); tgt.hp+=healed;
    push(`${p.name} heals ${tgt.name} for ${healed} HP!`,'heal');
    return log;
  }
  if(sk.type==='buff'){
    applyBuff(p,sk,party,push);
    return log;
  }

  // damage skills (attack/magic) and debuffs that also deal dmg
  const hits = sk.hits||1;
  let totalDealt=0, anyCrit=false;
  for(let i=0;i<hits;i++){
    if(enemy.hp<=0) break;
    let base = rng(sk.dmg[0],sk.dmg[1]);
    // scale: add a fraction of attacker stat so growth matters
    base += Math.floor(atkStat*0.6);
    let crit = Math.random()<critChance; if(crit) anyCrit=true;
    let dmg = base*(crit?st.critMult:1);
    // defense unless pierce
    const pierce = sk.pierce||0;
    dmg -= enemy.def*(1-pierce);
    const dealt = hitEnemy(enemy, dmg, {});
    totalDealt+=dealt;
    // weapon on-hit
    if(sk.type==='attack'){
      if(equipSpecial(p,'burn_on_hit')) addStatus(enemy,{type:'burn',rounds:3,power:12,stack:true});
      if(equipSpecial(p,'poison_on_hit')) addStatus(enemy,{type:'poison',rounds:3,power:14,stack:true});
      if(equipSpecial(p,'freeze_on_hit')&&Math.random()<0.3) addStatus(enemy,{type:'freeze',rounds:1});
    }
  }
  // statuses from skill
  (sk.status||[]).forEach(s=>addStatus(enemy,Object.assign({},s,{stack:s.type==='poison'||s.type==='burn'})));
  // lifesteal
  if(sk.lifesteal){ const heal=Math.floor(totalDealt*sk.lifesteal); p.hp=Math.min(st.maxHp,p.hp+heal); if(heal>0) push(`${p.name} drains ${heal} HP!`,'heal'); }
  const critTxt = anyCrit?' ⚡CRIT':'';
  const hitTxt = hits>1?` (${hits} hits)`:'';
  push(`${p.name} uses ${sk.name}${hitTxt} for ${totalDealt}${critTxt} damage!`);
  // debuff flavor
  if((sk.status||[]).length){ const names=sk.status.map(s=>s.type).join(', '); push(`${enemy.name} suffers ${names}!`,'player'); }
  return log;
}

function applyBuff(p,sk,party,push){
  switch(sk.buff){
    case 'shield': addStatus(p,{type:'shield',power:sk.shield||60,rounds:99}); push(`${p.name} raises a shield (${sk.shield||60})!`,'heal'); break;
    case 'fortress': addStatus(p,{type:'shield',power:sk.shield||120,rounds:99}); addBuff(p,'fortress',3); push(`${p.name} becomes a fortress (+50% DEF, ${sk.shield||120} shield)!`,'heal'); break;
    case 'atkup': party.forEach(a=>{ if(a.hp>0) addBuff(a,'atkup',3); }); push(`${p.name} empowers the party (+35% damage)!`,'heal'); break;
    case 'critup': addBuff(p,'critup',3); push(`${p.name} sharpens aim (+30% crit)!`,'heal'); break;
    case 'accup': addBuff(p,'accup',3); push(`${p.name} focuses (+25% accuracy & crit)!`,'heal'); break;
    case 'spdup': party.forEach(a=>{ if(a.hp>0) addBuff(a,'spdup',3); }); push(`${p.name} hastens the party (+40% speed)!`,'heal'); break;
    case 'meditate': { const st=stats(p); p.mp=Math.min(st.maxMp,p.mp+Math.floor(st.maxMp*0.3)); addStatus(p,{type:'shield',power:40,rounds:99}); push(`${p.name} meditates — restores MP & gains shield.`,'heal'); break; }
    case 'turret': addBuff(p,'turret',3); push(`${p.name} deploys a turret (bonus damage 3 rounds)!`,'heal'); break;
    default: addBuff(p,sk.buff,3); push(`${p.name} uses ${sk.name}.`,'heal');
  }
}

function lowestAlly(party){ const a=party.filter(x=>x.hp>0).sort((x,y)=>x.hp/stats(x).maxHp - y.hp/stats(y).maxHp); return a[0]; }

// ─── USE ITEM ───
function useItem(itemId,p,enemy,party){
  const log=[]; const it=ITEMS[itemId]; const st=stats(p);
  if(!it){ log.push({msg:`${p.name} fumbles.`,type:'system'}); return log; }
  if(it.full){ p.hp=st.maxHp; p.mp=st.maxMp; log.push({msg:`${p.name} drinks ${it.name} — fully restored!`,type:'heal'}); }
  else if(it.heal&&it.cleanse){ clearDebuffs(p); const g=Math.min(it.heal,st.maxHp-p.hp); p.hp+=g; log.push({msg:`${p.name} uses ${it.name} — cleansed +${g} HP!`,type:'heal'}); }
  else if(it.heal){ const g=Math.min(it.heal,st.maxHp-p.hp); p.hp+=g; log.push({msg:`${p.name} uses ${it.name} (+${g} HP)!`,type:'heal'}); }
  else if(it.mana){ const g=Math.min(it.mana,st.maxMp-p.mp); p.mp+=g; log.push({msg:`${p.name} uses ${it.name} (+${g} MP)!`,type:'heal'}); }
  else if(it.fixed){ const d=hitEnemy(enemy,it.fixed,{}); log.push({msg:`${p.name} throws ${it.name} for ${d}!`,type:'player'}); }
  else if(it.revive){ const dead=party.find(x=>x.hp<=0); if(dead){ dead.hp=Math.floor(stats(dead).maxHp*0.5); log.push({msg:`${p.name} revives ${dead.name}!`,type:'heal'});} else log.push({msg:`${p.name} uses ${it.name}, but no one needs reviving.`,type:'system'}); }
  else log.push({msg:`${p.name} uses ${it.name}.`,type:'system'});
  return log;
}

// ─── TICK STATUS (start of entity turn) ───
function tickStatus(e,isEnemy,log){
  if(!e.status) e.status=[];
  let skip=false;
  const mx = isEnemy ? e.maxHp : stats(e).maxHp;
  for(const s of [...e.status]){
    if(s.type==='poison'||s.type==='burn'||s.type==='bleed'){
      e.hp=Math.max(0,e.hp-s.power);
      const lbl=s.type==='poison'?'🟢 Poison':s.type==='burn'?'🔥 Burn':'🩸 Bleed';
      log.push({msg:`${e.name} takes ${s.power} ${lbl} damage!`,type:isEnemy?'player':'enemy'});
    }
    if(s.type==='regen'){ const h=Math.min(s.power,mx-e.hp); if(h>0){e.hp+=h; log.push({msg:`${e.name} regenerates ${h} HP.`,type:'heal'});} }
    if(s.type==='stun'||s.type==='freeze') skip=true;
    if(s.rounds!==99) s.rounds-=1;
  }
  e.status=e.status.filter(s=>s.rounds>0||s.rounds===99);
  // equipment regen for players
  if(!isEnemy && equipSpecial(e,'regen')){ const h=Math.min(12,mx-e.hp); if(h>0) e.hp+=h; }
  // tick buffs
  if(e.buffs){ e.buffs.forEach(b=>{ if(b.rounds!==99) b.rounds-=1; }); e.buffs=e.buffs.filter(b=>b.rounds>0||b.rounds===99); }
  return skip;
}

module.exports = { rng, clamp, classNode, coreStats, stats, hasStatus, getStatus, hasBuff,
  addStatus, addBuff, clearDebuffs, equipSpecial, hitEnemy, hitPlayer, useSkill, useItem, tickStatus, lowestAlly };
