// Achievement system — 20 achievements with toast notifications
// Earned achievement IDs are stored in career.achievements via career.js

import { getAchievementIds, addAchievementId, addXP } from './career.js';

// ── Achievement definitions ──

const ACHIEVEMENTS = [
  { id: 'first_flight',      name: 'First Flight',       description: 'Complete any flight (land after takeoff)',            xpBonus: 50 },
  { id: 'butter',            name: 'Butter',              description: 'Land with less than 60 fpm vertical speed',          xpBonus: 100 },
  { id: 'centerline',        name: 'Centerline King',     description: 'Land within 1m of runway centerline',                xpBonus: 100 },
  { id: 'crosswind_warrior', name: 'Crosswind Warrior',   description: 'Land in 18kt+ crosswind',                            xpBonus: 200 },
  { id: 'crosswind_master',  name: 'Crosswind Master',    description: 'Land in 30kt+ crosswind',                            xpBonus: 300 },
  { id: 'iron_pilot',        name: 'Iron Pilot',          description: '10 consecutive landings without crash',              xpBonus: 500 },
  { id: 'explorer',          name: 'Explorer',            description: 'Land at all 6 airports',                             xpBonus: 300 },
  { id: 'night_owl',         name: 'Night Owl',           description: 'Land at night (after 10pm)',                         xpBonus: 150 },
  { id: 'dawn_patrol',       name: 'Dawn Patrol',         description: 'Take off before 6am',                                xpBonus: 100 },
  { id: 'mayday',            name: 'Mayday Mayday',       description: 'Recover from engine failure and land safely',        xpBonus: 300 },
  { id: 'speed_demon',       name: 'Speed Demon',         description: 'Complete speedrun under 3 minutes',                  xpBonus: 200 },
  { id: 'full_circuit',      name: 'Full Circuit',        description: 'Complete a gate-to-gate flight',                     xpBonus: 250 },
  { id: 'multi_type',        name: 'Multi-Type',          description: 'Fly all 5 aircraft types',                           xpBonus: 200 },
  { id: 'sea_legs',          name: 'Sea Legs',            description: 'Land a seaplane on water',                           xpBonus: 150 },
  { id: 'storm_rider',       name: 'Storm Rider',         description: 'Land in storm weather',                              xpBonus: 200 },
  { id: 'greaser',           name: 'Greaser',             description: '3 consecutive butter landings (< 60 fpm)',           xpBonus: 300 },
  { id: 'heavy_metal',       name: 'Heavy Metal',         description: 'Land A340 with landing score above 80',              xpBonus: 250 },
  { id: 'top_gun',           name: 'Top Gun',             description: 'Fire all 6 missiles in one flight',                  xpBonus: 100 },
  { id: 'road_trip',         name: 'Road Trip',           description: 'Complete a race circuit',                            xpBonus: 150 },
  { id: 'captain',           name: 'Captain',             description: 'Reach the Captain rank',                             xpBonus: 0 },
];

// Lookup map for fast access
const ACHIEVEMENT_MAP = new Map();
for (const a of ACHIEVEMENTS) {
  ACHIEVEMENT_MAP.set(a.id, a);
}

// ── Toast container (lazily created) ──

let toastContainer = null;

function ensureToastContainer() {
  if (toastContainer && document.body.contains(toastContainer)) return;
  toastContainer = document.createElement('div');
  toastContainer.id = 'achievement-toast-container';
  Object.assign(toastContainer.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '10000',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    pointerEvents: 'none',
  });
  document.body.appendChild(toastContainer);
}

// ── Public API ──

export function initAchievements() {
  // Nothing needed beyond ensuring career is loaded (caller handles initCareer)
  ensureToastContainer();
}

export function checkAchievement(id) {
  const def = ACHIEVEMENT_MAP.get(id);
  if (!def) return null;

  const earned = getAchievementIds();
  if (earned.includes(id)) return null;

  // Mark as earned
  addAchievementId(id);

  // Award XP bonus
  if (def.xpBonus > 0) {
    addXP(def.xpBonus, 'achievement');
  }

  // Show toast
  showAchievementToast(def.name, def.xpBonus);

  return { unlocked: true, name: def.name, xpBonus: def.xpBonus };
}

export function isAchievementUnlocked(id) {
  return getAchievementIds().includes(id);
}

export function getAllAchievements() {
  const earned = getAchievementIds();
  return ACHIEVEMENTS.map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    unlocked: earned.includes(a.id),
    xpBonus: a.xpBonus,
  }));
}

export function showAchievementToast(name, xpBonus) {
  ensureToastContainer();

  const toast = document.createElement('div');
  Object.assign(toast.style, {
    background: 'rgba(8, 12, 20, 0.85)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(120, 180, 255, 0.25)',
    borderRadius: '12px',
    padding: '14px 20px',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
    color: '#e0e8f0',
    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
    fontSize: '13px',
    minWidth: '220px',
    maxWidth: '320px',
    transform: 'translateX(120%)',
    transition: 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease',
    opacity: '0',
    pointerEvents: 'auto',
  });

  // Trophy icon + name
  const header = document.createElement('div');
  Object.assign(header.style, {
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '1.5px',
    color: 'rgba(120, 180, 255, 0.8)',
    marginBottom: '4px',
    textTransform: 'uppercase',
  });
  header.textContent = 'ACHIEVEMENT UNLOCKED';

  const title = document.createElement('div');
  Object.assign(title.style, {
    fontSize: '15px',
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: xpBonus > 0 ? '4px' : '0',
  });
  title.textContent = name;

  toast.appendChild(header);
  toast.appendChild(title);

  if (xpBonus > 0) {
    const xpLine = document.createElement('div');
    Object.assign(xpLine.style, {
      fontSize: '12px',
      fontWeight: '600',
      color: 'rgba(100, 220, 140, 0.9)',
    });
    xpLine.textContent = '+' + xpBonus + ' XP';
    toast.appendChild(xpLine);
  }

  toastContainer.appendChild(toast);

  // Slide in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(0)';
      toast.style.opacity = '1';
    });
  });

  // Slide out after 3s
  setTimeout(() => {
    toast.style.transform = 'translateX(120%)';
    toast.style.opacity = '0';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 400);
  }, 3000);
}
