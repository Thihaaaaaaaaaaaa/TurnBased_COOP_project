import { useState, useEffect, useRef, useMemo } from 'react';
import { Character, SpeechBubble, NameTag } from './Character';
import { ROLE_INFO } from '../utils/roles';

// Position N seats around an oval (table).
// Returns array of {x, y, angle} for each seat as percentages.
function seatPositions(count) {
  if (count <= 0) return [];
  const positions = [];
  // Distribute around an ellipse — start at top center, go clockwise
  const rx = 38; // horizontal radius (% of container width from center)
  const ry = 32; // vertical radius
  for (let i = 0; i < count; i++) {
    // Start at top (-PI/2), go clockwise
    const t = -Math.PI / 2 + (i / count) * 2 * Math.PI;
    const x = 50 + Math.cos(t) * rx;
    const y = 50 + Math.sin(t) * ry;
    positions.push({ x, y, angle: t });
  }
  return positions;
}

export function SaloonScene({
  players,
  myId,
  phase,
  voteCounts,
  myVote,
  onSelectPlayer,
  selectedId,
  recentChat,
  rolesByPlayerId,
  myRole,
  acting,
  killedThisRound,
  centerSlot,        // React node rendered on the table center (e.g. <BigClock/>)
}) {
  const positions = useMemo(() => seatPositions(players.length), [players.length]);
  const [bubbles, setBubbles] = useState({}); // playerId -> {text, expiresAt}

  // Track new chat messages and pop bubbles for ~4s
  const lastSeenRef = useRef(0);
  useEffect(() => {
    if (!recentChat) return;
    if (recentChat.length > lastSeenRef.current) {
      const newOnes = recentChat.slice(lastSeenRef.current);
      const now = Date.now();
      const newBubbles = { ...bubbles };
      newOnes.forEach(c => {
        if (c.channel === 'town' && c.playerId) {
          newBubbles[c.playerId] = { text: c.msg, expiresAt: now + 4500 };
        }
      });
      setBubbles(newBubbles);
    }
    lastSeenRef.current = recentChat.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentChat]);

  // Sweep expired bubbles
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setBubbles(prev => {
        const next = {};
        let changed = false;
        for (const [k, v] of Object.entries(prev)) {
          if (v.expiresAt > now) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // voteCounts comes from server (anonymous tally only)
  const counts = voteCounts || {};

  const isClickable = phase === 'day' || phase === 'night';

  return (
    <div className={`saloon-scene scene-${phase}`}>
      {/* Background — saloon interior */}
      <div className="scene-bg">
        <div className="scene-floor" />
        <div className="scene-wall-back" />
        <div className="scene-chandelier">
          <div className="chandelier-glow" />
          <div className="chandelier-body">
            <span>🕯️</span><span>🕯️</span><span>🕯️</span>
          </div>
        </div>
        {phase === 'night' && (
          <>
            <div className="scene-moon-window" />
            <div className="scene-darkness" />
          </>
        )}
      </div>

      {/* The poker table */}
      <div className="poker-table">
        <div className="table-felt">
          {centerSlot ? (
            <div className="table-center-slot">{centerSlot}</div>
          ) : (
            <div className="table-emblem">
              {phase === 'day' ? '☀' : phase === 'night' ? '🌙' : '⭐'}
            </div>
          )}
        </div>
        <div className="table-rim" />
      </div>

      {/* Characters around the table */}
      {players.map((p, i) => {
        const pos = positions[i];
        if (!pos) return null;
        const role = rolesByPlayerId?.[p.id];
        const isMe = p.id === myId;
        const isKilled = killedThisRound === p.id;
        const state = !p.alive
          ? (p.eliminated ? 'eliminated' : 'dead')
          : 'idle';
        const isTargeted = selectedId === p.id;
        const isVoted = myVote === p.id;
        const isActing = acting?.[p.id];
        const bubble = bubbles[p.id];

        return (
          <div
            key={p.id}
            className={`seat ${isClickable && p.alive ? 'clickable' : ''} ${isKilled ? 'just-killed' : ''}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            onClick={() => isClickable && p.alive && onSelectPlayer?.(p.id)}
          >
            <Character
              seed={p.id}
              state={state}
              role={role}
              isMe={isMe}
              talking={!!bubble}
              voted={isVoted}
              targeted={isTargeted}
              acting={isActing}
              size={88}
            />
            <NameTag
              name={p.name}
              alive={p.alive}
              isHost={p.isHost}
              voteCount={counts[p.id] || 0}
            />
            {bubble && <SpeechBubble text={bubble.text} />}
          </div>
        );
      })}

      {/* Scene-wide overlays */}
      {phase === 'night' && <NightVignette />}
    </div>
  );
}

function NightVignette() {
  return <div className="night-vignette" />;
}
