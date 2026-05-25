# ⚔️ The Eternal Quest — 8-Player Multiplayer RPG

A real-time co-op RPG where up to 8 players upload their photo, choose a class, and fight through 5 zones together to collect the Shards and seal the Rift.

## Features

- **8-player co-op** with WebSocket real-time sync
- **Photo upload** — your face becomes your hero portrait
- **4 classes**: Warrior, Mage, Rogue, Ranger — each with unique skills
- **Turn-based combat** — take turns attacking the shared enemy
- **Democratic zone voting** — majority vote decides where to go next
- **Session management** — 10-min idle TTL, full lobby rejects new players
- **Party chat** + live battle log
- **5 zones** with scaling enemies and shared loot/XP

---

## Deploying to Render (Free)
```

###  Create Render Web Service
1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Render auto-detects `render.yaml` — just click **Deploy**

### Manual settings (if not using render.yaml):
| Setting | Value |
|---|---|
| Environment | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free |

###  Share the URL
Give your players the Render URL (e.g. `https://eternal-quest.onrender.com`).
Up to 8 people can join. If full, new visitors see a "Realm Full" screen.

---

## Local Development

```bash
npm install
npm run dev
# Open http://localhost:3000
```

---

## Architecture

```
Browser clients (up to 8)
    │
    │  WebSocket (ws://)
    ▼
Node.js + Express server (server.js)
    ├── Session manager  (10-min TTL, max 8 slots)
    ├── Game state       (in-memory, shared world)
    └── Static files     (public/index.html)
```

All game state lives in server memory — no database needed. State resets if the server restarts (expected on Render free tier after idle).

---

## Game Flow

1. **Lobby** — Players upload photo, pick class & name, mark ready
2. **Adventure** — Vote on which zone to tackle (majority wins)
3. **Combat** — Turn-based: each player acts in order; enemy retaliates after each turn
4. **Victory** — All 5 shards collected → credits screen → play again

### Session Rules
- New connection → assigned a session ID
- Idle > 10 minutes → auto-removed
- Tab closed → instant removal
- Lobby full (8/8) → new visitors see "Realm Full" with a refresh button

---

## File Structure

```
eternal-quest/
├── server.js          ← Node.js WebSocket + Express server
├── package.json
├── render.yaml        ← Render deployment config
├── README.md
└── public/
    └── index.html     ← Full game client (single file)
```
