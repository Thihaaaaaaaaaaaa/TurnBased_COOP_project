// Placeholder character sprites — procedural SVG cowboys/cowgirls.
// Swap-point for real assets: replace the <svg>...</svg> with <img src={...}/>
// keyed by `variant` (0-9) to slot in custom PNGs later.

const VARIANTS = [
  { skin: '#e8c39e', shirt: '#8b1a1a', hat: '#3a1f0a', vest: '#1a0e00', name: 'Sundown Sal' },
  { skin: '#d4a574', shirt: '#2a4a7a', hat: '#1a0e00', vest: '#3a1f0a', name: 'Black Jack' },
  { skin: '#f0d0a8', shirt: '#7a5a00', hat: '#4a3520', vest: '#0f0700', name: 'Goldie' },
  { skin: '#c89a6c', shirt: '#2a7a4f', hat: '#2a1a08', vest: '#1a0e00', name: 'Doc Iron' },
  { skin: '#e8c39e', shirt: '#5a3a7a', hat: '#3a1f0a', vest: '#2a1a08', name: 'Velvet' },
  { skin: '#c08555', shirt: '#c0392b', hat: '#1a0e00', vest: '#3a1f0a', name: 'Red Rita' },
  { skin: '#f0d0a8', shirt: '#1a3a5a', hat: '#4a3520', vest: '#0f0700', name: 'Bluebird' },
  { skin: '#d4a574', shirt: '#7a4a1a', hat: '#1a0e00', vest: '#2a1a08', name: 'Rusty' },
  { skin: '#e8c39e', shirt: '#0f4a3a', hat: '#3a1f0a', vest: '#1a0e00', name: 'Mossy' },
  { skin: '#c08555', shirt: '#5a0e0e', hat: '#2a1a08', vest: '#0f0700', name: 'Ash' },
];

function pickVariant(seed) {
  // deterministic variant from player id
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return VARIANTS[Math.abs(h) % VARIANTS.length];
}

export function Character({ seed, state = 'idle', role, isMe, talking, voted, targeted, acting, size = 96 }) {
  const v = pickVariant(seed);
  const dead = state === 'dead';
  const eliminated = state === 'eliminated';

  return (
    <div className={`character state-${state} ${isMe ? 'is-me' : ''} ${acting ? 'acting' : ''}`}
      style={{ width: size, height: size * 1.4 }}>

      {/* The character body */}
      <svg viewBox="0 0 96 134" width={size} height={size * 1.4}
        className={`char-svg ${talking ? 'talking' : ''}`}>

        {/* Shadow */}
        <ellipse cx="48" cy="128" rx="22" ry="4" fill="#000" opacity="0.4" />

        {/* Body sway group */}
        <g className="char-body">
          {/* Legs */}
          <rect x="38" y="92" width="8" height="28" fill={v.vest} />
          <rect x="50" y="92" width="8" height="28" fill={v.vest} />
          {/* Boots */}
          <rect x="36" y="118" width="12" height="6" rx="2" fill="#1a0e00" />
          <rect x="48" y="118" width="12" height="6" rx="2" fill="#1a0e00" />

          {/* Body / shirt */}
          <rect x="30" y="58" width="36" height="40" rx="3" fill={v.shirt} />
          {/* Vest */}
          <path d="M30 60 L36 65 L36 95 L30 98 Z" fill={v.vest} opacity="0.85" />
          <path d="M66 60 L60 65 L60 95 L66 98 Z" fill={v.vest} opacity="0.85" />
          {/* Sheriff star or buttons */}
          {role === 'SHERIFF' || role === 'POLICE' ? (
            <polygon points="48,72 51,79 58,79 52,84 54,91 48,87 42,91 44,84 38,79 45,79"
              fill="#f4d03f" stroke="#8b6914" strokeWidth="0.5" />
          ) : (
            <>
              <circle cx="48" cy="68" r="1.5" fill="#c9a84c" />
              <circle cx="48" cy="76" r="1.5" fill="#c9a84c" />
              <circle cx="48" cy="84" r="1.5" fill="#c9a84c" />
            </>
          )}

          {/* Arms */}
          <rect x="22" y="60" width="8" height="32" rx="3" fill={v.shirt} />
          <rect x="66" y="60" width="8" height="32" rx="3" fill={v.shirt} />
          {/* Hands */}
          <circle cx="26" cy="94" r="4" fill={v.skin} />
          <circle cx="70" cy="94" r="4" fill={v.skin} />

          {/* Holster + pistol on hip (for killers) */}
          {(role === 'NORMAL_KILLER' || role === 'GEMINI_KILLER' || role === 'BAY_HARBOR') && (
            <g>
              <rect x="63" y="90" width="6" height="8" fill="#1a0e00" />
              <rect x="64" y="88" width="4" height="3" fill="#5a4a3a" />
            </g>
          )}

          {/* Neck */}
          <rect x="44" y="50" width="8" height="10" fill={v.skin} />
          {/* Bandana for some */}
          {(role === 'NORMAL_KILLER' || role === 'GEMINI_KILLER') && (
            <path d="M36 56 Q48 62 60 56 L60 62 Q48 68 36 62 Z" fill="#6b0e0e" />
          )}

          {/* Head */}
          <circle cx="48" cy="40" r="13" fill={v.skin} />
          {/* Hair tuft (sideburn) */}
          <path d="M36 38 Q34 44 38 48" fill={v.hat} opacity="0.7" />
          <path d="M60 38 Q62 44 58 48" fill={v.hat} opacity="0.7" />

          {/* Eyes */}
          {dead ? (
            <g className="dead-eyes">
              <line x1="42" y1="38" x2="46" y2="42" stroke="#1a0e00" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="46" y1="38" x2="42" y2="42" stroke="#1a0e00" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="50" y1="38" x2="54" y2="42" stroke="#1a0e00" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="54" y1="38" x2="50" y2="42" stroke="#1a0e00" strokeWidth="1.5" strokeLinecap="round" />
            </g>
          ) : (
            <g className="char-eyes">
              <circle cx="44" cy="40" r="1.5" fill="#1a0e00" />
              <circle cx="52" cy="40" r="1.5" fill="#1a0e00" />
            </g>
          )}
          {/* Mouth */}
          {dead ? (
            <line x1="44" y1="46" x2="52" y2="46" stroke="#6b0e0e" strokeWidth="1" />
          ) : talking ? (
            <ellipse cx="48" cy="46" rx="3" ry="2" fill="#3a1f0a" className="talking-mouth" />
          ) : (
            <path d="M44 46 Q48 48 52 46" stroke="#3a1f0a" strokeWidth="1" fill="none" />
          )}
          {/* Mustache for some characters */}
          {Math.abs((seed||'').charCodeAt?.(0) || 0) % 3 === 0 && !dead && (
            <path d="M42 45 Q48 47 54 45" stroke={v.hat} strokeWidth="2" fill="none" strokeLinecap="round" />
          )}

          {/* Cowboy hat */}
          <ellipse cx="48" cy="29" rx="20" ry="3" fill={v.hat} />
          <path d="M34 29 Q34 18 48 17 Q62 18 62 29 Z" fill={v.hat} />
          <ellipse cx="48" cy="29" rx="20" ry="2" fill={v.hat} opacity="0.7" />
          {/* Hat band */}
          <rect x="35" y="26" width="26" height="2" fill={v.shirt} opacity="0.8" />
        </g>
      </svg>

      {/* Overlays */}
      {dead && <BloodPool />}
      {dead && <RipMarker />}
      {targeted && !dead && <TargetReticle />}
      {voted && !dead && <VotedMark />}
      {acting && <ActionPulse role={role} />}
      {isMe && <YouMarker />}
    </div>
  );
}

function BloodPool() {
  return (
    <svg className="blood-pool" viewBox="0 0 96 30">
      <ellipse cx="48" cy="20" rx="26" ry="8" fill="#6b0e0e" opacity="0.7" />
      <ellipse cx="40" cy="22" rx="12" ry="4" fill="#8b1a1a" opacity="0.8" />
      <ellipse cx="58" cy="18" rx="8" ry="3" fill="#8b1a1a" opacity="0.8" />
      <circle cx="30" cy="24" r="2" fill="#6b0e0e" />
      <circle cx="68" cy="22" r="3" fill="#6b0e0e" />
    </svg>
  );
}

function RipMarker() {
  return (
    <div className="rip-marker">
      <svg viewBox="0 0 60 70" width="44" height="50">
        <path d="M15 50 Q15 10 30 8 Q45 10 45 50 Z" fill="#5a4a3a" stroke="#2a1a08" strokeWidth="1.5" />
        <text x="30" y="28" textAnchor="middle" fontFamily="Rye, serif" fontSize="10" fill="#1a0e00">R.I.P.</text>
        <line x1="20" y1="35" x2="40" y2="35" stroke="#1a0e00" strokeWidth="0.5" />
        <line x1="22" y1="40" x2="38" y2="40" stroke="#1a0e00" strokeWidth="0.5" />
      </svg>
    </div>
  );
}

function TargetReticle() {
  return (
    <svg className="target-reticle" viewBox="0 0 60 60" width="60" height="60">
      <circle cx="30" cy="30" r="24" fill="none" stroke="#e63946" strokeWidth="2" strokeDasharray="4 3" />
      <circle cx="30" cy="30" r="16" fill="none" stroke="#e63946" strokeWidth="1.5" />
      <line x1="30" y1="2" x2="30" y2="14" stroke="#e63946" strokeWidth="2" />
      <line x1="30" y1="46" x2="30" y2="58" stroke="#e63946" strokeWidth="2" />
      <line x1="2" y1="30" x2="14" y2="30" stroke="#e63946" strokeWidth="2" />
      <line x1="46" y1="30" x2="58" y2="30" stroke="#e63946" strokeWidth="2" />
      <circle cx="30" cy="30" r="2" fill="#e63946" />
    </svg>
  );
}

function VotedMark() {
  return (
    <div className="voted-mark">
      <svg viewBox="0 0 40 40" width="36" height="36">
        <circle cx="20" cy="20" r="18" fill="#c0392b" stroke="#f4d03f" strokeWidth="2" />
        <path d="M10 10 L30 30 M30 10 L10 30" stroke="#f4d03f" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function ActionPulse({ role }) {
  const icons = {
    NORMAL_KILLER: '🔫', GEMINI_KILLER: '⏳', BAY_HARBOR: '🪓',
    NORMAL_DOCTOR: '💉', SURGEON: '🩺', POLICE: '🛡️',
    NORMAL_DETECTIVE: '🔍', SHERIFF: '⭐', FORENSIC: '🧪',
  };
  return (
    <div className="action-pulse">
      <div className="pulse-ring" />
      <div className="pulse-icon">{icons[role] || '✨'}</div>
    </div>
  );
}

function YouMarker() {
  return <div className="you-marker">▼ YOU</div>;
}

export function SpeechBubble({ text }) {
  if (!text) return null;
  return (
    <div className="speech-bubble">
      <div className="speech-text">{text}</div>
    </div>
  );
}

export function NameTag({ name, alive, isHost, voteCount }) {
  return (
    <div className={`name-tag ${!alive ? 'dead' : ''}`}>
      {isHost && <span className="nt-marshal">★</span>}
      <span className="nt-name">{name}</span>
      {voteCount > 0 && <span className="nt-votes">{voteCount}</span>}
    </div>
  );
}
