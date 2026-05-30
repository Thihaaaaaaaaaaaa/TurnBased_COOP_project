import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { ROLE_INFO, getRoleLabel, KILLER_VARIANTS, CATEGORY_ALL } from './utils/roles';
import { sfx, setSoundEnabled, isSoundEnabled } from './utils/sound';
import { SaloonScene } from './components/SaloonScene';
import './App.css';

// ─── Atmosphere: Dust ──────────────────────────────────────────────────────────
function DustParticles({ count = 25 }) {
  const particles = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 10}s`,
    duration: `${8 + Math.random() * 10}s`,
    size: `${2 + Math.random() * 5}px`,
    opacity: 0.3 + Math.random() * 0.5,
  }));
  return (
    <div className="dust-container">
      {particles.map(p => (
        <div key={p.id} className="dust-particle" style={{
          left: p.left, width: p.size, height: p.size,
          animationDelay: p.delay, animationDuration: p.duration, opacity: p.opacity,
        }} />
      ))}
    </div>
  );
}

// ─── Atmosphere: Smoke clouds ──────────────────────────────────────────────────
function SmokeAtmosphere({ count = 4 }) {
  const clouds = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${10 + Math.random() * 80}%`,
    delay: `${Math.random() * 12}s`,
    duration: `${14 + Math.random() * 8}s`,
  }));
  return (
    <div className="smoke-container">
      {clouds.map(c => (
        <div key={c.id} className="smoke-cloud" style={{
          left: c.left, animationDelay: c.delay, animationDuration: c.duration
        }} />
      ))}
    </div>
  );
}

// ─── Atmosphere: Ravens flying ─────────────────────────────────────────────────
function Ravens({ count = 2 }) {
  const ravens = Array.from({ length: count }, (_, i) => ({
    id: i,
    top: `${10 + Math.random() * 30}%`,
    delay: `${Math.random() * 20}s`,
    duration: `${15 + Math.random() * 10}s`,
  }));
  return (
    <div className="raven-container">
      {ravens.map(r => (
        <div key={r.id} className="raven" style={{
          top: r.top, animationDelay: r.delay, animationDuration: r.duration
        }}>🦅</div>
      ))}
    </div>
  );
}

// ─── Atmosphere: Tumbleweed ────────────────────────────────────────────────────
function Tumbleweed({ count = 1 }) {
  const weeds = Array.from({ length: count }, (_, i) => ({
    id: i,
    delay: `${5 + Math.random() * 25}s`,
    duration: `${10 + Math.random() * 6}s`,
  }));
  return (
    <div className="raven-container">
      {weeds.map(w => (
        <div key={w.id} className="tumbleweed" style={{
          animationDelay: w.delay, animationDuration: w.duration
        }}>🌾</div>
      ))}
    </div>
  );
}

// ─── Scanline CRT effect ───────────────────────────────────────────────────────
function Scanline() {
  return <div className="scanline-overlay" />;
}

// ─── Wanted Poster Player Card ─────────────────────────────────────────────────
function WantedCard({ player, onAction, actionLabel, disabled, isMe, isTarget, isDead }) {
  return (
    <div className={`wanted-card ${isDead ? 'dead' : ''} ${isTarget ? 'targeted' : ''} ${isMe ? 'is-me' : ''}`}
      onClick={!disabled && !isDead ? onAction : undefined}>
      <div className="wanted-header">WANTED</div>
      <div className="wanted-portrait">
        <div className="portrait-silhouette">
          {isDead ? '💀' : player.isHost ? '🤠' : '👤'}
        </div>
      </div>
      <div className="wanted-name">{player.name}</div>
      {isDead && <div className="dead-stamp">DECEASED</div>}
      {isMe && <div className="me-badge">YOU</div>}
      {actionLabel && !disabled && !isDead && (
        <div className="action-hint">{actionLabel}</div>
      )}
    </div>
  );
}

// ─── Timer Ring ────────────────────────────────────────────────────────────────
function TimerRing({ duration, onComplete, label }) {
  const [timeLeft, setTimeLeft] = useState(duration / 1000);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setTimeLeft(duration / 1000);
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const remaining = Math.max(0, duration / 1000 - elapsed);
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onComplete?.();
      }
    }, 100);
    return () => clearInterval(interval);
  }, [duration]);

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const progress = timeLeft / (duration / 1000);
  const dashOffset = circumference * (1 - progress);
  const urgentColor = timeLeft < 5 ? '#c0392b' : timeLeft < 10 ? '#e67e22' : '#c9a84c';

  return (
    <div className="timer-ring-container">
      <svg width="130" height="130" className="timer-svg">
        <circle cx="65" cy="65" r={radius} className="timer-track" />
        <circle cx="65" cy="65" r={radius}
          className="timer-progress"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: dashOffset,
            stroke: urgentColor,
            transition: 'stroke-dashoffset 0.1s linear, stroke 0.5s',
            filter: `drop-shadow(0 0 8px ${urgentColor})`,
          }}
        />
        <text x="65" y="60" className="timer-text" fill={urgentColor}>{Math.ceil(timeLeft)}</text>
        <text x="65" y="78" className="timer-label-text">{label}</text>
      </svg>
    </div>
  );
}

// ─── Big Center Clock (syncs to server phaseEndsAt) ────────────────────────────
function BigClock({ endsAt, totalMs, label }) {
  const [now, setNow] = useState(Date.now());
  const lastTickRef = useRef(null);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, []);

  if (!endsAt) return null;
  const remaining = Math.max(0, endsAt - now);
  const secs = Math.ceil(remaining / 1000);

  // Tick sound on each whole second when <= 5s remain
  if (secs <= 5 && secs >= 1 && lastTickRef.current !== secs) {
    lastTickRef.current = secs;
    sfx.tick();
  }
  if (secs > 5) lastTickRef.current = null;

  const total = totalMs || 30000;
  const progress = Math.max(0, Math.min(1, remaining / total));

  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);
  const urgent = secs <= 5;
  const warning = secs <= 10 && secs > 5;
  const color = urgent ? '#e63946' : warning ? '#e67e22' : '#f4d03f';

  return (
    <div className={`big-clock ${urgent ? 'urgent' : ''}`}>
      <svg width="220" height="220" viewBox="0 0 220 220" className="big-clock-svg">
        {/* Outer decorative ring */}
        <circle cx="110" cy="110" r="104" fill="none" stroke="rgba(201,168,76,0.2)" strokeWidth="2" strokeDasharray="4 6" />
        {/* Tick marks */}
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 30 - 90) * Math.PI / 180;
          const x1 = 110 + Math.cos(angle) * 98;
          const y1 = 110 + Math.sin(angle) * 98;
          const x2 = 110 + Math.cos(angle) * 88;
          const y2 = 110 + Math.sin(angle) * 88;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(201,168,76,0.4)" strokeWidth="2" />;
        })}
        {/* Track */}
        <circle cx="110" cy="110" r={radius} fill="none" stroke="rgba(15,7,0,0.6)" strokeWidth="10" />
        {/* Progress */}
        <circle cx="110" cy="110" r={radius} fill="none"
          stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 110 110)"
          style={{ transition: 'stroke-dashoffset 0.2s linear, stroke 0.4s', filter: `drop-shadow(0 0 12px ${color})` }}
        />
        <text x="110" y="118" textAnchor="middle" className="big-clock-num"
          fill={color} style={{ filter: `drop-shadow(0 0 10px ${color})` }}>{secs}</text>
        <text x="110" y="150" textAnchor="middle" className="big-clock-label">{label}</text>
      </svg>
    </div>
  );
}

// ─── Revolver Chamber Spinner (time-waster toy) ────────────────────────────────
function RevolverSpinner() {
  const [chambers, setChambers] = useState(() => {
    const arr = [false, false, false, false, false, false];
    arr[Math.floor(Math.random() * 6)] = true; // one live round
    return arr;
  });
  const [position, setPosition] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState(null); // 'click' | 'bang'
  const [pulls, setPulls] = useState(0);
  const [survived, setSurvived] = useState(0);

  const spin = () => {
    if (spinning) return;
    setResult(null);
    setSpinning(true);
    sfx.spin();
    const spins = 3 + Math.floor(Math.random() * 4);
    const landingPos = Math.floor(Math.random() * 6);
    const totalRot = rotation + spins * 360 + landingPos * 60;
    setRotation(totalRot);
    setPosition(landingPos);
    setTimeout(() => {
      setSpinning(false);
    }, 1200);
  };

  const pull = () => {
    if (spinning) return;
    const isLive = chambers[position];
    setPulls(p => p + 1);
    if (isLive) {
      setResult('bang');
      sfx.gunshot();
      // reset with new live round after a moment
      setTimeout(() => {
        const arr = [false, false, false, false, false, false];
        arr[Math.floor(Math.random() * 6)] = true;
        setChambers(arr);
        setSurvived(0);
        setResult(null);
      }, 1500);
    } else {
      setResult('click');
      sfx.click();
      setSurvived(s => s + 1);
      // advance chamber
      setPosition(p => (p + 1) % 6);
      setRotation(r => r + 60);
      setTimeout(() => setResult(null), 800);
    }
  };

  return (
    <div className="revolver-toy">
      <div className="revolver-toy-title">🎲 Russian Roulette — pass the time</div>
      <div className={`revolver-chamber-wrap ${result === 'bang' ? 'bang' : ''}`}>
        <div className="revolver-cylinder" style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? 'transform 1.2s cubic-bezier(0.3,0.9,0.4,1)' : 'transform 0.3s ease-out' }}>
          {chambers.map((live, i) => {
            const angle = i * 60;
            return (
              <div key={i} className="chamber-hole" style={{ transform: `rotate(${angle}deg) translateY(-58px)` }}>
                <div className={`chamber-dot ${live ? 'live' : ''}`} />
              </div>
            );
          })}
          <div className="cylinder-center">🤠</div>
        </div>
        <div className="revolver-hammer" />
        {result === 'click' && <div className="revolver-result click">CLICK</div>}
        {result === 'bang' && <div className="revolver-result bang">💥 BANG!</div>}
      </div>
      <div className="revolver-stats">
        <span>Survived: <strong>{survived}</strong></span>
        <span>Pulls: <strong>{pulls}</strong></span>
      </div>
      <div className="revolver-buttons">
        <button className="revolver-btn spin" onClick={spin} disabled={spinning}>🔄 Spin</button>
        <button className="revolver-btn pull" onClick={pull} disabled={spinning || result === 'bang'}>🔫 Pull Trigger</button>
      </div>
    </div>
  );
}

// ─── Role Selection Screen ─────────────────────────────────────────────────────
function RoleSelectScreen({ category, available, selected, pending, waitingCount, onSelect, players, myId }) {
  const catLabels = {
    killer: { title: 'CHOOSE YOUR OUTLAW', emoji: '🔫', color: '#c0392b', sub: 'How will you deal death?' },
    doctor: { title: 'CHOOSE YOUR HEALER', emoji: '💉', color: '#2a7a4f', sub: 'How will you save lives?' },
    detective: { title: 'CHOOSE YOUR LAWMAN', emoji: '🔍', color: '#7a6a2a', sub: 'How will you find the truth?' },
  };
  const info = catLabels[category] || { title: 'CHOOSE YOUR ROLE', emoji: '🎭', color: '#c9a84c', sub: '' };

  // Civilian or non-special: just wait
  if (!category || category === 'civilian') {
    return (
      <div className="roleselect-screen">
        <DustParticles count={20} />
        <SmokeAtmosphere count={2} />
        <div className="roleselect-content animate-burn">
          <div className="roleselect-civilian">
            <div className="civ-big-emoji">🤠</div>
            <div className="roleselect-title">YOU RIDE AS A CIVILIAN</div>
            <div className="roleselect-sub">No special powers — just your wits and your vote.</div>
            <div className="roleselect-waiting">
              <span className="waiting-spinner">⭐</span>
              Waiting on {waitingCount} gunslinger{waitingCount !== 1 ? 's' : ''} to choose...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="roleselect-screen" style={{ '--cat-color': info.color }}>
      <DustParticles count={25} />
      <SmokeAtmosphere count={3} />
      <Scanline />
      <div className="roleselect-content animate-burn">
        <div className="roleselect-emoji" style={{ color: info.color }}>{info.emoji}</div>
        <div className="roleselect-title" style={{ color: info.color }}>{info.title}</div>
        <div className="roleselect-sub">{info.sub}</div>

        {selected ? (
          <div className="roleselect-locked animate-stamp">
            <div className="locked-check">✓</div>
            <div className="locked-role">{ROLE_INFO[selected]?.emoji} {ROLE_INFO[selected]?.label}</div>
            <div className="locked-msg">Locked in! Waiting on {waitingCount} other{waitingCount !== 1 ? 's' : ''}...</div>
          </div>
        ) : (
          <div className="roleselect-cards">
            {CATEGORY_ALL[category].map(variant => {
              const rInfo = ROLE_INFO[variant];
              const isAvailable = available.includes(variant);
              const rgb = hexToRgb(rInfo.color);
              return (
                <button key={variant}
                  className={`roleselect-card ${!isAvailable ? 'taken' : ''}`}
                  style={{ '--rc': rInfo.color, '--rc-rgb': rgb }}
                  onClick={() => isAvailable && onSelect(variant)}
                  disabled={!isAvailable}>
                  <div className="rsc-emoji">{rInfo.emoji}</div>
                  <div className="rsc-name">{rInfo.label}</div>
                  <div className="rsc-desc">{rInfo.description}</div>
                  <div className="rsc-flavor">"{rInfo.flavor}"</div>
                  {!isAvailable && <div className="rsc-taken-stamp">TAKEN</div>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── RPS Showdown Screen ───────────────────────────────────────────────────────
function RPSShowdown({ state, myId, onChoice }) {
  const [chosen, setChosen] = useState(null);
  const [countdown, setCountdown] = useState(15);
  const choices = ['rock', 'paper', 'scissors'];
  const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
  const isParticipant = myId === state?.sheriffId || myId === state?.killerId;

  useEffect(() => {
    const timer = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setCountdown(15);
    setChosen(null);
  }, [state?.round]);

  const handleChoice = (c) => {
    if (chosen) return;
    setChosen(c);
    onChoice(c);
  };

  return (
    <div className="rps-overlay">
      <div className="rps-container animate-burn">
        <div className="rps-title rye">⭐ HIGH NOON SHOWDOWN ⭐</div>
        <div className="rps-subtitle">The town holds its breath...</div>
        <div className="rps-round">Round {state?.round || 1}</div>

        <div className="rps-players">
          <div className="rps-player sheriff-side">
            <div className="rps-role-badge">SHERIFF</div>
            <div className="rps-emoji">⭐</div>
            <div className="rps-player-indicator">
              {state?.choices?.[state?.sheriffId] ? '✓ READY' : '⏳ CHOOSING'}
            </div>
          </div>
          <div className="rps-vs">VS</div>
          <div className="rps-player killer-side">
            <div className="rps-role-badge">KILLER</div>
            <div className="rps-emoji">🔫</div>
            <div className="rps-player-indicator">
              {state?.choices?.[state?.killerId] ? '✓ READY' : '⏳ CHOOSING'}
            </div>
          </div>
        </div>

        {isParticipant && !chosen && (
          <div className="rps-choices">
            <div className="rps-prompt">DRAW YOUR WEAPON — {countdown}s</div>
            <div className="rps-buttons">
              {choices.map(c => (
                <button key={c} className="rps-choice-btn" onClick={() => handleChoice(c)}>
                  <span className="rps-choice-emoji">{emojis[c]}</span>
                  <span className="rps-choice-label">{c.toUpperCase()}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {isParticipant && chosen && (
          <div className="rps-chosen">
            You drew: {emojis[chosen]} {chosen.toUpperCase()} — waiting for opponent...
          </div>
        )}
        {!isParticipant && (
          <div className="rps-spectate">You are watching the showdown...</div>
        )}
      </div>
    </div>
  );
}

// ─── Game Log ──────────────────────────────────────────────────────────────────
function GameLog({ entries }) {
  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [entries]);
  return (
    <div className="game-log" ref={logRef}>
      <div className="log-header rye">📜 THE CHRONICLE</div>
      {entries.map((e, i) => (
        <div key={i} className="log-entry">{e.msg}</div>
      ))}
      {entries.length === 0 && <div className="log-empty">The pages await their ink...</div>}
    </div>
  );
}

// ─── Chat Panel ────────────────────────────────────────────────────────────────
function ChatPanel({ chatLog, canGhostChat, canSend, onSend, phase, embedded }) {
  const [text, setText] = useState('');
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chatLog]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  const nightMuted = canSend === false && !canGhostChat;

  return (
    <div className={`chat-panel ${embedded ? 'embedded' : ''}`}>
      {!embedded && (
        <div className="chat-header">
          {canGhostChat ? '👻 GHOST CHATTER' : '💬 TOWN TALK'}
        </div>
      )}
      <div className="chat-messages" ref={scrollRef}>
        {(chatLog || []).length === 0 && (
          <div className="chat-empty">{canGhostChat ? 'The dead are silent... for now.' : 'No one\'s spoken yet.'}</div>
        )}
        {(chatLog || []).map((c, i) => (
          <div key={i} className={`chat-msg ${c.channel === 'ghost' ? 'ghost' : ''}`}>
            <span className="chat-name">{c.name}:</span>
            <span className="chat-text">{c.msg}</span>
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          type="text"
          placeholder={nightMuted ? 'Town sleeps — hush now...' : canGhostChat ? 'Whisper from the grave...' : 'Speak yer piece...'}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          maxLength={200}
          disabled={nightMuted}
        />
        <button className="chat-send" onClick={submit} disabled={nightMuted || !text.trim()}>▶</button>
      </div>
    </div>
  );
}

// ─── Game Dock — bottom tabbed area: ACTION | CHAT | LOG ───────────────────────
function GameDock({
  phase, isAlive, myRole, players, myId, send,
  pendingAction, cooldowns, policeTarget, policeCooldownActive,
  chatLog, canGhostChat, sendChat, gameLog,
}) {
  // Default tab based on context
  const defaultTab = !isAlive ? 'chat' : (phase === 'night' && myRole !== 'CIVILIAN' && pendingAction) ? 'action' : 'chat';
  const [tab, setTab] = useState(defaultTab);

  // Auto-switch to action tab when night begins and you have a pending action
  const phaseRef = useRef(phase);
  useEffect(() => {
    if (phaseRef.current !== phase) {
      phaseRef.current = phase;
      if (phase === 'night' && isAlive && pendingAction) setTab('action');
      if (phase === 'day' && isAlive && myRole === 'POLICE' && !policeCooldownActive) setTab('action');
    }
  }, [phase, isAlive, pendingAction, myRole, policeCooldownActive]);

  const showActionTab =
    (phase === 'day' && isAlive && myRole === 'POLICE' && !policeCooldownActive) ||
    (phase === 'night' && isAlive && myRole && myRole !== 'CIVILIAN' && pendingAction);

  return (
    <div className="game-dock">
      <div className="dock-tabs">
        {showActionTab && (
          <button className={`dock-tab ${tab === 'action' ? 'active' : ''}`} onClick={() => setTab('action')}>
            ⚡ ACTION
            {pendingAction && <span className="dock-badge">!</span>}
          </button>
        )}
        <button className={`dock-tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
          💬 CHAT
        </button>
        <button className={`dock-tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>
          📜 LOG
        </button>
        <button className={`dock-tab ${tab === 'roster' ? 'active' : ''}`} onClick={() => setTab('roster')}>
          🤠 POSSE
        </button>
      </div>
      <div className="dock-body">
        {tab === 'action' && (
          <DockActionPanel
            phase={phase} isAlive={isAlive} myRole={myRole} players={players} myId={myId}
            send={send} pendingAction={pendingAction} cooldowns={cooldowns}
            policeTarget={policeTarget} policeCooldownActive={policeCooldownActive}
          />
        )}
        {tab === 'chat' && (
          <ChatPanel
            chatLog={chatLog}
            canGhostChat={canGhostChat}
            canSend={isAlive ? (phase !== 'night') : false}
            onSend={sendChat}
            phase={phase}
            embedded
          />
        )}
        {tab === 'log' && (
          <div className="dock-log">
            {(gameLog || []).slice(-30).map((e, i) => (
              <div key={i} className="log-entry">{e.msg}</div>
            ))}
            {(!gameLog || !gameLog.length) && <div className="log-empty">The pages await their ink...</div>}
          </div>
        )}
        {tab === 'roster' && (
          <div className="dock-roster">
            <div className="dock-roster-section">
              <div className="dock-roster-label">ALIVE ({players.filter(p => p.alive).length})</div>
              {players.filter(p => p.alive).map(p => (
                <div key={p.id} className={`dock-roster-row ${p.id === myId ? 'is-me' : ''}`}>
                  🤠 {p.name}
                  {p.id === myId && <span className="you-tag">YOU</span>}
                  {p.isHost && <span className="marshal-tag">★</span>}
                </div>
              ))}
            </div>
            {players.filter(p => !p.alive).length > 0 && (
              <div className="dock-roster-section">
                <div className="dock-roster-label dead">DEPARTED ({players.filter(p => !p.alive).length})</div>
                {players.filter(p => !p.alive).map(p => (
                  <div key={p.id} className="dock-roster-row dead">
                    💀 {p.name}
                    {p.revived && <span className="revived-tag">REVIVED</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Action sub-panel inside dock — embeds existing NightActionPanel or POLICE day action.
function DockActionPanel({ phase, isAlive, myRole, players, myId, send, pendingAction, cooldowns, policeTarget, policeCooldownActive }) {
  if (!isAlive) {
    return (
      <div className="dock-dead-msg">
        <span className="dock-dead-icon">⚰️</span>
        <div className="rye">Yer six feet under, partner.</div>
        <div className="dock-dead-sub">Talk it over in the ghost channel.</div>
      </div>
    );
  }
  if (phase === 'night') {
    if (myRole === 'CIVILIAN') {
      return (
        <div className="dock-civ-msg">
          <span className="dock-civ-icon">🌙</span>
          <div className="rye">Rest, civilian.</div>
          <div>Try the revolver to pass time.</div>
          <RevolverSpinner />
        </div>
      );
    }
    return (
      <NightActionPanel
        myRole={myRole}
        players={players}
        myId={myId}
        onAction={(action) => send({ type: 'NIGHT_ACTION', ...action })}
        pendingAction={pendingAction}
        cooldowns={cooldowns}
        policeTarget={policeTarget}
        phaseEndsAt={null}
      />
    );
  }
  if (phase === 'day' && myRole === 'POLICE' && !policeCooldownActive) {
    // Police day action — embed inline
    return <PoliceDayAction players={players} myId={myId} send={send} policeTarget={policeTarget} />;
  }
  return <div className="dock-civ-msg"><div>Vote on the table during the day, partner.</div></div>;
}

function PoliceDayAction({ players, myId, send, policeTarget }) {
  const [selected, setSelected] = useState(null);
  const alive = players.filter(p => p.alive && p.id !== myId);
  return (
    <div className="dock-police">
      <div className="police-label">🛡️ DESIGNATE TONIGHT'S PROTECTION</div>
      <div className="player-vote-grid">
        {alive.map(p => (
          <button key={p.id}
            className={`vote-btn ${selected === p.id ? 'voted' : ''}`}
            onClick={() => setSelected(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      <button className="submit-btn small" onClick={() => selected && send({ type: 'POLICE_DAY_ACTION', targetId: selected })} disabled={!selected}>
        🛡️ Set Protection
      </button>
      {policeTarget && <div className="police-confirm">✓ Protecting: {players.find(p => p.id === policeTarget)?.name}</div>}
    </div>
  );
}

// ─── Role Card (role reveal) ───────────────────────────────────────────────────
function RoleRevealCard({ role }) {
  const info = ROLE_INFO[role] || {};
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`role-reveal-card ${revealed ? 'revealed' : ''}`}
      style={{ '--role-color': info.color }}>
      <div className="role-card-front">
        <div className="role-card-question">?</div>
        <div className="role-card-tap">Tap to reveal your role</div>
      </div>
      <div className="role-card-back">
        <div className="role-emoji">{info.emoji}</div>
        <div className="role-name rye">{info.label}</div>
        <div className={`role-team ${info.team}`}>
          {info.team === 'killer' ? '☠️ OUTLAW' : '⭐ LAWFUL'}
        </div>
        <div className="role-desc">{info.description}</div>
        <div className="role-flavor">"{info.flavor}"</div>
      </div>
    </div>
  );
}

// ─── Night Action Panel ────────────────────────────────────────────────────────
function NightActionPanel({ myRole, players, myId, onAction, pendingAction, cooldowns, policeTarget, phaseEndsAt }) {
  const [selected, setSelected] = useState(null);
  const [geminiDelay, setGeminiDelay] = useState(1);
  const [forensicGuess, setForensicGuess] = useState(null);
  const [actionMode, setActionMode] = useState('primary');
  const [submitted, setSubmitted] = useState(false);
  const alivePlayers = players.filter(p => p.alive && p.id !== myId);
  const deadPlayers = players.filter(p => !p.alive);
  const info = ROLE_INFO[myRole] || {};

  const submit = () => {
    if (submitted) return;
    let action = {};
    switch (myRole) {
      case 'NORMAL_KILLER':
        if (!selected) return;
        action = { action: 'kill', target: selected };
        break;
      case 'GEMINI_KILLER':
        if (!selected) return;
        action = { action: 'schedule', target: selected, delay: geminiDelay };
        break;
      case 'BAY_HARBOR':
        if (!selected) return;
        if (actionMode === 'kill' && !cooldowns.bayHarborCooldownActive)
          action = { action: 'kill', target: selected };
        else
          action = { action: 'investigate', target: selected };
        break;
      case 'NORMAL_DOCTOR':
      case 'POLICE':
        if (!selected) return;
        action = { action: 'protect', target: selected };
        break;
      case 'SURGEON':
        if (!selected) return;
        action = { action: 'revive', target: selected };
        break;
      case 'NORMAL_DETECTIVE':
      case 'SHERIFF':
        if (!selected) return;
        action = { action: 'investigate', target: selected };
        break;
      case 'FORENSIC':
        if (actionMode === 'forensic' && forensicGuess)
          action = { action: 'forensic_guess', guess: forensicGuess };
        else if (selected)
          action = { action: 'investigate', target: selected, targets: [selected] };
        break;
      default:
        action = { action: 'skip' };
    }
    setSubmitted(true);
    onAction(action);
  };

  const skipAction = () => {
    if (submitted) return;
    setSubmitted(true);
    onAction({ action: 'skip' });
  };

  if (!pendingAction || submitted) {
    return (
      <div className="night-panel submitted">
        <div className="submitted-icon">✓</div>
        <div className="submitted-text">Your action is sealed...</div>
      </div>
    );
  }

  const targetPool = myRole === 'SURGEON' ? deadPlayers : alivePlayers;

  return (
    <div className="night-panel animate-paper">
      <div className="night-panel-header">
        <span style={{ color: info.color, fontSize: '1.4rem' }}>{info.emoji}</span>
        <span className="role-name">{info.label}</span>
      </div>

      {myRole === 'BAY_HARBOR' && (
        <div className="action-mode-tabs">
          <button className={`mode-tab ${actionMode === 'kill' ? 'active' : ''} ${cooldowns.bayHarborCooldownActive ? 'disabled' : ''}`}
            onClick={() => !cooldowns.bayHarborCooldownActive && setActionMode('kill')}>
            🪓 Kill {cooldowns.bayHarborCooldownActive ? '(cooldown)' : ''}
          </button>
          <button className={`mode-tab ${actionMode === 'investigate' ? 'active' : ''}`}
            onClick={() => setActionMode('investigate')}>🔍 Investigate</button>
        </div>
      )}

      {myRole === 'FORENSIC' && !cooldowns.forensicUsed && (
        <div className="action-mode-tabs">
          <button className={`mode-tab ${actionMode === 'primary' ? 'active' : ''}`}
            onClick={() => setActionMode('primary')}>🔍 Investigate</button>
          <button className={`mode-tab ${actionMode === 'forensic' ? 'active' : ''}`}
            onClick={() => setActionMode('forensic')}>🧪 Forensic Guess</button>
        </div>
      )}

      {myRole === 'GEMINI_KILLER' && (
        <div className="gemini-delay-selector">
          <span>Kill delay:</span>
          {[1, 2].map(d => (
            <button key={d} className={`delay-btn ${geminiDelay === d ? 'active' : ''}`}
              onClick={() => setGeminiDelay(d)}>
              +{d} night{d > 1 ? 's' : ''}
            </button>
          ))}
        </div>
      )}

      {(actionMode === 'forensic') ? (
        <div className="forensic-guess-panel">
          <div className="forensic-prompt">Guess the killer variant:</div>
          {KILLER_VARIANTS.map(v => (
            <button key={v} className={`forensic-option ${forensicGuess === v ? 'active' : ''}`}
              onClick={() => setForensicGuess(v)}>
              {ROLE_INFO[v]?.emoji} {ROLE_INFO[v]?.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="target-grid">
          <div className="target-label">
            {myRole === 'SURGEON' ? 'Revive the fallen:' :
              myRole?.includes('KILLER') || myRole === 'BAY_HARBOR' && actionMode === 'kill' ? 'Choose your mark:' :
                myRole?.includes('DETECTIVE') || myRole === 'SHERIFF' || myRole === 'FORENSIC' || (myRole === 'BAY_HARBOR' && actionMode === 'investigate') ? 'Investigate:' :
                  'Protect:'}
          </div>
          {targetPool.length === 0 ? (
            <div className="no-targets">No valid targets</div>
          ) : (
            targetPool.map(p => (
              <button key={p.id}
                className={`target-btn ${selected === p.id ? 'selected' : ''}`}
                onClick={() => setSelected(p.id)}>
                {p.alive ? '👤' : '💀'} {p.name}
              </button>
            ))
          )}
        </div>
      )}

      <div className="night-actions">
        <button className="submit-btn" onClick={submit}
          disabled={actionMode === 'forensic' ? !forensicGuess : !selected}>
          ⚡ COMMIT
        </button>
        <button className="skip-btn" onClick={skipAction}>Skip Night</button>
      </div>
    </div>
  );
}

// ─── Day Vote Panel ────────────────────────────────────────────────────────────
function DayVotePanel({ players, myId, myRole, onVote, onSkip, onPoliceAction,
  skipVoteCount, skipVoteRequired, votes, policeTarget, policeCooldownActive, phaseEndsAt }) {
  const [myVote, setMyVote] = useState(null);
  const [policeSelected, setPoliceSelected] = useState(null);
  const [skipped, setSkipped] = useState(false);
  const [showToy, setShowToy] = useState(false);
  const alivePlayers = players.filter(p => p.alive && p.id !== myId);
  const skipPct = Math.round((skipVoteCount / Math.max(1, players.filter(p => p.alive).length)) * 100);

  const castVote = (id) => {
    setMyVote(id);
    onVote(id);
  };

  const handleSkip = () => {
    setSkipped(true);
    onSkip();
  };

  const setPoliceProtect = () => {
    if (policeSelected) {
      onPoliceAction(policeSelected);
    }
  };

  return (
    <div className="day-panel animate-paper">
      <div className="day-panel-header">☀ TOWN SQUARE — SPEAK YOUR PIECE</div>

      <div className="clock-center-wrap">
        <BigClock endsAt={phaseEndsAt} totalMs={30000} label="DISCUSS" />
      </div>

      <div className="skip-progress-wrap">
        <div className="skip-bar-label">SKIP VOTES — <span className="num">{skipVoteCount}/{skipVoteRequired}</span></div>
        <div className="skip-bar-track">
          <div className="skip-bar-fill" style={{ width: `${Math.min(100, skipPct)}%` }} />
          <div className="skip-bar-threshold" style={{ left: '50%' }} />
        </div>
        {!skipped && (
          <button className="skip-day-btn" onClick={handleSkip}>⏭ SKIP TO NIGHT</button>
        )}
      </div>

      <div className="vote-section">
        <div className="vote-label">WHO'S THE OUTLAW?</div>
        <div className="player-vote-grid">
          {alivePlayers.map(p => (
            <button key={p.id}
              className={`vote-btn ${myVote === p.id ? 'voted' : ''}`}
              onClick={() => castVote(p.id)}>
              <span className="vote-player-icon">🤠</span>
              <span className="vote-player-name">{p.name}</span>
              {myVote === p.id && <span className="vote-check">✓</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="toy-toggle-wrap">
        <button className="toy-toggle" onClick={() => setShowToy(s => !s)}>
          {showToy ? '✕ Hide the Revolver' : '🔫 Got time to kill? Spin the chamber'}
        </button>
      </div>
      {showToy && <RevolverSpinner />}

      {myRole === 'POLICE' && !policeCooldownActive && (
        <div className="police-day-action">
          <div className="police-label">🛡️ DESIGNATE TONIGHT'S PROTECTION</div>
          <div className="player-vote-grid">
            {alivePlayers.map(p => (
              <button key={p.id}
                className={`vote-btn ${policeSelected === p.id ? 'voted' : ''}`}
                onClick={() => setPoliceSelected(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
          <button className="submit-btn small" onClick={setPoliceProtect} disabled={!policeSelected}>
            🛡️ Set Protection
          </button>
          {policeTarget && <div className="police-confirm">✓ Protecting: {players.find(p => p.id === policeTarget)?.name}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Lobby Screen ──────────────────────────────────────────────────────────────
function LobbyScreen({ players, myId, isHost, config, onReady, onSetConfig, onStart, error, roomCode }) {
  const [killers, setKillers] = useState(config.killers || 1);
  const [doctors, setDoctors] = useState(config.doctors || 1);
  const [detectives, setDetectives] = useState(config.detectives || 1);
  const me = players.find(p => p.id === myId);

  const updateConfig = (k, d, det) => {
    setKillers(k); setDoctors(d); setDetectives(det);
    onSetConfig({ killers: k, doctors: d, detectives: det });
  };

  return (
    <div className="lobby-screen">
      <DustParticles count={25} />
      <SmokeAtmosphere count={2} />
      <Ravens count={1} />
      <Tumbleweed count={1} />
      <Scanline />

      <div className="lobby-header">
        <div className="sheriff-badge-top">⭐</div>
        <h1 className="game-title animate-title">DEADWOOD</h1>
        <div className="title-revolvers">
          <span>🔫</span>
          <span style={{ color: 'var(--gold)' }}>✦</span>
          <span>🔫</span>
        </div>
        <div className="entry-subtitle">— The Reckoning —</div>
        <div className="lobby-divider">✦ ✦ ✦</div>
        {roomCode && (
          <div className="lobby-room-code">
            <span className="label">SALOON CODE — share it</span>
            {roomCode}
          </div>
        )}
      </div>

      <div className="lobby-content">
        {/* Player Roster */}
        <div className="lobby-section animate-paper">
          <h2 className="section-title">
            <span>🤠</span>
            <span>The Posse — {players.length}/10</span>
          </h2>
          <div className="player-roster">
            {players.map((p, i) => (
              <div key={p.id} className={`roster-entry ${p.id === myId ? 'is-me' : ''}`}
                style={{ animationDelay: `${i * 0.08}s` }}>
                <div className="roster-left">
                  <span className="roster-icon">{p.isHost ? '⭐' : '🤠'}</span>
                  <span className="roster-name">{p.name}</span>
                  {p.isHost && <span className="host-tag">MARSHAL</span>}
                  {p.id === myId && !p.isHost && <span className="me-tag">YOU</span>}
                </div>
                <div className={`ready-badge ${p.ready ? 'ready' : 'not-ready'}`}>
                  {p.isHost ? '⭐ HOST' : p.ready ? '✓ READY' : '◌ WAITING'}
                </div>
              </div>
            ))}
            {players.length < 4 && (
              <div className="waiting-msg">
                ◌ Waiting for {4 - players.length} more rider{4 - players.length !== 1 ? 's' : ''} to join the posse...
              </div>
            )}
          </div>
        </div>

        {/* Config (host only) */}
        {isHost && (
          <div className="lobby-section animate-paper" style={{ animationDelay: '0.2s' }}>
            <h2 className="section-title">
              <span>⚙️</span>
              <span>Town Setup</span>
            </h2>
            <div className="config-grid">
              {[
                { label: '🔫 Outlaws', val: killers, set: v => updateConfig(v, doctors, detectives) },
                { label: '💉 Docs', val: doctors, set: v => updateConfig(killers, v, detectives) },
                { label: '🔍 Lawmen', val: detectives, set: v => updateConfig(killers, doctors, v) },
              ].map(({ label, val, set }) => (
                <div key={label} className="config-item">
                  <span className="config-label">{label}</span>
                  <div className="config-stepper">
                    <button onClick={() => set(Math.max(1, val - 1))}>−</button>
                    <span className="config-val">{val}</span>
                    <button onClick={() => set(Math.min(2, val + 1))}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="config-note">⚖ Min 1, Max 2 of each. Remaining players ride as civilians.</div>
          </div>
        )}
        {!isHost && (
          <div className="lobby-section animate-paper" style={{ animationDelay: '0.2s' }}>
            <h2 className="section-title">
              <span>⚙️</span>
              <span>Town Setup</span>
            </h2>
            <div className="config-display">
              <div>🔫 Outlaws: <strong>{config.killers}</strong></div>
              <div>💉 Docs: <strong>{config.doctors}</strong></div>
              <div>🔍 Lawmen: <strong>{config.detectives}</strong></div>
            </div>
          </div>
        )}

        {/* Role Guide */}
        <div className="lobby-section animate-paper" style={{ animationDelay: '0.4s' }}>
          <h2 className="section-title">
            <span>📜</span>
            <span>The Roles of Deadwood</span>
          </h2>
          <div className="role-guide-grid">
            {Object.entries(ROLE_INFO).map(([key, info]) => {
              const rgb = hexToRgb(info.color);
              return (
                <div key={key} className="role-guide-item"
                  style={{ '--rc': info.color, '--rc-rgb': rgb }}>
                  <span className="rg-emoji">{info.emoji}</span>
                  <div className="rg-info">
                    <div className="rg-name">{info.label}</div>
                    <div className="rg-desc">{info.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {error && <div className="error-banner animate-stamp">⚠️ {error}</div>}

        <div className="lobby-actions">
          {!isHost && (
            <button className={`ready-btn ${me?.ready ? 'is-ready' : ''}`} onClick={onReady}>
              {me?.ready ? '✓ READY UP' : '◌ READY UP'}
            </button>
          )}
          {isHost && (
            <button className="start-btn" onClick={onStart}
              disabled={players.length < 4}>
              {players.length < 4 ? `⏳ NEED ${4 - players.length} MORE` : '⚡ START THE RECKONING'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper for converting hex color to rgb
function hexToRgb(hex) {
  if (!hex) return '201,168,76';
  const m = hex.replace('#', '').match(/.{1,2}/g);
  if (!m || m.length < 3) return '201,168,76';
  return `${parseInt(m[0], 16)},${parseInt(m[1], 16)},${parseInt(m[2], 16)}`;
}

// ─── Game Over Screen ──────────────────────────────────────────────────────────
function GameOverScreen({ winner, reason, roleReveal, isHost, onPlayAgain }) {
  return (
    <div className="gameover-screen">
      <DustParticles count={40} />
      <SmokeAtmosphere count={4} />
      <Ravens count={3} />
      <Scanline />
      <div className="gameover-content animate-burn">
        <div className="gameover-banner" style={{ color: winner === 'killer' ? '#e63946' : '#f4d03f' }}>
          <div className="gameover-title">
            {winner === 'killer' ? '☠️  OUTLAWS  RULE  ☠️' : '⭐  JUSTICE  PREVAILS  ⭐'}
          </div>
        </div>
        <div className="gameover-reason">{reason}</div>
        <div className="gameover-divider">✦ ✦ ✦</div>
        <div className="role-reveal-section">
          <div className="role-reveal-title">— The True Identities —</div>
          <div className="role-reveal-grid">
            {roleReveal?.map((p, i) => {
              const info = ROLE_INFO[p.role] || {};
              return (
                <div key={p.id} className={`reveal-card ${info.team}`}
                  style={{ animationDelay: `${i * 0.1}s` }}>
                  <div className="reveal-emoji">{info.emoji || '👤'}</div>
                  <div className="reveal-name">{p.name}</div>
                  <div className="reveal-role" style={{ color: info.color }}>{info.label || p.role}</div>
                  <div className={`reveal-alive ${p.alive ? 'alive' : 'dead'}`}>
                    {p.alive ? '✓ SURVIVED' : '✗ FALLEN'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {isHost && (
          <button className="start-btn" onClick={onPlayAgain}>
            🤠 RIDE AGAIN
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [gameState, setGameState] = useState(null);
  const [myId, setMyId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [entryMode, setEntryMode] = useState('menu'); // menu | create | join
  const [roomCode, setRoomCode] = useState(null);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState(null);
  const [investigateResults, setInvestigateResults] = useState([]);
  const [forensicResult, setForensicResult] = useState(null);
  const [showRoleCard, setShowRoleCard] = useState(false);
  const [prevPhase, setPrevPhase] = useState(null);
  const [rpsResult, setRpsResult] = useState(null);
  const [soundOn, setSoundOn] = useState(true);
  const [killedThisRound, setKilledThisRound] = useState(null);
  const [myVote, setMyVote] = useState(null);

  const notify = useCallback((msg, type = 'info', duration = 4000) => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), duration);
  }, []);

  // Blip when a new chat message arrives (from someone else)
  const lastChatLenRef = useRef(0);
  useEffect(() => {
    const log = gameState?.chatLog || [];
    if (log.length > lastChatLenRef.current && lastChatLenRef.current !== 0) {
      const last = log[log.length - 1];
      if (last && last.playerId !== myId) sfx.blip();
    }
    lastChatLenRef.current = log.length;
  }, [gameState?.chatLog, myId]);

  const { send, connected } = useWebSocket(useCallback((data) => {
    switch (data.type) {
      case 'JOINED':
        setMyId(data.playerId);
        setIsHost(data.isHost);
        setRoomCode(data.roomCode);
        setJoined(true);
        sfx.chime();
        break;
      case 'STATE_UPDATE':
        setGameState(prev => {
          const newPhase = data.state.phase;
          if (prev?.phase !== newPhase) {
            setPrevPhase(prev?.phase);
            // Phase transition sounds
            if (newPhase === 'day') sfx.dawn();
            else if (newPhase === 'night') sfx.dusk();
            else if (newPhase === 'rps') sfx.showdown();
          }
          return data.state;
        });
        break;
      case 'PLAYER_JOINED':
        sfx.hoof();
        break;
      case 'GAME_STARTING':
        notify('🎲 Categories dealt — choose your path!', 'warn', 3000);
        sfx.chime();
        break;
      case 'SELECTION_COMPLETE':
        setShowRoleCard(true);
        notify('✊ All roles locked in! The reckoning begins...', 'good', 3000);
        break;
      case 'INVESTIGATE_RESULT':
        setInvestigateResults(data.results);
        notify(`🔍 Investigation complete — ${data.results.length} result(s)`, 'info', 6000);
        sfx.chime();
        break;
      case 'FORENSIC_RESULT':
        setForensicResult(data);
        notify(data.correct ? '✅ Forensic guess correct!' : '❌ Forensic guess wrong!', data.correct ? 'good' : 'bad', 6000);
        break;
      case 'PLAYER_KILLED':
        notify(`💀 ${data.playerName} was found dead at dawn.`, 'bad', 5000);
        sfx.gunshot();
        setKilledThisRound(data.playerId);
        setTimeout(() => setKilledThisRound(null), 1200);
        break;
      case 'PLAYER_ELIMINATED':
        notify(`🪓 ${data.playerName} was eliminated by the town!`, 'warn', 5000);
        sfx.gunshot();
        setKilledThisRound(data.playerId);
        setTimeout(() => setKilledThisRound(null), 1200);
        setMyVote(null);
        break;
      case 'RPS_RESULT':
        setRpsResult(data);
        setTimeout(() => setRpsResult(null), 5000);
        break;
      case 'GAME_OVER':
        if (data.winner === 'good') sfx.win(); else sfx.lose();
        break;
      case 'LOBBY_RESET':
        setInvestigateResults([]);
        setForensicResult(null);
        setShowRoleCard(false);
        setRpsResult(null);
        break;
      case 'ERROR':
        setError(data.message);
        notify(`⚠️ ${data.message}`, 'bad', 4000);
        setTimeout(() => setError(''), 4000);
        break;
    }
  }, [prevPhase, notify]));

  const handleCreate = () => {
    const name = nameInput.trim();
    if (!name) return;
    setPlayerName(name);
    send({ type: 'CREATE_ROOM', name });
  };

  const handleJoinRoom = () => {
    const name = nameInput.trim();
    const code = codeInput.trim().toUpperCase();
    if (!name || code.length !== 4) return;
    setPlayerName(name);
    send({ type: 'JOIN_ROOM', name, code });
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) sfx.chime();
  };

  // ── Entry Screen ──────────────────────────────────────────────────────────────
  if (!joined) {
    return (
      <div className="entry-screen">
        <DustParticles count={30} />
        <SmokeAtmosphere count={3} />
        <Ravens count={2} />
        <Scanline />

        <button className="sound-toggle entry-sound" onClick={toggleSound} title="Toggle sound">
          {soundOn ? '🔊' : '🔇'}
        </button>

        <div className="entry-content">
          <div className="entry-badge">⭐</div>
          <h1 className="game-title animate-title">DEADWOOD</h1>
          <div className="title-revolvers">
            <span>🔫</span>
            <span style={{ color: 'var(--gold)' }}>✦</span>
            <span>🔫</span>
          </div>
          <div className="entry-subtitle">— The Reckoning —</div>
          <div className="entry-divider">✦ ✦ ✦</div>

          <div className="wanted-frame">
            <div className="bullet-hole b1"></div>
            <div className="bullet-hole b2"></div>
            <div className="bullet-hole b3"></div>
            <div className="wanted-frame-top">WANTED</div>
            <div className="wanted-frame-sub">— Identify Yourself, Stranger —</div>
            <div className="name-input-wrap">
              <input
                className="name-input"
                type="text"
                placeholder="your name here..."
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                maxLength={20}
                autoFocus
              />
            </div>

            {entryMode === 'menu' && (
              <div className="entry-menu">
                <button className="enter-btn block" onClick={() => nameInput.trim() && setEntryMode('create')}
                  disabled={!nameInput.trim() || !connected}>
                  🏠 CREATE A SALOON
                </button>
                <button className="enter-btn block ghost" onClick={() => nameInput.trim() && setEntryMode('join')}
                  disabled={!nameInput.trim() || !connected}>
                  🚪 JOIN BY CODE
                </button>
              </div>
            )}

            {entryMode === 'create' && (
              <div className="entry-menu">
                <div className="reward-text">REWARD<span className="amount">$5,000</span></div>
                <button className="enter-btn block" onClick={handleCreate} disabled={!connected}>
                  🐎 OPEN THE SALOON
                </button>
                <button className="text-back" onClick={() => setEntryMode('menu')}>← back</button>
              </div>
            )}

            {entryMode === 'join' && (
              <div className="entry-menu">
                <input
                  className="code-input"
                  type="text"
                  placeholder="ROOM CODE"
                  value={codeInput}
                  onChange={e => setCodeInput(e.target.value.toUpperCase().slice(0, 4))}
                  onKeyDown={e => e.key === 'Enter' && handleJoinRoom()}
                  maxLength={4}
                />
                <button className="enter-btn block" onClick={handleJoinRoom}
                  disabled={codeInput.trim().length !== 4 || !connected}>
                  🐎 RIDE IN
                </button>
                <button className="text-back" onClick={() => setEntryMode('menu')}>← back</button>
              </div>
            )}
          </div>

          {!connected && <div className="connecting-msg">📡 Tappin' the telegraph wire...</div>}
          {error && <div className="error-banner animate-stamp">⚠️ {error}</div>}
        </div>
      </div>
    );
  }

  if (!gameState) {
    return <div className="loading-screen"><div className="rye flicker">Loading...</div></div>;
  }

  const { phase, players, round, config, gameLog, rpsState, winner, skipVoteCount, skipVoteRequired, phaseEndsAt, roomCode: stateRoomCode } = gameState;
  const { myRole, pendingAction, policeTarget, forensicUsed, forensicDoubleCheck,
    bayHarborCooldownActive, surgeonCooldownActive, policeCooldownActive,
    myCategory, mySelectedVariant, availableVariants, pendingSelection, selectionWaitingCount,
    chatLog, canGhostChat } = gameState;

  const myPlayer = players.find(p => p.id === myId);
  const isAlive = myPlayer?.alive;
  const sendChat = (text) => send({ type: 'CHAT', text });

  // ── Role Selection Phase ────────────────────────────────────────────────────────
  if (phase === 'roleselect') {
    return (
      <RoleSelectScreen
        category={myCategory}
        available={availableVariants || []}
        selected={mySelectedVariant && mySelectedVariant !== 'CIVILIAN' ? mySelectedVariant : (myCategory === 'civilian' ? null : (pendingSelection ? null : mySelectedVariant))}
        pending={pendingSelection}
        waitingCount={selectionWaitingCount || 0}
        onSelect={(variant) => send({ type: 'SELECT_VARIANT', variant })}
        players={players}
        myId={myId}
      />
    );
  }

  // ── Role Reveal ───────────────────────────────────────────────────────────────
  if (showRoleCard && myRole && phase !== 'lobby' && phase !== 'roleselect') {
    return (
      <div className="role-reveal-screen">
        <DustParticles />
        <SmokeAtmosphere count={2} />
        <div className="role-reveal-content animate-burn">
          <div className="role-reveal-header">Your Fate Is Sealed</div>
          <RoleRevealCard role={myRole} />
          <button className="enter-btn" onClick={() => setShowRoleCard(false)}>
            ⚡ I ACCEPT MY ROLE
          </button>
        </div>
      </div>
    );
  }

  // ── Game Over ─────────────────────────────────────────────────────────────────
  if (phase === 'gameover') {
    return (
      <GameOverScreen
        winner={winner}
        reason={gameLog[gameLog.length - 1]?.msg}
        roleReveal={gameState.roleReveal || players.map(p => ({ ...p, role: p.role }))}
        isHost={isHost}
        onPlayAgain={() => send({ type: 'PLAY_AGAIN' })}
      />
    );
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────────
  if (phase === 'lobby') {
    return (
      <>
        <button className="sound-toggle entry-sound" onClick={toggleSound} title="Toggle sound">
          {soundOn ? '🔊' : '🔇'}
        </button>
        <LobbyScreen
          players={players}
          myId={myId}
          isHost={isHost}
          config={config}
          onReady={() => send({ type: 'READY' })}
          onSetConfig={(cfg) => send({ type: 'SET_CONFIG', ...cfg })}
          onStart={() => send({ type: 'START_GAME' })}
          error={error}
          roomCode={stateRoomCode || roomCode}
        />
        {notification && (
          <div className={`notification ${notification.type}`}>{notification.msg}</div>
        )}
      </>
    );
  }

  // ── Main Game ─────────────────────────────────────────────────────────────────
  const alivePlayers = players.filter(p => p.alive);
  const deadPlayers = players.filter(p => !p.alive);

  return (
    <div className={`game-screen ${phase}-phase`}>
      <DustParticles count={phase === 'night' ? 12 : 8} />
      {phase === 'night' && <SmokeAtmosphere count={3} />}
      {phase === 'day' && <Tumbleweed count={1} />}
      <Scanline />

      {phase === 'day' && <div className="sun" />}
      {phase === 'night' && <div className="moon" />}

      {/* RPS Overlay */}
      {phase === 'rps' && rpsState && (
        <RPSShowdown
          state={rpsState}
          myId={myId}
          onChoice={(c) => send({ type: 'RPS_CHOICE', choice: c })}
        />
      )}

      {/* Header */}
      <div className="game-header">
        <div className="phase-indicator">
          <div className={`phase-orb ${phase}`} />
          <span className="phase-label">
            {phase === 'day' ? `☀ DAY ${round}` : phase === 'night' ? `🌙 NIGHT ${round}` : ''}
          </span>
        </div>
        <div className="game-title-small">DEADWOOD</div>
        <div className="header-right">
          {stateRoomCode && <span className="room-code-badge" title="Room code">🎫 {stateRoomCode}</span>}
          <button className="sound-toggle" onClick={toggleSound} title="Toggle sound">
            {soundOn ? '🔊' : '🔇'}
          </button>
          <div className="my-role-badge" style={{ '--rc': ROLE_INFO[myRole]?.color }}>
            <span className="emoji-large">{ROLE_INFO[myRole]?.emoji}</span>
            <span>{ROLE_INFO[myRole]?.label || 'Observer'}</span>
          </div>
        </div>
      </div>

      {/* Saloon scene — animated 2D table view */}
      {/* Main stage: scene fills remaining viewport */}
      <div className="game-stage">
        <SaloonScene
          players={players}
          myId={myId}
          phase={phase}
          voteCounts={gameState.voteCounts}
          myVote={myVote}
          recentChat={chatLog}
          rolesByPlayerId={gameState.killerTeam
            ? Object.fromEntries([
                ...(gameState.killerTeam || []).map(k => [k.id, 'KILLER_TEAM']),
                [myId, myRole],
              ])
            : { [myId]: myRole }}
          myRole={myRole}
          killedThisRound={killedThisRound}
          centerSlot={
            phase === 'day' || phase === 'night' ? (
              <BigClock
                endsAt={phaseEndsAt}
                totalMs={phase === 'day' ? 30000 : 25000}
                label={phase === 'day' ? 'DISCUSS' : 'ACT'}
              />
            ) : null
          }
          onSelectPlayer={(targetId) => {
            if (targetId === myId) return;
            if (phase === 'day') {
              setMyVote(targetId);
              send({ type: 'VOTE', targetId });
              sfx.chime();
            }
          }}
        />

        {/* Skip-vote ribbon at top of stage during day */}
        {phase === 'day' && isAlive && (
          <div className="stage-skip-ribbon">
            <div className="skip-label">SKIP {skipVoteCount}/{skipVoteRequired}</div>
            <div className="skip-bar-mini">
              <div className="skip-bar-fill-mini"
                style={{ width: `${Math.min(100, (skipVoteCount / Math.max(1, skipVoteRequired)) * 100)}%` }} />
            </div>
            <button className="skip-btn-mini" onClick={() => send({ type: 'SKIP_VOTE' })}>⏭ SKIP</button>
          </div>
        )}

        {/* Investigate / forensic results — floating overlay */}
        {investigateResults.length > 0 && (
          <div className="floating-result investigate-panel animate-paper">
            <div className="inv-title">🔍 Investigation Report</div>
            {investigateResults.map((r, i) => (
              <div key={i} className={`inv-result ${r.team}`}>
                <span>{ROLE_INFO[r.role]?.emoji}</span>
                <span className="inv-name">{r.name}</span>
                <span className="inv-role">{ROLE_INFO[r.role]?.label}</span>
                <span className="inv-team">{r.team === 'killer' ? '☠️' : '⭐'}</span>
              </div>
            ))}
            <button className="clear-btn" onClick={() => setInvestigateResults([])}>Burn Evidence</button>
          </div>
        )}
        {forensicResult && (
          <div className={`floating-result forensic-panel animate-stamp ${forensicResult.correct ? 'correct' : 'wrong'}`}>
            <div className="rye">🧪 Forensic Report</div>
            <div>{forensicResult.message}</div>
            <button className="clear-btn" onClick={() => setForensicResult(null)}>Dismiss</button>
          </div>
        )}
      </div>

      {/* Bottom dock — tabbed: ACTION | CHAT | LOG */}
      <GameDock
        phase={phase}
        isAlive={isAlive}
        myRole={myRole}
        players={players}
        myId={myId}
        send={send}
        pendingAction={pendingAction}
        cooldowns={{ bayHarborCooldownActive, surgeonCooldownActive, policeCooldownActive, forensicUsed }}
        policeTarget={policeTarget}
        policeCooldownActive={policeCooldownActive}
        chatLog={chatLog}
        canGhostChat={canGhostChat}
        sendChat={sendChat}
        gameLog={gameLog}
      />

      {/* Notifications */}
      {notification && (
        <div className={`notification ${notification.type}`}>{notification.msg}</div>
      )}
    </div>
  );
}
