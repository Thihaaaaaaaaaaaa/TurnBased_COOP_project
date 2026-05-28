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
2. **Day** — 20s timer, vote to eliminate someone, skip by majority
3. **Night** — Each special role gets 25s to act, auto-skip on timeout
4. **Win** — Town wins when all killers eliminated; Killers win at 1:1 ratio

---

## Tech Stack
- **Server**: Node.js + Express + `ws` (WebSocket)
- **Client**: React + Vite
- **Hosting**: Render (WebSocket-compatible)
