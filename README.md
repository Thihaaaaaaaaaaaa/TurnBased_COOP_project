# 🤠 DEADWOOD — The Reckoning
### A Western Mafia Game

---

## Deploy to Render (Free)

1. Push this folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Render will auto-detect `render.yaml`
5. Click **Deploy** — done!

**Or manually:**
- Build Command: `npm install && cd client && npm install && npm run build`
- Start Command: `npm start`
- Environment: Node
- Port: `3001`

---

## Local Dev

```bash
# Install server deps
npm install

# Install & build client
cd client && npm install && npm run build && cd ..

# Start server (serves built client + WebSocket)
npm start
```
Open `http://localhost:3001`

---

## Roles

### 🔫 Killers
| Role | Ability | Cooldown |
|------|---------|----------|
| The Outlaw | Kill every night | None |
| Gemini Killer | Schedule a kill 1-2 nights ahead | None |
| Bay Harbor Butcher | Kill OR investigate, kill every 2 turns | 2 turns |

### 💉 Doctors
| Role | Ability | Cooldown |
|------|---------|----------|
| Doc Holliday | Protect one player each night | None |
| The Surgeon | Revive a dead player | 2 turns |
| The Police | Designate protection target during day | 1 turn |

### 🔍 Detectives
| Role | Ability | Special |
|------|---------|---------|
| The Detective | Check one role per night | — |
| The Sheriff | Check roles + RPS showdown | 1v1 if last 2 alive |
| The Forensic | One-time killer variant guess | Correct = 2 checks/night |

---

## Game Flow
1. **Lobby** — Host configures roles (1-2 of each type), players ready up, need 4+ to start
2. **Role Selection** — Each player dealt a *category* picks their own variant from a card chooser (25s, auto-picks if you stall; taken variants are locked when 2 share a category)
3. **Day** — 30s timer with a big synced countdown clock, vote to eliminate, skip by majority. Spin the revolver chamber toy to pass the time
4. **Night** — Each special role gets 25s to act (big clock shown), auto-skip on timeout
5. **Win** — Town wins when all killers eliminated; Killers win at 1:1 ratio; Sheriff vs last killer triggers a Rock-Paper-Scissors showdown

## Interactive Features
- **2D saloon scene** — animated poker-table view with characters around it; speech bubbles when players chat, vote badges on names, target reticles on selection, slumping death animations with blood pools and RIP markers, action pulses when special roles act at night. Day/night ambient lighting transitions.
- **Room codes** — create a saloon and share its 4-letter code, or join one. Multiple games run at once, fully isolated. Empty rooms expire after 60s.
- **Town chat & ghost chat** — living players chat during the day; the dead get their own ghost channel (and can still read town talk). The living are hushed at night.
- **Sound effects** — procedural Web Audio (no asset files): gunshots, chamber clicks, dawn/dusk stings, win/lose fanfares, clock ticks under 5s, chat blips. Toggle with the 🔊 button.
- **Pick-your-own-variant** role selection screen with conflict resolution
- **Big center countdown clock** synced across all clients via server timestamp
- **Revolver chamber spinner** — a Russian-roulette time-waster during day/night
- Dynamic western UI: film grain, dust, smoke, ravens, tumbleweeds, sun/moon, flickering signs, wanted-poster styling, flip-card role reveal

## Swapping in real sprites
The 2D characters in the saloon scene are currently procedural SVG (drawn inline, no asset files). To replace with real sprite art:
1. Drop your PNGs into `client/public/sprites/` (e.g., `cowboy-1.png`, `cowboy-1-dead.png`, etc.)
2. Edit `client/src/components/Character.jsx` and replace the `<svg>...</svg>` markup with `<img className="char-img" src={...}/>` keyed by the `variant` index (0–9 are pre-mapped, deterministically per player ID)
3. The `.char-img` CSS class already has `image-rendering: pixelated` for crisp pixel-art scaling
4. Animation states are: `idle` (default), `dead`, `eliminated`, plus overlays for `talking`, `voted`, `targeted`, `acting`

---

## Tech Stack
- **Server**: Node.js + Express + `ws` (WebSocket)
- **Client**: React + Vite
- **Hosting**: Render (WebSocket-compatible)
