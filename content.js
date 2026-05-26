'use strict';
// ════════════════════════════════════════════════════════════
// THE ETERNAL QUEST — content (6-stat system, class paths, 50 enemies)
// Stats: STR(phys), DEX(speed/crit/acc), INT(magic), VIT(hp/def), WIS(mana/cdr), LUK(crit/rare)
// Class path: Base (Lv1) → Super (Lv10) → Ultra (Lv15+). Choices branch A/B then two ultras.
// ════════════════════════════════════════════════════════════

// derive combat stats from the 6 core stats
function derive(stats){
  const {STR=0,DEX=0,INT=0,VIT=0,WIS=0,LUK=0}=stats;
  return {
    maxHp: 200 + VIT*16 + STR*3,
    maxMp: 70 + WIS*9 + INT*2,
    patk: 10 + STR*3 + DEX*0.5,         // physical attack
    matk: 8 + INT*3 + WIS*0.5,          // magic attack
    def: 6 + VIT*2 + STR*0.4,
    spd: 8 + DEX*1.2,
    crit: 0.05 + DEX*0.012 + LUK*0.015, // crit chance
    critMult: 1.8 + LUK*0.03,
    acc: 0.85 + DEX*0.01,
    cdr: WIS*0.008,
    luck: LUK,
  };
}

// ─── SKILLS ─── damage given as [min,max]; scale: 'str'|'int'|'mix'
// type: 'attack'(phys), 'magic', 'heal', 'buff', 'debuff'
// hits: number of strikes; statuses applied via status:[...]
function S(id,name,sprite,o){ return Object.assign({id,name,sprite,mp:0,hits:1,scale:'str',type:'attack',dmg:[0,0],desc:''},o); }

const SKILLS = {
  // universal
  basic:        S('basic','Strike',1448,{mp:0,dmg:[8,14],scale:'str',desc:'A basic attack.'}),

  // RANGER line
  quickshot:    S('quickshot','Quick Shot',1131,{mp:6,hits:3,dmg:[20,30],scale:'str',type:'attack',desc:'Fire 3 arrows (20-30 each).'}),
  eagleeye:     S('eagleeye','Eagle Eye',1126,{mp:5,type:'buff',buff:'accup',desc:'+25% accuracy & crit for 3 rounds.'}),
  wolf:         S('wolf','Wolf Companion',1162,{mp:10,dmg:[30,60],scale:'str',desc:'Beast strikes (30-60).'}),
  predator:     S('predator','Predator Bond',1130,{mp:8,type:'buff',buff:'spdup',desc:'+40% speed, party haste.'}),
  alpha:        S('alpha','Alpha Summon',1163,{mp:20,dmg:[150,220],scale:'str',desc:'Massive beast assault (150-220).'}),
  frenzy:       S('frenzy','Frenzy Roar',1152,{mp:16,type:'buff',buff:'atkup',desc:'+35% team damage for 3 rounds.'}),
  phoenix:      S('phoenix','Spirit Phoenix',1174,{mp:22,dmg:[180,260],scale:'int',type:'magic',desc:'Phoenix fire (180-260).'}),
  natureheal:   S('natureheal','Nature Heal',1175,{mp:18,type:'heal',heal:[100,200],desc:'Heal an ally 100-200.'}),
  pierce:       S('pierce','Piercing Shot',1145,{mp:9,dmg:[70,110],scale:'str',pierce:0.5,desc:'Armor-piercing shot (70-110).'}),
  deadeye:      S('deadeye','Deadeye',1170,{mp:7,type:'buff',buff:'critup',desc:'+30% crit for 3 rounds.'}),
  shadowvolley: S('shadowvolley','Shadow Volley',1180,{mp:20,hits:10,dmg:[35,50],scale:'str',desc:'10 shadow arrows (35-50 each).'}),
  blink:        S('blink','Blink Shot',1190,{mp:22,dmg:[180,230],scale:'str',critBonus:0.3,desc:'Teleport strike (180-230).'}),
  thunderarrow: S('thunderarrow','Thunder Arrow',1196,{mp:24,dmg:[220,320],scale:'int',type:'magic',status:[{type:'stun',rounds:1}],desc:'Thunder bolt (220-320) + stun.'}),
  stormbarrage: S('stormbarrage','Storm Barrage',1198,{mp:22,hits:8,dmg:[40,60],scale:'int',type:'magic',desc:'8 storm bolts (40-60 each).'}),

  // MAGE line
  fireball:     S('fireball','Fireball',1185,{mp:8,dmg:[45,70],scale:'int',type:'magic',status:[{type:'burn',rounds:3,power:10}],desc:'Hurl fire (45-70) + Burn.'}),
  manapulse:    S('manapulse','Mana Pulse',1156,{mp:6,type:'debuff',status:[{type:'weaken',rounds:2}],dmg:[20,30],scale:'int',desc:'Push & weaken enemy.'}),
  arcanebeam:   S('arcanebeam','Arcane Beam',1186,{mp:14,dmg:[80,120],scale:'int',type:'magic',pierce:1,desc:'Pure arcane (80-120) ignores DEF.'}),
  meteorrain:   S('meteorrain','Meteor Rain',1212,{mp:30,dmg:[300,500],scale:'int',type:'magic',status:[{type:'burn',rounds:3,power:20}],desc:'Cataclysm (300-500) + Burn.'}),
  manacollapse: S('manacollapse','Mana Collapse',1196,{mp:26,dmg:[200,280],scale:'int',type:'magic',pierce:1,desc:'AoE arcane blast (200-280).'}),
  timefreeze:   S('timefreeze','Time Freeze',1160,{mp:22,type:'debuff',status:[{type:'stun',rounds:2}],dmg:[40,60],scale:'int',desc:'Freeze enemy 2 rounds.'}),
  agedecay:     S('agedecay','Age Decay',1167,{mp:20,dmg:[60,90],scale:'int',type:'magic',status:[{type:'poison',rounds:4,power:35}],desc:'Decay (150-250 over time).'}),
  souldrain:    S('souldrain','Soul Drain',1184,{mp:10,dmg:[60,90],scale:'int',type:'magic',lifesteal:0.6,desc:'Drain (60-90), heal 60%.'}),
  curse:        S('curse','Curse',1166,{mp:9,type:'debuff',status:[{type:'weaken',rounds:3},{type:'vulnerable',rounds:3}],desc:'Weaken & expose enemy.'}),
  bloodexpl:    S('bloodexpl','Blood Explosion',1218,{mp:30,dmg:[250,400],scale:'int',type:'magic',desc:'Detonate blood (250-400).'}),
  lifetheft:    S('lifetheft','Life Theft',1184,{mp:24,dmg:[120,180],scale:'int',type:'magic',lifesteal:1.0,desc:'Steal 50% HP as damage.'}),
  voidrift:     S('voidrift','Void Rift',1216,{mp:30,dmg:[300,450],scale:'int',type:'magic',pierce:1,desc:'Tear reality (300-450).'}),
  darkspawn:    S('darkspawn','Dark Spawn',1164,{mp:24,dmg:[80,120],hits:3,scale:'int',type:'magic',desc:'Summon demons (3×80-120).'}),

  // WARRIOR line
  slash:        S('slash','Heavy Slash',1450,{mp:6,dmg:[40,60],scale:'str',desc:'Heavy blow (40-60).'}),
  guardstance:  S('guardstance','Guard Stance',1140,{mp:6,type:'buff',buff:'shield',shield:60,desc:'Shield absorbing 60.'}),
  earthslam:    S('earthslam','Earth Slam',1205,{mp:28,dmg:[250,400],scale:'str',status:[{type:'vulnerable',rounds:3}],desc:'Quake (250-400) + Vulnerable.'}),
  rageburst:    S('rageburst','Rage Burst',1217,{mp:30,dmg:[300,450],scale:'str',lifesteal:0.4,desc:'Berserk (300-450), heal 40%.'}),
  divinestrike: S('divinestrike','Divine Strike',1204,{mp:26,dmg:[230,340],scale:'str',type:'magic',desc:'Holy smite (230-340).'}),
  fortress:     S('fortress','Fortress Shield',1141,{mp:24,type:'buff',buff:'fortress',shield:120,desc:'+50% defense & 120 shield.'}),
  warcry2:      S('warcry2','War Cry',1152,{mp:14,type:'buff',buff:'atkup',desc:'+35% party damage.'}),
  cleave2:      S('cleave2','Cleave',1452,{mp:8,dmg:[50,80],scale:'str',desc:'Sweeping cut (50-80).'}),

  // ASSASSIN line
  stab:         S('stab','Stab',1460,{mp:5,dmg:[35,55],scale:'str',critBonus:0.2,desc:'Quick stab (35-55).'}),
  shadowstrike: S('shadowstrike','Shadow Strike',1188,{mp:9,dmg:[60,90],scale:'str',critBonus:0.3,desc:'Strike from shadow (60-90).'}),
  backstab2:    S('backstab2','Backstab',1189,{mp:24,dmg:[300,500],scale:'str',critBonus:0.5,pierce:0.5,desc:'Lethal backstab (300-500).'}),
  shadowclones: S('shadowclones','Shadow Clones',1180,{mp:22,hits:4,dmg:[70,110],scale:'str',desc:'Clones strike (4×70-110).'}),
  toxiccloud:   S('toxiccloud','Toxic Cloud',1226,{mp:24,dmg:[40,60],scale:'int',type:'magic',status:[{type:'poison',rounds:5,power:50}],desc:'Poison cloud (250-300 over time).'}),
  infection:    S('infection','Infection Spread',1224,{mp:20,status:[{type:'poison',rounds:5,power:30},{type:'weaken',rounds:3}],dmg:[60,90],scale:'int',desc:'Spread plague + weaken.'}),
  poisonstab:   S('poisonstab','Poison Stab',1462,{mp:8,dmg:[40,60],scale:'str',status:[{type:'poison',rounds:4,power:18}],desc:'Venom strike (40-60) + Poison.'}),

  // MONK line
  palm:         S('palm','Palm Strike',1136,{mp:6,dmg:[40,65],scale:'str',desc:'Focused palm (40-65).'}),
  dragonfist:   S('dragonfist','Dragon Fist',1232,{mp:30,dmg:[350,500],scale:'str',desc:'Dragon strike (350-500).'}),
  astralpunch:  S('astralpunch','Astral Punch',1234,{mp:28,dmg:[300,420],scale:'int',type:'magic',desc:'Astral blow (300-420).'}),
  chiheal:      S('chiheal','Chi Heal',1146,{mp:16,type:'heal',heal:[80,140],desc:'Channel chi to heal 80-140.'}),
  meditate:     S('meditate','Meditate',1147,{mp:0,type:'buff',buff:'meditate',desc:'Restore 30% MP, +shield.'}),

  // ENGINEER line
  wrench:       S('wrench','Wrench Bash',1476,{mp:6,dmg:[38,58],scale:'str',desc:'Bonk (38-58).'}),
  rocketbarr:   S('rocketbarr','Rocket Barrage',1138,{mp:28,dmg:[280,400],scale:'int',hits:3,type:'magic',desc:'Rockets (3 hits, 280-400 total).'}),
  chemcat:      S('chemcat','Chemical Catastrophe',1228,{mp:30,dmg:[300,450],scale:'int',type:'magic',status:[{type:'poison',rounds:3,power:30}],desc:'Acid blast (300-450) + Poison.'}),
  turret:       S('turret','Deploy Turret',1162,{mp:18,type:'buff',buff:'turret',desc:'Turret adds bonus damage 3 rounds.'}),

  // NECROMANCER line
  bonebolt:     S('bonebolt','Bone Bolt',1164,{mp:8,dmg:[45,70],scale:'int',type:'magic',desc:'Bone shard (45-70).'}),
  undeadarmy:   S('undeadarmy','Undead Army',1162,{mp:26,hits:5,dmg:[40,70],scale:'int',type:'magic',desc:'Raise undead (5×40-70).'}),
  soulexpl:     S('soulexpl','Soul Explosion',1220,{mp:30,dmg:[320,480],scale:'int',type:'magic',lifesteal:0.3,desc:'Soul burst (320-480).'}),
  lifedrain:    S('lifedrain','Life Drain',1184,{mp:12,dmg:[70,100],scale:'int',type:'magic',lifesteal:0.7,desc:'Drain life (70-100).'}),

  // ELEMENTALIST line
  frostbolt:    S('frostbolt','Frost Bolt',1175,{mp:8,dmg:[45,70],scale:'int',type:'magic',status:[{type:'freeze',rounds:1}],desc:'Frost (45-70) + chill.'}),
  frozenworld:  S('frozenworld','Frozen World',1178,{mp:30,dmg:[300,450],scale:'int',type:'magic',status:[{type:'stun',rounds:2}],desc:'Absolute zero (300-450) + freeze.'}),
  sunexpl:      S('sunexpl','Sun Explosion',1212,{mp:32,dmg:[400,600],scale:'int',type:'magic',status:[{type:'burn',rounds:3,power:30}],desc:'Solar nova (400-600) + Burn.'}),
  flamewave:    S('flamewave','Flame Wave',1144,{mp:14,dmg:[90,130],scale:'int',type:'magic',status:[{type:'burn',rounds:3,power:15}],desc:'Fire wave (90-130) + Burn.'}),

  // SECRET
  chaosbolt:    S('chaosbolt','Chaos Bolt',1216,{mp:20,dmg:[50,800],scale:'int',type:'magic',desc:'Random chaos (50-800!).'}),
  dragonbreath: S('dragonbreath','Dragon Breath',1144,{mp:30,dmg:[450,700],scale:'int',type:'magic',status:[{type:'burn',rounds:3,power:30}],desc:'Dragonfire (450-700).'}),
  godpunch:     S('godpunch','Godhand',1136,{mp:34,dmg:[600,900],scale:'str',desc:'The fist of god (600-900).'}),
};

// ─── CLASS PATH TREES ───
// Each class: base stats + base skills, then super[A/B] each with ultra[0/1].
// sprite = character icon index (from armor/character region of sheet).
function CL(o){ return o; }
const CLASSES = {
  ranger: CL({
    id:'ranger', name:'Ranger', sprite:1955,
    stats:{DEX:12,STR:5,LUK:3},
    skills:['quickshot','eagleeye'],
    supers:{
      A:{ name:'Beast Tamer', sprite:1937, stats:{VIT:10,DEX:8}, skills:['wolf','predator'],
        ultras:[
          {name:'Savage Beastmaster',sprite:1938,stats:{STR:20,VIT:20},skills:['alpha','frenzy']},
          {name:'Spirit Caller',sprite:1939,stats:{WIS:25,DEX:15},skills:['phoenix','natureheal']},
        ]},
      B:{ name:'Sharpshooter', sprite:1940, stats:{DEX:15,LUK:10}, skills:['pierce','deadeye'],
        ultras:[
          {name:'Phantom Archer',sprite:1941,stats:{DEX:30,LUK:15},skills:['shadowvolley','blink']},
          {name:'Storm Sniper',sprite:1942,stats:{DEX:25,INT:20},skills:['thunderarrow','stormbarrage']},
        ]},
    },
  }),
  mage: CL({
    id:'mage', name:'Mage', sprite:1957,
    stats:{INT:12,WIS:10},
    skills:['fireball','manapulse'],
    supers:{
      A:{ name:'Arcane Mage', sprite:1953, stats:{INT:20}, skills:['arcanebeam','manapulse'],
        ultras:[
          {name:'Supreme Mage',sprite:1954,stats:{INT:40,WIS:20},skills:['meteorrain','manacollapse']},
          {name:'Time Sage',sprite:1955,stats:{WIS:35},skills:['timefreeze','agedecay']},
        ]},
      B:{ name:'Warlock', sprite:1956, stats:{INT:10,VIT:15}, skills:['souldrain','curse'],
        ultras:[
          {name:'Blood Warlock',sprite:1957,stats:{VIT:30,INT:20},skills:['bloodexpl','lifetheft']},
          {name:'Abyss Lord',sprite:1958,stats:{INT:35},skills:['voidrift','darkspawn']},
        ]},
    },
  }),
  warrior: CL({
    id:'warrior', name:'Warrior', sprite:1908,
    stats:{STR:15,VIT:10},
    skills:['slash','guardstance'],
    supers:{
      A:{ name:'Berserker', sprite:1921, stats:{STR:18,VIT:6}, skills:['cleave2','warcry2'],
        ultras:[
          {name:'Titan Berserker',sprite:1922,stats:{STR:25,VIT:20},skills:['earthslam','warcry2']},
          {name:'Blood Titan',sprite:1923,stats:{STR:28,VIT:15},skills:['rageburst','warcry2']},
        ]},
      B:{ name:'Knight', sprite:1924, stats:{VIT:18,STR:8}, skills:['slash','guardstance'],
        ultras:[
          {name:'Holy Paladin',sprite:1925,stats:{VIT:22,STR:18},skills:['divinestrike','guardstance']},
          {name:'Guardian King',sprite:1926,stats:{VIT:30,STR:12},skills:['fortress','divinestrike']},
        ]},
    },
  }),
  assassin: CL({
    id:'assassin', name:'Assassin', sprite:1953,
    stats:{DEX:15,LUK:10},
    skills:['stab','poisonstab'],
    supers:{
      A:{ name:'Shadowblade', sprite:1929, stats:{DEX:18,LUK:8}, skills:['shadowstrike','stab'],
        ultras:[
          {name:'Void Assassin',sprite:1930,stats:{DEX:30,LUK:18},skills:['backstab2','shadowstrike']},
          {name:'Night Hunter',sprite:1931,stats:{DEX:28,LUK:20},skills:['shadowclones','backstab2']},
        ]},
      B:{ name:'Poison Master', sprite:1932, stats:{DEX:12,INT:12}, skills:['poisonstab','infection'],
        ultras:[
          {name:'Venom King',sprite:1933,stats:{INT:25,DEX:18},skills:['toxiccloud','infection']},
          {name:'Plague Reaper',sprite:1934,stats:{INT:28,DEX:15},skills:['infection','toxiccloud']},
        ]},
    },
  }),
  monk: CL({
    id:'monk', name:'Monk', sprite:1965,
    stats:{STR:10,DEX:10,WIS:10},
    skills:['palm','meditate'],
    supers:{
      A:{ name:'Martial Sage', sprite:1945, stats:{STR:15,DEX:10}, skills:['palm','chiheal'],
        ultras:[
          {name:'Dragon Monk',sprite:1946,stats:{STR:30,DEX:20},skills:['dragonfist','chiheal']},
          {name:'War Sage',sprite:1947,stats:{STR:25,VIT:20},skills:['dragonfist','meditate']},
        ]},
      B:{ name:'Spirit Monk', sprite:1948, stats:{WIS:18,INT:8}, skills:['astralpunch','chiheal'],
        ultras:[
          {name:'Celestial Monk',sprite:1949,stats:{INT:30,WIS:20},skills:['astralpunch','chiheal']},
          {name:'Void Monk',sprite:1950,stats:{INT:28,DEX:18},skills:['astralpunch','meditate']},
        ]},
    },
  }),
  engineer: CL({
    id:'engineer', name:'Engineer', sprite:1910,
    stats:{INT:15,DEX:10},
    skills:['wrench','turret'],
    supers:{
      A:{ name:'Mechanic', sprite:1961, stats:{INT:18,DEX:10}, skills:['wrench','turret'],
        ultras:[
          {name:'Mecha Lord',sprite:1962,stats:{INT:30,DEX:20},skills:['rocketbarr','turret']},
          {name:'War Machine',sprite:1963,stats:{INT:28,VIT:20},skills:['rocketbarr','fortress']},
        ]},
      B:{ name:'Alchemist', sprite:1964, stats:{INT:18,WIS:10}, skills:['chemcat','turret'],
        ultras:[
          {name:'Mad Scientist',sprite:1965,stats:{INT:35,WIS:15},skills:['chemcat','rocketbarr']},
          {name:'Plague Doctor',sprite:1966,stats:{INT:30,WIS:20},skills:['chemcat','infection']},
        ]},
    },
  }),
  necromancer: CL({
    id:'necromancer', name:'Necromancer', sprite:1952,
    stats:{INT:12,VIT:10},
    skills:['bonebolt','lifedrain'],
    supers:{
      A:{ name:'Bone Summoner', sprite:1969, stats:{INT:18,VIT:10}, skills:['bonebolt','undeadarmy'],
        ultras:[
          {name:'Lich King',sprite:1970,stats:{INT:35,VIT:20},skills:['undeadarmy','soulexpl']},
          {name:'Bone Emperor',sprite:1971,stats:{INT:30,VIT:25},skills:['undeadarmy','lifedrain']},
        ]},
      B:{ name:'Death Priest', sprite:1972, stats:{INT:15,WIS:12}, skills:['lifedrain','bonebolt'],
        ultras:[
          {name:'Soul Emperor',sprite:1973,stats:{INT:38,WIS:15},skills:['soulexpl','lifedrain']},
          {name:'Death Lord',sprite:1974,stats:{INT:32,VIT:22},skills:['soulexpl','undeadarmy']},
        ]},
    },
  }),
  elementalist: CL({
    id:'elementalist', name:'Elementalist', sprite:1961,
    stats:{INT:15,DEX:5,WIS:5},
    skills:['frostbolt','flamewave'],
    supers:{
      A:{ name:'Frost Mage', sprite:1977, stats:{INT:18,WIS:8}, skills:['frostbolt','flamewave'],
        ultras:[
          {name:'Absolute Zero',sprite:1978,stats:{INT:35,WIS:15},skills:['frozenworld','frostbolt']},
          {name:'Glacier Lord',sprite:1979,stats:{INT:30,VIT:20},skills:['frozenworld','flamewave']},
        ]},
      B:{ name:'Flame Master', sprite:1980, stats:{INT:18,DEX:8}, skills:['flamewave','frostbolt'],
        ultras:[
          {name:'Solar Emperor',sprite:1981,stats:{INT:40,DEX:10},skills:['sunexpl','flamewave']},
          {name:'Inferno Lord',sprite:1982,stats:{INT:35,VIT:15},skills:['sunexpl','frozenworld']},
        ]},
    },
  }),
};

// Secret classes (rare unlock on new game; 0.5% — handled server-side)
const SECRET_CLASSES = {
  chaoswalker: { id:'chaoswalker', name:'Chaos Walker', sprite:1958, stats:{INT:25,LUK:25,DEX:15}, skills:['chaosbolt','voidrift'], secret:true,
    supers:null },
  voiddragon:  { id:'voiddragon', name:'Void Dragon Rider', sprite:1982, stats:{STR:25,INT:25,VIT:15}, skills:['dragonbreath','godpunch'], secret:true,
    supers:null },
};

// ─── ITEMS / EQUIPMENT (big pool, rarity-tiered) ───
// rarity: common/uncommon/rare/epic/legendary
const _spectext={burn_on_hit:'Burns on hit',poison_on_hit:'Poisons on hit',freeze_on_hit:'May freeze',crit_up:'+10% crit',pierce:'Ignores some DEF',dodge:'18% dodge',thorns:'Reflects dmg',regen:'Regen HP/turn'};
function _edesc(stats,special){ const p=[]; if(stats&&Object.keys(stats).length) p.push(Object.entries(stats).map(([k,v])=>'+'+v+' '+k).join(' ')); if(special&&_spectext[special]) p.push(_spectext[special]); return p.join(' · '); }
function W(id,name,sprite,rarity,stats,special){ return {id,name,sprite,rarity,kind:'weapon',stats:stats||{},special:special||null,desc:_edesc(stats,special)}; }
function A(id,name,sprite,rarity,stats,special){ return {id,name,sprite,rarity,kind:'armor',stats:stats||{},special:special||null,desc:_edesc(stats,special)}; }
function T(id,name,sprite,rarity,stats,special){ return {id,name,sprite,rarity,kind:'trinket',stats:stats||{},special:special||null,desc:_edesc(stats,special)}; }
function P(id,name,sprite,o){ return Object.assign({id,name,sprite,kind:'consumable',rarity:o.rarity||'common'},o); }

const ITEMS = {
  // consumables
  hpotion:   P('hpotion','Health Potion',266,{heal:80,desc:'Restore 80 HP.'}),
  greaterhp: P('greaterhp','Greater Potion',278,{heal:180,rarity:'uncommon',desc:'Restore 180 HP.'}),
  superhp:   P('superhp','Super Potion',285,{heal:350,rarity:'rare',desc:'Restore 350 HP.'}),
  mpotion:   P('mpotion','Mana Potion',297,{mana:90,desc:'Restore 90 MP.'}),
  greatermp: P('greatermp','Greater Ether',300,{mana:200,rarity:'uncommon',desc:'Restore 200 MP.'}),
  elixir:    P('elixir','Elixir',287,{full:true,rarity:'rare',desc:'Full HP + MP.'}),
  antidote:  P('antidote','Antidote',270,{cleanse:true,heal:30,desc:'Cleanse debuffs + 30 HP.'}),
  bomb:      P('bomb','Fire Bomb',261,{fixed:120,rarity:'uncommon',desc:'120 fixed damage.'}),
  megabomb:  P('megabomb','Inferno Bomb',260,{fixed:280,rarity:'rare',desc:'280 fixed damage.'}),
  phoenixdown:P('phoenixdown','Phoenix Down',262,{revive:true,rarity:'legendary',desc:'Revive a fallen ally at 50% HP.'}),

  // WEAPONS — common
  rustsword: W('rustsword','Rusty Sword',1448,'common',{STR:3}),
  shortbow:  W('shortbow','Short Bow',1418,'common',{DEX:3}),
  oakstaff:  W('oakstaff','Oak Staff',1392,'common',{INT:3}),
  dagger:    W('dagger','Iron Dagger',1460,'common',{DEX:2,LUK:1}),
  // uncommon
  steelsword:W('steelsword','Steel Sword',1449,'uncommon',{STR:6}),
  warbow:    W('warbow','War Bow',1419,'uncommon',{DEX:6}),
  battleaxe: W('battleaxe','Battle Axe',1456,'uncommon',{STR:7,VIT:2}),
  cmace:     W('cmace','Heavy Mace',1476,'uncommon',{STR:5,VIT:3}),
  // rare
  flamebrand:W('flamebrand','Flamebrand',1366,'rare',{STR:9,INT:4},'burn_on_hit'),
  frostfang: W('frostfang','Frostfang',1450,'rare',{STR:8,INT:5},'freeze_on_hit'),
  venomedge: W('venomedge','Venom Edge',1462,'rare',{STR:7,DEX:5},'poison_on_hit'),
  arcanerod: W('arcanerod','Arcane Rod',1394,'rare',{INT:11,WIS:4}),
  // epic
  dragonsword:W('dragonsword','Dragon Sword',1452,'epic',{STR:14,VIT:5},'burn_on_hit'),
  stormbow:  W('stormbow','Storm Bow',1420,'epic',{DEX:14,INT:6},'crit_up'),
  voidstaff: W('voidstaff','Void Staff',1395,'epic',{INT:16,WIS:6},'pierce'),
  // legendary
  excalibur: W('excalibur','Excalibur',1364,'legendary',{STR:20,VIT:8,LUK:5},'crit_up'),
  worldender:W('worldender','World Ender',1370,'legendary',{STR:18,INT:14},'burn_on_hit'),
  godslayer: W('godslayer','Godslayer Bow',1133,'legendary',{DEX:22,LUK:10},'crit_up'),

  // ARMOR — by rarity
  leather:   A('leather','Leather Armor',1856,'common',{VIT:3}),
  chainmail: A('chainmail','Chainmail',1857,'uncommon',{VIT:6,STR:1}),
  platearmor:A('platearmor','Plate Armor',1858,'rare',{VIT:10,STR:2}),
  mageRobe:  A('mageRobe','Mage Robe',1840,'uncommon',{INT:5,WIS:5}),
  shadowgarb:A('shadowgarb','Shadow Garb',1841,'rare',{DEX:8,LUK:3},'dodge'),
  dragonmail:A('dragonmail','Dragonscale Mail',1859,'epic',{VIT:16,STR:4},'thorns'),
  holyplate: A('holyplate','Holy Plate',1860,'legendary',{VIT:22,WIS:8},'regen'),

  // TRINKETS
  ringpow:   T('ringpow','Ring of Power',230,'uncommon',{STR:4,INT:4}),
  amuletvit: T('amuletvit','Amulet of Vigor',232,'uncommon',{VIT:6}),
  bootspd:   T('bootspd','Swift Boots',1888,'rare',{DEX:8},'crit_up'),
  soulorb:   T('soulorb','Soul Orb',378,'rare',{WIS:6},'regen'),
  luckcharm: T('luckcharm','Lucky Charm',225,'epic',{LUK:12}),
  godheart:  T('godheart','Heart of the Gods',258,'legendary',{VIT:10,STR:6,INT:6},'regen'),
};

const LOOT_RARITY = {
  common: Object.values(ITEMS).filter(i=>i.rarity==='common').map(i=>i.id),
  uncommon: Object.values(ITEMS).filter(i=>i.rarity==='uncommon').map(i=>i.id),
  rare: Object.values(ITEMS).filter(i=>i.rarity==='rare').map(i=>i.id),
  epic: Object.values(ITEMS).filter(i=>i.rarity==='epic').map(i=>i.id),
  legendary: Object.values(ITEMS).filter(i=>i.rarity==='legendary').map(i=>i.id),
};

// ─── ENEMIES: 10 stages × 5 rounds; higher base damage now ───
function E(name,sprite,hp,atk,def,mechanic,desc,boss){ return {name,sprite,hp,atk,def,mechanic,desc,boss:!!boss}; }
const STAGES = [
  { id:'woodlands', name:'The Cursed Woodlands', emoji:'🌲', sprite:88,
    intro:'Twisted trees claw at a blood-red sky. The first Shard lies deep within.',
    rounds:[
      E('Dire Wolf',805,140,24,4,'none','Fast and ferocious.'),
      E('Venom Spider',820,170,22,6,'poison','Bites inject deadly Poison.'),
      E('Bramble Golem',777,260,28,16,'thorns','Reflects 30% of melee damage.'),
      E('Grove Wraith',843,200,34,8,'lifesteal','Heals from the damage it deals.'),
      E('Treant Warlord',778,560,40,18,'enrage','BOSS · Enrages each round + Weakens.',true),
    ]},
  { id:'caverns', name:'The Echoing Caverns', emoji:'🕳️', sprite:89,
    intro:'Cold stone swallows all light. Things skitter in the dark.',
    rounds:[
      E('Cave Bat Swarm',801,190,30,5,'none','Relentless swarming bites.'),
      E('Rock Crawler',253,250,28,18,'thorns','Hardened shell reflects damage.'),
      E('Toxic Ooze',808,230,26,8,'poison','Acidic body poisons on contact.'),
      E('Crystal Sentinel',254,300,36,22,'shield','Raises a crystal shield each round.'),
      E('The Underking',863,680,48,20,'enrage','BOSS · Grows furious + summons roots.',true),
    ]},
  { id:'marsh', name:'The Drowned Marsh', emoji:'🌫️', sprite:90,
    intro:'A fog that drinks courage. The mud remembers every fallen hero.',
    rounds:[
      E('Bog Lurker',809,280,34,8,'poison','Spits venom that lingers.'),
      E('Will-o-Wisp',800,240,40,6,'burn','Sets the party alight.'),
      E('Drowned Knight',796,360,38,20,'lifesteal','Drains life from the living.'),
      E('Mire Hydra',811,420,44,14,'enrage','Three heads — grows angrier each round.'),
      E('The Marsh Mother',820,860,54,20,'riftlordlite','BOSS · Poison, lifesteal & rage.',true),
    ]},
  { id:'forge', name:'The Infernal Forge', emoji:'🔥', sprite:91,
    intro:'Heat that melts steel and resolve alike. Survivors will be reforged.',
    rounds:[
      E('Magma Hound',816,360,44,10,'burn','Burns everything it touches.'),
      E('Iron Revenant',855,440,42,26,'shield','Plated — shields itself often.'),
      E('Cinder Wraith',831,400,50,10,'lifesteal','Feeds on heat and flesh.'),
      E('Forge Titan',262,500,48,24,'thorns','Molten armor scorches attackers.'),
      E('Pyrelord Vulcan',261,1050,62,24,'burnrage','BOSS · Inferno + enrage. Very hard.',true),
    ]},
  { id:'frostpeak', name:'The Frostfang Peaks', emoji:'🏔️', sprite:92,
    intro:'Wind like knives. The cold gets inside you and stays.',
    rounds:[
      E('Frost Wolf',784,420,48,12,'freeze','Bites freeze the blood.'),
      E('Ice Elemental',788,480,46,20,'freeze','Encases heroes in ice.'),
      E('Yeti Bruiser',786,580,54,16,'enrage','Beats harder as it rages.'),
      E('Glacial Serpent',818,520,52,14,'poison','Frostvenom slows and poisons.'),
      E('Boreas Storm Tyrant',789,1250,70,26,'freezerage','BOSS · Freeze-locks + enrages. Brutal.',true),
    ]},
  { id:'necropolis', name:'The Silent Necropolis', emoji:'⚰️', sprite:93,
    intro:'The dead outnumber the living a thousand to one.',
    rounds:[
      E('Skeleton Legion',862,520,52,16,'none','Endless bones, endless blades.'),
      E('Plague Bearer',808,560,46,14,'poison','Disease rots from within.'),
      E('Bone Colossus',863,720,56,30,'thorns','Bone spikes gut attackers.'),
      E('Soul Reaver',843,640,64,18,'execute','Executes the wounded.'),
      E('The Lich King',862,1500,78,28,'riftlordlite','BOSS · Poison, drain, execute. Merciless.',true),
    ]},
  { id:'astral', name:'The Astral Rift', emoji:'🌠', sprite:94,
    intro:'Space folds wrong here. Stars scream. Nothing obeys the rules.',
    rounds:[
      E('Void Stalker',842,680,64,20,'execute','Hunts the weakest hero.'),
      E('Star Devourer',769,740,62,22,'burn','Cosmic fire incinerates all.'),
      E('Gravity Warden',772,720,58,32,'shield','Bends force into shields.'),
      E('Nebula Horror',826,780,68,20,'poison','Toxic stardust chokes the party.'),
      E('Astralon Star-Eater',774,1750,86,30,'freezerage','BOSS · Freeze + enrage + burn. Savage.',true),
    ]},
  { id:'abyss', name:'The Abyssal Deep', emoji:'🌊', sprite:95,
    intro:'Pressure that crushes ships and souls. The dark down here is alive.',
    rounds:[
      E('Abyssal Eel',818,820,72,22,'poison','Venom built for the deep.'),
      E('Kraken Spawn',811,880,70,24,'lifesteal','Drains warmth and life.'),
      E('Drowned Leviathan',796,1000,76,28,'enrage','A mountain of fury.'),
      E('Angler Horror',799,920,80,22,'execute','Lures and devours the faltering.'),
      E('Dagon Tide Sovereign',789,2100,94,32,'riftlordlite','BOSS · All-out assault. Nightmare tier.',true),
    ]},
  { id:'inferno', name:'The Ninth Hell', emoji:'😈', sprite:96,
    intro:'Abandon hope. Beyond the final demon lies the end.',
    rounds:[
      E('Hellhound Pack',816,1000,84,24,'burnrage','Burns and grows rabid.'),
      E('Pit Fiend',863,1120,82,30,'lifesteal','Devours souls to heal.'),
      E('Brimstone Golem',262,1300,80,38,'thorns','Hellfire armor punishes melee.'),
      E('Soul Harvester',843,1160,90,26,'execute','Reaps the dying without mercy.'),
      E('Baalzeth Hell Monarch',261,2700,104,36,'freezerage','BOSS · Demonic gauntlet. Only legends pass.',true),
    ]},
  { id:'rift', name:'The Eternal Rift', emoji:'🌌', sprite:97,
    intro:'The wound at the heart of reality. Here the Rift Lord waits.',
    rounds:[
      E('Rift Echo',769,1300,96,28,'execute','A shard of the Lord itself.'),
      E('Chaos Spawn',826,1450,92,30,'poison','Unmaking given form.'),
      E('Reality Render',831,1550,98,34,'burnrage','Tears the world and burns it.'),
      E('Oblivion Sentinel',855,1650,100,40,'shield','The last gate. Nearly unbreakable.'),
      E('The Rift Lord',774,4000,118,42,'riftlord','FINAL BOSS · Three phases. The ultimate trial.',true),
    ]},
];

module.exports = { derive, SKILLS, CLASSES, SECRET_CLASSES, ITEMS, LOOT_RARITY, STAGES };
