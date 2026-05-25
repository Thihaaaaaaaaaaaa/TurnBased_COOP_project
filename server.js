'use strict';
const http = require('http');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const { CLASSES, EVOLVE_NAMES, EVOLVE_EMOJI, ABILITIES, BASIC_ATTACK, ITEMS, STAGES, LOOT_TABLE } = require('./content');
const C = require('./combat');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;
const SESSION_TTL_MS = 15 * 60 * 1000;

const sessions = new Map();

const world = {
  phase: 'lobby',
  stageIdx: 0, roundIdx: 0,
  enemy: null,
  turnOrder: [], turnPtr: 0,
  log: [], chat: [],
  lootOffers: {}, lootPicked: {}, equipReady: {},
  roundActive: false,
};

function broadcast() {
  const snap = JSON.stringify(snapshot());
  for (const s of sessions.values()) if (s.ws.readyState === WebSocket.OPEN) s.ws.send(snap);
}
function sendTo(ws, data) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function joined() { return [...sessions.entries()].filter(([, s]) => s.player); }
function alivePlayers() { return joined().filter(([, s]) => s.player.hp > 0); }
function plog(msg, type = 'system') { world.log.push({ msg, type, ts: Date.now() }); if (world.log.length > 120) world.log.shift(); }

function pubPlayer(sid, s) {
  const p = s.player;
  const es = C.effStats(p);
  const tier=p.evolveTier||0;
  const emoji=(EVOLVE_EMOJI[p.cls]||[])[tier]||CLASSES[p.cls].emoji;
  const className=(EVOLVE_NAMES[p.cls]||[])[tier]||CLASSES[p.cls].name;
  return {
    id: sid, name: p.name, cls: p.cls, evolved: p.evolved, evolveTier: tier,
    emoji, className,
    portrait: p.portrait,
    level: p.level, hp: p.hp, maxHp: es.maxHp, mp: p.mp, maxMp: es.maxMp,
    atk: es.atk, def: es.def, spd: es.spd, gold: p.gold,
    alive: p.hp > 0, ready: p.ready,
    status: (p.status || []).map(st => ({ type: st.type, rounds: st.rounds, power: st.power })),
    equippedAbilities: p.equippedAbilities, equip: p.equip,
    inventory: p.inventory, ownedAbilities: p.ownedAbilities,
    equipReady: !!world.equipReady[sid], lootPicked: !!world.lootPicked[sid],
  };
}

function snapshot() {
  const players = joined().map(([sid, s]) => pubPlayer(sid, s));
  const stage = STAGES[world.stageIdx];
  return {
    type: 'state',
    world: {
      phase: world.phase, stageIdx: world.stageIdx, roundIdx: world.roundIdx,
      stageName: stage ? stage.name : '', stageEmoji: stage ? stage.emoji : '',
      stageIntro: stage ? stage.intro : '',
      totalStages: STAGES.length, roundsPerStage: stage ? stage.rounds.length : 5,
      enemy: world.enemy ? {
        name: world.enemy.name, emoji: world.enemy.emoji,
        hp: world.enemy.hp, maxHp: world.enemy.maxHp,
        mechanic: world.enemy.mechanic, mechanicDesc: world.enemy.mechanicDesc,
        boss: world.enemy.boss, phase: world.enemy.phaseLabel || null,
        status: (world.enemy.status || []).map(st => ({ type: st.type, rounds: st.rounds, power: st.power })),
      } : null,
      currentTurnId: world.roundActive && world.turnOrder.length ? world.turnOrder[world.turnPtr] : null,
      turnOrder: world.turnOrder,
      log: world.log.slice(-40), chat: world.chat.slice(-40),
      lootOffers: world.lootOffers,
    },
    players, playerCount: joined().length, maxPlayers: MAX_PLAYERS,
  };
}

function makePlayer(name, cls, portrait) {
  const b = CLASSES[cls].base;
  const owned = Object.values(ABILITIES).filter(a => a.cls === cls && a.tier === 1).map(a => a.id);
  return {
    name, cls, portrait, evolved: false, evolveTier: 0,
    level: 1, hp: b.maxHp, maxHp: b.maxHp, mp: b.maxMp, maxMp: b.maxMp,
    atk: b.atk, def: b.def, spd: b.spd, gold: 0,
    status: [], ready: false,
    ownedAbilities: owned, equippedAbilities: owned.slice(0, 4),
    equip: { weapon: null, armor: null, trinket: null },
    inventory: ['hpotion', 'hpotion', 'greaterhp', 'mpotion'], extraTurn: false,
  };
}

function allReady() { const j = joined(); return j.length >= 1 && j.every(([, s]) => s.player.ready); }
function allEquipReady() { const j = joined(); return j.length >= 1 && j.every(([sid]) => world.equipReady[sid]); }
function allLootPicked() { const j = alivePlayers(); return j.length === 0 || j.every(([sid]) => world.lootPicked[sid]); }

function startGame() { world.phase='equip'; world.stageIdx=0; world.roundIdx=0; world.equipReady={}; plog('⚔️ The party assembles. Equip your kit before entering '+STAGES[0].name+'!','system'); broadcast(); }
function beginStage() { world.phase='equip'; world.equipReady={}; plog(`🏰 Entering ${STAGES[world.stageIdx].name}. Equip up to 4 abilities & gear!`,'system'); broadcast(); }
function partyScale() { const n=Math.max(1,alivePlayers().length); return 0.6+n*0.45; }

function spawnEnemy() {
  const stage = STAGES[world.stageIdx];
  const def = stage.rounds[world.roundIdx];
  const scale = partyScale();
  // damage curve: early stages hit softer, ramps to full by stage 5 and beyond
  const atkCurve = Math.min(1, 0.62 + world.stageIdx * 0.08); // s0=0.62 ... s5+=1.0
  const atk = Math.max(1, Math.round(def.atk * atkCurve));
  // HP curve: also a touch gentler very early so openings aren't grindy walls
  const hpCurve = Math.min(1, 0.78 + world.stageIdx * 0.05);
  world.enemy = {
    name:def.name, emoji:def.emoji,
    maxHp:Math.floor(def.hp*scale*hpCurve), hp:Math.floor(def.hp*scale*hpCurve),
    atk, def:def.def, baseAtk:atk,
    mechanic:def.mechanic, mechanicDesc:def.desc, boss:!!def.boss,
    status:[], roundCount:0, phaseLabel:def.boss?'Phase 1':null,
  };
}

function buildTurnOrder() {
  world.turnOrder = alivePlayers().map(([sid,s])=>({sid,spd:C.effStats(s.player).spd})).sort((a,b)=>b.spd-a.spd).map(o=>o.sid);
  world.turnPtr = 0;
}

function enterCombat() {
  world.phase='combat'; spawnEnemy();
  for (const [,s] of alivePlayers()) { s.player.status=[]; s.player.extraTurn=false;
    if(C.equipSpecial(s.player,'regen8')) C.addStatus(s.player,{type:'regen',rounds:99,power:8,good:true});
    if(C.equipSpecial(s.player,'regen14')) C.addStatus(s.player,{type:'regen',rounds:99,power:14,good:true});
  }
  buildTurnOrder(); world.roundActive=true;
  const stage=STAGES[world.stageIdx];
  plog(`${world.enemy.emoji} Round ${world.roundIdx+1}/${stage.rounds.length}: ${world.enemy.name} appears! (${world.enemy.mechanicDesc})`,'system');
  announceTurn(); broadcast();
}

function announceTurn() {
  if (!world.turnOrder.length) return;
  const s = sessions.get(world.turnOrder[world.turnPtr]);
  if (s && s.player) plog(`🎯 ${s.player.name}'s turn.`,'system');
}

function enemyTurn() {
  const e = world.enemy;
  if (!e || e.hp<=0) return;
  e.roundCount++;
  const tickLog=[]; const skip=C.tickStatus(e,true,tickLog);
  tickLog.forEach(l=>plog(l.msg,l.type));
  if (e.hp<=0) { checkEnemyDead(); return; }
  applyEnemyMechanic(e);
  if (skip) { plog(`${e.name} is frozen/stunned and cannot act!`,'heal'); return; }
  let targets=alivePlayers();
  if (e.tauntedBy) { const t=targets.find(([sid])=>sid===e.tauntedBy); if(t) targets=[t]; }
  if (!targets.length) return;
  let pick;
  const exec=['execute','riftlord','riftlordlite'];
  const drain=['lifesteal','riftlord','riftlordlite'];
  const venom=['poison','riftlord','riftlordlite'];
  if (exec.includes(e.mechanic)) pick=targets.sort((a,b)=>(a[1].player.hp/C.effStats(a[1].player).maxHp)-(b[1].player.hp/C.effStats(b[1].player).maxHp))[0];
  else pick=targets[C.rng(0,targets.length-1)];
  const [,ts]=pick; const tp=ts.player;
  let atk=e.atk;
  if (exec.includes(e.mechanic) && tp.hp/C.effStats(tp).maxHp<0.4) { atk=Math.floor(atk*1.8); plog(`☠️ ${e.name} moves to EXECUTE ${tp.name}!`,'enemy'); }
  const raw=atk-C.effStats(tp).def+C.rng(-3,5);
  const res=C.dealToPlayer(tp,raw);
  if (res.dodged) plog(`💨 ${tp.name} dodged ${e.name}'s attack!`,'heal');
  else {
    plog(`💥 ${e.name} hits ${tp.name} for ${res.dmg} damage!`,'enemy');
    if (drain.includes(e.mechanic)) { const h=Math.floor(res.dmg*0.5); e.hp=Math.min(e.maxHp,e.hp+h); if(h>0) plog(`🩸 ${e.name} drains ${h} HP!`,'enemy'); }
    if (venom.includes(e.mechanic)) C.addStatus(tp,{type:'poison',rounds:3,power:e.mechanic==='poison'?10:12,stack:true});
  }
  if (tp.hp<=0) plog(`💀 ${tp.name} has fallen!`,'system');
}

function applyEnemyMechanic(e) {
  switch(e.mechanic) {
    case 'enrage': e.atk=e.baseAtk+3*e.roundCount; if(e.roundCount%2===0){const t=alivePlayers(); if(t.length){C.addStatus(t[C.rng(0,t.length-1)][1].player,{type:'weaken',rounds:2}); plog(`🌿 ${e.name}'s roots Weaken a hero!`,'enemy');}} break;
    case 'shield': if(e.roundCount%2===1){C.addStatus(e,{type:'shield',power:60,rounds:99}); plog(`🛡️ ${e.name} raises a 60-point shield!`,'enemy');} break;
    case 'burn': { const t=alivePlayers(); t.forEach(([,s])=>C.addStatus(s.player,{type:'burn',rounds:2,power:12,stack:true})); plog(`🔥 ${e.name} sets the whole party ablaze!`,'enemy'); break; }
    case 'freeze': { const t=alivePlayers(); if(t.length){const v=t[C.rng(0,t.length-1)][1].player; C.addStatus(v,{type:'stun',rounds:1}); plog(`🧊 ${e.name} freezes ${v.name} solid!`,'enemy');} break; }
    case 'burnrage': { e.atk=e.baseAtk+3*e.roundCount; const t=alivePlayers(); t.forEach(([,s])=>C.addStatus(s.player,{type:'burn',rounds:2,power:14,stack:true})); plog(`🔥 ${e.name} rages hotter and burns the party!`,'enemy'); break; }
    case 'freezerage': { e.atk=e.baseAtk+3*e.roundCount; const t=alivePlayers(); if(t.length){const v=t[C.rng(0,t.length-1)][1].player; C.addStatus(v,{type:'stun',rounds:1}); plog(`🧊 ${e.name} freezes ${v.name} and grows stronger!`,'enemy');} break; }
    case 'riftlordlite': {
      e.atk=e.baseAtk+3*e.roundCount;
      if(e.roundCount%3===0){ const t=alivePlayers(); t.forEach(([,s])=>C.addStatus(s.player,{type:'burn',rounds:2,power:12,stack:true})); plog(`🌋 ${e.name} erupts — the party burns!`,'enemy'); }
      if(e.roundCount%2===0) C.addStatus(e,{type:'shield',power:40,rounds:99});
      break;
    }
    case 'riftlord': {
      const pct=e.hp/e.maxHp;
      if(pct<0.33&&e.phaseLabel!=='Phase 3'){e.phaseLabel='Phase 3'; e.atk=e.baseAtk+18; plog('🌌 THE RIFT LORD ENTERS PHASE 3 — reality collapses!','system'); const t=alivePlayers(); t.forEach(([,s])=>C.addStatus(s.player,{type:'burn',rounds:3,power:18,stack:true}));}
      else if(pct<0.66&&e.phaseLabel==='Phase 1'){e.phaseLabel='Phase 2'; e.atk=e.baseAtk+9; plog('🌌 The Rift Lord shifts to PHASE 2!','system');}
      if(e.roundCount%2===0) C.addStatus(e,{type:'shield',power:60,rounds:99});
      break;
    }
  }
}

function maybeThorns(player) {
  const e=world.enemy;
  if(e && e.mechanic==='thorns'){const refl=Math.floor(C.effStats(player).atk*0.3); const r=C.dealToPlayer(player,refl,{trueDmg:true}); if(r.dmg>0) plog(`🪨 Thorns reflect ${r.dmg} damage onto ${player.name}!`,'enemy');}
}

function doAction(sid, kind, payload) {
  if (world.phase!=='combat'||!world.roundActive) return;
  if (world.turnOrder[world.turnPtr]!==sid){ const ss=sessions.get(sid); if(ss) sendTo(ss.ws,{type:'toast',msg:"Not your turn!"}); return; }
  const s=sessions.get(sid); if(!s||!s.player||s.player.hp<=0) return;
  const p=s.player; const e=world.enemy;
  const tlog=[]; const skip=C.tickStatus(p,false,tlog);
  tlog.forEach(l=>plog(l.msg,l.type));
  if(p.hp<=0){plog(`💀 ${p.name} succumbs!`,'system'); advanceTurn(); return;}
  if(skip){plog(`${p.name} is frozen/stunned and loses their turn!`,'enemy'); advanceTurn(); return;}
  let lines=[];
  if(kind==='ability'){
    const aid=payload.abilityId;
    if(aid!=='attack'&&!p.equippedAbilities.includes(aid)){sendTo(s.ws,{type:'toast',msg:'Ability not equipped!'}); return;}
    const A=aid==='attack'?BASIC_ATTACK:ABILITIES[aid]; if(!A) return;
    if(p.mp<A.mpCost){sendTo(s.ws,{type:'toast',msg:'Not enough MP!'}); return;}
    p.mp-=A.mpCost;
    const pp=alivePlayers().map(([,ss])=>ss.player);
    lines=C.useAbility(aid,p,e,pp,payload.targetId);
    const melee=['attack','cleave','bash','backstab','poisonblade','shadowstep','thousandcuts','pierceshot','bloodlust','earthshatter','executioner','assassinate','ragnarok','oblivion'];
    if(melee.includes(aid)) maybeThorns(p);
  } else if(kind==='item'){
    const iid=payload.itemId; const idx=p.inventory.indexOf(iid);
    if(idx===-1){sendTo(s.ws,{type:'toast',msg:'Item not in inventory!'}); return;}
    p.inventory.splice(idx,1);
    const pp=alivePlayers().map(([,ss])=>ss.player);
    lines=C.useItem(iid,p,e,pp);
  } else if(kind==='pass'){ lines=[{msg:`${p.name} guards and waits.`,type:'system'}]; }
  lines.forEach(l=>plog(l.msg,l.type));
  if(e.hp<=0){checkEnemyDead(); return;}
  if(p.extraTurn){p.extraTurn=false; plog(`⏳ ${p.name} acts again!`,'heal'); broadcast(); return;}
  advanceTurn();
}

function advanceTurn() {
  world.turnOrder=world.turnOrder.filter(sid=>{const s=sessions.get(sid); return s&&s.player&&s.player.hp>0;});
  if(!world.turnOrder.length) return defeat();
  world.turnPtr++;
  if(world.turnPtr>=world.turnOrder.length){
    world.turnPtr=0; enemyTurn();
    if(world.enemy.hp<=0){checkEnemyDead(); return;}
    if(!alivePlayers().length) return defeat();
    buildTurnOrder();
  }
  let guard=0;
  while(guard++<16){const sid=world.turnOrder[world.turnPtr]; const s=sessions.get(sid); if(s&&s.player&&s.player.hp>0) break; world.turnPtr=(world.turnPtr+1)%world.turnOrder.length;}
  announceTurn(); broadcast();
}

function checkEnemyDead() {
  const e=world.enemy;
  if(!e||e.hp>0){broadcast(); return;}
  world.roundActive=false;
  plog(`🎉 ${e.name} is defeated!`,'system');
  const stage=STAGES[world.stageIdx];
  const isStageBoss=world.roundIdx===stage.rounds.length-1;
  const goldEach=(e.boss?60:25)+world.stageIdx*15;
  for(const [,s] of joined()){const p=s.player; p.gold+=goldEach; p.level+=1; p.maxHp+=8; p.atk+=2; p.def+=1; p.maxMp+=4; if(p.hp>0) p.hp=Math.min(C.effStats(p).maxHp,p.hp+Math.floor(C.effStats(p).maxHp*0.2));}
  if(isStageBoss){
    plog(`💎 Shard recovered from ${stage.name}!`,'system');
    if(world.stageIdx>=STAGES.length-1){world.phase='victory'; plog('🏆 ALL SHARDS RESTORED! The Rift is sealed! Aethoria is saved!','system'); broadcast(); return;}
    // evolve after stages 3,6,9 (stageIdx 2,5,8 just cleared)
    if(world.stageIdx===2||world.stageIdx===5||world.stageIdx===8) maybeEvolveAll();
    world.stageIdx++; world.roundIdx=0; beginStage(); return;
  }
  offerLoot();
}

function maybeEvolveAll() {
  for(const [,s] of joined()){
    const p=s.player;
    const nextTier=(p.evolveTier||0)+1; // 1->t2, 2->t3, 3->t4
    if(nextTier>3) continue;
    p.evolveTier=nextTier; p.evolved=true;
    const newAbils=Object.values(ABILITIES).filter(a=>a.cls===p.cls&&a.tier===nextTier+1).map(a=>a.id);
    p.ownedAbilities=[...new Set([...p.ownedAbilities,...newAbils])];
    // scaling stat boost per evolution
    p.maxHp+=40+nextTier*15; p.maxMp+=30+nextTier*10; p.atk+=8+nextTier*3; p.def+=6+nextTier*2; p.spd+=3;
    p.hp=C.effStats(p).maxHp; p.mp=C.effStats(p).maxMp;
    const title=(EVOLVE_NAMES[p.cls]||[])[nextTier]||CLASSES[p.cls].evolveName;
    plog(`🌟 ${p.name} ASCENDS into a ${title}! New abilities unlocked!`,'system');
  }
}

function offerLoot() {
  world.phase='loot'; world.lootOffers={}; world.lootPicked={};
  for(const [sid,s] of joined()){
    if(s.player.hp<=0){world.lootPicked[sid]=true; continue;}
    const depth=world.stageIdx*5+world.roundIdx; // 0..49
    const r=Math.random(); let pool;
    if(depth>=35) pool=r<0.45?LOOT_TABLE.legendary:LOOT_TABLE.rare;
    else if(depth>=22) pool=r<0.4?LOOT_TABLE.rare:LOOT_TABLE.uncommon;
    else if(depth>=10) pool=r<0.5?LOOT_TABLE.uncommon:LOOT_TABLE.common;
    else pool=r<0.65?LOOT_TABLE.common:LOOT_TABLE.uncommon;
    const choices=[]; const copy=[...pool];
    while(choices.length<3&&copy.length) choices.push(copy.splice(C.rng(0,copy.length-1),1)[0]);
    while(choices.length<3){const c=LOOT_TABLE.common[C.rng(0,LOOT_TABLE.common.length-1)]; if(!choices.includes(c)) choices.push(c); else break;}
    world.lootOffers[sid]=choices;
  }
  plog('💰 Loot scattered from the fallen. Each hero chooses one reward!','system');
  broadcast();
}

function pickLoot(sid,itemId) {
  if(world.phase!=='loot'||world.lootPicked[sid]) return;
  const offers=world.lootOffers[sid]||[]; if(!offers.includes(itemId)) return;
  const s=sessions.get(sid); if(!s||!s.player) return;
  const it=ITEMS[itemId]; s.player.inventory.push(itemId);
  world.lootPicked[sid]=true;
  plog(`🎁 ${s.player.name} takes ${it.emoji} ${it.name}.`,'item');
  if(allLootPicked()){world.roundIdx++; enterCombat();} else broadcast();
}

function confirmEquip(sid,equippedAbilities,equip) {
  const s=sessions.get(sid); if(!s||!s.player) return;
  const p=s.player;
  const valid=(equippedAbilities||[]).filter(a=>p.ownedAbilities.includes(a)).slice(0,4);
  if(valid.length) p.equippedAbilities=valid;
  const e={weapon:null,armor:null,trinket:null};
  for(const slot of ['weapon','armor','trinket']){const iid=equip&&equip[slot]; if(iid&&ITEMS[iid]&&ITEMS[iid].kind===slot&&p.inventory.includes(iid)) e[slot]=iid;}
  p.equip=e; world.equipReady[sid]=true;
  plog(`✅ ${p.name} is geared and ready.`,'system');
  if(allEquipReady()){world.roundIdx=0; enterCombat();} else broadcast();
}

function defeat(){ world.phase='defeat'; world.roundActive=false; plog('💀 The entire party has fallen. The Rift consumes Aethoria... Press Play Again.','system'); broadcast(); }

function resetAll() {
  world.phase='lobby'; world.stageIdx=0; world.roundIdx=0; world.enemy=null;
  world.turnOrder=[]; world.turnPtr=0; world.lootOffers={}; world.lootPicked={}; world.equipReady={};
  world.roundActive=false; world.log=[];
  for(const [,s] of joined()){if(s.player) s.player=makePlayer(s.player.name,s.player.cls,s.player.portrait);}
  plog('🔄 A new quest begins. Mark ready when prepared.','system'); broadcast();
}

setInterval(()=>{
  const now=Date.now();
  for(const [sid,s] of sessions){
    if(now-s.lastSeen>SESSION_TTL_MS||s.ws.readyState!==WebSocket.OPEN){
      const nm=s.player?s.player.name:'A hero'; sessions.delete(sid);
      if(world.turnOrder.includes(sid)) world.turnOrder=world.turnOrder.filter(x=>x!==sid);
      plog(`🚪 ${nm} left the realm.`,'system'); broadcast();
    }
  }
},30000);

wss.on('connection',(ws)=>{
  if(sessions.size>=MAX_PLAYERS){sendTo(ws,{type:'full',maxPlayers:MAX_PLAYERS}); ws.close(); return;}
  const sid=uuidv4();
  sessions.set(sid,{ws,player:null,lastSeen:Date.now()});
  sendTo(ws,{type:'init',sessionId:sid,maxPlayers:MAX_PLAYERS});
  ws.send(JSON.stringify(snapshot()));
  ws.on('message',raw=>{
    let m; try{m=JSON.parse(raw);}catch{return;}
    const s=sessions.get(sid); if(!s) return; s.lastSeen=Date.now();
    switch(m.type){
      case 'join': { if(!m.name||!CLASSES[m.cls]) return; s.player=makePlayer(String(m.name).slice(0,22),m.cls,m.portrait||''); plog(`⚔️ ${s.player.name} the ${CLASSES[m.cls].name} joins!`,'system'); broadcast(); break; }
      case 'ready': { if(!s.player||world.phase!=='lobby') return; s.player.ready=!s.player.ready; broadcast(); break; }
      case 'start': { if(world.phase!=='lobby'||!allReady()){sendTo(ws,{type:'toast',msg:'All heroes must be ready!'}); return;} startGame(); break; }
      case 'equip': { if(world.phase!=='equip') return; confirmEquip(sid,m.abilities,m.equip); break; }
      case 'action': { doAction(sid,m.kind,m.payload||{}); break; }
      case 'loot': { pickLoot(sid,m.itemId); break; }
      case 'chat': { if(!s.player||!m.text) return; world.chat.push({name:s.player.name,msg:String(m.text).slice(0,200),ts:Date.now()}); if(world.chat.length>80) world.chat.shift(); broadcast(); break; }
      case 'reset': { if(s.player) resetAll(); break; }
      case 'ping': sendTo(ws,{type:'pong'}); break;
    }
  });
  ws.on('close',()=>{
    const s=sessions.get(sid); const nm=s&&s.player?s.player.name:'A hero';
    sessions.delete(sid);
    if(world.turnOrder.includes(sid)){
      const wasTurn=world.turnOrder[world.turnPtr]===sid;
      world.turnOrder=world.turnOrder.filter(x=>x!==sid);
      if(world.turnPtr>=world.turnOrder.length) world.turnPtr=0;
      if(world.phase==='combat'&&world.roundActive){if(!world.turnOrder.length) defeat(); else if(wasTurn) announceTurn();}
    }
    delete world.lootPicked[sid]; delete world.equipReady[sid]; delete world.lootOffers[sid];
    if(world.phase==='loot'&&allLootPicked()){world.roundIdx++; enterCombat(); return;}
    if(world.phase==='equip'&&allEquipReady()&&joined().length){world.roundIdx=0; enterCombat(); return;}
    plog(`🚪 ${nm} left the realm.`,'system'); broadcast();
  });
  ws.on('error',()=>{});
});

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(_q,r)=>r.sendFile(path.join(__dirname,'public','index.html')));
server.listen(PORT,()=>console.log(`⚔️  Eternal Quest server on :${PORT}`));
