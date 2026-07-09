// smoke test — run: node test/smoke.js (server must be running on :3000)
const WebSocket = require('ws');
const URL = 'ws://localhost:3000';

function client(name) {
  const c = { name, ws: new WebSocket(URL), state: null, id: null, team: null, events: [] };
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') { c.id = m.id; c.team = m.team; c.field = m.field; }
    else if (m.t === 's') c.state = m;
    else c.events.push(m);
  });
  c.send = (o) => c.ws.send(JSON.stringify(o));
  return c;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗ FAIL:', label); }
}

(async () => {
  const A = client('Alice'), B = client('Bob');
  await sleep(300);
  A.send({ t: 'join', name: 'Alice' });
  B.send({ t: 'join', name: 'Bob' });
  await sleep(400);

  console.log('— join & teams —');
  check(A.id && B.id, 'both got ids');
  check(A.team !== B.team, `auto team balance (${A.team} vs ${B.team})`);
  check(A.state && A.state.p.length === 2, 'state broadcast includes both players');

  // move Alice to the ball at centre (walk in steps so anti-teleport doesn't trip)
  console.log('— possession —');
  const meA = A.state.p.find(p => p.i === A.id);
  let ax = meA.x, az = meA.z;
  for (let i = 0; i < 40; i++) {
    const dx = 0 - ax, dz = 0 - az, d = Math.hypot(dx, dz);
    if (d < 0.5) break;
    const st = Math.min(0.55, d);
    ax += dx / d * st; az += dz / d * st;
    A.send({ t: 'input', x: ax, y: 0, z: az, yaw: 0, a: 1 });
    await sleep(45);
  }
  await sleep(200);
  check(A.state.b.o === A.id, 'Alice picked up the ball (possession)');
  check(A.state.ph === 'play', 'kickoff -> play on first touch');

  // curve shot toward Bob's goal: Alice is red? red attacks +x. aim yaw so forward = +x => yaw = -PI/2
  console.log('— curve shot & Magnus —');
  const attackDir = A.team === 'red' ? -Math.PI / 2 : Math.PI / 2;
  A.send({ t: 'shoot', pass: false, power: 0.9, yaw: attackDir, pitch: 0.15, curve: 1 });
  await sleep(120);
  check(A.state.b.o === null, 'ball released after shot');
  const v1 = { x: A.state.b.x, z: A.state.b.z };
  await sleep(400);
  const v2 = { x: A.state.b.x, z: A.state.b.z };
  check(Math.abs(v2.z - v1.z) > 0.3, `sidespin bent the path (Δz=${(v2.z - v1.z).toFixed(2)})`);

  // wait for possible goal or settle, then force a clean straight goal
  await sleep(2500);
  console.log('— scoring a goal —');
  // walk Alice to wherever the ball is, then blast straight at goal centre
  for (let tri = 0; tri < 3 && !(A.state.sc.red + A.state.sc.blue); tri++) {
    for (let i = 0; i < 120; i++) {
      if (A.state.b.o === A.id) break;
      const b = A.state.b;
      const dx = b.x - ax, dz = b.z - az, d = Math.hypot(dx, dz);
      const st = Math.min(0.55, d);
      if (d > 0.01) { ax += dx / d * st; az += dz / d * st; }
      A.send({ t: 'input', x: ax, y: 0, z: az, yaw: 0, a: 2 });
      await sleep(40);
    }
    if (A.state.b.o !== A.id) continue;
    // aim from current pos to goal centre
    const gx = A.team === 'red' ? A.field.halfL + 1 : -A.field.halfL - 1;
    const yaw = Math.atan2(-(gx - ax), -(0 - az)); // forward=(-sin,-cos)
    A.send({ t: 'shoot', pass: false, power: 1, yaw, pitch: 0.05, curve: 0 });
    await sleep(1800);
  }
  const scored = A.state.sc.red + A.state.sc.blue >= 1;
  check(scored, `goal registered (score ${A.state.sc.red}-${A.state.sc.blue})`);
  const goalEv = A.events.find(e => e.t === 'goal');
  check(!!goalEv, 'goal event broadcast');
  if (goalEv) check(goalEv.scorer === 'Alice', `scorer credited (${goalEv.scorer})`);

  // wait for kickoff reset
  await sleep(6800);
  console.log('— kickoff reset —');
  check(A.state.b.x === 0 && A.state.b.z === 0 || Math.hypot(A.state.b.x, A.state.b.z) < 0.5, 'ball back at centre');
  const meA2 = A.state.p.find(p => p.i === A.id);
  ax = meA2.x; az = meA2.z;

  // tackle test: park Bob on the ball, Alice tackles from behind
  console.log('— tackle steal —');
  const meB = B.state.p.find(p => p.i === B.id);
  let bx = meB.x, bz = meB.z;
  for (let i = 0; i < 120; i++) {
    if (B.state.b.o === B.id) break;
    const b = B.state.b;
    const dx = b.x - bx, dz = b.z - bz, d = Math.hypot(dx, dz);
    const st = Math.min(0.55, d);
    if (d > 0.01) { bx += dx / d * st; bz += dz / d * st; }
    B.send({ t: 'input', x: bx, y: 0, z: bz, yaw: 0, a: 1 });
    await sleep(40);
  }
  check(B.state.b.o === B.id, 'Bob has the ball');
  // move Alice next to Bob
  for (let i = 0; i < 120; i++) {
    const dx = bx - ax, dz = (bz + 1.5) - az, d = Math.hypot(dx, dz);
    if (d < 0.3) break;
    const st = Math.min(0.55, d);
    ax += dx / d * st; az += dz / d * st;
    A.send({ t: 'input', x: ax, y: 0, z: az, yaw: 0, a: 2 });
    await sleep(40);
  }
  // face Bob: forward should point from Alice to Bob
  const yawT = Math.atan2(-(bx - ax), -(bz - az));
  A.send({ t: 'input', x: ax, y: 0, z: az, yaw: yawT, a: 0 });
  await sleep(80);
  A.send({ t: 'tackle', yaw: yawT });
  await sleep(300);
  check(B.state.b.o !== B.id, 'tackle knocked ball loose');
  check(B.events.some(e => e.t === 'stunned'), 'victim got stunned event');
  const meBst = A.state.p.find(p => p.i === B.id);
  check(meBst.st === 1, 'stun flag visible in state');

  // flick test: whoever owns ball next tries F
  console.log('— rainbow flick & volley —');
  await sleep(1500);
  // Alice grabs loose ball
  for (let i = 0; i < 120; i++) {
    if (A.state.b.o === A.id) break;
    const b = A.state.b;
    const dx = b.x - ax, dz = b.z - az, d = Math.hypot(dx, dz);
    const st = Math.min(0.55, d);
    if (d > 0.01) { ax += dx / d * st; az += dz / d * st; }
    A.send({ t: 'input', x: ax, y: 0, z: az, yaw: 0, a: 1 });
    await sleep(40);
  }
  check(A.state.b.o === A.id, 'Alice regained ball');
  A.events.length = 0;
  A.send({ t: 'flick' });
  await sleep(150);
  check(A.state.b.o === null && A.state.b.y > 0.6, `flick popped ball up (y=${A.state.b.y})`);
  check(A.events.some(e => e.t === 'fx' && e.kind === 'flick'), 'flick fx broadcast');
  // volley it while it's airborne
  let volleyOk = false;
  for (let i = 0; i < 20; i++) {
    if (A.state.b.y > 0.8 && A.state.b.o === null) {
      A.send({ t: 'volley', yaw: 0, pitch: 0.4, curve: 0 });
      await sleep(120);
      const sp = Math.hypot(A.state.b.x, A.state.b.z); // it should be flying somewhere fast
      if (A.events.some(e => e.t === 'fx' && e.kind === 'bicycle')) { volleyOk = true; break; }
    }
    await sleep(60);
  }
  check(volleyOk, 'bicycle volley connected on airborne ball');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
