// extras test: whiffed slides, fouls, assists — server on :3000
const WebSocket = require('ws');
const URL = 'ws://localhost:3000';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗ FAIL:', label); }
}
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
async function walk(c, gxFn, gzFn, opts = {}) {
  const meS = c.state.p.find(p => p.i === c.id);
  let x = c.px ?? meS.x, z = c.pz ?? meS.z;
  for (let i = 0; i < 180; i++) {
    if (opts.untilBall && c.state.b.o === c.id) break;
    const gx = typeof gxFn === 'function' ? gxFn() : gxFn;
    const gz = typeof gzFn === 'function' ? gzFn() : gzFn;
    const dx = gx - x, dz = gz - z, d = Math.hypot(dx, dz);
    if (!opts.untilBall && d < 0.3) break;
    const st = Math.min(0.55, d);
    if (d > 0.01) { x += dx / d * st; z += dz / d * st; }
    c.send({ t: 'input', x, y: 0, z, yaw: c.yaw || 0, a: 1 });
    await sleep(40);
  }
  c.px = x; c.pz = z;
}

(async () => {
  const A = client('Ana'), foe = client('Rival'), mate = client('Buddy');
  await sleep(300);
  A.send({ t: 'join', name: 'Ana' });
  await sleep(150);
  foe.send({ t: 'join', name: 'Rival' });
  await sleep(150);
  mate.send({ t: 'join', name: 'Buddy' });
  await sleep(400);
  check(A.team === mate.team && A.team !== foe.team, `teams: Ana+Buddy vs Rival (${A.team}/${mate.team}/${foe.team})`);

  // start play first: Ana touches the ball then clears it into her own corner
  await walk(A, () => A.state.b.x, () => A.state.b.z, { untilBall: true });
  check(A.state.b.o === A.id, 'kickoff: Ana took first touch');
  const ownX = A.team === 'red' ? -1 : 1;
  const clearYaw = Math.atan2(-(ownX * (A.field.halfL * 0.7) - A.px), -(18 - A.pz));
  A.send({ t: 'shoot', pass: false, power: 0.35, yaw: clearYaw, pitch: 0.1, curve: 0 });
  await sleep(600);
  check(A.state.ph === 'play', 'phase is play');

  console.log('— whiffed slide penalty —');
  A.events.length = 0;
  A.send({ t: 'tackle', yaw: 0 });     // nobody anywhere near
  await sleep(250);
  const whiff = A.events.find(e => e.t === 'stunned');
  check(whiff && /missed slide/.test(whiff.by), 'whiff leaves you on the turf');
  const meW = A.state.p.find(p => p.i === A.id);
  check(meW.st === 1, 'whiff stun visible in state');
  await sleep(1200);

  console.log('— foul on a player without the ball —');
  // park foe away from the ball, Ana slides into him
  await walk(foe, 10, 10);
  await walk(A, 10, 12);
  const yawT = Math.atan2(-(foe.px - A.px), -(foe.pz - A.pz));
  A.send({ t: 'input', x: A.px, y: 0, z: A.pz, yaw: yawT, a: 0 });
  await sleep(1200);                    // let whiff stun + cooldown fully lapse
  A.events.length = 0; foe.events.length = 0;
  A.send({ t: 'tackle', yaw: yawT });
  await sleep(250);
  const st = A.state;
  const aS = st.p.find(p => p.i === A.id), fS = st.p.find(p => p.i === foe.id);
  check(fS.st === 1, 'victim goes down');
  check(aS.st === 1, 'tackler goes down too (foul)');
  check(A.events.some(e => e.t === 'chat' && /FOUL/.test(e.text || '')), 'foul announced');
  await sleep(1500);

  console.log('— assist tracking —');
  // clear the ball away from the pile-up if anyone is holding it
  if (A.state.b.o === foe.id) {
    // shouldn't happen, but don't let the test hang
    await sleep(500);
  }
  // move Ana to the ball (it was cleared into her corner, far from Rival)
  await walk(A, () => A.state.b.x, () => A.state.b.z, { untilBall: true });
  check(A.state.b.o === A.id, 'Ana has the ball');
  // Ana dribbles to midfield (ball follows the carrier), Buddy pushes up near the box
  const atkX = A.team === 'red' ? 1 : -1;
  await walk(A, 0, -6);                              // pass lane well clear of the stunned Rival
  await walk(mate, atkX * (A.field.halfL - 25), -6);
  // aim pass at Buddy
  const passYaw = Math.atan2(-(mate.px - A.px), -(mate.pz - A.pz));
  A.send({ t: 'shoot', pass: true, power: 0, yaw: passYaw, pitch: 0, curve: 0 });
  // Buddy collects
  await walk(mate, () => mate.state.b.x, () => mate.state.b.z, { untilBall: true });
  check(mate.state.b.o === mate.id, 'Buddy received the pass');
  // Buddy shoots at goal centre
  const gx2 = A.team === 'red' ? A.field.halfL + 1 : -A.field.halfL - 1;
  const shootYaw = Math.atan2(-(gx2 - mate.px), -(0 - mate.pz));
  mate.events.length = 0;
  mate.send({ t: 'shoot', pass: false, power: 1, yaw: shootYaw, pitch: 0.12, curve: 0 });
  let goal = null;
  for (let i = 0; i < 120 && !goal; i++) {   // up to 6s for the ball to travel
    goal = mate.events.find(e => e.t === 'goal') || A.events.find(e => e.t === 'goal');
    await sleep(50);
  }
  check(!!goal, 'goal scored off the pass');
  if (goal) {
    check(goal.scorer === 'Buddy', `scorer = Buddy (${goal.scorer})`);
    check(goal.assist === 'Ana', `assist = Ana (${goal.assist})`);
  }
  const anaS = A.state.p.find(p => p.i === A.id);
  check((anaS.as || 0) >= 1, `assist counted in stats (as=${anaS.as})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
