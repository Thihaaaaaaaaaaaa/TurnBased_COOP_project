export const ROLE_INFO = {
  CIVILIAN: {
    label: 'Civilian',
    team: 'good',
    emoji: '🤠',
    color: '#c9a84c',
    description: 'A simple townsfolk. Survive and vote out the killers.',
    flavor: 'Just tryin\' to live honest.',
  },
  NORMAL_KILLER: {
    label: 'The Outlaw',
    team: 'killer',
    emoji: '🔫',
    color: '#8b1a1a',
    description: 'Kill one person each night, or lay low and skip.',
    flavor: 'Wanted: Dead or Alive.',
  },
  GEMINI_KILLER: {
    label: 'Gemini Killer',
    team: 'killer',
    emoji: '⏳',
    color: '#6b1a6b',
    description: 'Schedule a kill 1-2 nights in advance. The victim dies later.',
    flavor: 'Patience is the deadliest weapon.',
  },
  BAY_HARBOR: {
    label: 'Bay Harbor Butcher',
    team: 'killer',
    emoji: '🪓',
    color: '#8b2500',
    description: 'Kill every 2 nights, or investigate like a detective. One action only.',
    flavor: 'A killer with a conscience — almost.',
  },
  NORMAL_DOCTOR: {
    label: 'Doc Holliday',
    team: 'good',
    emoji: '💉',
    color: '#2a7a4f',
    description: 'Protect one person each night from being killed.',
    flavor: 'I\'m your huckleberry.',
  },
  SURGEON: {
    label: 'The Surgeon',
    team: 'good',
    emoji: '🩺',
    color: '#2a5a7a',
    description: 'Bring a dead player back to life. 2-night cooldown.',
    flavor: 'Death ain\'t final, not on my watch.',
  },
  POLICE: {
    label: 'The Police',
    team: 'good',
    emoji: '🛡️',
    color: '#2a4a7a',
    description: 'Designate a protect target during the day. Shield activates that night. 1-night cooldown.',
    flavor: 'Law comes to Deadwood.',
  },
  NORMAL_DETECTIVE: {
    label: 'The Detective',
    team: 'good',
    emoji: '🔍',
    color: '#7a6a2a',
    description: 'Investigate one player each night to learn their role.',
    flavor: 'The truth is buried somewhere.',
  },
  SHERIFF: {
    label: 'The Sheriff',
    team: 'good',
    emoji: '⭐',
    color: '#7a5a00',
    description: 'Investigate players nightly. If it comes down to just you and the killer — it\'s a showdown.',
    flavor: 'This town ain\'t big enough for the both of us.',
  },
  FORENSIC: {
    label: 'The Forensic',
    team: 'good',
    emoji: '🧪',
    color: '#5a7a4a',
    description: 'One-time guess of killer variant. Correct = 2 checks/night forever. Wrong = normal detective.',
    flavor: 'The evidence never lies.',
  },
};

export const KILLER_VARIANTS = ['NORMAL_KILLER', 'GEMINI_KILLER', 'BAY_HARBOR'];
export const DOCTOR_VARIANTS = ['NORMAL_DOCTOR', 'SURGEON', 'POLICE'];
export const DETECTIVE_VARIANTS = ['NORMAL_DETECTIVE', 'SHERIFF', 'FORENSIC'];

export const CATEGORY_ALL = {
  killer: KILLER_VARIANTS,
  doctor: DOCTOR_VARIANTS,
  detective: DETECTIVE_VARIANTS,
};

export function getRoleTeam(role) {
  return ROLE_INFO[role]?.team || 'good';
}

export function getRoleLabel(role) {
  return ROLE_INFO[role]?.label || role;
}
