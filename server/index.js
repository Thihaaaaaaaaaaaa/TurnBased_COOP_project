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

// ─── Game State ───────────────────────────────────────────────────────────────
let gameState = {
  phase: 'lobby',        // lobby | day | night | rps | gameover
  players: {},           // id -> player object
  host: null,
  round: 0,
  dayTimer: null,
  nightTimers: {},
  config: { killers: 1, doctors: 1, detectives: 1 },
  votes: {},             // playerId -> targetId
  skipVotes: new Set(),
  nightActions: {},      // playerId -> { action, target, delay? }
  pendingNightActions: new Set(), // who still needs to act
  deadThisNight: [],
  savedThisNight: [],
  rpsState: null,
  forensicUsed: {},      // playerId -> boolean
  geminiScheduled: [],   // { killerId, targetId, roundToExecute }
  bayHarborCooldown: {}, // playerId -> lastKillRound
  surgeonCooldown: {},   // playerId -> lastReviveRound
  policeCooldown: {},    // playerId -> lastProtectRound
  policeTargets: {},     // playerId -> targetId (set during day)
  protected: new Set(),  // protected tonight
  gameLog: [],
  sessionExpireTimer: null,
};

function resetGame() {
  clearAllTimers();
  gameState = {
    phase: 'lobby',
    players: {},
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
    sessionExpireTimer: null,
  };
}

function clearAllTimers() {
  if (gameState.dayTimer) clearTimeout(gameState.dayTimer);
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
  };
  // Killers can see each other
  if (p.role && p.role.includes('KILLER') || p.role === 'BAY_HARBOR') {
    state.killerTeam = Object.entries(gameState.players)
      .filter(([id, pl]) => pl.role && (pl.role.includes('KILLER') || pl.role === 'BAY_HARBOR') && id !== playerId)
      .map(([id, pl]) => ({ id, name: pl.name }));
  }
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

  const roles = [];
  const killerRoles = shuffle([...KILLER_VARIANTS]).slice(0, killers);
  const doctorRoles = shuffle([...DOCTOR_VARIANTS]).slice(0, doctors);
  const detectiveRoles = shuffle([...DETECTIVE_VARIANTS]).slice(0, detectives);
  roles.push(...killerRoles, ...doctorRoles, ...detectiveRoles);
  while (roles.length < total) roles.push('CIVILIAN');

  const shuffledRoles = shuffle(roles);
  const shuffledIds = shuffle([...playerIds]);
  shuffledIds.forEach((id, i) => {
    gameState.players[id].role = shuffledRoles[i];
    gameState.players[id].alive = true;
    gameState.players[id].eliminated = false;
  });
  return true;
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
const DAY_DURATION = 20000;

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
  broadcastGameState();
  broadcast({ type: 'PHASE_CHANGE', phase: 'day', round: gameState.round, duration: DAY_DURATION });

  if (checkWinCondition()) return;

  gameState.dayTimer = setTimeout(() => endDay(), DAY_DURATION);
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
  broadcastGameState();
  broadcast({ type: 'PHASE_CHANGE', phase: 'night', round: gameState.round });

  // Set timers for each player
  gameState.pendingNightActions.forEach(id => {
    gameState.nightTimers[id] = setTimeout(() => {
      if (gameState.pendingNightActions.has(id)) {
        gameState.nightActions[id] = { action: 'skip' };
        gameState.pendingNightActions.delete(id);
        addLog(`⏭️ ${gameState.players[id]?.name} ran out of time and skipped.`);
        checkNightComplete();
      }
    }, NIGHT_ACTION_TIMEOUT);
  });

  if (gameState.pendingNightActions.size === 0) {
    setTimeout(() => resolveNight(), 500);
  }
}

function checkNightComplete() {
  if (gameState.pendingNightActions.size === 0) {
    Object.values(gameState.nightTimers).forEach(t => clearTimeout(t));
    gameState.nightTimers = {};
    setTimeout(() => resolveNight(), 1500);
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
  setTimeout(() => startDay(), 3000);
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
  gameState.rpsTimeout = setTimeout(() => {
    if (!gameState.rpsState.choices[sheriffId]) gameState.rpsState.choices[sheriffId] = 'rock';
    if (!gameState.rpsState.choices[killerId]) gameState.rpsState.choices[killerId] = 'rock';
    resolveRPS();
  }, 15000);
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
    gameState.rpsTimeout = setTimeout(() => {
      if (!gameState.rpsState.choices[sheriffId]) gameState.rpsState.choices[sheriffId] = 'rock';
      if (!gameState.rpsState.choices[killerId]) gameState.rpsState.choices[killerId] = 'rock';
      resolveRPS();
    }, 15000);
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
  if (gameState.sessionExpireTimer) clearTimeout(gameState.sessionExpireTimer);
  gameState.sessionExpireTimer = setTimeout(() => {
    if (Object.keys(gameState.players).length === 0) {
      resetGame();
      console.log('Session expired — reset.');
    }
  }, 60000);
}

// ─── WebSocket Connection Handler ─────────────────────────────────────────────
wss.on('connection', (ws) => {
  const playerId = uuidv4();
  console.log(`Player connected: ${playerId}`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'JOIN': {
        const name = (msg.name || 'Stranger').slice(0, 20).trim();
        if (Object.keys(gameState.players).length >= 10) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Posse is full (10 max)' }));
          return;
        }
        if (gameState.phase !== 'lobby') {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Game already in progress' }));
          return;
        }
        const isHost = Object.keys(gameState.players).length === 0;
        gameState.players[playerId] = {
          id: playerId, name, ws, alive: true, ready: false, role: null, eliminated: false
        };
        if (isHost) gameState.host = playerId;
        if (gameState.sessionExpireTimer) {
          clearTimeout(gameState.sessionExpireTimer);
          gameState.sessionExpireTimer = null;
        }
        addLog(`🤠 ${name} has ridden into town.`);
        broadcast({ type: 'PLAYER_JOINED', playerId, name, isHost });
        ws.send(JSON.stringify({ type: 'JOINED', playerId, isHost }));
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
        addLog(`🎲 Roles have been assigned. The game begins!`);
        broadcast({ type: 'GAME_STARTING' });
        setTimeout(() => startDay(), 2000);
        break;
      }

      case 'VOTE': {
        if (gameState.phase !== 'day') return;
        const { targetId } = msg;
        if (targetId && gameState.players[targetId]?.alive) {
          gameState.votes[playerId] = targetId;
          const voter = gameState.players[playerId];
          addLog(`🗳️ ${voter?.name} cast a vote...`);
          broadcastGameState();
        }
        break;
      }

      case 'SKIP_VOTE': {
        if (gameState.phase !== 'day') return;
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
        resetGame();
        oldPlayers.forEach(({ id, name, ws: pws }) => {
          const isHost = id === oldPlayers[0].id;
          gameState.players[id] = { id, name, ws: pws, alive: true, ready: false, role: null, eliminated: false };
          if (isHost) gameState.host = id;
        });
        broadcast({ type: 'LOBBY_RESET' });
        broadcastGameState();
        break;
      }
    }
  });

  ws.on('close', () => {
    const p = gameState.players[playerId];
    if (p) {
      addLog(`🚪 ${p.name} has left town.`);
      // Remove from pending if in night phase
      gameState.pendingNightActions.delete(playerId);
      if (gameState.phase === 'night') checkNightComplete();
      // If was host, assign new host
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
