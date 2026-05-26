'use strict';
const http=require('http'); const path=require('path');
const { v4:uuidv4 }=require('uuid');
const express=require('express');
const { WebSocketServer, WebSocket }=require('ws');
const { derive, SKILLS, CLASSES, SECRET_CLASSES, ITEMS, LOOT_RARITY, STAGES }=require('./content');
const C=require('./combat');

// ── crash guards: never let one error kill the process ──
process.on('uncaughtException',e=>{ console.error('[uncaught]',e&&e.stack||e); });
process.on('unhandledRejection',e=>{ console.error('[unhandled]',e&&e.stack||e); });

const app=express(); const server=http.createServer(app);
const wss=new WebSocketServer({ server });
const PORT=process.env.PORT||3000;
const MAX=8, TTL=20*60*1000;

const sessions=new Map(); // sid -> {ws,player,lastSeen}
const world={ phase:'lobby', stageIdx:0, roundIdx:0, enemy:null, turnOrder:[], turnPtr:0,
  log:[], chat:[], lootOffers:{}, lootPicked:{}, equipReady:{}, classChoice:{}, roundActive:false };

function broadcast(){ let snap; try{ snap=JSON.stringify(snapshot()); }catch(e){ console.error('snapshot',e); return; }
  for(const s of sessions.values()) if(s.ws.readyState===WebSocket.OPEN){ try{s.ws.send(snap);}catch(e){} } }
function sendTo(ws,d){ try{ if(ws&&ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(d)); }catch(e){} }
function joined(){ return [...sessions.entries()].filter(([,s])=>s.player); }
function alive(){ return joined().filter(([,s])=>s.player.hp>0); }
function plog(m,t='system'){ world.log.push({msg:m,type:t,ts:Date.now()}); if(world.log.length>140) world.log.shift(); }

// classNode + display name/sprite for a player
function nodeOf(p){ return C.classNode(p)||CLASSES[p.cls]||SECRET_CLASSES[p.cls]||{name:p.cls,sprite:1920}; }

function pubPlayer(sid,s){
  const p=s.player; const st=C.stats(p); const node=nodeOf(p); const core=C.coreStats(p);
  return { id:sid, name:p.name, cls:p.cls, tier:p.tier, level:p.level, xp:p.xp,
    className:node.name, sprite:node.sprite, portrait:p.portrait,
    hp:p.hp, maxHp:st.maxHp, mp:p.mp, maxMp:st.maxMp,
    patk:st.patk, matk:st.matk, def:st.def, spd:st.spd,
    crit:Math.round(st.crit*100), core,
    alive:p.hp>0, ready:p.ready,
    skills:liveSkills(p),
    equip:p.equip, inventory:p.inventory,
    status:(p.status||[]).map(x=>({type:x.type,rounds:x.rounds,power:x.power})),
    buffs:(p.buffs||[]).map(b=>({buff:b.buff,rounds:b.rounds})),
    equipReady:!!world.equipReady[sid], lootPicked:!!world.lootPicked[sid],
    pendingChoice: pendingClassChoice(p),
  };
}

// what skills a player currently has (base + super + ultra as unlocked)
function liveSkills(p){
  const base=CLASSES[p.cls]||SECRET_CLASSES[p.cls]; if(!base) return ['basic'];
  let ids=['basic',...(base.skills||[])];
  if(p.tier>=1 && base.supers && base.supers[p.superKey]) ids.push(...base.supers[p.superKey].skills);
  if(p.tier>=2 && base.supers && base.supers[p.superKey] && base.supers[p.superKey].ultras[p.ultraKey]) ids.push(...base.supers[p.superKey].ultras[p.ultraKey].skills);
  return [...new Set(ids)];
}

// does this player owe a class choice now? returns {type:'super'|'ultra', options:[...]} or null
function pendingClassChoice(p){
  const base=CLASSES[p.cls]; if(!base||!base.supers) return null;
  // Level 10 -> choose Super class; Level 15 -> choose Ultra class.
  if(p.level>=10 && p.tier<1){
    return { type:'super', options:Object.entries(base.supers).map(([k,v])=>({key:k,name:v.name,sprite:v.sprite,skills:v.skills.map(id=>SKILLS[id]&&SKILLS[id].name).filter(Boolean)})) };
  }
  if(p.level>=15 && p.tier===1 && base.supers[p.superKey]){
    const ult=base.supers[p.superKey].ultras||[];
    return { type:'ultra', options:ult.map((u,i)=>({key:i,name:u.name,sprite:u.sprite,skills:u.skills.map(id=>SKILLS[id]&&SKILLS[id].name).filter(Boolean)})) };
  }
  return null;
}

function snapshot(){
  const players=joined().map(([sid,s])=>pubPlayer(sid,s));
  const stage=STAGES[world.stageIdx];
  return { type:'state',
    world:{ phase:world.phase, stageIdx:world.stageIdx, roundIdx:world.roundIdx,
      stageName:stage?stage.name:'', stageEmoji:stage?stage.emoji:'', stageIntro:stage?stage.intro:'', stageSprite:stage?stage.sprite:0,
      totalStages:STAGES.length, roundsPerStage:stage?stage.rounds.length:5,
      enemy: world.enemy?{ name:world.enemy.name, sprite:world.enemy.sprite, hp:world.enemy.hp, maxHp:world.enemy.maxHp,
        mechanic:world.enemy.mechanic, mechanicDesc:world.enemy.mechanicDesc, boss:world.enemy.boss, phase:world.enemy.phaseLabel||null,
        status:(world.enemy.status||[]).map(x=>({type:x.type,rounds:x.rounds,power:x.power})) }:null,
      currentTurnId: world.roundActive&&world.turnOrder.length?world.turnOrder[world.turnPtr]:null,
      log:world.log.slice(-44), chat:world.chat.slice(-44), lootOffers:world.lootOffers },
    players, playerCount:joined().length, maxPlayers:MAX };
}

// ── XP / leveling ── tuned so Super(~L10) lands ~stage3-4, Ultra(~L15) ~stage6-7
function xpToNext(lvl){ return 80 + lvl*35; }
function grantXp(p,amt){
  p.xp=(p.xp||0)+amt;
  while(p.xp>=xpToNext(p.level)){ p.xp-=xpToNext(p.level); p.level++; plog(`✨ ${p.name} reached Level ${p.level}!`,'system'); }
}

function makePlayer(name,cls,portrait){
  const base=CLASSES[cls]||SECRET_CLASSES[cls]||CLASSES.warrior;
  const p={ name, cls:base.id, portrait, tier:0, superKey:null, ultraKey:null,
    level:1, xp:0, ready:false, status:[], buffs:[],
    equip:{weapon:null,armor:null,trinket:null},
    inventory:['hpotion','hpotion','mpotion'], extraTurn:false, hp:0, mp:0 };
  const st=C.stats(p); p.hp=st.maxHp; p.mp=st.maxMp;
  return p;
}

const allReady=()=>{ const j=joined(); return j.length>=1&&j.every(([,s])=>s.player.ready); };
const allEquip=()=>{ const j=joined(); return j.length>=1&&j.every(([sid])=>world.equipReady[sid]); };
const allLoot=()=>{ const j=alive(); return j.length===0||j.every(([sid])=>world.lootPicked[sid]); };
const allChose=()=>{ return joined().every(([sid,s])=> !pendingClassChoice(s.player) || world.classChoice[sid] ); };

function startGame(){ world.phase='equip'; world.stageIdx=0; world.roundIdx=0; world.equipReady={};
  plog('⚔️ The party gathers. Equip your gear, then descend into '+STAGES[0].name+'!','system'); broadcast(); }
function beginStage(){ world.phase='equip'; world.equipReady={};
  plog(`🏰 Entering ${STAGES[world.stageIdx].name}. Gear up!`,'system'); broadcast(); }

// enemy scaling: HP and DAMAGE both scale with party size now
function partyN(){ return Math.max(1,alive().length); }
function spawnEnemy(){
  const stage=STAGES[world.stageIdx]; const def=stage.rounds[world.roundIdx]; const n=partyN();
  const hpScale = 0.7 + n*0.5;                       // more players = more enemy HP
  const dmgScale = 0.78 + (n-1)*0.12;                // more players = enemy hits harder
  const stageHp = Math.min(1,0.82+world.stageIdx*0.045);
  world.enemy={ name:def.name, sprite:def.sprite,
    maxHp:Math.floor(def.hp*hpScale*stageHp), hp:Math.floor(def.hp*hpScale*stageHp),
    atk:Math.round(def.atk*dmgScale), baseAtk:Math.round(def.atk*dmgScale), def:def.def,
    mechanic:def.mechanic, mechanicDesc:def.desc, boss:!!def.boss,
    status:[], roundCount:0, phaseLabel:def.boss?'Phase 1':null };
}

function buildOrder(){ world.turnOrder=alive().map(([sid,s])=>({sid,spd:C.stats(s.player).spd})).sort((a,b)=>b.spd-a.spd).map(o=>o.sid); world.turnPtr=0; }

function enterCombat(){ world.phase='combat'; spawnEnemy();
  for(const [,s] of alive()){ s.player.status=[]; s.player.buffs=[]; s.player.extraTurn=false; }
  buildOrder(); world.roundActive=true;
  const stage=STAGES[world.stageIdx];
  plog(`Round ${world.roundIdx+1}/${stage.rounds.length}: ${world.enemy.name} appears! (${world.enemy.mechanicDesc})`,'system');
  announce(); broadcast(); }

function announce(){ if(!world.turnOrder.length) return; const s=sessions.get(world.turnOrder[world.turnPtr]); if(s&&s.player) plog(`🎯 ${s.player.name}'s turn.`,'system'); }

// ── enemy AI ──
function enemyTurn(){
  const e=world.enemy; if(!e||e.hp<=0) return; e.roundCount++;
  const tl=[]; const skip=C.tickStatus(e,true,tl); tl.forEach(l=>plog(l.msg,l.type));
  if(e.hp<=0){ return; }
  mechanic(e); if(e.hp<=0) return;
  if(skip){ plog(`${e.name} is frozen/stunned and cannot act!`,'heal'); return; }
  let targets=alive(); if(!targets.length) return;
  const exec=['execute','riftlord','riftlordlite'], drain=['lifesteal','riftlord','riftlordlite'], venom=['poison','riftlord','riftlordlite'];
  let pick = exec.includes(e.mechanic)
    ? targets.sort((a,b)=>(a[1].player.hp/C.stats(a[1].player).maxHp)-(b[1].player.hp/C.stats(b[1].player).maxHp))[0]
    : targets[C.rng(0,targets.length-1)];
  const tp=pick[1].player; let atk=e.atk;
  if(exec.includes(e.mechanic)&&tp.hp/C.stats(tp).maxHp<0.4){ atk=Math.floor(atk*1.7); plog(`☠️ ${e.name} moves to EXECUTE ${tp.name}!`,'enemy'); }
  const raw=atk - C.stats(tp).def + C.rng(-3,6);
  const res=C.hitPlayer(tp,raw);
  if(res.dodged) plog(`💨 ${tp.name} dodges ${e.name}'s attack!`,'heal');
  else { plog(`💥 ${e.name} hits ${tp.name} for ${res.dmg}!`,'enemy');
    if(drain.includes(e.mechanic)){ const h=Math.floor(res.dmg*0.5); e.hp=Math.min(e.maxHp,e.hp+h); if(h>0) plog(`🩸 ${e.name} drains ${h} HP!`,'enemy'); }
    if(venom.includes(e.mechanic)) C.addStatus(tp,{type:'poison',rounds:3,power:e.mechanic==='poison'?14:16,stack:true});
  }
  if(tp.hp<=0) plog(`💀 ${tp.name} has fallen!`,'system');
}
function mechanic(e){
  switch(e.mechanic){
    case 'enrage': e.atk=e.baseAtk+Math.round(e.baseAtk*0.12*e.roundCount); if(e.roundCount%2===0){const t=alive(); if(t.length){C.addStatus(t[C.rng(0,t.length-1)][1].player,{type:'weaken',rounds:2}); plog(`🌿 ${e.name} weakens a hero!`,'enemy');}} break;
    case 'shield': if(e.roundCount%2===1){C.addStatus(e,{type:'shield',power:Math.floor(e.maxHp*0.12),rounds:99}); plog(`🛡️ ${e.name} shields itself!`,'enemy');} break;
    case 'burn': { alive().forEach(([,s])=>C.addStatus(s.player,{type:'burn',rounds:2,power:14,stack:true})); plog(`🔥 ${e.name} burns the party!`,'enemy'); break; }
    case 'freeze': { const t=alive(); if(t.length){const v=t[C.rng(0,t.length-1)][1].player; C.addStatus(v,{type:'freeze',rounds:1}); plog(`🧊 ${e.name} freezes ${v.name}!`,'enemy');} break; }
    case 'burnrage': e.atk=e.baseAtk+Math.round(e.baseAtk*0.1*e.roundCount); alive().forEach(([,s])=>C.addStatus(s.player,{type:'burn',rounds:2,power:16,stack:true})); plog(`🔥 ${e.name} rages and burns all!`,'enemy'); break;
    case 'freezerage': e.atk=e.baseAtk+Math.round(e.baseAtk*0.1*e.roundCount); { const t=alive(); if(t.length){const v=t[C.rng(0,t.length-1)][1].player; C.addStatus(v,{type:'freeze',rounds:1}); plog(`🧊 ${e.name} freezes ${v.name} and grows stronger!`,'enemy');} } break;
    case 'riftlordlite': e.atk=e.baseAtk+Math.round(e.baseAtk*0.08*e.roundCount); if(e.roundCount%3===0){alive().forEach(([,s])=>C.addStatus(s.player,{type:'burn',rounds:2,power:14,stack:true})); plog(`🌋 ${e.name} erupts!`,'enemy');} if(e.roundCount%2===0) C.addStatus(e,{type:'shield',power:Math.floor(e.maxHp*0.08),rounds:99}); break;
    case 'riftlord': { const pct=e.hp/e.maxHp;
      if(pct<0.33&&e.phaseLabel!=='Phase 3'){e.phaseLabel='Phase 3'; e.atk=Math.round(e.baseAtk*1.5); plog('🌌 THE RIFT LORD ENTERS PHASE 3 — reality collapses!','system'); alive().forEach(([,s])=>C.addStatus(s.player,{type:'burn',rounds:3,power:20,stack:true}));}
      else if(pct<0.66&&e.phaseLabel==='Phase 1'){e.phaseLabel='Phase 2'; e.atk=Math.round(e.baseAtk*1.25); plog('🌌 The Rift Lord shifts to PHASE 2!','system');}
      if(e.roundCount%2===0) C.addStatus(e,{type:'shield',power:Math.floor(e.maxHp*0.1),rounds:99}); break; }
  }
}
function thorns(p){ const e=world.enemy; if(e&&e.mechanic==='thorns'){ const r=C.hitPlayer(p,Math.floor(C.stats(p).patk*0.3),{trueDmg:true}); if(r.dmg>0) plog(`🪨 Thorns reflect ${r.dmg} onto ${p.name}!`,'enemy'); } }

// ── actions ──
function doAction(sid,kind,payload){
  if(world.phase!=='combat'||!world.roundActive) return;
  if(world.turnOrder[world.turnPtr]!==sid){ const ss=sessions.get(sid); if(ss) sendTo(ss.ws,{type:'toast',msg:'Not your turn!'}); return; }
  const s=sessions.get(sid); if(!s||!s.player||s.player.hp<=0) return;
  const p=s.player, e=world.enemy;
  const tl=[]; const skip=C.tickStatus(p,false,tl); tl.forEach(l=>plog(l.msg,l.type));
  if(p.hp<=0){ plog(`💀 ${p.name} succumbs!`,'system'); return advanceTurn(); }
  if(skip){ plog(`${p.name} is frozen/stunned and loses the turn!`,'enemy'); return advanceTurn(); }
  let lines=[];
  if(kind==='skill'){
    const id=payload.skillId; if(id!=='basic' && !liveSkills(p).includes(id)){ sendTo(s.ws,{type:'toast',msg:'Skill not available!'}); return; }
    const sk=SKILLS[id]; if(!sk) return;
    if(p.mp<sk.mp){ sendTo(s.ws,{type:'toast',msg:'Not enough MP!'}); return; }
    p.mp-=sk.mp;
    const pp=alive().map(([,ss])=>ss.player);
    lines=C.useSkill(id,p,e,pp,payload.targetId);
    if(sk.type==='attack') thorns(p);
  } else if(kind==='item'){
    const iid=payload.itemId; const idx=p.inventory.indexOf(iid); if(idx===-1){ sendTo(s.ws,{type:'toast',msg:'Item not owned!'}); return; }
    p.inventory.splice(idx,1); const pp=alive().map(([,ss])=>ss.player); lines=C.useItem(iid,p,e,pp);
  } else if(kind==='pass'){ const st=C.stats(p); p.mp=Math.min(st.maxMp,p.mp+Math.floor(st.maxMp*0.15)); lines=[{msg:`${p.name} guards and recovers focus.`,type:'system'}]; }
  lines.forEach(l=>plog(l.msg,l.type));
  if(e.hp<=0) return defeatEnemy();
  if(p.extraTurn){ p.extraTurn=false; plog(`⏳ ${p.name} acts again!`,'heal'); return broadcast(); }
  advanceTurn();
}

function advanceTurn(){
  world.turnOrder=world.turnOrder.filter(sid=>{const s=sessions.get(sid); return s&&s.player&&s.player.hp>0;});
  if(!world.turnOrder.length) return wipe();
  world.turnPtr++;
  if(world.turnPtr>=world.turnOrder.length){
    world.turnPtr=0;
    // mana regen each round for everyone
    for(const [,s] of alive()){ const st=C.stats(s.player); s.player.mp=Math.min(st.maxMp,s.player.mp+Math.floor(st.maxMp*0.1)+5); }
    enemyTurn();
    if(world.enemy.hp<=0) return defeatEnemy();
    if(!alive().length) return wipe();
    buildOrder();
  }
  let g=0; while(g++<20){ const sid=world.turnOrder[world.turnPtr]; const s=sessions.get(sid); if(s&&s.player&&s.player.hp>0) break; world.turnPtr=(world.turnPtr+1)%world.turnOrder.length; }
  announce(); broadcast();
}

function defeatEnemy(){
  const e=world.enemy; if(!e||e.hp>0) return broadcast();
  world.roundActive=false; plog(`🎉 ${e.name} is defeated!`,'system');
  const stage=STAGES[world.stageIdx]; const isBoss=world.roundIdx===stage.rounds.length-1;
  const xp=(e.boss?160:70)+world.stageIdx*22;
  for(const [,s] of joined()){ const p=s.player; grantXp(p,xp); if(p.hp>0){ const st=C.stats(p); p.hp=Math.min(st.maxHp,p.hp+Math.floor(st.maxHp*0.18)); } }
  if(isBoss){
    plog(`💎 Shard recovered from ${stage.name}!`,'system');
    if(world.stageIdx>=STAGES.length-1){ world.phase='victory'; plog('🏆 ALL SHARDS RESTORED! Aethoria is saved!','system'); return broadcast(); }
    // class-choice gate before next stage if anyone has a pending choice
    if(joined().some(([sid,s])=>pendingClassChoice(s.player))){ world.phase='classchoice'; world.classChoice={}; plog('🌟 A surge of power! Heroes may advance their class.','system'); return broadcast(); }
    world.stageIdx++; world.roundIdx=0; beginStage(); return;
  }
  offerLoot();
}

function offerLoot(){
  world.phase='loot'; world.lootOffers={}; world.lootPicked={};
  const depth=world.stageIdx*5+world.roundIdx;
  for(const [sid,s] of joined()){
    if(s.player.hp<=0){ world.lootPicked[sid]=true; continue; }
    const r=Math.random(); let pool;
    if(depth>=38) pool = r<0.5?LOOT_RARITY.legendary:LOOT_RARITY.epic;
    else if(depth>=28) pool = r<0.4?LOOT_RARITY.epic:LOOT_RARITY.rare;
    else if(depth>=16) pool = r<0.5?LOOT_RARITY.rare:LOOT_RARITY.uncommon;
    else if(depth>=6) pool = r<0.55?LOOT_RARITY.uncommon:LOOT_RARITY.common;
    else pool = r<0.7?LOOT_RARITY.common:LOOT_RARITY.uncommon;
    const choices=[]; const copy=[...pool];
    while(choices.length<3&&copy.length) choices.push(copy.splice(C.rng(0,copy.length-1),1)[0]);
    while(choices.length<3){ const c=LOOT_RARITY.common[C.rng(0,LOOT_RARITY.common.length-1)]; if(!choices.includes(c)) choices.push(c); else break; }
    world.lootOffers[sid]=choices;
  }
  plog('💰 Spoils scatter — each hero claims one reward.','system'); broadcast();
}
function pickLoot(sid,itemId){ if(world.phase!=='loot'||world.lootPicked[sid]) return;
  const off=world.lootOffers[sid]||[]; if(!off.includes(itemId)) return;
  const s=sessions.get(sid); if(!s||!s.player) return;
  s.player.inventory.push(itemId); world.lootPicked[sid]=true;
  const it=ITEMS[itemId]; plog(`🎁 ${s.player.name} takes ${it.name}.`,'item');
  if(allLoot()){ world.roundIdx++; enterCombat(); } else broadcast();
}

function chooseClass(sid,choiceKey){
  if(world.phase!=='classchoice') return;
  const s=sessions.get(sid); if(!s||!s.player) return;
  const p=s.player; const pend=pendingClassChoice(p); if(!pend){ world.classChoice[sid]=true; return checkChoiceDone(); }
  if(pend.type==='super'){ if(!CLASSES[p.cls].supers[choiceKey]) return; p.superKey=choiceKey; p.tier=1;
    const st=C.stats(p); p.hp=st.maxHp; p.mp=st.maxMp; plog(`🌟 ${p.name} becomes a ${CLASSES[p.cls].supers[choiceKey].name}!`,'system'); }
  else if(pend.type==='ultra'){ const ult=CLASSES[p.cls].supers[p.superKey].ultras; if(!ult[choiceKey]) return; p.ultraKey=choiceKey; p.tier=2;
    const st=C.stats(p); p.hp=st.maxHp; p.mp=st.maxMp; plog(`🌟 ${p.name} ascends into a ${ult[choiceKey].name}!`,'system'); }
  world.classChoice[sid]=true; checkChoiceDone();
}
function checkChoiceDone(){
  if(allChose()){ world.stageIdx++; world.roundIdx=0; beginStage(); } else broadcast();
}

function confirmEquip(sid,skills,equip){
  const s=sessions.get(sid); if(!s||!s.player) return; const p=s.player;
  const e={weapon:null,armor:null,trinket:null};
  for(const slot of ['weapon','armor','trinket']){ const iid=equip&&equip[slot]; if(iid&&ITEMS[iid]&&ITEMS[iid].kind===slot&&p.inventory.includes(iid)) e[slot]=iid; }
  p.equip=e; world.equipReady[sid]=true; plog(`✅ ${p.name} is ready.`,'system');
  if(allEquip()){ world.roundIdx=0; enterCombat(); } else broadcast();
}

function wipe(){ world.phase='defeat'; world.roundActive=false; plog('💀 The party has fallen. The Rift consumes all... Press Play Again.','system'); broadcast(); }
function resetAll(){ world.phase='lobby'; world.stageIdx=0; world.roundIdx=0; world.enemy=null; world.turnOrder=[]; world.turnPtr=0;
  world.lootOffers={}; world.lootPicked={}; world.equipReady={}; world.classChoice={}; world.roundActive=false; world.log=[];
  for(const [,s] of joined()){ if(s.player) s.player=makePlayer(s.player.name,s.player.cls,s.player.portrait); }
  plog('🔄 A new quest begins.','system'); broadcast(); }

setInterval(()=>{ const now=Date.now();
  for(const [sid,s] of sessions){ if(now-s.lastSeen>TTL||s.ws.readyState!==WebSocket.OPEN){ const nm=s.player?s.player.name:'A hero'; sessions.delete(sid); if(world.turnOrder.includes(sid)) world.turnOrder=world.turnOrder.filter(x=>x!==sid); plog(`🚪 ${nm} left.`,'system'); broadcast(); } }
},30000);

wss.on('connection',ws=>{
  if(sessions.size>=MAX){ sendTo(ws,{type:'full',maxPlayers:MAX}); ws.close(); return; }
  const sid=uuidv4(); sessions.set(sid,{ws,player:null,lastSeen:Date.now()});
  sendTo(ws,{type:'init',sessionId:sid,maxPlayers:MAX}); sendTo(ws,snapshot());
  ws.on('message',raw=>{ try{
    let m; try{m=JSON.parse(raw);}catch{return;}
    const s=sessions.get(sid); if(!s) return; s.lastSeen=Date.now();
    switch(m.type){
      case 'join': { if(!m.name||!(CLASSES[m.cls]||SECRET_CLASSES[m.cls])) return; s.player=makePlayer(String(m.name).slice(0,22),m.cls,m.portrait||''); plog(`⚔️ ${s.player.name} the ${nodeOf(s.player).name} joins!`,'system'); broadcast(); break; }
      case 'ready': { if(!s.player||world.phase!=='lobby') return; s.player.ready=!s.player.ready; broadcast(); break; }
      case 'start': { if(world.phase!=='lobby'||!allReady()){ sendTo(ws,{type:'toast',msg:'All heroes must be ready!'}); return; } startGame(); break; }
      case 'equip': { if(world.phase!=='equip') return; confirmEquip(sid,m.skills,m.equip); break; }
      case 'choose': { chooseClass(sid,m.choice); break; }
      case 'action': { doAction(sid,m.kind,m.payload||{}); break; }
      case 'loot': { pickLoot(sid,m.itemId); break; }
      case 'chat': { if(!s.player||!m.text) return; world.chat.push({name:s.player.name,msg:String(m.text).slice(0,200),ts:Date.now()}); if(world.chat.length>90) world.chat.shift(); broadcast(); break; }
      case 'reset': { if(s.player) resetAll(); break; }
      case 'ping': sendTo(ws,{type:'pong'}); break;
    }
  }catch(err){ console.error('[msg handler]',err&&err.stack||err); } });
  ws.on('close',()=>{ try{
    const s=sessions.get(sid); const nm=s&&s.player?s.player.name:'A hero'; sessions.delete(sid);
    if(world.turnOrder.includes(sid)){ const wasTurn=world.turnOrder[world.turnPtr]===sid; world.turnOrder=world.turnOrder.filter(x=>x!==sid); if(world.turnPtr>=world.turnOrder.length) world.turnPtr=0; if(world.phase==='combat'&&world.roundActive){ if(!world.turnOrder.length) return wipe(); if(wasTurn) announce(); } }
    delete world.lootPicked[sid]; delete world.equipReady[sid]; delete world.lootOffers[sid]; delete world.classChoice[sid];
    if(world.phase==='loot'&&allLoot()){ world.roundIdx++; return enterCombat(); }
    if(world.phase==='equip'&&allEquip()&&joined().length){ world.roundIdx=0; return enterCombat(); }
    if(world.phase==='classchoice'&&allChose()&&joined().length){ world.stageIdx++; world.roundIdx=0; return beginStage(); }
    plog(`🚪 ${nm} left.`,'system'); broadcast();
  }catch(err){ console.error('[close handler]',err&&err.stack||err); } });
  ws.on('error',()=>{});
});

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(_q,r)=>r.sendFile(path.join(__dirname,'public','index.html')));
server.listen(PORT,()=>console.log(`⚔️  Eternal Quest on :${PORT}`));
