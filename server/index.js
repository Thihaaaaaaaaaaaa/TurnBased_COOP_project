const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/dist')));

const PORT = process.env.PORT || 3001;
const server = require('http').createServer(app);
const wss = new WebSocketServer({ server });

// ─── Rooms ──────────────────────────────────────────────────────────────────
// Each room is a self-contained game. `gameState` always points at the room
// currently being operated on; timer callbacks re-point it via withRoom().
const rooms = new Map(); // code -> room

let gameState = null; // active room pointer

function makeRoom(code) {
  return {
    code,
    phase: 'lobby',        // lobby | roleselect | day | night | rps | gameover
    players: {},           // id -> player object
    host: null,
    round: 0,
    dayTimer: null,
    nightTimers: {},
    config: { killers: 1, doctors: 1, detectives: 1 },
    votes: {},
    skipVotes: new Set(),
    nightActions: {},
    pendingNightActions: new Set(),
    deadThisNight: [],
    savedThisNight: [],
    rpsState: null,
    forensicUsed: {},
    geminiScheduled: [],
    bayHarborCooldown: {},
    surgeonCooldown: {},
    policeCooldown: {},
    policeTargets: {},
    protected: new Set(),
    gameLog: [],
    chatLog: [],            // { name, msg, channel: 'town'|'ghost', time }
    sessionExpireTimer: null,
    playerCategory: {},
    selectedVariant: {},
    pendingSelection: new Set(),
    selectionTimer: null,
    rpsTimeout: null,
    winner: null,
    phaseEndsAt: null,
  };
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

// Run fn with gameState pointed at the given room. Restores prior pointer after.
function withRoom(room, fn) {
  if (!room || !rooms.has(room.code)) return; // room was torn down
  const prev = gameState;
  gameState = room;
  try { fn(); } finally { gameState = prev; }
}

function resetGame() {
  // Re-initialize the ACTIVE room in place, preserving its code.
  clearAllTimers();
  const code = gameState.code;
  const fresh = makeRoom(code);
  // copy fresh fields onto existing object so references (rooms map) stay valid
  Object.keys(gameState).forEach(k => { delete gameState[k]; });
  Object.assign(gameState, fresh);
}

function destroyRoom(room) {
  if (!room) return;
  withRoom(room, () => clearAllTimers());
  rooms.delete(room.code);
  console.log(`Room ${room.code} destroyed.`);
}

function clearAllTimers() {
  if (gameState.dayTimer) clearTimeout(gameState.dayTimer);
  if (gameState.selectionTimer) clearTimeout(gameState.selectionTimer);
  if (gameState.rpsTimeout) clearTimeout(gameState.rpsTimeout);
  Object.values(gameState.nightTimers).forEach(t => clearTimeout(t));
  if (gameState.sessionExpireTimer) clearTimeout(gameState.sessionExpireTimer);
}

// ─── Role Definitions ─────────────────────────────────────────────────────────
const ROLES = {
  CIVILIAN: { team: 'good', variant: null },
  NORMAL_KILLER: { team: 'killer', variant: 'normal' },
  GEMINI_KILLER: { team: 'killer', variant: 'gemini' },
  BAY_HARBOR: { team: 'killer', variant: 'bayharbor' },
  NORMAL_DOCTOR: { team: 'good', variant: 'normal' },
  SURGEON: { team: 'good', variant: 'surgeon' },
  POLICE: { team: 'good', variant: 'police' },
  NORMAL_DETECTIVE: { team: 'good', variant: 'normal' },
  SHERIFF: { team: 'good', variant: 'sheriff' },
  FORENSIC: { team: 'good', variant: 'forensic' },
};

// ─── Broadcast Helpers ────────────────────────────────────────────────────────
function broadcast(data, excludeId = null) {
  const msg = JSON.stringify(data);
  Object.entries(gameState.players).forEach(([id, p]) => {
    if (id !== excludeId && p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msg);
    }
  });
}

function sendTo(playerId, data) {
  const p = gameState.players[playerId];
  if (p && p.ws && p.ws.readyState === WebSocket.OPEN) {
    p.ws.send(JSON.stringify(data));
  }
}

function broadcastGameState() {
  const publicState = buildPublicState();
  Object.entries(gameState.players).forEach(([id, p]) => {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) {
      const privateState = buildPrivateState(id);
      p.ws.send(JSON.stringify({
        type: 'STATE_UPDATE',
        state: { ...publicState, ...privateState }
      }));
    }
  });
}

function buildPublicState() {
  const players = Object.entries(gameState.players).map(([id, p]) => ({
    id,
    name: p.name,
    alive: p.alive,
    ready: p.ready,
    isHost: id === gameState.host,
    eliminated: p.eliminated || false,
    revived: p.revived || false,
  }));
  return {
    phase: gameState.phase,
    players,
    round: gameState.round,
    config: gameState.config,
    gameLog: gameState.gameLog.slice(-20),
    rpsState: gameState.rpsState ? {
      active: gameState.rpsState.active,
      choices: {
        [gameState.rpsState.sheriffId]: gameState.rpsState.choices[gameState.rpsState.sheriffId] ? '?' : null,
        [gameState.rpsState.killerId]: gameState.rpsState.choices[gameState.rpsState.killerId] ? '?' : null,
      },
      result: gameState.rpsState.result,
    } : null,
    winner: gameState.winner || null,
    skipVoteCount: gameState.skipVotes.size,
    skipVoteRequired: Math.ceil(alivePlayers().length / 2),
    phaseEndsAt: gameState.phaseEndsAt || null,
    roomCode: gameState.code,
    voteCounts: (() => {
      const t = {};
      Object.values(gameState.votes || {}).forEach(v => { t[v] = (t[v] || 0) + 1; });
      return t;
    })(),
  };
}

function buildPrivateState(playerId) {
  const p = gameState.players[playerId];
  if (!p) return {};
  const state = {
    myRole: p.role,
    myId: playerId,
    pendingAction: gameState.pendingNightActions.has(playerId),
    policeTarget: gameState.policeTargets[playerId] || null,
    forensicUsed: gameState.forensicUsed[playerId] || false,
    forensicDoubleCheck: p.forensicDoubleCheck || false,
    bayHarborCooldownActive: isBayHarborOnCooldown(playerId),
    surgeonCooldownActive: isSurgeonOnCooldown(playerId),
    policeCooldownActive: isPolicOnCooldown(playerId),
    // Role selection
    myCategory: gameState.playerCategory[playerId] || null,
    mySelectedVariant: gameState.selectedVariant[playerId] || null,
    availableVariants: gameState.phase === 'roleselect' ? availableVariantsFor(playerId) : [],
    pendingSelection: gameState.pendingSelection.has(playerId),
    selectionWaitingCount: gameState.pendingSelection.size,
  };
  // Killers can see each other (only once roles are finalized)
  if (ROLES[p.role]?.team === 'killer') {
    state.killerTeam = Object.entries(gameState.players)
      .filter(([id, pl]) => ROLES[pl.role]?.team === 'killer' && id !== playerId)
      .map(([id, pl]) => ({ id, name: pl.name }));
  }
  // Chat: living players see town chat; dead players see town + ghost chat
  const isDead = !p.alive;
  state.chatLog = gameState.chatLog
    .filter(c => c.channel === 'town' || (isDead && c.channel === 'ghost'))
    .slice(-50);
  state.canGhostChat = isDead;
  return state;
}

function alivePlayers() {
  return Object.entries(gameState.players).filter(([, p]) => p.alive);
}

function aliveCount() { return alivePlayers().length; }

function killerCount() {
  return alivePlayers().filter(([, p]) => ROLES[p.role]?.team === 'killer').length;
}

function goodCount() {
  return alivePlayers().filter(([, p]) => ROLES[p.role]?.team === 'good').length;
}

function addLog(msg) {
  gameState.gameLog.push({ msg, time: Date.now() });
}

// ─── Role Assignment ──────────────────────────────────────────────────────────
const KILLER_VARIANTS = ['NORMAL_KILLER', 'GEMINI_KILLER', 'BAY_HARBOR'];
const DOCTOR_VARIANTS = ['NORMAL_DOCTOR', 'SURGEON', 'POLICE'];
const DETECTIVE_VARIANTS = ['NORMAL_DETECTIVE', 'SHERIFF', 'FORENSIC'];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function assignRoles() {
  const { killers, doctors, detectives } = gameState.config;
  const playerIds = Object.keys(gameState.players);
  const total = playerIds.length;
  const specialCount = killers + doctors + detectives;

  if (specialCount > total) return false;

  // Build category list: assign each special player a CATEGORY (not a variant yet)
  const categories = [];
  for (let i = 0; i < killers; i++) categories.push('killer');
  for (let i = 0; i < doctors; i++) categories.push('doctor');
  for (let i = 0; i < detectives; i++) categories.push('detective');
  while (categories.length < total) categories.push('civilian');

  const shuffledCats = shuffle(categories);
  const shuffledIds = shuffle([...playerIds]);

  // Reset selection state
  gameState.playerCategory = {};   // id -> 'killer'|'doctor'|'detective'|'civilian'
  gameState.selectedVariant = {};  // id -> chosen variant string
  gameState.pendingSelection = new Set();

  shuffledIds.forEach((id, i) => {
    const cat = shuffledCats[i];
    gameState.players[id].alive = true;
    gameState.players[id].eliminated = false;
    gameState.playerCategory[id] = cat;
    if (cat === 'civilian') {
      gameState.players[id].role = 'CIVILIAN';
      gameState.selectedVariant[id] = 'CIVILIAN';
    } else {
      gameState.players[id].role = null; // chosen in roleselect phase
      gameState.pendingSelection.add(id);
    }
  });
  return true;
}

const CATEGORY_VARIANTS = {
  killer: KILLER_VARIANTS,
  doctor: DOCTOR_VARIANTS,
  detective: DETECTIVE_VARIANTS,
};

// Which variants in a player's category are still free (not taken by a same-category player)?
function availableVariantsFor(playerId) {
  const cat = gameState.playerCategory[playerId];
  if (!cat || cat === 'civilian') return [];
  const all = CATEGORY_VARIANTS[cat];
  const takenByOthers = Object.entries(gameState.selectedVariant)
    .filter(([id]) => id !== playerId && gameState.playerCategory[id] === cat)
    .map(([, v]) => v);
  return all.filter(v => !takenByOthers.includes(v));
}

// When all special players have locked a variant, finalize and start the game
function checkSelectionComplete() {
  const room = gameState;
  if (gameState.pendingSelection.size === 0) {
    if (gameState.selectionTimer) { clearTimeout(gameState.selectionTimer); gameState.selectionTimer = null; }
    // Apply chosen variants to player roles
    Object.entries(gameState.selectedVariant).forEach(([id, variant]) => {
      if (gameState.players[id]) gameState.players[id].role = variant;
    });
    addLog(`🎲 All roles are locked in. The reckoning begins!`);
    broadcast({ type: 'SELECTION_COMPLETE' });
    setTimeout(() => withRoom(room, () => startDay()), 1500);
    return true;
  }
  broadcastGameState();
  return false;
}

// Auto-pick a random available variant for anyone who didn't choose in time
function autoPickRemaining() {
  gameState.pendingSelection.forEach(id => {
    const avail = availableVariantsFor(id);
    const pick = avail[Math.floor(Math.random() * avail.length)] || CATEGORY_VARIANTS[gameState.playerCategory[id]][0];
    gameState.selectedVariant[id] = pick;
    addLog(`⏳ ${gameState.players[id]?.name} let fate decide their path.`);
  });
  gameState.pendingSelection = new Set();
  checkSelectionComplete();
}

const ROLE_SELECT_DURATION = 25000;

function startRoleSelection() {
  const room = gameState;
  gameState.phase = 'roleselect';
  addLog(`📜 Special roles, choose your path...`);
  broadcast({ type: 'PHASE_CHANGE', phase: 'roleselect', duration: ROLE_SELECT_DURATION });
  broadcastGameState();

  if (gameState.pendingSelection.size === 0) {
    setTimeout(() => withRoom(room, () => checkSelectionComplete()), 500);
    return;
  }
  gameState.selectionTimer = setTimeout(() => withRoom(room, () => autoPickRemaining()), ROLE_SELECT_DURATION);
}

// ─── Cooldown Helpers ─────────────────────────────────────────────────────────
function isBayHarborOnCooldown(id) {
  const last = gameState.bayHarborCooldown[id];
  return last !== undefined && gameState.round - last < 2;
}
function isSurgeonOnCooldown(id) {
  const last = gameState.surgeonCooldown[id];
  return last !== undefined && gameState.round - last < 2;
}
function isPolicOnCooldown(id) {
  const last = gameState.policeCooldown[id];
  return last !== undefined && gameState.round - last < 1;
}

// ─── Check Win Conditions ─────────────────────────────────────────────────────
function checkWinCondition() {
  const kCount = killerCount();
  const gCount = goodCount();

  if (kCount === 0) {
    endGame('good', 'The town has eliminated all killers! Justice prevails!');
    return true;
  }
  if (kCount >= gCount) {
    // Check for Sheriff standoff
    const aliveSheriff = alivePlayers().find(([, p]) => p.role === 'SHERIFF');
    const aliveKiller = alivePlayers().find(([, p]) => ROLES[p.role]?.team === 'killer');
    if (aliveCount() === 2 && aliveSheriff && aliveKiller) {
      startRPS(aliveSheriff[0], aliveKiller[0]);
      return true;
    }
    endGame('killer', 'The killers have taken over the town. Nobody is safe!');
    return true;
  }
  return false;
}

function endGame(winner, reason) {
  clearAllTimers();
  gameState.phase = 'gameover';
  gameState.winner = winner;
  addLog(`🏁 ${reason}`);
  // Reveal all roles
  const roleReveal = Object.entries(gameState.players).map(([id, p]) => ({
    id, name: p.name, role: p.role, alive: p.alive
  }));
  broadcast({ type: 'GAME_OVER', winner, reason, roleReveal });
  broadcastGameState();
}

// ─── Day Phase ────────────────────────────────────────────────────────────────
const DAY_DURATION = 30000;

function startDay() {
  gameState.phase = 'day';
  gameState.round++;
  gameState.votes = {};
  gameState.skipVotes = new Set();
  gameState.policeTargets = {};

  // Process Gemini kills
  const toExecute = gameState.geminiScheduled.filter(g => g.roundToExecute === gameState.round);
  gameState.geminiScheduled = gameState.geminiScheduled.filter(g => g.roundToExecute !== gameState.round);
  toExecute.forEach(({ targetId }) => {
    const target = gameState.players[targetId];
    if (target && target.alive) {
      if (!gameState.protected.has(targetId)) {
        target.alive = false;
        addLog(`💀 ${target.name} was found dead — a delayed Gemini kill.`);
      } else {
        addLog(`🛡️ ${target.name} was protected from a Gemini kill!`);
      }
    }
  });
  gameState.protected = new Set();

  addLog(`☀️ Day ${gameState.round} begins. Discuss and vote!`);
  gameState.phaseEndsAt = Date.now() + DAY_DURATION;
  broadcastGameState();
  broadcast({ type: 'PHASE_CHANGE', phase: 'day', round: gameState.round, duration: DAY_DURATION });

  if (checkWinCondition()) return;

  const room = gameState;
  gameState.dayTimer = setTimeout(() => withRoom(room, () => endDay()), DAY_DURATION);
}

function endDay() {
  if (gameState.dayTimer) clearTimeout(gameState.dayTimer);

  // Tally votes
  const tally = {};
  Object.values(gameState.votes).forEach(v => { tally[v] = (tally[v] || 0) + 1; });
  let maxVotes = 0;
  let eliminated = null;
  Object.entries(tally).forEach(([id, count]) => {
    if (count > maxVotes) { maxVotes = count; eliminated = id; }
  });

  if (eliminated && gameState.players[eliminated]) {
    const p = gameState.players[eliminated];
    p.alive = false;
    p.eliminated = true;
    addLog(`🪓 ${p.name} was eliminated by the town's vote!`);
    broadcast({ type: 'PLAYER_ELIMINATED', playerId: eliminated, playerName: p.name });
  } else {
    addLog(`🤷 No consensus — no one was eliminated today.`);
  }

  if (checkWinCondition()) return;
  startNight();
}

// ─── Night Phase ──────────────────────────────────────────────────────────────
const NIGHT_ACTION_TIMEOUT = 25000;

function startNight() {
  gameState.phase = 'night';
  gameState.nightActions = {};
  gameState.deadThisNight = [];
  gameState.savedThisNight = [];
  gameState.pendingNightActions = new Set();

  // Determine who needs to act
  alivePlayers().forEach(([id, p]) => {
    const role = p.role;
    if (role && role !== 'CIVILIAN') {
      gameState.pendingNightActions.add(id);
    }
  });

  addLog(`🌙 Night ${gameState.round} falls. Special roles, take your actions...`);
  gameState.phaseEndsAt = Date.now() + NIGHT_ACTION_TIMEOUT;
  broadcastGameState();
  broadcast({ type: 'PHASE_CHANGE', phase: 'night', round: gameState.round, duration: NIGHT_ACTION_TIMEOUT });

  // Set timers for each player
  const room = gameState;
  gameState.pendingNightActions.forEach(id => {
    gameState.nightTimers[id] = setTimeout(() => withRoom(room, () => {
      if (gameState.pendingNightActions.has(id)) {
        gameState.nightActions[id] = { action: 'skip' };
        gameState.pendingNightActions.delete(id);
        addLog(`⏭️ ${gameState.players[id]?.name} ran out of time and skipped.`);
        checkNightComplete();
      }
    }), NIGHT_ACTION_TIMEOUT);
  });

  if (gameState.pendingNightActions.size === 0) {
    setTimeout(() => withRoom(room, () => resolveNight()), 500);
  }
}

function checkNightComplete() {
  const room = gameState;
  if (gameState.pendingNightActions.size === 0) {
    Object.values(gameState.nightTimers).forEach(t => clearTimeout(t));
    gameState.nightTimers = {};
    setTimeout(() => withRoom(room, () => resolveNight()), 1500);
  }
  broadcastGameState();
}

function resolveNight() {
  const actions = gameState.nightActions;

  // 1. Apply Police protections (set during day)
  Object.entries(gameState.policeTargets).forEach(([, targetId]) => {
    gameState.protected.add(targetId);
  });

  // 2. Apply Doctor protections
  alivePlayers().forEach(([id, p]) => {
    if (p.role === 'NORMAL_DOCTOR' || p.role === 'SURGEON') {
      const act = actions[id];
      if (act && act.action === 'protect' && act.target) {
        gameState.protected.add(act.target);
        addLog(`🩺 Someone was protected tonight...`);
      }
    }
  });

  // 3. Resolve Surgeon revives
  alivePlayers().forEach(([id, p]) => {
    if (p.role === 'SURGEON') {
      const act = actions[id];
      if (act && act.action === 'revive' && act.target && !isSurgeonOnCooldown(id)) {
        const target = gameState.players[act.target];
        if (target && !target.alive) {
          target.alive = true;
          target.revived = true;
          gameState.surgeonCooldown[id] = gameState.round;
          addLog(`💉 ${target.name} was brought back from the dead!`);
        }
      }
    }
  });

  // 4. Resolve Killer actions
  alivePlayers().forEach(([id, p]) => {
    const act = actions[id];
    if (!act || act.action === 'skip') return;

    if (p.role === 'NORMAL_KILLER' && act.action === 'kill') {
      executeKill(act.target, id);
    }
    if (p.role === 'GEMINI_KILLER' && act.action === 'schedule') {
      const delay = Math.min(2, Math.max(1, act.delay || 1));
      gameState.geminiScheduled.push({
        killerId: id,
        targetId: act.target,
        roundToExecute: gameState.round + delay,
      });
      addLog(`⏳ A killer has scheduled something sinister...`);
    }
    if (p.role === 'BAY_HARBOR' && act.action === 'kill' && !isBayHarborOnCooldown(id)) {
      executeKill(act.target, id);
      gameState.bayHarborCooldown[id] = gameState.round;
    }
  });

  // 5. Detective investigations (private)
  alivePlayers().forEach(([id, p]) => {
    const act = actions[id];
    if (!act || act.action !== 'investigate') return;

    let checksCount = 1;
    if (p.role === 'FORENSIC' && p.forensicDoubleCheck) checksCount = 2;
    if (p.role === 'BAY_HARBOR' && act.action === 'investigate') checksCount = 1;

    const targets = act.targets || [act.target];
    const results = targets.slice(0, checksCount).map(tid => {
      const t = gameState.players[tid];
      if (!t) return null;
      return { id: tid, name: t.name, role: t.role, team: ROLES[t.role]?.team };
    }).filter(Boolean);

    sendTo(id, { type: 'INVESTIGATE_RESULT', results, round: gameState.round });
    addLog(`🔍 A detective made their move tonight...`);
  });

  // 6. Forensic one-time guess result
  alivePlayers().forEach(([id, p]) => {
    const act = actions[id];
    if (p.role === 'FORENSIC' && act && act.action === 'forensic_guess' && !gameState.forensicUsed[id]) {
      gameState.forensicUsed[id] = true;
      const killerAlive = alivePlayers().find(([, pl]) => ROLES[pl.role]?.team === 'killer');
      if (killerAlive) {
        const correct = killerAlive[1].role === act.guess;
        if (correct) {
          p.forensicDoubleCheck = true;
          sendTo(id, { type: 'FORENSIC_RESULT', correct: true, message: 'Your forensic instincts were right! You can now check 2 roles per night.' });
        } else {
          sendTo(id, { type: 'FORENSIC_RESULT', correct: false, message: 'Wrong variant. Your forensic guess failed — you\'re now a standard detective.' });
        }
      }
    }
  });

  if (checkWinCondition()) return;
  const room = gameState;
  setTimeout(() => withRoom(room, () => startDay()), 3000);
}

function executeKill(targetId, killerId) {
  const target = gameState.players[targetId];
  if (!target || !target.alive) return;
  if (gameState.protected.has(targetId)) {
    addLog(`🛡️ ${target.name} was targeted but survived the night!`);
    return;
  }
  target.alive = false;
  addLog(`🩸 ${target.name} was found dead at dawn.`);
  broadcast({ type: 'PLAYER_KILLED', playerId: targetId, playerName: target.name });
}

// ─── RPS Showdown ─────────────────────────────────────────────────────────────
function startRPS(sheriffId, killerId) {
  gameState.phase = 'rps';
  gameState.rpsState = {
    active: true,
    sheriffId,
    killerId,
    choices: {},
    result: null,
    round: 1,
  };
  addLog(`🤠 SHOWDOWN! Sheriff vs Killer — Rock Paper Scissors!`);
  broadcast({ type: 'RPS_START', sheriffId, killerName: gameState.players[killerId]?.name });
  broadcastGameState();

  // Auto-timeout for RPS
  const room = gameState;
  gameState.rpsTimeout = setTimeout(() => withRoom(room, () => {
    if (!gameState.rpsState.choices[sheriffId]) gameState.rpsState.choices[sheriffId] = 'rock';
    if (!gameState.rpsState.choices[killerId]) gameState.rpsState.choices[killerId] = 'rock';
    resolveRPS();
  }), 15000);
}

function resolveRPS() {
  if (gameState.rpsTimeout) clearTimeout(gameState.rpsTimeout);
  const { sheriffId, killerId, choices } = gameState.rpsState;
  const sc = choices[sheriffId] || 'rock';
  const kc = choices[killerId] || 'rock';
  const beats = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

  let result;
  if (sc === kc) {
    result = 'tie';
    gameState.rpsState.choices = {};
    gameState.rpsState.round = (gameState.rpsState.round || 1) + 1;
    broadcast({ type: 'RPS_TIE', round: gameState.rpsState.round, sc, kc });
    broadcastGameState();
    const room = gameState;
    gameState.rpsTimeout = setTimeout(() => withRoom(room, () => {
      if (!gameState.rpsState.choices[sheriffId]) gameState.rpsState.choices[sheriffId] = 'rock';
      if (!gameState.rpsState.choices[killerId]) gameState.rpsState.choices[killerId] = 'rock';
      resolveRPS();
    }), 15000);
    return;
  }

  if (beats[sc] === kc) {
    result = 'sheriff';
    gameState.players[killerId].alive = false;
    endGame('good', `The Sheriff drew faster! ${gameState.players[sheriffId]?.name} wins the showdown!`);
  } else {
    result = 'killer';
    gameState.players[sheriffId].alive = false;
    endGame('killer', `The Killer was quicker! ${gameState.players[killerId]?.name} wins the showdown!`);
  }
  gameState.rpsState.result = result;
  gameState.rpsState.revealChoices = { sc, kc };
  broadcast({ type: 'RPS_RESULT', result, sheriffChoice: sc, killerChoice: kc });
}

// ─── Session Management ───────────────────────────────────────────────────────
function startSessionExpireTimer() {
  const room = gameState;
  if (gameState.sessionExpireTimer) clearTimeout(gameState.sessionExpireTimer);
  gameState.sessionExpireTimer = setTimeout(() => withRoom(room, () => {
    if (Object.keys(gameState.players).length === 0) {
      destroyRoom(room);
      console.log(`Room ${room.code} expired — destroyed.`);
    }
  }), 60000);
}

// ─── WebSocket Connection Handler ─────────────────────────────────────────────
wss.on('connection', (ws) => {
  const playerId = uuidv4();
  let myRoom = null; // the room this socket belongs to
  console.log(`Socket connected: ${playerId}`);

  function joinRoomAsPlayer(room, name) {
    const isHost = Object.keys(room.players).length === 0;
    room.players[playerId] = {
      id: playerId, name, ws, alive: true, ready: false, role: null, eliminated: false
    };
    if (isHost) room.host = playerId;
    if (room.sessionExpireTimer) {
      clearTimeout(room.sessionExpireTimer);
      room.sessionExpireTimer = null;
    }
    myRoom = room;
    addLog(`🤠 ${name} has ridden into town.`);
    broadcast({ type: 'PLAYER_JOINED', playerId, name, isHost });
    ws.send(JSON.stringify({ type: 'JOINED', playerId, isHost, roomCode: room.code }));
    broadcastGameState();
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Lobby-finding messages don't need an active room yet
    if (msg.type === 'CREATE_ROOM') {
      const code = generateRoomCode();
      const room = makeRoom(code);
      rooms.set(code, room);
      console.log(`Room ${code} created.`);
      withRoom(room, () => {
        const name = (msg.name || 'Stranger').slice(0, 20).trim() || 'Stranger';
        joinRoomAsPlayer(room, name);
      });
      return;
    }

    if (msg.type === 'JOIN_ROOM') {
      const code = (msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        ws.send(JSON.stringify({ type: 'ERROR', message: `No saloon with code "${code}"` }));
        return;
      }
      withRoom(room, () => {
        if (Object.keys(room.players).length >= 10) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Posse is full (10 max)' }));
          return;
        }
        if (room.phase !== 'lobby') {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'That game already started' }));
          return;
        }
        const name = (msg.name || 'Stranger').slice(0, 20).trim() || 'Stranger';
        joinRoomAsPlayer(room, name);
      });
      return;
    }

    // All other messages require the socket to be in a room
    if (!myRoom || !rooms.has(myRoom.code)) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'You are not in a game' }));
      return;
    }

    withRoom(myRoom, () => {
      switch (msg.type) {

        case 'CHAT': {
          const p = gameState.players[playerId];
          if (!p) return;
          const text = (msg.text || '').slice(0, 200).trim();
          if (!text) return;
          // Dead players post to ghost chat; living to town chat.
          // During night, living players cannot use town chat (only dead ghost-chat).
          const channel = p.alive ? 'town' : 'ghost';
          if (p.alive && gameState.phase === 'night') {
            // No talking at night for the living
            ws.send(JSON.stringify({ type: 'ERROR', message: 'The town sleeps — no talking at night' }));
            return;
          }
          gameState.chatLog.push({ name: p.name, msg: text, channel, time: Date.now(), playerId });
          if (gameState.chatLog.length > 200) gameState.chatLog = gameState.chatLog.slice(-150);
          broadcastGameState();
          break;
        }

        case 'READY': {
          const p = gameState.players[playerId];
          if (!p) return;
          p.ready = !p.ready;
          broadcast({ type: 'PLAYER_READY', playerId, ready: p.ready });
          broadcastGameState();
          break;
        }

        case 'SET_CONFIG': {
          if (playerId !== gameState.host) return;
          const { killers, doctors, detectives } = msg;
          gameState.config = {
            killers: Math.min(2, Math.max(1, killers || 1)),
            doctors: Math.min(2, Math.max(1, doctors || 1)),
            detectives: Math.min(2, Math.max(1, detectives || 1)),
          };
          broadcast({ type: 'CONFIG_UPDATED', config: gameState.config });
          broadcastGameState();
          break;
        }

        case 'START_GAME': {
          if (playerId !== gameState.host) return;
          const count = Object.keys(gameState.players).length;
          if (count < 4) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Need at least 4 players to start!' }));
            return;
          }
          const allReady = Object.values(gameState.players).every(p => p.id === gameState.host || p.ready);
          if (!allReady) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Not all players are ready!' }));
            return;
          }
          if (!assignRoles()) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Not enough players for the configured roles!' }));
            return;
          }
          addLog(`🎲 Categories dealt. Choose your path, gunslingers!`);
          broadcast({ type: 'GAME_STARTING' });
          const room = gameState;
          setTimeout(() => withRoom(room, () => startRoleSelection()), 1500);
          break;
        }

        case 'SELECT_VARIANT': {
          if (gameState.phase !== 'roleselect') return;
          if (!gameState.pendingSelection.has(playerId)) return;
          const { variant } = msg;
          const avail = availableVariantsFor(playerId);
          if (!avail.includes(variant)) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'That role was just taken — pick another!' }));
            broadcastGameState();
            return;
          }
          gameState.selectedVariant[playerId] = variant;
          gameState.pendingSelection.delete(playerId);
          addLog(`✊ ${gameState.players[playerId]?.name} chose their path.`);
          checkSelectionComplete();
          break;
        }

        case 'VOTE': {
          if (gameState.phase !== 'day') return;
          const voterP = gameState.players[playerId];
          if (!voterP || !voterP.alive) return;
          const { targetId } = msg;
          if (targetId && gameState.players[targetId]?.alive) {
            gameState.votes[playerId] = targetId;
            addLog(`🗳️ ${voterP?.name} cast a vote...`);
            broadcastGameState();
          }
          break;
        }

        case 'SKIP_VOTE': {
          if (gameState.phase !== 'day') return;
          const sp = gameState.players[playerId];
          if (!sp || !sp.alive) return;
          gameState.skipVotes.add(playerId);
          const required = Math.ceil(aliveCount() / 2);
          if (gameState.skipVotes.size >= required) {
            addLog(`⏭️ Majority voted to skip the day.`);
            if (gameState.dayTimer) clearTimeout(gameState.dayTimer);
            endDay();
          } else {
            broadcastGameState();
          }
          break;
        }

        case 'NIGHT_ACTION': {
          if (gameState.phase !== 'night') return;
          if (!gameState.pendingNightActions.has(playerId)) return;
          const p = gameState.players[playerId];
          const { action, target, targets, delay, guess } = msg;
          gameState.nightActions[playerId] = { action, target, targets, delay, guess };
          gameState.pendingNightActions.delete(playerId);
          if (gameState.nightTimers[playerId]) {
            clearTimeout(gameState.nightTimers[playerId]);
            delete gameState.nightTimers[playerId];
          }
          addLog(`🌑 ${p?.name} has made their move...`);
          checkNightComplete();
          break;
        }

        case 'POLICE_DAY_ACTION': {
          if (gameState.phase !== 'day') return;
          const p = gameState.players[playerId];
          if (p?.role !== 'POLICE') return;
          if (isPolicOnCooldown(playerId)) return;
          gameState.policeTargets[playerId] = msg.targetId;
          gameState.policeCooldown[playerId] = gameState.round;
          sendTo(playerId, { type: 'POLICE_ACK', targetId: msg.targetId });
          addLog(`🛡️ The Police has designated a protection target...`);
          broadcastGameState();
          break;
        }

        case 'RPS_CHOICE': {
          if (gameState.phase !== 'rps') return;
          const { choice } = msg;
          const rps = gameState.rpsState;
          if (!rps || !['rock', 'paper', 'scissors'].includes(choice)) return;
          if (playerId !== rps.sheriffId && playerId !== rps.killerId) return;
          rps.choices[playerId] = choice;
          broadcastGameState();
          if (rps.choices[rps.sheriffId] && rps.choices[rps.killerId]) {
            resolveRPS();
          }
          break;
        }

        case 'PLAY_AGAIN': {
          if (playerId !== gameState.host) return;
          const oldPlayers = Object.entries(gameState.players).map(([id, p]) => ({ id, name: p.name, ws: p.ws }));
          const hostId = gameState.host;
          resetGame();
          oldPlayers.forEach(({ id, name, ws: pws }) => {
            const isHost = id === hostId;
            gameState.players[id] = { id, name, ws: pws, alive: true, ready: false, role: null, eliminated: false };
            if (isHost) gameState.host = id;
          });
          broadcast({ type: 'LOBBY_RESET' });
          broadcastGameState();
          break;
        }
      }
    });
  });

  ws.on('close', () => {
    if (!myRoom || !rooms.has(myRoom.code)) return;
    withRoom(myRoom, () => {
      const p = gameState.players[playerId];
      if (p) {
        addLog(`🚪 ${p.name} has left town.`);
        gameState.pendingNightActions.delete(playerId);
        if (gameState.phase === 'night') checkNightComplete();
        if (gameState.host === playerId) {
          const remaining = Object.keys(gameState.players).filter(id => id !== playerId);
          gameState.host = remaining[0] || null;
        }
        delete gameState.players[playerId];
        broadcast({ type: 'PLAYER_LEFT', playerId, playerName: p.name });
        broadcastGameState();
      }
      if (Object.keys(gameState.players).length === 0) {
        startSessionExpireTimer();
      }
    });
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
});

// ─── Serve React App ──────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

server.listen(PORT, () => {
  console.log(`🤠 Deadwood Mafia server running on port ${PORT}`);
});
