'use strict';
// ════════════════════════════════════════════════════════════
// GAME CONTENT — 10 stages × 5 rounds (50 fights), boss every 5th
// Per-player loot. Evolution at stages 3, 6, 9 (tiers 2/3/4).
// ════════════════════════════════════════════════════════════

const CLASSES = {
  warrior: { emoji:'⚔️', name:'Warrior', base:{maxHp:140,maxMp:40,atk:18,def:16,spd:8},
    evolveName:'Warlord', evolveEmoji:'🛡️', desc:'Tank & frontline. Soaks hits, counters.' },
  mage:    { emoji:'🔮', name:'Mage', base:{maxHp:80,maxMp:130,atk:14,def:7,spd:11},
    evolveName:'Archmage', evolveEmoji:'🌟', desc:'Glass cannon. Huge spells, fragile.' },
  rogue:   { emoji:'🗡️', name:'Rogue', base:{maxHp:100,maxMp:60,atk:22,def:9,spd:16},
    evolveName:'Assassin', evolveEmoji:'🥷', desc:'Fast striker. Crits, poison, evasion.' },
  ranger:  { emoji:'🏹', name:'Ranger', base:{maxHp:110,maxMp:75,atk:19,def:11,spd:13},
    evolveName:'Warden', evolveEmoji:'🦅', desc:'Balanced. Heals & control.' },
};
// evolution tier names per stage milestone (tier index 1..3 => after stage 3/6/9)
const EVOLVE_NAMES = {
  warrior:['Warrior','Warlord','Godslayer','Eternal Titan'],
  mage:['Mage','Archmage','Astromancer','Reality Weaver'],
  rogue:['Rogue','Assassin','Nightlord','Shadow Sovereign'],
  ranger:['Ranger','Warden','Stormcaller','World-Tree Guardian'],
};
const EVOLVE_EMOJI = {
  warrior:['⚔️','🛡️','⚜️','👑'], mage:['🔮','🌟','✨','🌌'],
  rogue:['🗡️','🥷','🌑','♠️'], ranger:['🏹','🦅','⛈️','🌳'],
};

// ─── ABILITIES (tier 1 base, tier 2/3/4 from evolutions) ───
const ABILITIES = {
  // WARRIOR t1
  cleave:{id:'cleave',name:'Cleave',emoji:'🪓',cls:'warrior',tier:1,mpCost:6,desc:'Heavy strike. 1.4× ATK.'},
  shieldwall:{id:'shieldwall',name:'Shield Wall',emoji:'🛡️',cls:'warrior',tier:1,mpCost:8,desc:'Shield absorbing 40 dmg.'},
  taunt:{id:'taunt',name:'Taunt',emoji:'😤',cls:'warrior',tier:1,mpCost:5,desc:'Force enemy to you + 30 shield.'},
  bash:{id:'bash',name:'Bash',emoji:'💥',cls:'warrior',tier:1,mpCost:10,desc:'Damage + 50% stun.'},
  // WARRIOR t2
  earthshatter:{id:'earthshatter',name:'Earthshatter',emoji:'🌋',cls:'warrior',tier:2,mpCost:18,desc:'2.2× ATK + Vulnerable.'},
  bloodlust:{id:'bloodlust',name:'Bloodlust',emoji:'🩸',cls:'warrior',tier:2,mpCost:14,desc:'Damage + heal 60% dealt.'},
  unbreakable:{id:'unbreakable',name:'Unbreakable',emoji:'⛰️',cls:'warrior',tier:2,mpCost:20,desc:'80 shield + Regen 3 rounds.'},
  // WARRIOR t3
  warcry:{id:'warcry',name:'War Cry',emoji:'📯',cls:'warrior',tier:3,mpCost:16,desc:'Whole party +Regen & 30 shield.'},
  executioner:{id:'executioner',name:'Executioner',emoji:'🪦',cls:'warrior',tier:3,mpCost:22,desc:'3× ATK; doubles vs <40% HP enemies.'},
  // WARRIOR t4
  ragnarok:{id:'ragnarok',name:'Ragnarok',emoji:'☄️',cls:'warrior',tier:4,mpCost:30,desc:'4× ATK + Vulnerable + heal 40% dealt.'},

  // MAGE t1
  firebolt:{id:'firebolt',name:'Firebolt',emoji:'🔥',cls:'mage',tier:1,mpCost:10,desc:'1.6× ATK + Burn.'},
  frostshard:{id:'frostshard',name:'Frost Shard',emoji:'❄️',cls:'mage',tier:1,mpCost:12,desc:'Damage + Freeze.'},
  arcaneorb:{id:'arcaneorb',name:'Arcane Orb',emoji:'🔮',cls:'mage',tier:1,mpCost:14,desc:'1.8× ATK, ignores DEF.'},
  manashield:{id:'manashield',name:'Mana Shield',emoji:'🌀',cls:'mage',tier:1,mpCost:8,desc:'Shield = 50% current MP.'},
  // MAGE t2
  meteor:{id:'meteor',name:'Meteor',emoji:'☄️',cls:'mage',tier:2,mpCost:28,desc:'3× ATK + huge Burn.'},
  timewarp:{id:'timewarp',name:'Time Warp',emoji:'⏳',cls:'mage',tier:2,mpCost:22,desc:'Stun 2 rounds + act again.'},
  soulburn:{id:'soulburn',name:'Soul Burn',emoji:'💜',cls:'mage',tier:2,mpCost:24,desc:'Scales w/ enemy missing HP.'},
  // MAGE t3
  chainlightning:{id:'chainlightning',name:'Chain Lightning',emoji:'⚡',cls:'mage',tier:3,mpCost:20,desc:'2× ATK + Stun, ignores DEF.'},
  blizzard:{id:'blizzard',name:'Blizzard',emoji:'🌨️',cls:'mage',tier:3,mpCost:26,desc:'Damage + Freeze + Vulnerable.'},
  // MAGE t4
  apocalypse:{id:'apocalypse',name:'Apocalypse',emoji:'🌌',cls:'mage',tier:4,mpCost:34,desc:'4.5× ATK ignore DEF + massive Burn.'},

  // ROGUE t1
  backstab:{id:'backstab',name:'Backstab',emoji:'🗡️',cls:'rogue',tier:1,mpCost:8,desc:'1.5× ATK, 40% crit.'},
  poisonblade:{id:'poisonblade',name:'Poison Blade',emoji:'🐍',cls:'rogue',tier:1,mpCost:10,desc:'Damage + stacking Poison.'},
  smokebomb:{id:'smokebomb',name:'Smoke Bomb',emoji:'💨',cls:'rogue',tier:1,mpCost:9,desc:'Dodge next 2 attacks.'},
  shadowstep:{id:'shadowstep',name:'Shadow Step',emoji:'🌑',cls:'rogue',tier:1,mpCost:7,desc:'Damage + clear debuffs.'},
  // ROGUE t2
  thousandcuts:{id:'thousandcuts',name:'Thousand Cuts',emoji:'🌪️',cls:'rogue',tier:2,mpCost:20,desc:'5 hits, each can crit.'},
  venomnova:{id:'venomnova',name:'Venom Nova',emoji:'☠️',cls:'rogue',tier:2,mpCost:18,desc:'Heavy Poison + damage.'},
  deathmark:{id:'deathmark',name:'Death Mark',emoji:'🎯',cls:'rogue',tier:2,mpCost:24,desc:'Enemy +60% dmg taken.'},
  // ROGUE t3
  assassinate:{id:'assassinate',name:'Assassinate',emoji:'🔪',cls:'rogue',tier:3,mpCost:22,desc:'2.5× ATK, 70% crit, ignores DEF.'},
  noxiouscloud:{id:'noxiouscloud',name:'Noxious Cloud',emoji:'🟢',cls:'rogue',tier:3,mpCost:20,desc:'Huge Poison + Weaken + Vulnerable.'},
  // ROGUE t4
  oblivion:{id:'oblivion',name:'Oblivion',emoji:'♠️',cls:'rogue',tier:4,mpCost:30,desc:'7 hits, each can crit + Death Mark.'},

  // RANGER t1
  pierceshot:{id:'pierceshot',name:'Pierce Shot',emoji:'🏹',cls:'ranger',tier:1,mpCost:8,desc:'1.5× ATK, half-pierce DEF.'},
  healingwind:{id:'healingwind',name:'Healing Wind',emoji:'🌿',cls:'ranger',tier:1,mpCost:12,desc:'Heal ally 35 + Regen.'},
  entangle:{id:'entangle',name:'Entangle',emoji:'🌱',cls:'ranger',tier:1,mpCost:10,desc:'Damage + Weaken enemy.'},
  hawkeye:{id:'hawkeye',name:'Hawk Eye',emoji:'🦅',cls:'ranger',tier:1,mpCost:6,desc:'Next 2 attacks crit.'},
  // RANGER t2
  arrowstorm:{id:'arrowstorm',name:'Arrow Storm',emoji:'🌧️',cls:'ranger',tier:2,mpCost:22,desc:'2.5× ATK + Bleed.'},
  lifebloom:{id:'lifebloom',name:'Lifebloom',emoji:'🌸',cls:'ranger',tier:2,mpCost:20,desc:'Heal ALL allies + Regen.'},
  naturewrath:{id:'naturewrath',name:"Nature's Wrath",emoji:'🌳',cls:'ranger',tier:2,mpCost:26,desc:'Dmg+Poison+Weaken+Vuln.'},
  // RANGER t3
  stormvolley:{id:'stormvolley',name:'Storm Volley',emoji:'⛈️',cls:'ranger',tier:3,mpCost:24,desc:'3× ATK + Stun chance.'},
  sanctuary:{id:'sanctuary',name:'Sanctuary',emoji:'🕊️',cls:'ranger',tier:3,mpCost:22,desc:'Heal all 60 + 40 shield each.'},
  // RANGER t4
  worldtree:{id:'worldtree',name:'World-Tree Blessing',emoji:'🌲',cls:'ranger',tier:4,mpCost:32,desc:'Full party heal + Regen + 60 shield each.'},
};

const BASIC_ATTACK = {id:'attack',name:'Attack',emoji:'⚔️',mpCost:0,desc:'Basic strike. 1× ATK.'};

const ITEMS = {
  hpotion:{id:'hpotion',name:'Health Potion',emoji:'🧪',desc:'Restore 60 HP',kind:'consumable'},
  mpotion:{id:'mpotion',name:'Mana Potion',emoji:'💧',desc:'Restore 50 MP',kind:'consumable'},
  greaterhp:{id:'greaterhp',name:'Greater Heal',emoji:'❤️‍🔥',desc:'Restore 130 HP',kind:'consumable'},
  elixir:{id:'elixir',name:'Elixir',emoji:'🌈',desc:'Full HP + MP',kind:'consumable'},
  antidote:{id:'antidote',name:'Antidote',emoji:'🍵',desc:'Clear debuffs +20 HP',kind:'consumable'},
  bomb:{id:'bomb',name:'Fire Bomb',emoji:'💣',desc:'70 fixed damage',kind:'consumable'},
  megabomb:{id:'megabomb',name:'Inferno Bomb',emoji:'🧨',desc:'150 fixed damage',kind:'consumable'},
  ironsword:{id:'ironsword',name:'Iron Sword',emoji:'🗡️',desc:'+8 ATK',kind:'weapon',stats:{atk:8}},
  flameblade:{id:'flameblade',name:'Flameblade',emoji:'🔥',desc:'+14 ATK, Burn on hit',kind:'weapon',stats:{atk:14},special:'burn_on_hit'},
  venomfang:{id:'venomfang',name:'Venom Fang',emoji:'🐍',desc:'+10 ATK, Poison on hit',kind:'weapon',stats:{atk:10},special:'poison_on_hit'},
  staff:{id:'staff',name:'Arcane Staff',emoji:'🪄',desc:'+6 ATK, +30 MP',kind:'weapon',stats:{atk:6,maxMp:30}},
  excalibur:{id:'excalibur',name:'Excalibur',emoji:'⚜️',desc:'+24 ATK, +10 DEF',kind:'weapon',stats:{atk:24,def:10}},
  oakshield:{id:'oakshield',name:'Oak Shield',emoji:'🛡️',desc:'+10 DEF',kind:'armor',stats:{def:10}},
  platemail:{id:'platemail',name:'Plate Mail',emoji:'🏰',desc:'+18 DEF, +30 HP',kind:'armor',stats:{def:18,maxHp:30}},
  robe:{id:'robe',name:'Mystic Robe',emoji:'👘',desc:'+6 DEF, +40 MP',kind:'armor',stats:{def:6,maxMp:40}},
  cloak:{id:'cloak',name:'Shadow Cloak',emoji:'🧥',desc:'+8 DEF +6 SPD, 15% dodge',kind:'armor',stats:{def:8,spd:6},special:'dodge15'},
  dragonscale:{id:'dragonscale',name:'Dragonscale',emoji:'🐲',desc:'+28 DEF, +60 HP',kind:'armor',stats:{def:28,maxHp:60}},
  amulet:{id:'amulet',name:'Amulet of Vigor',emoji:'📿',desc:'+50 Max HP',kind:'trinket',stats:{maxHp:50}},
  ring:{id:'ring',name:'Ring of Power',emoji:'💍',desc:'+6 ATK +6 DEF',kind:'trinket',stats:{atk:6,def:6}},
  orb:{id:'orb',name:'Soul Orb',emoji:'🔆',desc:'Regen 8 HP/round',kind:'trinket',special:'regen8'},
  boots:{id:'boots',name:'Swift Boots',emoji:'👢',desc:'+10 SPD, +10% crit',kind:'trinket',stats:{spd:10},special:'crit10'},
  phoenix:{id:'phoenix',name:'Phoenix Feather',emoji:'🪶',desc:'+30 HP, Regen 14/round',kind:'trinket',stats:{maxHp:30},special:'regen14'},
};

// ─── ENEMY ARCHETYPES → composed into 10 themed stages ───
// mechanic drives behaviour in combat engine
function R(name,emoji,hp,atk,def,mechanic,desc,boss){return {name,emoji,hp,atk,def,mechanic,desc,boss:!!boss};}

const STAGES = [
  { id:'woodlands', name:'The Cursed Woodlands', emoji:'🌲',
    intro:'Twisted trees claw at a blood-red sky. The first Shard lies deep within.',
    rounds:[
      R('Dire Wolf','🐺',90,16,4,'none','A rabid wolf. Fast and direct.'),
      R('Venom Spider','🕷️',110,14,6,'poison','Every hit injects Poison.'),
      R('Bramble Golem','🪨',170,18,14,'thorns','Reflects 30% of melee damage.'),
      R('Wraith','👻',130,22,8,'lifesteal','Heals for 50% of damage dealt.'),
      R('Treant Warlord','🌳',340,26,16,'enrage','BOSS · Enrages each round + Weakens.',true),
    ]},
  { id:'caverns', name:'The Echoing Caverns', emoji:'🕳️',
    intro:'Cold stone swallows all light. Things skitter in the dark.',
    rounds:[
      R('Cave Bat Swarm','🦇',120,20,5,'none','Relentless swarming bites.'),
      R('Rock Crawler','🦎',160,18,16,'thorns','Hardened shell reflects damage.'),
      R('Toxic Ooze','🟢',150,16,8,'poison','Acidic body poisons on contact.'),
      R('Crystal Sentinel','💎',200,24,20,'shield','Raises a crystal shield each round.'),
      R('The Underking','👑',420,30,18,'enrage','BOSS · Grows furious + summons roots.',true),
    ]},
  { id:'marsh', name:'The Drowned Marsh', emoji:'🌫️',
    intro:'A fog that drinks courage. The mud remembers every hero who fell here.',
    rounds:[
      R('Bog Lurker','🐸',180,22,8,'poison','Spits venom that lingers.'),
      R('Will-o-Wisp','🔮',150,26,6,'burn','Sets the party alight.'),
      R('Drowned Knight','⚰️',230,24,18,'lifesteal','Drains life from the living.'),
      R('Mire Hydra','🐉',270,28,14,'enrage','Three heads — grows angrier each round.'),
      R('The Marsh Mother','🕸️',520,32,18,'riftlordlite','BOSS · Poison, lifesteal, and rage combined.',true),
    ]},
  { id:'forge', name:'The Infernal Forge', emoji:'🔥',
    intro:'Heat that melts steel and resolve alike. Evolution awaits the survivors.',
    rounds:[
      R('Magma Hound','🔥',220,28,10,'burn','Burns everything it touches.'),
      R('Iron Revenant','🤖',280,26,24,'shield','Plated — shields itself often.'),
      R('Cinder Wraith','🌋',240,32,10,'lifesteal','Feeds on heat and flesh.'),
      R('Forge Titan','⚒️',320,30,22,'thorns','Molten armor scorches attackers.'),
      R('Pyrelord Vulcan','🌡️',640,38,22,'burnrage','BOSS · Inferno + enrage. Very hard.',true),
    ]},
  { id:'frostpeak', name:'The Frostfang Peaks', emoji:'🏔️',
    intro:'Wind like knives. The cold gets inside you and stays.',
    rounds:[
      R('Frost Wolf','🐾',260,30,12,'freeze','Bites freeze the blood.'),
      R('Ice Elemental','🧊',300,28,18,'freeze','Encases heroes in ice.'),
      R('Yeti Bruiser','🦣',360,34,16,'enrage','Beats harder as it rages.'),
      R('Glacial Serpent','🐍',330,32,14,'poison','Frostvenom slows and poisons.'),
      R('Boreas, Storm Tyrant','❄️',760,42,24,'freezerage','BOSS · Freeze-locks + enrages. Brutal.',true),
    ]},
  { id:'necropolis', name:'The Silent Necropolis', emoji:'⚰️',
    intro:'The dead outnumber the living a thousand to one. Second evolution lies beyond.',
    rounds:[
      R('Skeleton Legion','💀',320,32,14,'none','Endless bones, endless blades.'),
      R('Plague Bearer','🦠',340,28,12,'poison','Disease rots from within.'),
      R('Bone Colossus','🦴',440,34,28,'thorns','Bone spikes gut attackers.'),
      R('Soul Reaver','👁️',400,40,16,'execute','Executes the wounded.'),
      R('The Lich King','☠️',900,46,26,'riftlordlite','BOSS · Poison, drain, execute. Merciless.',true),
    ]},
  { id:'astral', name:'The Astral Rift', emoji:'🌠',
    intro:'Space folds wrong here. Stars scream. Nothing obeys the rules.',
    rounds:[
      R('Void Stalker','🌑',420,40,18,'execute','Hunts the weakest hero.'),
      R('Star Devourer','⭐',460,38,20,'burn','Cosmic fire incinerates all.'),
      R('Gravity Warden','🌀',440,36,30,'shield','Bends force into shields.'),
      R('Nebula Horror','🌫️',480,42,18,'poison','Toxic stardust chokes the party.'),
      R('Astralon, Star-Eater','🌌',1050,50,28,'freezerage','BOSS · Freeze + enrage + burn. Savage.',true),
    ]},
  { id:'abyss', name:'The Abyssal Deep', emoji:'🌊',
    intro:'Pressure that crushes ships and souls. The dark down here is alive.',
    rounds:[
      R('Abyssal Eel','🐡',500,44,20,'poison','Venom built for the deep.'),
      R('Kraken Spawn','🦑',540,42,22,'lifesteal','Drains warmth and life.'),
      R('Drowned Leviathan','🐋',620,46,26,'enrage','A mountain of fury.'),
      R('Angler Horror','🎣',560,48,20,'execute','Lures and devours the faltering.'),
      R('Dagon, Tide Sovereign','🔱',1250,56,30,'riftlordlite','BOSS · All-out assault. Nightmare tier.',true),
    ]},
  { id:'inferno', name:'The Ninth Hell', emoji:'😈',
    intro:'Abandon hope. Beyond the final demon lies the last evolution — and the end.',
    rounds:[
      R('Hellhound Pack','🐕',620,52,22,'burnrage','Burns and grows rabid.'),
      R('Pit Fiend','👹',680,50,28,'lifesteal','Devours souls to heal.'),
      R('Brimstone Golem','🗿',780,48,36,'thorns','Hellfire armor punishes melee.'),
      R('Soul Harvester','⚱️',700,56,24,'execute','Reaps the dying without mercy.'),
      R('Baalzeth, Hell Monarch','👿',1600,62,34,'freezerage','BOSS · Demonic gauntlet. Only legends pass.',true),
    ]},
  { id:'rift', name:'The Eternal Rift', emoji:'🌌',
    intro:'The wound at the heart of reality. Here the Rift Lord waits. Win, and Aethoria lives.',
    rounds:[
      R('Rift Echo','🕯️',800,58,28,'execute','A shard of the Lord itself.'),
      R('Chaos Spawn','🌪️',880,56,30,'poison','Unmaking given form.'),
      R('Reality Render','🗯️',920,60,34,'burnrage','Tears the world and burns it.'),
      R('Oblivion Sentinel','⬛',960,62,38,'shield','The last gate. Nearly unbreakable.'),
      R('The Rift Lord','🩸',2400,70,40,'riftlord','FINAL BOSS · Three phases. The ultimate trial.',true),
    ]},
];

const LOOT_TABLE = {
  common:['hpotion','mpotion','ironsword','oakshield','amulet'],
  uncommon:['greaterhp','antidote','bomb','venomfang','cloak','ring','orb','boots'],
  rare:['elixir','flameblade','staff','platemail','robe','megabomb'],
  legendary:['excalibur','dragonscale','phoenix','elixir','megabomb'],
};

module.exports = { CLASSES, EVOLVE_NAMES, EVOLVE_EMOJI, ABILITIES, BASIC_ATTACK, ITEMS, STAGES, LOOT_TABLE };
