// goalkeeper + 5v5 test — run with server on :3000
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
    else { c.events.push(m); if (m.t === 'full') c.full = true; }
  });
  c.send = (o) => c.ws.send(JSON.stringify(o));
  return c;
}
async function walkTo(c, tx, tz, opts = {}) {
  const meS = c.state.p.find(p => p.i === c.id);
  let x = c.px ?? meS.x, z = c.pz ?? meS.z;
  for (let i = 0; i < 160; i++) {
    if (opts.untilBall && c.state.b.o === c.id) break;
    const gx = opts.chaseBall ? c.state.b.x : tx;
    const gz = opts.chaseBall ? c.state.b.z : tz;
    const dx = gx - x, dz = gz - z, d = Math.hypot(dx, dz);
    if (!opts.chaseBall && d < 0.3) break;
    const st = Math.min(0.55, d);
    if (d > 0.01) { x += dx / d * st; z += dz / d * st; }
    c.send({ t: 'input', x, y: 0, z, yaw: c.yaw || 0, a: 1 });
    await sleep(40);
  }
  c.px = x; c.pz = z;
  return { x, z };
}

(async () => {
  console.log('— 5 v 5 cap —');
  const cs = [];
  for (let i = 0; i < 10; i++) { cs.push(client('P' + i)); }
  await sleep(400);
  cs.forEach((c, i) => c.send({ t: 'join', name: 'P' + i }));
  await sleep(600);
  const reds = cs.filter(c => c.team === 'red').length;
  const blues = cs.filter(c => c.team === 'blue').length;
  check(reds === 5 && blues === 5, `10 players split 5v5 (${reds}/${blues})`);

  const extra = client('P10');
  await sleep(300);
  extra.send({ t: 'join', name: 'P10' });
  await sleep(400);
  check(extra.full && !extra.id, '11th player rejected with full message');
  extra.ws.close();

  console.log('— goalkeeper role —');
  const A = cs[0];                     // will be keeper
  const mateSame = cs.find(c => c !== A && c.team === A.team);
  const foe = cs.find(c => c.team !== A.team);
  A.send({ t: 'role', gk: true });
  await sleep(300);
  let meA = A.state.p.find(p => p.i === A.id);
  check(meA.r === 1, 'role gk visible in state');
  mateSame.send({ t: 'role', gk: true });
  await sleep(300);
  const mateS = A.state.p.find(p => p.i === mateSame.id);
  check(mateS.r !== 1, 'second keeper on same team rejected');
  check(mateSame.events.some(e => e.t === 'chat' && /already/.test(e.text || '')), 'rejection message sent');

  console.log('— dive catch in own box —');
  // put keeper in his own box near goal centre
  const sideX = A.team === 'red' ? -1 : 1;
  const gx = sideX * (A.field.halfL - 3);
  await walkTo(A, gx, 0);
  A.yaw = A.team === 'red' ? Math.PI / 2 : -Math.PI / 2; // face own goal-ward? face outward: forward should point to pitch centre
  // aim outward toward centre: forward=(-sin,-cos) should be (-sideX,0) => sin(yaw)=sideX => yaw = sideX>0? PI/2 : -PI/2
  A.yaw = sideX > 0 ? Math.PI / 2 : -Math.PI / 2;
  A.send({ t: 'input', x: A.px, y: 0, z: A.pz, yaw: A.yaw, a: 0 });

  // foe grabs the ball at centre and shoots at that goal
  await walkTo(foe, 0, 0, { chaseBall: true, untilBall: true });
  check(foe.state.b.o === foe.id, 'attacker has the ball');
  const shootYaw = Math.atan2(-(gx - foe.px), -(0 - foe.pz));
  foe.send({ t: 'shoot', pass: false, power: 0.45, yaw: shootYaw, pitch: 0.12, curve: 0 });
  // keeper watches the ball and dives when it's close
  let caught = false;
  for (let i = 0; i < 80; i++) {
    const b = A.state.b;
    const d = Math.hypot(b.x - A.px, b.z - A.pz);
    if (b.o === A.id) { caught = true; break; }
    if (b.o == null && d < 3.2) A.send({ t: 'dive', yaw: A.yaw });
    await sleep(50);
  }
  await sleep(250);   // let a carry tick run so the ball sits in the keeper's hands
  meA = A.state.p.find(p => p.i === A.id);
  check(caught, 'keeper gathered the shot');
  check(meA.sv >= 1, `save counted (saves=${meA.sv})`);
  check(A.events.some(e => e.t === 'fx' && (e.kind === 'catch' || e.kind === 'punch')), 'catch/punch fx broadcast');
  check(A.state.b.y > 0.8, 'keeper carries ball in hands (y=' + A.state.b.y + ')');

  console.log('— keeper smother takes carrier down —');
  // keeper punts it away, foe collects, dribbles near keeper, keeper dives at his feet
  A.send({ t: 'shoot', pass: false, power: 0.5, yaw: A.yaw, pitch: 0.3, curve: 0 });
  await sleep(800);
  await walkTo(foe, 0, 0, { chaseBall: true, untilBall: true });
  check(foe.state.b.o === foe.id, 'attacker regained ball');
  // bring attacker to the keeper
  await walkTo(foe, A.px + 1.5, A.pz);
  await sleep(1800); // let dive cooldown lapse
  A.send({ t: 'dive', yaw: Math.atan2(-(foe.px - A.px), -(foe.pz - A.pz)) });
  await sleep(300);
  const foeS = A.state.p.find(p => p.i === foe.id);
  check(A.state.b.o === A.id, 'smother stole the ball off carrier\'s feet');
  check(foeS.st === 1, 'carrier knocked down (stunned)');
  check(foe.events.some(e => e.t === 'stunned'), 'carrier received stunned event');

  console.log('— give up gloves —');
  A.send({ t: 'role', gk: false });
  await sleep(300);
  meA = A.state.p.find(p => p.i === A.id);
  check(meA.r === 0, 'role back to field');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
