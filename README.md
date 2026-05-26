# ⚔️ The Eternal Quest

An 8-player real-time **co-op turn-based RPG** for the browser. Upload your photo as your hero portrait, pick one of 8 classes, and fight together through 10 stages (50 battles) to seal the Eternal Rift. Built with Node.js + Express + WebSockets — no database, no build step, deploy in minutes.

## ✨ Features

- **8 players, real-time co-op** over WebSockets — shared turn order by Speed.
- **Photo-as-hero**: each player's uploaded picture (compressed client-side) becomes their portrait.
- **6-stat system** — STR (physical), DEX (speed/crit/accuracy), INT (magic), VIT (HP/defense), WIS (mana), LUK (crit/rare effects). Combat stats are derived from these.
- **Rune-Slayer-style class paths** — every class advances **Base → Super (Lv 10) → Ultra (Lv 15)** with branching choices, for 8 base classes and 32 end-game specializations.
- **63 skills** with physical/magic/heal/buff/debuff types, multi-hit, crit, lifesteal, armor pierce, and status effects (poison, burn, freeze, stun, weaken, vulnerable, shield).
- **50 unique enemies** across 10 themed stages with distinct mechanics (enrage, thorns, lifesteal, shield, burn, freeze, execute) and a 3-phase final boss, **The Rift Lord**.
- **Enemy scaling** — both HP **and damage** scale with party size; difficulty ramps hard in the last three stages.
- **Mana regen each round** so casters stay in the fight.
- **Big loot pool** — 41 items across 5 rarities (common → legendary): weapons, armor, trinkets, and consumables, with per-player loot choices after each fight.
- **Sprite-based UI** using a 64px pixel-art icon set, with **CSS combat animations** — attack lunges, hit shakes, cast/slash effect overlays, and floating damage/crit numbers.
- Party sidebar with live HP/MP bars, your 6-stat panel, battle log, and party chat.

## 🚀 Run locally

```bash
npm install
npm start
# open http://localhost:3000 in several tabs to simulate multiple players
```

Requires Node.js 18+.

## ☁️ Deploy on Render

This repo includes `render.yaml`. On [Render](https://render.com):

1. Push this folder to a Git repo and create a new **Web Service** from it (or use the Blueprint / `render.yaml`).
2. Build command: `npm install` — Start command: `npm start`.
3. Render provides `PORT` automatically; the server reads `process.env.PORT`.
4. WebSockets work out of the box on Render web services. The client auto-detects `wss://` on HTTPS.

Free plan note: the instance sleeps when idle and game state is in memory, so a cold start resets any in-progress run.

## 🎮 How to play

1. **Upload a portrait** and **choose a class**, enter a name, and join the realm.
2. In the **lobby**, mark ready; any ready hero can **Begin Quest**.
3. **Equip** a weapon/armor/trinket from your inventory, then confirm.
4. **Combat** runs in Speed order. On your turn, use a skill (costs MP), a consumable, or Guard (recovers MP). Watch the enemy's mechanic.
5. After each win, **claim one loot reward**. After each stage boss, level-ups may trigger a **class advancement** choice (Super at Lv 10, Ultra at Lv 15).
6. Clear all 10 stages and defeat **The Rift Lord** to win.

## 🗂️ Project structure

```
server.js     — Express + ws server, game loop, turn engine, enemy AI (crash-guarded)
combat.js     — stat derivation, skill/item resolution, status effects
content.js    — classes, class paths, skills, items, 10 stages of enemies
sprites.js    — sprite-sheet index → grid-position helper
public/
  index.html  — full client (UI, all phases, sprite rendering, animations)
  assets/
    icons64.png — pixel-art icon sheet (16-column grid, 64px cells)
render.yaml   — Render deployment config
```

## 🧱 Tech

Vanilla JS client (no framework, no bundler), Node.js server, `ws` for WebSockets, `uuid` for session IDs. State is in memory. Built to be readable and hackable.
