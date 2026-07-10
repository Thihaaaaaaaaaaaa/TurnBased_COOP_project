# ⚽ Kickoff Arena

Multiplayer **first-person 3D soccer** in the browser. Node.js + WebSockets on the server, Three.js on the client. One global arena — a full-stadium-scale pitch (3x the area of v1), up to **10 v 10**, 5-minute matches with **golden-goal overtime**, penalties, and powerup pads. Auto team balancing; the 21st player is politely turned away.

## Controls

| Input | Action |
|---|---|
| WASD | Move |
| Mouse | Look / aim |
| Shift | Sprint (drains stamina, ball knocks on further ahead) |
| Space | Jump |
| **LMB tap** | Pass (aim-assisted to the best teammate in your cone) |
| **LMB hold + release** | Charged shot — flies **exactly where you're looking**, longer hold = more power |
| **A / D while charging** | **Curl the shot** (Magnus effect bends it mid-flight) |
| **hold C at release** | **Chip / lob** — floats it over the keeper and drops fast |
| **Space, then LMB** (timed) | **BICYCLE KICK**: face *away* from where you want it to go, jump, click inside the window. A live hitbox tracks the ball for 0.75s — connect and it rockets over your head; miss and you eat turf |
| **Jump into the ball** | **Header** — if your head meets an airborne ball, it's nodded wherever you're looking |
| **Q** | **Foot jab** — short poke steal: less range than the slide, **no recoil, no knockdown, 0.8s cooldown** |
| **R** (with the ball) | **Roulette** — 360° spin, 0.7s of tackle/jab immunity (sliders whiff right through you) |
| **X** (with the ball) | **Drag-back** — pull it behind you and spin off |
| **F** (with the ball) | **Rainbow flick** — pop it over a defender; they can't grab it mid-air, you can run onto it |
| RMB or E | Slide tackle — crawl-flat along the turf; the carrier gets knocked down and the ball pops loose (2s cooldown) |
| **G** | **Become your team's goalkeeper** (one per team, gold kit, 🧤 tag). Press again to give up the gloves |
| RMB or E *(as keeper)* | **Dive** (A/D picks the side): catch shots clean in your box, punch clear fast/out-of-box balls, or smother the ball off a carrier's feet — they go down |
| Tab | Scoreboard (goals / tackles) |
| Enter | Chat |

## Run locally

```bash
npm install
npm start          # http://localhost:3000
```

Open two browser windows to test multiplayer.

## Deploy on Render

1. Push this folder to a GitHub repo.
2. Render → **New → Web Service** → connect the repo.
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
4. Done. Render sets `PORT` automatically and its proxy supports WebSockets out of the box (the client auto-uses `wss://` on https).

Note: on the free tier the service sleeps after inactivity — first visitor waits ~30s for spin-up, and everyone shares one instance (that's fine: it's one global match room).

## Architecture

- **Server-authoritative ball** — physics (gravity, bounces, roll friction, Magnus curve), possession, tackles, goals, and match flow all simulated at 30Hz on the server. Clients can't cheat the ball.
- **Client-authoritative movement** with server-side sanity checks (speed/teleport clamps) — keeps your own movement lag-free.
- **Interpolation** — remote players and the ball render ~120ms in the past between snapshots, so motion is smooth at any tick rate.
- **Local prediction for dribbling** — when *you* own the ball it's glued in front of your camera locally (zero-lag feel) while the server keeps the true state.

## Your assets

- `public/assets/FootBall.glb` — your soccer ball model (from SoccerBall.zip), auto-normalized to match physics radius.
- `public/assets/HumanM_Model.fbx` + `anim_*.fbx` — the Human Basic Motions rig; other players are fully animated (idle / run / sprint / fall) with team-color tinting. If loading ever fails, the game gracefully falls back to capsule players.
- `football_thingys.blend` — **not included yet**: browsers can't load `.blend`. Open it in Blender → *File → Export → glTF 2.0 (.glb)* → drop it in `public/assets/` and tell me what's in it (stadium? goals? props?) and I'll wire it into the scene.

## Set pieces, overtime & powerups

- **Penalties**: a foul inside the defender's own box awards a penalty — the fouled player takes it alone against the keeper (8s shot clock, nobody else can touch the ball until it's struck; rebounds are live).
- **Golden goal**: if the clock hits zero level, the match goes to sudden death — clock shows **GG ⚡**, next goal wins.
- **Powerup pads**: six glowing pads on the pitch — ⚡ **speed** (+35% for 5s), 💥 **power shot** (next strike is supercharged), ∞ **stamina** (6s of free sprint). Pads respawn 20s after pickup with a random type. Visible on the radar.

## Goalkeeper rules

- One keeper per team; keepers wear a gold-tinted kit and a 🧤 name tag so teams stay unmistakably red vs blue with the keeper obvious.
- Inside their own box keepers have longer reach, can pluck high balls out of the air, and carry the ball **in their hands** at chest height.
- Shots faster than ~28 m/s (or dives outside the box) are **parried/punched clear** instead of caught.
- Saves are tracked on the Tab scoreboard alongside goals and tackles.
- No crawl/dive clips exist in the FREE motion pack, so nearby clips are substituted: Fall01 held flat = slide tackle & dive, Jump01-Land = the knockdown collapse. Swap in real clips later by dropping FBX files over `public/assets/anim_*.fbx`.

## Discipline & stats

- **Whiffed slides hurt**: miss a tackle and you eat turf for 0.7s — time your slides.
- **Fouls**: sliding into a player who *doesn't* have the ball takes you both down and gets announced ("FOUL!"). Fouls are tracked server-side.
- **Assists**: complete a pass to a teammate who scores within 10s and you get the assist — shown in the goal banner and on the Tab scoreboard (interceptions break the chain).
- **Radar** (bottom-right): live top-down map — red/blue dots, gold-ringed keepers, yellow ball, and your own facing tick. No more getting mugged from behind.
- **AFK cleanup**: connections silent for 90s are dropped so they don't hog a 5v5 slot.
- Goals now come with team-colored confetti bursting from the net, and fast shots leave a golden trail.

## Match rules

- Teams auto-balance on join; first touch after kickoff starts play.
- Goals: ball fully crosses the line inside the mouth, under the bar. Scorer gets credit (own goals stay anonymous).
- 5:00 matches → full-time banner → auto-restart with fresh scores.
