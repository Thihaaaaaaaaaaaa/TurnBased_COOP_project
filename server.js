// ============================================================
//  KICKOFF ARENA — authoritative soccer server
//  Express serves the client, ws runs the match.
// ============================================================
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- constants ----------
const TICK_HZ = 30;
const DT = 1 / TICK_HZ;

const FIELD = {
  halfL: 35,        // x: -35 .. 35  (goals on x ends)
  halfW: 22,        // z: -22 .. 22
  goalHalfW: 4.5,   // goal mouth half width (z)
  goalH: 3.2,       // crossbar height
  goalDepth: 3,     // net depth behind the line
  wallH: 6,         // arena wall height (ball bounces back in)
};

const BALL = {
  r: 0.45,
  gravity: -22,
  groundRest: 0.62,
  wallRest: 0.72,
  rollFriction: 0.985,   // per-tick multiplier while rolling
  airDrag: 0.997,
  pickupRange: 2.0,
  carryDist: 1.5,
};

const PLAYER = {
  radius: 0.6,
  maxStep: 0.9,          // max distance a client may move per input packet (anti-teleport, generous for sprint+lunge)
  tackleRange: 3.2,
  tackleCos: Math.cos(Math.PI / 3), // 60° cone
  tackleCooldown: 2.0,
  stunTime: 1.2,
  shootLockout: 0.45,    // shooter can't instantly re-grab
};

const TEAM_MAX = 5;            // 5 v 5

const GK = {
  catchRange: 3.2,        // hands beat feet inside the box
  catchMaxY: 2.6,         // can pluck crosses out of the air
  diveRange: 3.8,
  diveCooldown: 1.6,
  parrySpeed: 28,         // shots faster than this get parried, not caught
};

const MATCH_LEN = 5 * 60;      // seconds
const GOAL_PAUSE = 4;          // celebration seconds
const KICKOFF_PAUSE = 2;
const MATCH_END_PAUSE = 10;

// ---------- state ----------
let nextId = 1;
const players = new Map();     // id -> player
const sockets = new Map();     // id -> ws

const game = {
  phase: 'kickoff',            // kickoff | play | goal | matchEnd
  phaseT: KICKOFF_PAUSE,
  clock: MATCH_LEN,
  score: { red: 0, blue: 0 },
  lastScorer: null,
  ball: resetBall(),
};

function resetBall() {
  return { x: 0, y: BALL.r, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, owner: null, noPickup: {} };
}

function teamCounts() {
  let red = 0, blue = 0;
  for (const p of players.values()) p.team === 'red' ? red++ : blue++;
  return { red, blue };
}

function spawnPoint(team, idx, role) {
  const sideX = team === 'red' ? -1 : 1;
  if (role === 'gk') return { x: sideX * (FIELD.halfL - 2.5), z: 0 };
  const lanes = [-12, 12, -4, 4, -18, 18, 0, -8, 8];
  const z = lanes[idx % lanes.length];
  const x = sideX * (10 + 6 * Math.floor(idx / lanes.length));
  return { x, z };
}

function teamGk(team) {
  for (const p of players.values()) if (p.team === team && p.role === 'gk') return p;
  return null;
}

function inOwnBox(p) {
  const sideX = p.team === 'red' ? -1 : 1;
  return p.x * sideX > FIELD.halfL - 9 && Math.abs(p.z) < 10;
}

function respawnAll() {
  let ri = 0, bi = 0;
  for (const p of players.values()) {
    const idx = p.team === 'red' ? ri++ : bi++;
    const s = spawnPoint(p.team, idx, p.role);
    p.x = s.x; p.z = s.z; p.y = 0;
    p.forceSpawn = { x: s.x, z: s.z };   // client is told to teleport
  }
}

// ---------- helpers ----------
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg) { const s = JSON.stringify(msg); for (const ws of sockets.values()) if (ws.readyState === 1) ws.send(s); }

function sanitizeName(n) {
  n = String(n || '').replace(/[^\w \-\.\[\]]/g, '').trim().slice(0, 16);
  return n || 'Player' + nextId;
}

// ---------- connection ----------
wss.on('connection', (ws) => {
  const id = nextId++;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const p = players.get(id);

    switch (m.t) {
      case 'join': {
        if (players.has(id)) return;
        const { red, blue } = teamCounts();
        let team = red <= blue ? 'red' : 'blue';
        if ((team === 'red' ? red : blue) >= TEAM_MAX) team = team === 'red' ? 'blue' : 'red';
        if ((team === 'red' ? red : blue) >= TEAM_MAX) {
          send(ws, { t: 'full', max: TEAM_MAX });
          return;
        }
        const idx = team === 'red' ? red : blue;
        const s = spawnPoint(team, idx, 'field');
        players.set(id, {
          id, name: sanitizeName(m.name), team,
          x: s.x, y: 0, z: s.z, yaw: team === 'red' ? Math.PI / 2 : -Math.PI / 2,
          stunUntil: 0, tackleAt: -99, diveAt: -99, lastInputAt: Date.now(),
          goals: 0, tackles: 0, saves: 0, assists: 0, fouls: 0, role: 'field',
        });
        sockets.set(id, ws);
        send(ws, {
          t: 'welcome', id, team, field: FIELD,
          spawn: s, matchLen: MATCH_LEN,
        });
        broadcast({ t: 'chat', sys: true, text: `${players.get(id).name} joined ${team.toUpperCase()}` });
        break;
      }

      case 'input': {
        if (!p) return;
        // client-authoritative movement, loosely validated
        const nx = clamp(+m.x || 0, -FIELD.halfL - 1, FIELD.halfL + 1);
        const nz = clamp(+m.z || 0, -FIELD.halfW - 1, FIELD.halfW + 1);
        const ny = clamp(+m.y || 0, 0, 6);
        const dx = nx - p.x, dz = nz - p.z;
        const d = Math.hypot(dx, dz);
        if (d > PLAYER.maxStep * 3) {
          // teleport attempt — pull them back
          p.forceSpawn = { x: p.x, z: p.z };
        } else {
          p.x = nx; p.z = nz; p.y = ny;
        }
        p.yaw = +m.yaw || 0;
        p.anim = m.a | 0; // 0 idle 1 run 2 sprint 3 slide 4 stunned (client-reported, cosmetic)
        p.lastInputAt = Date.now();
        break;
      }

      case 'shoot': {
        if (!p || game.phase === 'goal' || game.phase === 'matchEnd') return;
        if (nowS() < p.stunUntil) return;
        const b = game.ball;
        if (b.owner !== id) return;
        const power = clamp(+m.power || 0, 0, 1);
        const pitch = clamp(+m.pitch || 0, -0.3, 0.9);
        const yaw = +m.yaw || p.yaw;

        if (m.pass) {
          // aim-assisted pass: pick best teammate in a 55° cone toward aim
          const target = bestPassTarget(p, yaw);
          if (target) {
            const dx = target.x - p.x, dz = target.z - p.z;
            const dist = Math.hypot(dx, dz) || 1;
            const speed = clamp(8 + dist * 0.9, 10, 24);
            b.vx = (dx / dist) * speed;
            b.vz = (dz / dist) * speed;
            b.vy = clamp(dist * 0.18, 1.5, 6);
          } else {
            // no target: firm ground pass along aim
            const dir = dirFromYaw(yaw);
            b.vx = dir.x * 14; b.vz = dir.z * 14; b.vy = 2;
          }
        } else {
          const dir = dirFromYaw(yaw);
          const speed = 10 + power * 24;
          b.vx = dir.x * speed * Math.cos(pitch);
          b.vz = dir.z * speed * Math.cos(pitch);
          b.vy = speed * Math.sin(Math.max(pitch, 0.02)) + 1;
          // curl: sidespin bends the ball mid-flight (Magnus effect)
          const curve = clamp(+m.curve || 0, -1, 1);
          b.spin = curve * (0.7 + power * 0.9);
        }
        if (m.pass) b.spin = 0;
        b.owner = null;
        b.noPickup[id] = nowS() + PLAYER.shootLockout;
        b.lastKick = { id, at: nowS() };
        if (m.pass) b.passFrom = { id, team: p.team, at: nowS() };
        else b.passFrom = null;
        b.x = p.x + dirFromYaw(yaw).x * (BALL.carryDist + 0.2);
        b.z = p.z + dirFromYaw(yaw).z * (BALL.carryDist + 0.2);
        b.y = Math.max(b.y, BALL.r + 0.05);
        broadcast({ t: 'fx', kind: m.pass ? 'pass' : 'shoot', id, power });
        break;
      }

      case 'tackle': {
        if (!p || game.phase !== 'play') return;
        const t = nowS();
        if (t < p.stunUntil || t - p.tackleAt < PLAYER.tackleCooldown) return;
        p.tackleAt = t;
        const dir = dirFromYaw(+m.yaw || p.yaw);
        let hit = null;
        for (const q of players.values()) {
          if (q.id === id || q.team === p.team) continue;
          const dx = q.x - p.x, dz = q.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d > PLAYER.tackleRange) continue;
          const cos = (dx * dir.x + dz * dir.z) / (d || 1);
          if (cos < PLAYER.tackleCos) continue;
          if (!hit || d < hit.d) hit = { q, d };
        }
        broadcast({ t: 'fx', kind: 'tackle', id });
        if (hit) {
          const q = hit.q;
          q.stunUntil = t + PLAYER.stunTime;
          send(sockets.get(q.id), { t: 'stunned', dur: PLAYER.stunTime, by: p.name });
          if (game.ball.owner === q.id) {
            const b = game.ball;
            b.owner = null;
            b.noPickup[q.id] = t + 1.0;      // victim can't instantly re-grab
            const pop = dirFromYaw(p.yaw);
            b.vx = pop.x * 6 + (Math.random() - 0.5) * 3;
            b.vz = pop.z * 6 + (Math.random() - 0.5) * 3;
            b.vy = 3;
            p.tackles++;
            broadcast({ t: 'chat', sys: true, text: `${p.name} dispossessed ${q.name}!` });
          } else {
            // FOUL: sliding into a player who doesn't have the ball takes you both down
            p.fouls++;
            p.stunUntil = t + PLAYER.stunTime;
            send(sockets.get(id), { t: 'stunned', dur: PLAYER.stunTime, by: 'the referee (foul!)' });
            broadcast({ t: 'chat', sys: true, text: `FOUL! ${p.name} scythes down ${q.name} off the ball` });
          }
        } else {
          // whiffed slide: you're committed — eat turf for a moment
          p.stunUntil = t + 0.7;
          send(sockets.get(id), { t: 'stunned', dur: 0.7, by: 'a missed slide' });
        }
        break;
      }

      case 'volley': {
        // bicycle kick / volley: strike a LOOSE airborne ball near you — no possession needed
        if (!p || (game.phase !== 'play' && game.phase !== 'kickoff')) return;
        const t = nowS();
        if (t < p.stunUntil) return;
        const b = game.ball;
        if (b.owner != null) return;
        const d = Math.hypot(b.x - p.x, b.z - p.z);
        if (d > 3.0 || b.y < 0.75 || b.y > 3.4) return;   // ball must be up in the air, close
        if (game.phase === 'kickoff') game.phase = 'play';
        const pitch = clamp(+m.pitch || 0, -0.5, 1.0);
        const dir = dirFromYaw(+m.yaw || p.yaw);
        const speed = 30;                                  // bicycle kicks are always violent
        b.vx = dir.x * speed * Math.cos(pitch);
        b.vz = dir.z * speed * Math.cos(pitch);
        b.vy = Math.max(speed * Math.sin(pitch), 2);
        b.spin = clamp(+m.curve || 0, -1, 1) * 0.8;
        b.noPickup[id] = t + PLAYER.shootLockout;
        b.lastKick = { id, at: t };
        broadcast({ t: 'fx', kind: 'bicycle', id });
        broadcast({ t: 'chat', sys: true, text: `${p.name} with the BICYCLE KICK!` });
        break;
      }

      case 'flick': {
        // rainbow flick: pop the ball over a defender, keep running onto it
        if (!p || game.phase !== 'play') return;
        const t = nowS();
        if (t < p.stunUntil) return;
        const b = game.ball;
        if (b.owner !== id) return;
        const dir = dirFromYaw(p.yaw);
        b.owner = null;
        b.vx = dir.x * 6;
        b.vz = dir.z * 6;
        b.vy = 7.5;
        b.spin = 0;
        // opponents can't snatch it out of the air — you keep the advantage
        for (const q of players.values()) {
          b.noPickup[q.id] = t + (q.id === id ? 0.25 : 0.6);
        }
        broadcast({ t: 'fx', kind: 'flick', id });
        break;
      }

      case 'role': {
        if (!p) return;
        if (m.gk) {
          const cur = teamGk(p.team);
          if (cur && cur.id !== id) {
            send(ws, { t: 'chat', sys: true, text: `${cur.name} is already ${p.team.toUpperCase()}'s keeper` });
            return;
          }
          if (p.role !== 'gk') {
            p.role = 'gk';
            broadcast({ t: 'chat', sys: true, text: `${p.name} is now ${p.team.toUpperCase()}'s GOALKEEPER 🧤` });
          }
        } else if (p.role === 'gk') {
          p.role = 'field';
          broadcast({ t: 'chat', sys: true, text: `${p.name} left the goal — ${p.team.toUpperCase()} needs a keeper!` });
        }
        break;
      }

      case 'dive': {
        // goalkeeper dive: catch loose balls in your box, punch them clear outside it,
        // and smother the ball off a carrier's feet (they go down)
        if (!p || p.role !== 'gk' || (game.phase !== 'play' && game.phase !== 'kickoff')) return;
        const t = nowS();
        if (t < p.stunUntil || t - p.diveAt < GK.diveCooldown) return;
        p.diveAt = t;
        broadcast({ t: 'fx', kind: 'dive', id });
        const b = game.ball;
        const d = Math.hypot(b.x - p.x, b.z - p.z);

        if (b.owner == null) {
          if (d < GK.diveRange && b.y < GK.catchMaxY) {
            const speed = Math.hypot(b.vx, b.vy, b.vz);
            if (game.phase === 'kickoff') game.phase = 'play';
            if (inOwnBox(p) && speed < GK.parrySpeed) {
              // clean catch
              b.owner = id; b.vx = b.vy = b.vz = 0; b.spin = 0;
              p.saves++;
              broadcast({ t: 'fx', kind: 'catch', id });
              broadcast({ t: 'chat', sys: true, text: `WHAT A SAVE by ${p.name}!` });
            } else {
              // parry / punch clear
              const dir = dirFromYaw(+m.yaw || p.yaw);
              b.vx = dir.x * 20; b.vz = dir.z * 20; b.vy = 7; b.spin = 0;
              b.noPickup[id] = t + 0.4;
              p.saves++;
              broadcast({ t: 'fx', kind: 'punch', id });
              broadcast({ t: 'chat', sys: true, text: `${p.name} punches it clear!` });
            }
          }
        } else {
          // smother the ball off an opponent's feet
          const q = players.get(b.owner);
          if (q && q.team !== p.team) {
            const dq = Math.hypot(q.x - p.x, q.z - p.z);
            if (dq < 3.0) {
              q.stunUntil = t + PLAYER.stunTime;
              send(sockets.get(q.id), { t: 'stunned', dur: PLAYER.stunTime, by: p.name });
              b.owner = id; b.vx = b.vy = b.vz = 0; b.spin = 0;
              b.noPickup[q.id] = t + 1.0;
              p.saves++;
              broadcast({ t: 'chat', sys: true, text: `${p.name} smothers it at ${q.name}'s feet!` });
            }
          }
        }
        break;
      }

      case 'chat': {
        if (!p) return;
        const text = String(m.text || '').slice(0, 120).trim();
        if (text) broadcast({ t: 'chat', name: p.name, team: p.team, text });
        break;
      }
    }
  });

  ws.on('close', () => {
    const p = players.get(id);
    if (p) broadcast({ t: 'chat', sys: true, text: `${p.name} left` });
    if (game.ball.owner === id) game.ball.owner = null;
    players.delete(id);
    sockets.delete(id);
  });
});

// keepalive (Render idles quiet sockets)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

// ---------- math ----------
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function nowS() { return Date.now() / 1000; }
function dirFromYaw(yaw) { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; } // matches three.js camera forward

function bestPassTarget(p, yaw) {
  const dir = dirFromYaw(yaw);
  let best = null, bestScore = -1;
  for (const q of players.values()) {
    if (q.id === p.id || q.team !== p.team) continue;
    const dx = q.x - p.x, dz = q.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 2 || d > 45) continue;
    const cos = (dx * dir.x + dz * dir.z) / d;
    if (cos < Math.cos((55 * Math.PI) / 180)) continue;
    const score = cos * 2 - d / 45;
    if (score > bestScore) { bestScore = score; best = q; }
  }
  return best;
}

// ---------- simulation ----------
function stepBall() {
  const b = game.ball;
  const t = nowS();

  // possession carry
  if (b.owner != null) {
    const p = players.get(b.owner);
    if (!p || t < p.stunUntil) { b.owner = null; }
    else {
      const dir = dirFromYaw(p.yaw);
      const carry = p.anim === 2 ? BALL.carryDist + 0.7 : BALL.carryDist; // sprint = knock-on
      b.x = p.x + dir.x * carry;
      b.z = p.z + dir.z * carry;
      b.y = p.role === 'gk' ? 1.05 : BALL.r;   // keepers hold it in their hands
      b.vx = b.vy = b.vz = 0;
      b.spin = 0;
      // dropped if carried out over the line somehow
      keepBallInArena(b);
      return;
    }
  }

  // free ball physics
  b.vy += BALL.gravity * DT;

  // Magnus effect: sidespin bends the flight path
  if (Math.abs(b.spin) > 0.01) {
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 2) {
      const a = 0.15 * b.spin * Math.min(sp, 32);   // lateral accel, m/s²
      const px = -b.vz / sp, pz = b.vx / sp;        // unit perpendicular
      b.vx += px * a * DT;
      b.vz += pz * a * DT;
    }
    b.spin *= 0.995;
  }

  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;

  // ground
  if (b.y < BALL.r) {
    b.y = BALL.r;
    if (Math.abs(b.vy) > 1.2) { b.vy = -b.vy * BALL.groundRest; b.spin *= 0.6; }
    else b.vy = 0;
    b.vx *= BALL.rollFriction;
    b.vz *= BALL.rollFriction;
  } else {
    b.vx *= BALL.airDrag;
    b.vz *= BALL.airDrag;
  }

  keepBallInArena(b);

  // players kick loose balls around / pick up
  if (game.phase === 'play' || game.phase === 'kickoff') {
    let nearest = null, nd = 1e9;
    for (const p of players.values()) {
      if (t < p.stunUntil) continue;
      if ((b.noPickup[p.id] || 0) > t) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      // keepers get longer reach + can take high balls inside their own box
      const gkBonus = p.role === 'gk' && inOwnBox(p);
      const range = gkBonus ? GK.catchRange : BALL.pickupRange;
      const maxY = gkBonus ? GK.catchMaxY : 1.6;
      const maxSpd = gkBonus ? GK.parrySpeed : 26;
      if (d < range && b.y < maxY && Math.hypot(b.vx, b.vz) < maxSpd && d < nd) { nd = d; nearest = p; }
    }
    if (nearest) {
      if (game.phase === 'kickoff') game.phase = 'play';
      const shotSpeed = Math.hypot(b.vx, b.vy, b.vz);
      b.owner = nearest.id;
      // a completed pass to a teammate sets up a potential assist
      if (b.passFrom && b.passFrom.id !== nearest.id && b.passFrom.team === nearest.team
          && t - b.passFrom.at < 6) {
        b.assistFrom = { id: b.passFrom.id, at: t };
      } else if (!b.passFrom || b.passFrom.team !== nearest.team) {
        b.assistFrom = null;   // interception kills the assist chain
      }
      b.passFrom = null;
      if (nearest.role === 'gk' && inOwnBox(nearest) && shotSpeed > 8) {
        nearest.saves++;
        broadcast({ t: 'fx', kind: 'catch', id: nearest.id });
        broadcast({ t: 'chat', sys: true, text: `${nearest.name} gathers it — safe hands!` });
      } else {
        broadcast({ t: 'fx', kind: 'trap', id: nearest.id });
      }
    }
  }

  // goal check
  if (game.phase === 'play') {
    const inMouth = Math.abs(b.z) < FIELD.goalHalfW && b.y < FIELD.goalH;
    if (inMouth && b.x < -FIELD.halfL - BALL.r) scoreGoal('blue');
    else if (inMouth && b.x > FIELD.halfL + BALL.r) scoreGoal('red');
  }

  // expire noPickup entries
  for (const k in b.noPickup) if (b.noPickup[k] < t) delete b.noPickup[k];
}

function keepBallInArena(b) {
  const inMouth = Math.abs(b.z) < FIELD.goalHalfW && b.y < FIELD.goalH;
  const xLimit = inMouth ? FIELD.halfL + FIELD.goalDepth - BALL.r : FIELD.halfL - BALL.r;

  if (b.x < -xLimit) { b.x = -xLimit; b.vx = Math.abs(b.vx) * BALL.wallRest; }
  if (b.x > xLimit) { b.x = xLimit; b.vx = -Math.abs(b.vx) * BALL.wallRest; }
  if (b.z < -(FIELD.halfW - BALL.r)) { b.z = -(FIELD.halfW - BALL.r); b.vz = Math.abs(b.vz) * BALL.wallRest; }
  if (b.z > FIELD.halfW - BALL.r) { b.z = FIELD.halfW - BALL.r; b.vz = -Math.abs(b.vz) * BALL.wallRest; }
  if (b.y > FIELD.wallH * 2.5) { b.y = FIELD.wallH * 2.5; b.vy = -Math.abs(b.vy) * 0.5; }
}

function scoreGoal(team) {
  game.score[team]++;
  const b = game.ball;
  let scorer = null;
  if (b.lastKick && nowS() - b.lastKick.at < 8) scorer = players.get(b.lastKick.id) || null;
  if (scorer && scorer.team !== team) scorer = null;   // own goals stay anonymous
  if (scorer) scorer.goals++;
  let assister = null;
  if (scorer && b.assistFrom && b.assistFrom.id !== scorer.id && nowS() - b.assistFrom.at < 10) {
    assister = players.get(b.assistFrom.id) || null;
    if (assister && assister.team === team) assister.assists++;
    else assister = null;
  }
  b.assistFrom = null;
  game.lastScorer = scorer ? scorer.name : null;
  game.phase = 'goal';
  game.phaseT = GOAL_PAUSE;
  broadcast({
    t: 'goal', team, score: game.score,
    scorer: game.lastScorer,
    assist: assister ? assister.name : null,
  });
}

function stepPhase() {
  const anyone = players.size > 0;
  switch (game.phase) {
    case 'kickoff':
      game.phaseT -= DT;
      if (game.phaseT <= 0) game.phase = 'play';
      break;
    case 'play':
      if (anyone) game.clock -= DT;
      if (game.clock <= 0) {
        game.clock = 0;
        game.phase = 'matchEnd';
        game.phaseT = MATCH_END_PAUSE;
        const s = game.score;
        const result = s.red === s.blue ? 'DRAW' : (s.red > s.blue ? 'RED WINS' : 'BLUE WINS');
        broadcast({ t: 'matchEnd', score: s, result });
      }
      break;
    case 'goal':
      game.phaseT -= DT;
      if (game.phaseT <= 0) {
        game.ball = resetBall();
        respawnAll();
        game.phase = 'kickoff';
        game.phaseT = KICKOFF_PAUSE;
        broadcast({ t: 'kickoff' });
      }
      break;
    case 'matchEnd':
      game.phaseT -= DT;
      if (game.phaseT <= 0) {
        game.score = { red: 0, blue: 0 };
        game.clock = MATCH_LEN;
        game.ball = resetBall();
        for (const p of players.values()) { p.goals = 0; p.tackles = 0; p.saves = 0; p.assists = 0; p.fouls = 0; }
        respawnAll();
        game.phase = 'kickoff';
        game.phaseT = KICKOFF_PAUSE;
        broadcast({ t: 'kickoff' });
      }
      break;
  }
}

// ---------- broadcast loop ----------
setInterval(() => {
  stepPhase();
  stepBall();

  // free up 5v5 slots held by dead/idle connections
  const nowMs = Date.now();
  for (const [pid, p] of players) {
    if (nowMs - p.lastInputAt > 90000) {
      broadcast({ t: 'chat', sys: true, text: `${p.name} timed out` });
      const sock = sockets.get(pid);
      if (sock) { try { sock.close(); } catch (e) {} }
      if (game.ball.owner === pid) game.ball.owner = null;
      players.delete(pid);
      sockets.delete(pid);
    }
  }

  const list = [];
  for (const p of players.values()) {
    const e = {
      i: p.id, n: p.name, tm: p.team,
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      yw: +p.yaw.toFixed(2), a: p.anim || 0,
      g: p.goals, tk: p.tackles, sv: p.saves, as: p.assists,
      r: p.role === 'gk' ? 1 : 0,
      st: nowS() < p.stunUntil ? 1 : 0,
    };
    if (p.forceSpawn) { e.fs = p.forceSpawn; p.forceSpawn = null; }
    list.push(e);
  }
  const b = game.ball;
  broadcast({
    t: 's',
    ph: game.phase,
    ck: Math.ceil(game.clock),
    sc: game.score,
    b: { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), o: b.owner },
    p: list,
  });
}, 1000 / TICK_HZ);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Kickoff Arena on :${PORT}`));
