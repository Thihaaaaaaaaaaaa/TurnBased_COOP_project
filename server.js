'use strict';

const http = require('http');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes idle

// ─────────────────────────────────────────────
// GAME DATA
// ─────────────────────────────────────────────
const CLASSES = {
  warrior: { emoji: '⚔️', maxHp: 130, maxMp: 30, atk: 18, def: 14, skills: ['Power Strike', 'Shield Bash'], skillMp: [8, 5], skillDmg: [30, 0] },
  mage:    { emoji: '🔮', maxHp: 75,  maxMp: 110, atk: 24, def: 6,  skills: ['Fireball', 'Frost Nova'],   skillMp: [18, 15], skillDmg: [38, 22] },
  rogue:   { emoji: '🗡️', maxHp: 95,  maxMp: 55,  atk: 22, def: 8,  skills: ['Backstab', 'Smoke Bomb'],   skillMp: [10, 12], skillDmg: [34, 0] },
  ranger:  { emoji: '🏹', maxHp: 105, maxMp: 65,  atk: 20, def: 10, skills: ["Eagle Shot", "Nature's Heal"], skillMp: [10, 20], skillDmg: [32, 0] },
};

const ENEMIES = {
  forest_troll:    { name: 'Forest Troll',    emoji: '👹', hp: 80,  maxHp: 80,  atk: 14, def: 4,  xp: 80,  gold: 20 },
  skeleton_mage:   { name: 'Skeleton Mage',   emoji: '💀', hp: 65,  maxHp: 65,  atk: 17, def: 3,  xp: 95,  gold: 25 },
  dragon_varathos: { name: 'Varathos',         emoji: '🐉', hp: 120, maxHp: 120, atk: 22, def: 9,  xp: 130, gold: 50 },
  sea_leviathan:   { name: 'Sea Leviathan',   emoji: '🦑', hp: 100, maxHp: 100, atk: 18, def: 7,  xp: 115, gold: 35 },
  rift_lord:       { name: 'The Rift Lord',   emoji: '🌑', hp: 160, maxHp: 160, atk: 26, def: 12, xp: 350, gold: 100 },
};

const ZONES = ['dark_forest','sunken_crypt','dragons_peak','abyssal_shore','shadow_sanctum'];
const ZONE_NAMES = {
  dark_forest: 'Dark Forest',
  sunken_crypt: 'Sunken Crypt',
  dragons_peak: "Dragon's Peak",
  abyssal_shore: 'Abyssal Shore',
  shadow_sanctum: 'Shadow Sanctum',
};
const ZONE_ENEMY = {
  dark_forest: 'forest_troll',
  sunken_crypt: 'skeleton_mage',
  dragons_peak: 'dragon_varathos',
  abyssal_shore: 'sea_leviathan',
  shadow_sanctum: 'rift_lord',
};
const ZONE_EMOJI = {
  dark_forest: '🌲',
  sunken_crypt: '💀',
  dragons_peak: '🐉',
  abyssal_shore: '🌊',
  shadow_sanctum: '🏰',
};

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
// sessions: Map<sessionId, { ws, player, lastSeen }>
const sessions = new Map();

// Shared game world
const world = {
  phase: 'lobby',   // lobby | adventure | combat | victory
  shards: 0,
  clearedZones: new Set(),
  currentZone: null,
  combat: null,     // { enemy, turnQueue, currentTurn }
  combatLog: [],
  chatLog: [],
  votes: {},        // { zoneId: Set<sessionId> }
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function rng(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  for (const [sid, sess] of sessions) {
    if (sid !== exclude && sess.ws.readyState === WebSocket.OPEN) {
      sess.ws.send(msg);
    }
  }
}

function broadcastAll(data) { broadcast(data, null); }

function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }

function getPublicPlayers() {
  return [...sessions.values()]
    .filter(s => s.player !== null)
    .map(s => ({
      id: s.player.id,
      name: s.player.name,
      cls: s.player.cls,
      emoji: CLASSES[s.player.cls]?.emoji || '⚔️',
      level: s.player.level,
      hp: s.player.hp,
      maxHp: s.player.maxHp,
      mp: s.player.mp,
      maxMp: s.player.maxMp,
      portrait: s.player.portrait,
      alive: s.player.hp > 0,
      ready: s.player.ready,
    }));
}

function worldSnapshot() {
  return {
    type: 'world_state',
    world: {
      phase: world.phase,
      shards: world.shards,
      clearedZones: [...world.clearedZones],
      currentZone: world.currentZone,
      combat: world.combat ? {
        enemy: world.combat.enemy,
        currentTurn: world.combat.currentTurn,
      } : null,
      combatLog: world.combatLog.slice(-30),
      chatLog: world.chatLog.slice(-50),
    },
    players: getPublicPlayers(),
    playerCount: sessions.size,
    maxPlayers: MAX_PLAYERS,
  };
}

function addCombatLog(msg, type = 'system') {
  world.combatLog.push({ msg, type, ts: Date.now() });
  if (world.combatLog.length > 100) world.combatLog.shift();
}

function addChat(playerName, msg) {
  world.chatLog.push({ playerName, msg, ts: Date.now() });
  if (world.chatLog.length > 100) world.chatLog.shift();
}

// ─────────────────────────────────────────────
// GAME LOGIC
// ─────────────────────────────────────────────
function initPlayer(id, name, cls, portrait) {
  const C = CLASSES[cls];
  return {
    id, name, cls, portrait,
    level: 1, xp: 0, xpNext: 100,
    hp: C.maxHp, maxHp: C.maxHp,
    mp: C.maxMp, maxMp: C.maxMp,
    atk: C.atk, def: C.def, gold: 10,
    inventory: [], ready: false,
  };
}

function checkAllReady() {
  const joined = [...sessions.values()].filter(s => s.player !== null);
  if (joined.length < 1) return false;
  return joined.every(s => s.player.ready);
}

function startAdventure() {
  world.phase = 'adventure';
  world.shards = 0;
  world.clearedZones.clear();
  world.combatLog = [];
  world.votes = {};
  addCombatLog('⚔️ The Eternal Quest begins! Collect all 5 Shards to seal the Rift!', 'system');
  broadcastAll(worldSnapshot());
}

function voteForZone(sessionId, zoneId) {
  if (!ZONES.includes(zoneId) || world.clearedZones.has(zoneId)) return;
  if (!world.votes[zoneId]) world.votes[zoneId] = new Set();
  // Remove player's previous votes
  for (const [z, voters] of Object.entries(world.votes)) voters.delete(sessionId);
  world.votes[zoneId].add(sessionId);

  // Check majority
  const needed = Math.ceil(sessions.size / 2);
  const votes = world.votes[zoneId]?.size || 0;
  addCombatLog(`🗳️ Vote: ${sessions.get(sessionId)?.player.name} → ${ZONE_NAMES[zoneId]} (${votes}/${needed} needed)`, 'system');

  if (votes >= needed) enterZone(zoneId);
  else broadcastAll(worldSnapshot());
}

function enterZone(zoneId) {
  world.currentZone = zoneId;
  world.phase = 'combat';
  world.votes = {};

  const template = ENEMIES[ZONE_ENEMY[zoneId]];
  world.combat = {
    enemy: { ...template }, // fresh copy
    turnQueue: [...sessions.keys()],
    currentTurn: 0,
    stunned: false,
  };

  addCombatLog(`${ZONE_EMOJI[zoneId]} The party enters ${ZONE_NAMES[zoneId]}!`, 'system');
  addCombatLog(`⚔️ ${template.name} appears! HP: ${template.hp}`, 'system');
  broadcastAll(worldSnapshot());
}

function nextTurn() {
  // Remove dead/disconnected from queue
  world.combat.turnQueue = world.combat.turnQueue.filter(sid => {
    const s = sessions.get(sid);
    return s && s.player.hp > 0;
  });
  if (world.combat.turnQueue.length === 0) {
    // All players dead — retreat
    addCombatLog('💀 All heroes fell... The party retreats to lick their wounds.', 'system');
    world.phase = 'adventure';
    world.combat = null;
    world.currentZone = null;
    // Restore half HP
    for (const s of sessions.values()) {
      if (!s.player) continue;
      s.player.hp = Math.max(1, Math.floor(s.player.maxHp * 0.4));
      s.player.mp = Math.max(0, Math.floor(s.player.maxMp * 0.4));
    }
    broadcastAll(worldSnapshot());
    return;
  }
  world.combat.currentTurn = (world.combat.currentTurn) % world.combat.turnQueue.length;
  // Announce whose turn
  const currentSid = world.combat.turnQueue[world.combat.currentTurn];
  const s = sessions.get(currentSid);
  if (s) addCombatLog(`🎯 It's ${s.player.name}'s turn!`, 'system');
  broadcastAll(worldSnapshot());
}

function performAction(sessionId, action, data) {
  const combat = world.combat;
  if (!combat) return;

  const queue = combat.turnQueue;
  const currentSid = queue[combat.currentTurn];
  if (currentSid !== sessionId) {
    send(sessions.get(sessionId)?.ws, { type: 'error', msg: "It's not your turn!" });
    return;
  }

  const sess = sessions.get(sessionId);
  if (!sess) return;
  const player = sess.player;
  const enemy = combat.enemy;
  const C = CLASSES[player.cls];

  let actionDone = false;

  if (action === 'attack') {
    const dmg = Math.max(1, player.atk - enemy.def + rng(-3, 5));
    enemy.hp = Math.max(0, enemy.hp - dmg);
    addCombatLog(`${C.emoji} ${player.name} attacks ${enemy.name} for ${dmg} damage!`, 'player');
    actionDone = true;
  } else if (action === 'skill1') {
    if (player.mp < C.skillMp[0]) { send(sess.ws, { type: 'error', msg: 'Not enough MP!' }); return; }
    player.mp -= C.skillMp[0];
    const dmg = Math.max(1, C.skillDmg[0] - enemy.def + rng(-2, 4));
    enemy.hp = Math.max(0, enemy.hp - dmg);
    addCombatLog(`✨ ${player.name} uses ${C.skills[0]} for ${dmg} damage!`, 'player');
    actionDone = true;
  } else if (action === 'skill2') {
    if (player.mp < C.skillMp[1]) { send(sess.ws, { type: 'error', msg: 'Not enough MP!' }); return; }
    player.mp -= C.skillMp[1];
    if (C.skillDmg[1] > 0) {
      const dmg = Math.max(1, C.skillDmg[1] - enemy.def + rng(-2, 3));
      enemy.hp = Math.max(0, enemy.hp - dmg);
      addCombatLog(`✨ ${player.name} uses ${C.skills[1]} for ${dmg} damage!`, 'player');
    } else {
      // Utility skill
      if (player.cls === 'warrior') { player.def += 3; addCombatLog(`🛡️ ${player.name} uses Shield Bash! +3 DEF!`, 'heal'); }
      else if (player.cls === 'rogue') { combat.stunned = true; addCombatLog(`💨 ${player.name} uses Smoke Bomb! Enemy stunned next turn!`, 'heal'); }
      else if (player.cls === 'ranger') { const gain = Math.min(30, player.maxHp - player.hp); player.hp += gain; addCombatLog(`🌿 ${player.name} uses Nature's Heal! +${gain} HP!`, 'heal'); }
    }
    actionDone = true;
  } else if (action === 'use_potion') {
    const idx = player.inventory.findIndex(i => i === 'healthPotion');
    if (idx === -1) { send(sess.ws, { type: 'error', msg: 'No health potions!' }); return; }
    player.inventory.splice(idx, 1);
    const gain = Math.min(50, player.maxHp - player.hp);
    player.hp += gain;
    addCombatLog(`🧪 ${player.name} drinks a Health Potion! +${gain} HP!`, 'heal');
    actionDone = true;
  } else if (action === 'use_mana_potion') {
    const idx = player.inventory.findIndex(i => i === 'manaPotion');
    if (idx === -1) { send(sess.ws, { type: 'error', msg: 'No mana potions!' }); return; }
    player.inventory.splice(idx, 1);
    const gain = Math.min(30, player.maxMp - player.mp);
    player.mp += gain;
    addCombatLog(`💧 ${player.name} drinks a Mana Potion! +${gain} MP!`, 'heal');
    actionDone = true;
  } else if (action === 'pass') {
    addCombatLog(`😶 ${player.name} passes their turn.`, 'system');
    actionDone = true;
  }

  if (!actionDone) return;

  // Check enemy death
  if (enemy.hp <= 0) {
    combatVictory();
    return;
  }

  // Enemy attacks — find lowest HP player
  if (combat.stunned) {
    addCombatLog(`😵 ${enemy.name} is stunned and misses!`, 'enemy');
    combat.stunned = false;
  } else {
    const targets = [...sessions.values()].filter(s => s.player && s.player.hp > 0);
    if (targets.length > 0) {
      const target = targets[rng(0, targets.length - 1)];
      const atkDmg = Math.max(1, enemy.atk - target.player.def + rng(-3, 5));
      target.player.hp = Math.max(0, target.player.hp - atkDmg);
      addCombatLog(`💥 ${enemy.name} attacks ${target.player.name} for ${atkDmg} damage!`, 'enemy');
      if (target.player.hp === 0) {
        addCombatLog(`💀 ${target.player.name} is knocked out!`, 'system');
      }
    }
  }

  // Advance turn
  combat.currentTurn = (combat.currentTurn + 1) % queue.length;
  nextTurn();
}

function combatVictory() {
  const zone = world.currentZone;
  const enemy = world.combat.enemy;
  const xpGain = Math.floor(enemy.xp / Math.max(1, sessions.size * 0.6));
  const goldGain = Math.floor(enemy.gold / Math.max(1, sessions.size * 0.6));

  addCombatLog(`🎉 ${enemy.name} is defeated!`, 'system');
  addCombatLog(`💎 Shard recovered from ${ZONE_NAMES[zone]}!`, 'system');
  addCombatLog(`✨ Each hero gains ${xpGain} XP and ${goldGain} gold!`, 'system');

  world.shards++;
  world.clearedZones.add(zone);
  world.combat = null;
  world.currentZone = null;

  // Reward all players
  for (const s of sessions.values()) {
    if (!s.player) continue;
    const p = s.player;
    p.xp += xpGain;
    p.gold += goldGain;
    // Restore some HP after battle
    p.hp = Math.min(p.maxHp, p.hp + Math.floor(p.maxHp * 0.25));
    // Random loot
    if (Math.random() < 0.4) { p.inventory.push('healthPotion'); addCombatLog(`🧪 ${p.name} finds a Health Potion!`, 'item'); }
    if (Math.random() < 0.25) { p.inventory.push('manaPotion'); addCombatLog(`💧 ${p.name} finds a Mana Potion!`, 'item'); }
    // Level up check
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level++;
      p.maxHp += 12; p.hp = p.maxHp;
      p.maxMp += 8; p.mp = p.maxMp;
      p.atk += 3; p.def += 2;
      p.xpNext = Math.floor(p.xpNext * 1.4);
      addCombatLog(`🌟 ${p.name} reached Level ${p.level}!`, 'system');
    }
  }

  if (world.shards >= 5) {
    world.phase = 'victory';
    addCombatLog('🏆 ALL FIVE SHARDS RESTORED! The Rift is sealed! Aethoria is saved!', 'system');
  } else {
    world.phase = 'adventure';
    addCombatLog(`🗺️ ${5 - world.shards} shard(s) remain. Vote for the next zone!`, 'system');
  }

  broadcastAll(worldSnapshot());
}

function restPlayer(sessionId) {
  if (world.phase !== 'adventure') return;
  const s = sessions.get(sessionId);
  if (!s) return;
  const p = s.player;
  if (!p) return;
  p.hp = p.maxHp;
  p.mp = p.maxMp;
  addCombatLog(`💤 ${p.name} rests and fully recovers!`, 'heal');
  broadcastAll(worldSnapshot());
}

function resetGame() {
  world.phase = 'lobby';
  world.shards = 0;
  world.clearedZones.clear();
  world.combat = null;
  world.currentZone = null;
  world.combatLog = [];
  world.votes = {};
  for (const s of sessions.values()) {
    if (!s.player) continue;
    const C = CLASSES[s.player.cls];
    s.player.hp = C.maxHp; s.player.maxHp = C.maxHp;
    s.player.mp = C.maxMp; s.player.maxMp = C.maxMp;
    s.player.atk = C.atk; s.player.def = C.def;
    s.player.level = 1; s.player.xp = 0; s.player.xpNext = 100;
    s.player.gold = 10; s.player.inventory = []; s.player.ready = false;
  }
  addCombatLog('🔄 The realm resets. A new quest begins!', 'system');
  broadcastAll(worldSnapshot());
}

// ─────────────────────────────────────────────
// SESSION CLEANUP
// ─────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [sid, sess] of sessions) {
    if (now - sess.lastSeen > SESSION_TTL_MS || sess.ws.readyState !== WebSocket.OPEN) {
      const name = sess.player?.name || 'A hero';
      sessions.delete(sid);
      addCombatLog(`🚪 ${name} has left the realm.`, 'system');
      broadcastAll(worldSnapshot());
    }
  }
}, 30_000);

// ─────────────────────────────────────────────
// WEBSOCKET HANDLING
// ─────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  if (sessions.size >= MAX_PLAYERS) {
    send(ws, { type: 'lobby_full', playerCount: sessions.size, maxPlayers: MAX_PLAYERS });
    ws.close();
    return;
  }

  const sessionId = uuidv4();
  // Placeholder session until join
  sessions.set(sessionId, { ws, player: null, lastSeen: Date.now() });

  send(ws, { type: 'session_init', sessionId, playerCount: sessions.size, maxPlayers: MAX_PLAYERS });
  send(ws, worldSnapshot());

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const sess = sessions.get(sessionId);
    if (!sess) return;
    sess.lastSeen = Date.now();

    switch (msg.type) {

      case 'join': {
        if (!msg.name || !msg.cls || !CLASSES[msg.cls]) return;
        const portrait = msg.portrait || '';
        sess.player = initPlayer(sessionId, msg.name.slice(0, 24), msg.cls, portrait);
        addCombatLog(`⚔️ ${sess.player.name} the ${msg.cls} joins the realm!`, 'system');
        broadcastAll(worldSnapshot());
        break;
      }

      case 'ready': {
        if (!sess.player) return;
        sess.player.ready = !sess.player.ready;
        addCombatLog(`${sess.player.ready ? '✅' : '❌'} ${sess.player.name} is ${sess.player.ready ? 'ready' : 'not ready'}.`, 'system');
        broadcastAll(worldSnapshot());
        break;
      }

      case 'start_game': {
        if (!sess.player || world.phase !== 'lobby') return;
        if (!checkAllReady() || sessions.size < 1) {
          send(ws, { type: 'error', msg: 'Not all heroes are ready yet!' });
          return;
        }
        startAdventure();
        break;
      }

      case 'vote_zone': {
        if (!sess.player || world.phase !== 'adventure') return;
        voteForZone(sessionId, msg.zoneId);
        break;
      }

      case 'combat_action': {
        if (!sess.player || world.phase !== 'combat') return;
        performAction(sessionId, msg.action, msg.data);
        break;
      }

      case 'rest': {
        restPlayer(sessionId);
        break;
      }

      case 'chat': {
        if (!sess.player || !msg.text) return;
        const text = String(msg.text).slice(0, 200);
        addChat(sess.player.name, text);
        broadcastAll(worldSnapshot());
        break;
      }

      case 'ping': {
        send(ws, { type: 'pong' });
        break;
      }

      case 'reset_game': {
        if (!sess.player) return;
        resetGame();
        break;
      }
    }
  });

  ws.on('close', () => {
    const s = sessions.get(sessionId);
    const name = s?.player?.name || 'A hero';
    sessions.delete(sessionId);
    // If in combat and it was their turn, advance
    if (world.phase === 'combat' && world.combat) {
      world.combat.turnQueue = world.combat.turnQueue.filter(sid => sid !== sessionId);
      if (world.combat.turnQueue.length === 0) {
        world.phase = 'adventure';
        world.combat = null;
        world.currentZone = null;
        addCombatLog('💀 All heroes have left. Combat cancelled.', 'system');
      } else {
        world.combat.currentTurn = world.combat.currentTurn % world.combat.turnQueue.length;
      }
    }
    addCombatLog(`🚪 ${name} has left the realm.`, 'system');
    broadcastAll(worldSnapshot());
  });

  ws.on('error', () => {});
});

// ─────────────────────────────────────────────
// EXPRESS
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => {
  console.log(`⚔️  Eternal Quest server running on port ${PORT}`);
});
