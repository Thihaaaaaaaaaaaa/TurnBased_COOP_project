import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { ROLE_INFO, getRoleLabel, KILLER_VARIANTS } from './utils/roles';
import './App.css';

// ─── Dust Particle Component ───────────────────────────────────────────────────
function DustParticles({ count = 15 }) {
  const particles = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 8}s`,
    duration: `${6 + Math.random() * 8}s`,
    size: `${2 + Math.random() * 4}px`,
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
function NightActionPanel({ myRole, players, myId, onAction, pendingAction, cooldowns, policeTarget }) {
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
        <span style={{ color: info.color }}>{info.emoji}</span>
        <span className="rye">{info.label}'s Move</span>
        <TimerRing duration={25000} label="ACT" onComplete={skipAction} />
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
  skipVoteCount, skipVoteRequired, votes, policeTarget, policeCooldownActive }) {
  const [myVote, setMyVote] = useState(null);
  const [policeSelected, setPoliceSelected] = useState(null);
  const [skipped, setSkipped] = useState(false);
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
      <div className="day-panel-header rye">☀️ Town Square — Speak Your Piece</div>

      <div className="skip-progress-wrap">
        <div className="skip-bar-label">SKIP VOTES: {skipVoteCount}/{skipVoteRequired}</div>
        <div className="skip-bar-track">
          <div className="skip-bar-fill" style={{ width: `${Math.min(100, skipPct)}%` }} />
          <div className="skip-bar-threshold" style={{ left: '50%' }} />
        </div>
        {!skipped && (
          <button className="skip-day-btn" onClick={handleSkip}>Skip to Night ⏭️</button>
        )}
      </div>

      <div className="vote-section">
        <div className="vote-label">Cast your vote — who's the outlaw?</div>
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

      {myRole === 'POLICE' && !policeCooldownActive && (
        <div className="police-day-action">
          <div className="police-label">🛡️ Designate tonight's protection:</div>
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
function LobbyScreen({ players, myId, isHost, config, onReady, onSetConfig, onStart, error }) {
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
      <DustParticles count={20} />

      <div className="lobby-header animate-burn">
        <div className="sheriff-badge-top">⭐</div>
        <h1 className="game-title rye flicker">DEADWOOD</h1>
        <div className="game-subtitle playfair">— The Reckoning —</div>
        <div className="lobby-divider">✦ ✦ ✦</div>
      </div>

      <div className="lobby-content">
        {/* Player Roster */}
        <div className="lobby-section">
          <h2 className="section-title rye">🤠 The Posse ({players.length}/10)</h2>
          <div className="player-roster">
            {players.map(p => (
              <div key={p.id} className={`roster-entry ${p.id === myId ? 'is-me' : ''}`}>
                <div className="roster-left">
                  <span className="roster-icon">{p.isHost ? '🌟' : '👤'}</span>
                  <span className="roster-name">{p.name}</span>
                  {p.isHost && <span className="host-tag">MARSHAL</span>}
                  {p.id === myId && <span className="me-tag">YOU</span>}
                </div>
                <div className={`ready-badge ${p.ready ? 'ready' : 'not-ready'}`}>
                  {p.isHost ? '⭐' : p.ready ? '✓ READY' : '◌ WAITING'}
                </div>
              </div>
            ))}
            {players.length < 4 && (
              <div className="waiting-msg">Waiting for {4 - players.length} more rider{4 - players.length !== 1 ? 's' : ''}...</div>
            )}
          </div>
        </div>

        {/* Config (host only) */}
        {isHost && (
          <div className="lobby-section">
            <h2 className="section-title rye">⚙️ Town Setup</h2>
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
            <div className="config-note">Min 1, Max 2 of each. Remaining players = civilians.</div>
          </div>
        )}
        {!isHost && (
          <div className="lobby-section">
            <div className="config-display">
              <div>🔫 Outlaws: {config.killers}</div>
              <div>💉 Docs: {config.doctors}</div>
              <div>🔍 Lawmen: {config.detectives}</div>
            </div>
          </div>
        )}

        {/* Role Guide */}
        <div className="lobby-section role-guide">
          <h2 className="section-title rye">📜 The Roles</h2>
          <div className="role-guide-grid">
            {Object.entries(ROLE_INFO).map(([key, info]) => (
              <div key={key} className="role-guide-item" style={{ '--rc': info.color }}>
                <span className="rg-emoji">{info.emoji}</span>
                <div className="rg-info">
                  <div className="rg-name">{info.label}</div>
                  <div className="rg-desc">{info.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <div className="error-banner animate-stamp">⚠️ {error}</div>}

        <div className="lobby-actions">
          {!isHost && (
            <button className={`ready-btn ${me?.ready ? 'is-ready' : ''}`} onClick={onReady}>
              {me?.ready ? '✓ READY' : 'READY UP'}
            </button>
          )}
          {isHost && (
            <button className="start-btn" onClick={onStart}
              disabled={players.length < 4}>
              <span className="start-btn-text rye">START THE RECKONING</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Game Over Screen ──────────────────────────────────────────────────────────
function GameOverScreen({ winner, reason, roleReveal, isHost, onPlayAgain }) {
  return (
    <div className="gameover-screen">
      <DustParticles count={30} />
      <div className="gameover-content animate-burn">
        <div className="gameover-banner" style={{ color: winner === 'killer' ? '#c0392b' : '#c9a84c' }}>
          <div className="rye gameover-title">
            {winner === 'killer' ? '☠️ OUTLAWS WIN ☠️' : '⭐ JUSTICE PREVAILS ⭐'}
          </div>
        </div>
        <div className="gameover-reason playfair">{reason}</div>
        <div className="gameover-divider">✦ ✦ ✦</div>
        <div className="role-reveal-section">
          <div className="rye role-reveal-title">THE TRUE IDENTITIES</div>
          <div className="role-reveal-grid">
            {roleReveal?.map(p => {
              const info = ROLE_INFO[p.role] || {};
              return (
                <div key={p.id} className={`reveal-card ${info.team}`}>
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
            <span className="rye">PLAY AGAIN</span>
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
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState(null);
  const [investigateResults, setInvestigateResults] = useState([]);
  const [forensicResult, setForensicResult] = useState(null);
  const [showRoleCard, setShowRoleCard] = useState(false);
  const [prevPhase, setPrevPhase] = useState(null);
  const [rpsResult, setRpsResult] = useState(null);

  const notify = useCallback((msg, type = 'info', duration = 4000) => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), duration);
  }, []);

  const { send, connected } = useWebSocket(useCallback((data) => {
    switch (data.type) {
      case 'JOINED':
        setMyId(data.playerId);
        setIsHost(data.isHost);
        setJoined(true);
        break;
      case 'STATE_UPDATE':
        setGameState(prev => {
          if (prev?.phase !== data.state.phase) {
            setPrevPhase(prev?.phase);
            if (data.state.phase === 'night' && data.state.myRole) setShowRoleCard(false);
          }
          return data.state;
        });
        if (data.state.phase === 'night' && data.state.myRole && prevPhase === 'lobby') {
          setShowRoleCard(true);
        }
        break;
      case 'GAME_STARTING':
        notify('🎲 The reckoning begins! Roles are being assigned...', 'warn', 3000);
        setShowRoleCard(true);
        break;
      case 'INVESTIGATE_RESULT':
        setInvestigateResults(data.results);
        notify(`🔍 Investigation complete — ${data.results.length} result(s)`, 'info', 6000);
        break;
      case 'FORENSIC_RESULT':
        setForensicResult(data);
        notify(data.correct ? '✅ Forensic guess correct!' : '❌ Forensic guess wrong!', data.correct ? 'good' : 'bad', 6000);
        break;
      case 'PLAYER_KILLED':
        notify(`💀 ${data.playerName} was found dead at dawn.`, 'bad', 5000);
        break;
      case 'PLAYER_ELIMINATED':
        notify(`🪓 ${data.playerName} was eliminated by the town!`, 'warn', 5000);
        break;
      case 'RPS_RESULT':
        setRpsResult(data);
        setTimeout(() => setRpsResult(null), 5000);
        break;
      case 'GAME_OVER':
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

  const handleJoin = () => {
    const name = nameInput.trim();
    if (!name) return;
    setPlayerName(name);
    send({ type: 'JOIN', name });
  };

  // ── Entry Screen ──────────────────────────────────────────────────────────────
  if (!joined) {
    return (
      <div className="entry-screen">
        <DustParticles count={25} />
        <div className="entry-content animate-burn">
          <div className="entry-badge">⭐</div>
          <h1 className="game-title rye flicker">DEADWOOD</h1>
          <div className="entry-subtitle playfair">— The Reckoning —</div>
          <div className="entry-divider">✦ ✦ ✦</div>

          <div className="wanted-frame">
            <div className="wanted-frame-top">WANTED</div>
            <div className="wanted-frame-sub">Your Name, Stranger</div>
            <div className="name-input-wrap">
              <input
                className="name-input"
                type="text"
                placeholder="Enter your name, partner..."
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
                maxLength={20}
              />
            </div>
            <div className="reward-text">REWARD: {nameInput.length > 0 ? '— CLAIMED —' : 'UNCLAIMED'}</div>
          </div>

          <button className="enter-btn rye" onClick={handleJoin} disabled={!nameInput.trim() || !connected}>
            {connected ? 'RIDE INTO TOWN' : 'CONNECTING...'}
          </button>

          {!connected && <div className="connecting-msg">🔄 Connecting to the telegraph...</div>}
        </div>
      </div>
    );
  }

  if (!gameState) {
    return <div className="loading-screen"><div className="rye flicker">Loading...</div></div>;
  }

  const { phase, players, round, config, gameLog, rpsState, winner, skipVoteCount, skipVoteRequired } = gameState;
  const { myRole, pendingAction, policeTarget, forensicUsed, forensicDoubleCheck,
    bayHarborCooldownActive, surgeonCooldownActive, policeCooldownActive } = gameState;

  const myPlayer = players.find(p => p.id === myId);
  const isAlive = myPlayer?.alive;

  // ── Role Reveal ───────────────────────────────────────────────────────────────
  if (showRoleCard && myRole && phase !== 'lobby') {
    return (
      <div className="role-reveal-screen">
        <DustParticles />
        <div className="role-reveal-content animate-burn">
          <div className="rye role-reveal-header">Your Fate Has Been Drawn</div>
          <RoleRevealCard role={myRole} />
          <button className="enter-btn rye" onClick={() => setShowRoleCard(false)}>
            I ACCEPT MY ROLE
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
        <LobbyScreen
          players={players}
          myId={myId}
          isHost={isHost}
          config={config}
          onReady={() => send({ type: 'READY' })}
          onSetConfig={(cfg) => send({ type: 'SET_CONFIG', ...cfg })}
          onStart={() => send({ type: 'START_GAME' })}
          error={error}
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
      <DustParticles count={8} />

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
          <span className="rye phase-label">
            {phase === 'day' ? `☀️ DAY ${round}` : phase === 'night' ? `🌙 NIGHT ${round}` : ''}
          </span>
        </div>
        <div className="game-title-small rye flicker">DEADWOOD</div>
        <div className="my-role-badge" style={{ '--rc': ROLE_INFO[myRole]?.color }}>
          <span>{ROLE_INFO[myRole]?.emoji}</span>
          <span>{ROLE_INFO[myRole]?.label || 'Observer'}</span>
        </div>
      </div>

      <div className="game-layout">
        {/* Left: Players */}
        <div className="game-left">
          <div className="section-header rye">🤠 The Town ({alivePlayers.length} alive)</div>
          <div className="player-grid">
            {alivePlayers.map(p => (
              <div key={p.id} className={`player-tag alive ${p.id === myId ? 'is-me' : ''}`}>
                <span className="player-tag-icon">🤠</span>
                <span className="player-tag-name">{p.name}</span>
                {p.id === myId && <span className="you-tag">YOU</span>}
                {p.isHost && <span className="marshal-tag">MARSHAL</span>}
              </div>
            ))}
          </div>

          {deadPlayers.length > 0 && (
            <>
              <div className="section-header rye dead-header">💀 The Departed</div>
              <div className="player-grid">
                {deadPlayers.map(p => (
                  <div key={p.id} className="player-tag dead">
                    <span className="player-tag-icon">💀</span>
                    <span className="player-tag-name">{p.name}</span>
                    {p.revived && <span className="revived-tag">REVIVED</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          <GameLog entries={gameLog} />
        </div>

        {/* Right: Actions */}
        <div className="game-right">
          {phase === 'day' && isAlive && (
            <DayVotePanel
              players={players}
              myId={myId}
              myRole={myRole}
              onVote={(id) => send({ type: 'VOTE', targetId: id })}
              onSkip={() => send({ type: 'SKIP_VOTE' })}
              onPoliceAction={(id) => send({ type: 'POLICE_DAY_ACTION', targetId: id })}
              skipVoteCount={skipVoteCount}
              skipVoteRequired={skipVoteRequired}
              votes={gameState.votes}
              policeTarget={policeTarget}
              policeCooldownActive={policeCooldownActive}
            />
          )}

          {phase === 'night' && isAlive && myRole && myRole !== 'CIVILIAN' && (
            <NightActionPanel
              myRole={myRole}
              players={players}
              myId={myId}
              onAction={(action) => send({ type: 'NIGHT_ACTION', ...action })}
              pendingAction={pendingAction}
              cooldowns={{ bayHarborCooldownActive, surgeonCooldownActive, policeCooldownActive, forensicUsed }}
              policeTarget={policeTarget}
            />
          )}

          {phase === 'night' && isAlive && myRole === 'CIVILIAN' && (
            <div className="civilian-night">
              <div className="night-waiting-icon">🌙</div>
              <div className="rye">Rest, civilian.</div>
              <div>The night holds its secrets...</div>
            </div>
          )}

          {!isAlive && phase !== 'gameover' && (
            <div className="dead-observer">
              <div className="dead-observer-icon">💀</div>
              <div className="rye">You have fallen.</div>
              <div>Watch the living play out their fate...</div>
            </div>
          )}

          {/* Investigate Results */}
          {investigateResults.length > 0 && (
            <div className="investigate-panel animate-paper">
              <div className="rye inv-title">🔍 Investigation Results</div>
              {investigateResults.map((r, i) => (
                <div key={i} className={`inv-result ${r.team}`}>
                  <span>{ROLE_INFO[r.role]?.emoji}</span>
                  <span className="inv-name">{r.name}</span>
                  <span className="inv-role" style={{ color: ROLE_INFO[r.role]?.color }}>
                    {ROLE_INFO[r.role]?.label}
                  </span>
                  <span className={`inv-team ${r.team}`}>{r.team === 'killer' ? '☠️' : '⭐'}</span>
                </div>
              ))}
              <button className="clear-btn" onClick={() => setInvestigateResults([])}>Dismiss</button>
            </div>
          )}

          {forensicResult && (
            <div className={`forensic-panel animate-stamp ${forensicResult.correct ? 'correct' : 'wrong'}`}>
              <div className="rye">🧪 Forensic Report</div>
              <div>{forensicResult.message}</div>
              <button className="clear-btn" onClick={() => setForensicResult(null)}>Dismiss</button>
            </div>
          )}
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div className={`notification ${notification.type}`}>{notification.msg}</div>
      )}
    </div>
  );
}
