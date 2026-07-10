// v3 mega test — run server with MATCH_LEN=12 for the golden-goal finale
const WebSocket = require('ws');
const URL = 'ws://localhost:3000';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗ FAIL:', label); }
}
function client(name) {
  const c = { name, ws: new WebSocket(URL), state: null, id: null, team: null, events: [], full: false };
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') { c.id = m.id; c.team = m.team; c.field = m.field; }
    else if (m.t === 's') c.state = m;
    else { c.events.push(m); if (m.t === 'full') c.full = true; if (m.t === 'golden') c.golden = true; }
  });
  c.send = (o) => c.ws.send(JSON.stringify(o));
  return c;
}
async function walk(c, gxF, gzF, opts = {}) {
  const meS = c.state.p.find(p => p.i === c.id);
  let x = c.px ?? meS.x, z = c.pz ?? meS.z;
  for (let i = 0; i < (opts.iters || 220); i++) {
    if (opts.untilBall && c.state.b.o === c.id) break;
    const gx = typeof gxF === 'function' ? gxF() : gxF;
    const gz = typeof gzF === 'function' ? gzF() : gzF;
    const dx = gx - x, dz = gz - z, d = Math.hypot(dx, dz);
    if (!opts.untilBall && d < 0.3) break;
    const st = Math.min(0.55, d);
    if (d > 0.01) { x += dx / d * st; z += dz / d * st; }
    c.send({ t: 'input', x, y: opts.y || 0, z, yaw: c.yaw || 0, pt: c.pt || 0, a: 1 });
    await sleep(38);
  }
  c.px = x; c.pz = z;
}
function put(c, x, z, yaw, y = 0, pt = 0) {
  c.px = x; c.pz = z; c.yaw = yaw; 
  c.send({ t: 'input', x, y, z, yaw, pt, a: 0 });
}
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
let ALL = [];   // every connected client, for wrangling idle ball-hogs
async function acquire(c) {
  for (let k = 0; k < 4; k++) {
    const o = c.state.b.o;
    if (o === c.id) return true;
    if (o != null) {
      const holder = ALL.find(cc => cc.id === o);
      if (holder) {
        const hs = holder.state.p.find(p => p.i === holder.id);
        const y = yawTo(hs.x, hs.z, c.px ?? 0, c.pz ?? 0);
        holder.send({ t: 'shoot', pass: true, power: 0, yaw: y, pitch: 0, curve: 0 });
        await sleep(400);
      } else await sleep(400);
    }
    await walk(c, () => c.state.b.x, () => c.state.b.z, { untilBall: true });
    if (c.state.b.o === c.id) return true;
  }
  return c.state.b.o === c.id;
}

(async () => {
  console.log('— 10 v 10 cap —');
  const cs = [];
  for (let i = 0; i < 20; i++) cs.push(client('P' + i));
  await sleep(600);
  cs.forEach((c, i) => c.send({ t: 'join', name: 'P' + i }));
  await sleep(900);
  const reds = cs.filter(c => c.team === 'red').length;
  const blues = cs.filter(c => c.team === 'blue').length;
  check(reds === 10 && blues === 10, `20 players split 10v10 (${reds}/${blues})`);
  const extra = client('P20');
  await sleep(300);
  extra.send({ t: 'join', name: 'P20' });
  await sleep(400);
  check(extra.full && !extra.id, '21st player rejected');
  extra.ws.close();

  ALL = cs;
  const A = cs[0];                                  // red actor
  const B = cs.find(c => c.team !== A.team);        // blue actor
  const F = A.field;

  console.log('— jab: clean steal, no stun, fast cooldown —');
  await walk(A, () => A.state.b.x, () => A.state.b.z, { untilBall: true });
  check(A.state.b.o === A.id, 'A carries the ball');
  A.yaw = 0; put(A, A.px, A.pz, 0);
  await walk(B, A.px, A.pz + 1.4);
  B.yaw = yawTo(B.px, B.pz, A.px, A.pz);
  put(B, B.px, B.pz, B.yaw);
  await sleep(120);
  B.events.length = 0; A.events.length = 0;
  B.send({ t: 'jab', yaw: B.yaw });
  await sleep(250);
  const aS = A.state.p.find(p => p.i === A.id);
  check(A.state.b.o !== A.id, 'jab poked the ball loose');
  check(aS.st === 0, 'victim NOT stunned (no-recoil steal)');
  check(!A.events.some(e => e.t === 'stunned'), 'no stunned event for victim');
  await sleep(700);                                  // jab cd is 0.8s — much shorter than tackle
  B.events.length = 0;
  B.send({ t: 'jab', yaw: B.yaw });
  await sleep(200);
  check(B.events.some(e => e.t === 'fx' && e.kind === 'jab') ||
        A.events.some(e => e.t === 'fx' && e.kind === 'jab'), 'second jab fired < 1s later (short cooldown)');

  console.log('— roulette shield beats the slide —');
  await walk(A, () => A.state.b.x, () => A.state.b.z, { untilBall: true });
  check(A.state.b.o === A.id, 'A regained the ball');
  await walk(B, A.px, A.pz + 1.6);
  B.yaw = yawTo(B.px, B.pz, A.px, A.pz);
  put(B, B.px, B.pz, B.yaw);
  await sleep(1300);                                 // clear any old cooldowns/stuns
  A.send({ t: 'roulette' });
  await sleep(80);
  B.events.length = 0;
  B.send({ t: 'tackle', yaw: B.yaw });
  await sleep(300);
  check(A.state.b.o === A.id, 'shielded carrier kept the ball');
  check(B.events.some(e => e.t === 'stunned' && /missed/.test(e.by || '')), 'tackler whiffed through the roulette');
  check(A.events.some(e => e.t === 'fx' && e.kind === 'roulette'), 'roulette fx broadcast');

  console.log('— drag-back —');
  await sleep(1600);
  A.yaw = 0; put(A, A.px, A.pz, 0);
  await sleep(100);
  check(A.state.b.o === A.id, 'A still has it');
  A.events.length = 0;
  A.send({ t: 'dragback' });
  await sleep(200);
  check(A.events.some(e => e.t === 'fx' && e.kind === 'dragback'), 'dragback fx fired');
  check(A.state.b.o === null, 'ball released behind (turn-around window)');
  await sleep(180);   // it starts from the carry spot 1.5m ahead — let it travel past you
  check(A.state.b.z > A.pz - 0.3, `ball pulled back (bz=${A.state.b.z.toFixed(1)} vs pz=${A.pz.toFixed(1)})`);
  await walk(A, () => A.state.b.x, () => A.state.b.z, { untilBall: true });
  check(A.state.b.o === A.id, 'A collected his own drag-back');

  console.log('— chip shot floats —');
  A.yaw = yawTo(A.px, A.pz, A.px, A.pz - 30); // straight -z, open pitch
  put(A, A.px, A.pz, A.yaw);
  await sleep(100);
  A.send({ t: 'shoot', pass: false, power: 1, yaw: A.yaw, pitch: 0.1, curve: 0, chip: true });
  let maxY = 0;
  for (let i = 0; i < 40; i++) { maxY = Math.max(maxY, A.state.b.y); await sleep(50); }
  check(maxY > 2.5, `chip got real air (peak y=${maxY.toFixed(1)})`);

  console.log('— header: jump and nod it where you look —');
  // B stands 18m from A; A chips toward B; B "jumps" under it and heads it
  await acquire(A);
  await walk(A, 0, 12);                              // carry it to midfield first
  await walk(B, 0, -6);
  B.yaw = 0; // B will head toward -z (away from A? A is at +z side of B) — fine, open pitch
  A.yaw = yawTo(A.px, A.pz, B.px, B.pz);
  put(A, A.px, A.pz, A.yaw);
  await sleep(100);
  B.events.length = 0;
  A.send({ t: 'shoot', pass: false, power: 0.7, yaw: A.yaw, pitch: 0.55, curve: 0, chip: true });
  let headed = false;
  for (let i = 0; i < 120 && !headed; i++) {
    const b = B.state.b;
    // track under the ball while airborne
    B.send({ t: 'input', x: b.x, y: 0.45, z: b.z, yaw: B.yaw, pt: 0.1, a: 1 });
    B.px = b.x; B.pz = b.z;
    headed = B.events.some(e => e.t === 'fx' && e.kind === 'header');
    await sleep(35);
  }
  check(headed, 'header connected mid-air');

  console.log('— timed bicycle kick —');
  await sleep(800);
  // A collects, backs off 20m from B, chips high toward B; B faces the incoming ball,
  // waits for it to arrive, then triggers the flip — kick goes OVER B, away from A.
  await acquire(A);
  check(A.state.b.o === A.id, 'A has ball for the cross');
  await walk(A, 0, 10);                              // midfield launch pad
  await walk(B, 0, -10);
  B.yaw = yawTo(B.px, B.pz, A.px, A.pz);              // face the cross (opposite of shot dir)
  put(B, B.px, B.pz, B.yaw);
  A.yaw = yawTo(A.px, A.pz, B.px, B.pz);
  put(A, A.px, A.pz, A.yaw, 0);
  await sleep(120);
  B.events.length = 0;
  A.send({ t: 'shoot', pass: false, power: 1, yaw: A.yaw, pitch: 0.15, curve: 0, chip: true });
  let biked = false, attempted = false;
  for (let i = 0; i < 160 && !biked; i++) {
    const b = B.state.b;
    const d = Math.hypot(b.x - B.px, b.z - B.pz);
    // trigger the flip while the cross is ~0.3s out — the live hitbox does the rest
    if (!attempted && b.o == null && d < 7.5 && b.y > 1) {
      B.send({ t: 'bicycle', yaw: B.yaw, pitch: 0.3, curve: 0 });
      attempted = true;
    }
    if (attempted && i % 45 === 44) attempted = false;   // retry if the first window missed
    biked = B.events.some(e => e.t === 'fx' && e.kind === 'bicycle');
    await sleep(30);
  }
  check(biked, 'bicycle kick connected via the flip hitbox');
  if (biked) {
    // ball should now travel OPPOSITE to B's facing (over the head, away from A)
    const z1 = B.state.b.z; await sleep(250); const z2 = B.state.b.z;
    const f = { z: -Math.cos(B.yaw) };
    check(Math.sign(z2 - z1) === -Math.sign(f.z), 'kick went over the head, opposite to facing');
  }

  console.log('— powerup pads —');
  check(A.state.pd && A.state.pd.length >= 6, `pads in state (${A.state.pd.length})`);
  const powerPad = A.state.pd.find(p => p.k === 'power');
  check(!!powerPad, 'a power pad is up');
  if (powerPad) {
    A.events.length = 0;
    await walk(A, powerPad.x, powerPad.z);
    await sleep(300);
    check(A.events.some(e => e.t === 'buff' && e.kind === 'power'), 'power buff received');
    await acquire(A);
    A.events.length = 0;
    A.send({ t: 'shoot', pass: false, power: 1, yaw: A.yaw, pitch: 0.2, curve: 0 });
    await sleep(300);
    check(A.events.some(e => e.t === 'fx' && e.kind === 'powershot'), 'supercharged shot fired');
  }
  const speedPad = A.state.pd.find(p => p.k === 'speed');
  if (speedPad) {
    A.events.length = 0;
    await walk(A, speedPad.x, speedPad.z);
    await sleep(300);
    check(A.events.some(e => e.t === 'buff' && e.kind === 'speed'), 'speed buff received');
  }

  console.log('— penalty kick —');
  // B fouls A inside B's own box (blue defends +x) => penalty to red, A takes it
  const boxX = F.halfL - F.boxDepth + 3;
  await sleep(1500);
  await walk(B, boxX, 2);
  await walk(A, boxX, 4);
  B.yaw = yawTo(B.px, B.pz, A.px, A.pz);
  put(B, B.px, B.pz, B.yaw);
  await sleep(1200);
  A.events.length = 0; B.events.length = 0;
  B.send({ t: 'tackle', yaw: B.yaw });
  await sleep(400);
  check(A.events.some(e => e.t === 'penalty'), 'penalty awarded for a foul in the box');
  check(A.state.ph === 'penalty', 'phase = penalty');
  check(A.state.b.o === A.id, 'fouled player is the taker (has the ball)');
  // only the taker may act: B tries to jab/steal — nothing happens
  B.send({ t: 'jab', yaw: 0 });
  await sleep(200);
  check(A.state.b.o === A.id, 'defenders cannot touch the ball during the penalty');
  // taker shoots (into the side wall on purpose — keeping it 0-0 for the golden goal)
  const takerMe = A.state.p.find(p => p.i === A.id);
  A.px = takerMe.x; A.pz = takerMe.z;
  const wallYaw = yawTo(A.px, A.pz, A.px, -F.halfW + 2);
  A.send({ t: 'shoot', pass: false, power: 0.6, yaw: wallYaw, pitch: 0.1, curve: 0 });
  await sleep(300);
  check(A.state.ph === 'play', 'ball is live after the penalty is struck');

  console.log('— golden goal (MATCH_LEN=12 env) —');
  // clock ran out during all of the above with the score level -> sudden death
  let goldenSeen = !!A.golden;
  for (let i = 0; i < 100 && !goldenSeen; i++) { goldenSeen = !!A.golden; await sleep(100); }
  check(goldenSeen, 'golden goal announced when the clock hit zero level');
  check(A.state.gg === 1, 'gg flag live in state');
  // now score: A takes the ball to the blue goal and buries it
  await acquire(A);
  check(A.state.b.o === A.id, 'A has the ball for the winner');
  await walk(A, F.halfL - 14, 0, { iters: 300 });
  const gYaw = yawTo(A.px, A.pz, F.halfL + 1, 0);
  A.events.length = 0;
  A.send({ t: 'shoot', pass: false, power: 1, yaw: gYaw, pitch: 0.1, curve: 0 });
  let ended = null;
  for (let i = 0; i < 200 && !ended; i++) {
    ended = A.events.find(e => e.t === 'matchEnd');
    await sleep(50);
  }
  check(!!ended, 'match ended on the golden goal');
  if (ended) check(/GOLDEN GOAL/.test(ended.result), `result says golden goal (${ended.result})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
