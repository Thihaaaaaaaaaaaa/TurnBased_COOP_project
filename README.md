# ⚔️ The Eternal Quest — 8-Player Co-op RPG

A real-time multiplayer fantasy RPG where **your uploaded photo becomes your hero's portrait**. Up to 8 players adventure together through 10 cursed realms, fighting in shared turn-based combat, evolving their classes, and building per-player kits of abilities and gear.

## 🎮 The Game

- **Upload your face** → it becomes your circular hero portrait.
- **4 classes**: Warrior ⚔️ · Mage 🔮 · Rogue 🗡️ · Ranger 🏹 — each with a unique playstyle.
- **10 realms × 5 rounds = 50 fights**, with a **boss every 5th round**. Difficulty ramps hard — the final realms are brutal.
- **Unique enemy mechanics**: poison, burn, freeze, thorns (reflect), lifesteal, enrage, shields, execute, and multi-phase bosses.
- **Equip between realms**: choose up to **4 abilities** plus a weapon / armor / trinket from your own inventory.
- **Three evolutions** (after realms 3, 6 & 9): each class ascends, gaining powerful new abilities and stat boosts.
- **Per-player loot**: after each non-boss round you pick 1 of 3 rewards, kept for the whole run (stored in your session).
- **40 abilities + 22 items** across all classes and tiers.
- Real-time party sidebar (HP/MP/status), battle log, and party chat.

## 🚀 Deploy on Render

1. Push this folder to a GitHub repo.
2. In Render, create a **New Web Service** from the repo (the included `render.yaml` auto-configures it).
   - Build: `npm install`  ·  Start: `npm start`  ·  Plan: Free
3. Open the live URL. Share it — up to 8 players can join the same realm.

> The server uses `process.env.PORT` (Render sets this automatically). The client auto-detects `wss://` over HTTPS, so it works on Render out of the box.

## 🖥️ Run locally

```bash
npm install
npm start
# open http://localhost:3000  (open multiple tabs to simulate players)
```

## 🗂️ Files
- `server.js` — Express + WebSocket server: sessions, phases, turn order, enemy AI, evolution, loot.
- `content.js` — all game data: classes, abilities, items, 10 stages of enemies, loot tables.
- `combat.js` — combat engine: status effects, ability effects, damage/shield/dodge resolution.
- `public/index.html` — the full client (UI, all phases, atmosphere).
- `render.yaml` — Render deploy config.

## ⚙️ Notes
- State is in-memory (no database). Sessions expire after 15 min idle or on disconnect.
- Max 8 players; a 9th sees a "realm full" screen.
- Photos are compressed client-side to 200×200 JPEG before sending.
