// celebrations.js — Dramatic animations for challenge start/finish, milestones, rank-ups
// All DOM-based with CSS animations. No Three.js dependency.

const CONTAINER_ID = 'celebration-container';

function getContainer() {
  return document.getElementById(CONTAINER_ID);
}

// Helper: create element with styles
function el(tag, styles = {}, text = '') {
  const e = document.createElement(tag);
  Object.assign(e.style, styles);
  if (text) e.textContent = text;
  return e;
}

// Helper: remove element after delay
function removeAfter(element, ms) {
  setTimeout(() => {
    if (element.parentNode) element.parentNode.removeChild(element);
  }, ms);
}

// Helper: grade color
function gradeColor(grade) {
  const colors = { S: '#ffd700', A: '#4fc3f7', B: '#81c784', C: '#fff176', D: '#ff8a65', F: '#ef5350' };
  return colors[grade] || '#e0ecff';
}

// Helper: spawn confetti particles inside a container
function spawnConfetti(parent, count = 30) {
  const colors = ['#ffd700', '#4fc3f7', '#81c784', '#ff8a65', '#ef5350', '#fff176', '#b39ddb'];
  for (let i = 0; i < count; i++) {
    const p = el('div', {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: (4 + Math.random() * 6) + 'px',
      height: (4 + Math.random() * 6) + 'px',
      background: colors[Math.floor(Math.random() * colors.length)],
      borderRadius: Math.random() > 0.5 ? '50%' : '0',
      pointerEvents: 'none',
      zIndex: '1',
    });
    const tx = (Math.random() - 0.5) * 600;
    const ty = (Math.random() - 0.5) * 400;
    p.style.setProperty('--tx', tx + 'px');
    p.style.setProperty('--ty', ty + 'px');
    p.style.animation = `cel-confetti ${1.5 + Math.random() * 1}s ease-out forwards`;
    p.style.animationDelay = (Math.random() * 0.3) + 's';
    parent.appendChild(p);
  }
}

// ─── 1. Challenge Start ───
export function showChallengeStart(title, subtitle) {
  const container = getContainer();
  if (!container) return;

  const overlay = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '150',
    background: 'radial-gradient(ellipse at center, rgba(20,30,60,0.85) 0%, rgba(5,8,15,0.92) 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: '0',
    transition: 'opacity 0.3s ease',
    pointerEvents: 'none',
    fontFamily: "'JetBrains Mono', monospace",
  });

  const titleEl = el('div', {
    fontSize: '36px',
    fontWeight: '700',
    color: '#e0ecff',
    letterSpacing: '6px',
    textTransform: 'uppercase',
    animation: 'cel-slideInLeft 0.5s ease-out forwards',
    opacity: '0',
    textShadow: '0 0 20px rgba(79,195,247,0.3)',
  }, title || 'CHALLENGE');

  const subEl = el('div', {
    fontSize: '16px',
    fontWeight: '600',
    color: '#4fc3f7',
    letterSpacing: '3px',
    marginTop: '12px',
    animation: 'cel-slideInRight 0.5s ease-out 0.2s forwards',
    opacity: '0',
    textShadow: '0 0 15px rgba(79,195,247,0.4)',
  }, subtitle || '');

  overlay.appendChild(titleEl);
  overlay.appendChild(subEl);
  container.appendChild(overlay);

  // Fade in
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });

  // After 2s hold, slide out + fade
  setTimeout(() => {
    titleEl.style.animation = 'cel-slideOutLeft 0.4s ease-in forwards';
    subEl.style.animation = 'cel-slideOutRight 0.4s ease-in forwards';
    overlay.style.opacity = '0';
  }, 2300);

  removeAfter(overlay, 3000);
}

// ─── 2. Challenge Complete ───
export function showChallengeComplete(title, score, grade, isNewBest) {
  const container = getContainer();
  if (!container) return;

  const overlay = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '150',
    background: 'rgba(5,8,15,0.9)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'auto',
    cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
    transform: 'translateY(-100%)',
    transition: 'transform 0.5s cubic-bezier(0.22,1,0.36,1)',
  });

  // Tap to dismiss
  overlay.addEventListener('click', () => {
    overlay.style.transform = 'translateY(-100%)';
    removeAfter(overlay, 600);
  });

  // Header
  const header = el('div', {
    fontSize: '28px',
    fontWeight: '700',
    color: '#e0ecff',
    letterSpacing: '6px',
    textTransform: 'uppercase',
    animation: 'cel-pulseGlow 2s ease-in-out infinite',
    marginBottom: '8px',
  }, 'CHALLENGE COMPLETE');

  // Title
  const titleEl = el('div', {
    fontSize: '14px',
    color: 'rgba(160,200,255,0.6)',
    letterSpacing: '3px',
    marginBottom: '24px',
  }, title || '');

  // Score number (counting animation)
  const scoreEl = el('div', {
    fontSize: '64px',
    fontWeight: '700',
    color: '#e0ecff',
    fontVariantNumeric: 'tabular-nums',
    animation: 'cel-countUp 0.5s ease-out forwards',
    marginBottom: '16px',
  }, '0');

  // Grade badge
  const gradeEl = el('div', {
    fontSize: '48px',
    fontWeight: '700',
    color: gradeColor(grade),
    animation: 'cel-bounceIn 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.3s forwards',
    transform: 'scale(0)',
    textShadow: `0 0 30px ${gradeColor(grade)}`,
    marginBottom: '16px',
  }, grade || '');

  // New best indicator
  let bestEl = null;
  if (isNewBest) {
    bestEl = el('div', {
      fontSize: '16px',
      fontWeight: '700',
      color: '#ffd700',
      letterSpacing: '4px',
      animation: 'cel-pulseGlow 1s ease-in-out infinite',
      marginBottom: '12px',
    }, 'NEW BEST!');
  }

  // Dismiss hint
  const hint = el('div', {
    fontSize: '11px',
    color: 'rgba(160,200,255,0.35)',
    letterSpacing: '2px',
    marginTop: '24px',
  }, 'TAP TO DISMISS');

  overlay.appendChild(header);
  overlay.appendChild(titleEl);
  overlay.appendChild(scoreEl);
  overlay.appendChild(gradeEl);
  if (bestEl) overlay.appendChild(bestEl);
  overlay.appendChild(hint);

  // Confetti wrapper (centered)
  const confettiLayer = el('div', {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    overflow: 'hidden',
  });
  overlay.appendChild(confettiLayer);

  container.appendChild(overlay);

  // Slide in
  requestAnimationFrame(() => {
    overlay.style.transform = 'translateY(0)';
  });

  // Score counting animation
  const finalScore = Math.round(score) || 0;
  const countDuration = 1500;
  const startTime = performance.now();
  function countTick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / countDuration, 1);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    scoreEl.textContent = Math.round(finalScore * eased);
    if (progress < 1) {
      requestAnimationFrame(countTick);
    } else {
      scoreEl.textContent = finalScore;
      // Spawn confetti after count finishes
      spawnConfetti(confettiLayer, 30);
    }
  }
  requestAnimationFrame(countTick);

  // Auto-dismiss after 5s
  setTimeout(() => {
    if (overlay.parentNode) {
      overlay.style.transform = 'translateY(-100%)';
      removeAfter(overlay, 600);
    }
  }, 5000);
}

// ─── 3. Rank Up ───
export function showRankUp(newRankName) {
  const container = getContainer();
  if (!container) return;

  // White flash
  const flash = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '151',
    background: 'white',
    opacity: '1',
    transition: 'opacity 0.3s ease',
    pointerEvents: 'none',
  });
  container.appendChild(flash);
  setTimeout(() => { flash.style.opacity = '0'; }, 100);
  removeAfter(flash, 500);

  // Main overlay
  const overlay = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '150',
    background: 'radial-gradient(ellipse at center, rgba(40,35,10,0.9) 0%, rgba(5,8,15,0.95) 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: '0',
    transition: 'opacity 0.3s ease 0.1s',
    pointerEvents: 'none',
    fontFamily: "'JetBrains Mono', monospace",
  });

  // "RANK UP!" header
  const header = el('div', {
    fontSize: '24px',
    fontWeight: '700',
    color: '#ffd700',
    letterSpacing: '0px',
    animation: 'cel-letterSpacing 0.8s ease-out 0.3s forwards, cel-pulseGlow 2s ease-in-out 1s infinite',
    textShadow: '0 0 20px rgba(255,215,0,0.6)',
    marginBottom: '16px',
  }, 'RANK UP!');

  // Rank badge
  const badge = el('div', {
    fontSize: '18px',
    fontWeight: '700',
    color: '#ffd700',
    background: 'rgba(255,215,0,0.1)',
    border: '2px solid rgba(255,215,0,0.3)',
    borderRadius: '12px',
    padding: '12px 28px',
    animation: 'cel-bounceIn 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.2s forwards',
    transform: 'scale(0)',
    marginBottom: '16px',
  }, '\u2605');

  // Rank name
  const rankEl = el('div', {
    fontSize: '32px',
    fontWeight: '700',
    color: '#4fc3f7',
    letterSpacing: '4px',
    textShadow: '0 0 25px rgba(79,195,247,0.5)',
    animation: 'cel-countUp 0.6s ease-out 0.5s forwards',
    opacity: '0',
  }, newRankName || 'NEW RANK');

  // Confetti
  const confettiLayer = el('div', {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    overflow: 'hidden',
  });

  overlay.appendChild(header);
  overlay.appendChild(badge);
  overlay.appendChild(rankEl);
  overlay.appendChild(confettiLayer);
  container.appendChild(overlay);

  requestAnimationFrame(() => { overlay.style.opacity = '1'; });

  // Delayed confetti
  setTimeout(() => spawnConfetti(confettiLayer, 30), 600);

  // Fade out
  setTimeout(() => { overlay.style.opacity = '0'; }, 3500);
  removeAfter(overlay, 4000);
}

// ─── 4. Milestone ───
export function showMilestone(text) {
  const container = getContainer();
  if (!container) return;

  const toast = el('div', {
    position: 'fixed',
    top: '80px',
    right: '-400px',
    zIndex: '150',
    background: 'rgba(8,12,20,0.85)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,215,0,0.25)',
    borderRadius: '10px',
    padding: '14px 22px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    transition: 'right 0.4s cubic-bezier(0.22,1,0.36,1)',
    pointerEvents: 'none',
    fontFamily: "'JetBrains Mono', monospace",
    maxWidth: '380px',
  });

  const star = el('div', {
    fontSize: '24px',
    color: '#ffd700',
    animation: 'cel-pulseGlow 1.5s ease-in-out infinite',
    flexShrink: '0',
  }, '\u2605');

  const label = el('div', {
    fontSize: '13px',
    fontWeight: '700',
    color: '#e0ecff',
    letterSpacing: '1.5px',
    lineHeight: '1.4',
  }, text || 'MILESTONE');

  toast.appendChild(star);
  toast.appendChild(label);
  container.appendChild(toast);

  // Slide in
  requestAnimationFrame(() => { toast.style.right = '24px'; });

  // Slide out
  setTimeout(() => { toast.style.right = '-400px'; }, 2600);
  removeAfter(toast, 3000);
}

// ─── 5. Level Up (Progressive) ───
export function showLevelUp(level, description) {
  const container = getContainer();
  if (!container) return;

  // Quick black flash
  const flash = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '151',
    background: 'black',
    opacity: '1',
    transition: 'opacity 0.15s ease',
    pointerEvents: 'none',
  });
  container.appendChild(flash);
  setTimeout(() => { flash.style.opacity = '0'; }, 150);
  removeAfter(flash, 400);

  // Overlay
  const overlay = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '150',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    fontFamily: "'JetBrains Mono', monospace",
  });

  // Level text with punch-in
  const levelEl = el('div', {
    fontSize: '48px',
    fontWeight: '700',
    color: '#e0ecff',
    letterSpacing: '6px',
    animation: 'cel-punchIn 0.3s ease-out forwards',
    textShadow: '0 0 30px rgba(79,195,247,0.4)',
  }, `LEVEL ${level}`);

  // Description fades in below
  const descEl = el('div', {
    fontSize: '14px',
    fontWeight: '600',
    color: '#4fc3f7',
    letterSpacing: '3px',
    marginTop: '12px',
    animation: 'cel-countUp 0.5s ease-out 0.3s forwards',
    opacity: '0',
    textShadow: '0 0 15px rgba(79,195,247,0.3)',
  }, description || '');

  overlay.appendChild(levelEl);
  overlay.appendChild(descEl);
  container.appendChild(overlay);

  // Fade out
  setTimeout(() => {
    overlay.style.transition = 'opacity 0.3s ease';
    overlay.style.opacity = '0';
  }, 1700);
  removeAfter(overlay, 2000);
}
