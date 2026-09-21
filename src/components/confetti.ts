const GRAVITY = 1400; // px/s²
const STEPS = 12;

type Burst = {
  /** Pieces per wave. */
  pieces: number;
  /** How many waves go up, one after another. */
  waves: number;
  /** Milliseconds between waves. */
  gap: number;
  /** Font size range in px. */
  size: [number, number];
  /** Max sideways launch speed in px/s. */
  spread: number;
};

const NORMAL: Burst = { pieces: 48, waves: 1, gap: 0, size: [22, 48], spread: 350 };
// The Ceuta/Melilla easter egg: many more, bigger flags, wave after wave for ~5s.
const EPIC: Burst = { pieces: 90, waves: 8, gap: 550, size: [26, 90], spread: 900 };

/**
 * Throws a burst of `emoji` confetti up from the bottom of the screen. Each
 * piece follows its own arc, then the overlay cleans itself up. `epic` turns
 * it into a long barrage.
 */
export function throwConfetti(emoji: string, { epic = false } = {}) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const burst = epic ? EPIC : NORMAL;

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "50",
  });
  document.body.appendChild(layer);

  const { innerWidth: width, innerHeight: height } = window;
  const animations = Array.from({ length: burst.pieces * burst.waves }, (_, n) => {
    const wave = Math.floor(n / burst.pieces);
    const piece = document.createElement("span");
    piece.textContent = emoji;
    const [min, max] = burst.size;
    const size = min + Math.random() * (max - min);
    Object.assign(piece.style, {
      position: "absolute",
      left: `${width * (0.15 + Math.random() * 0.7)}px`,
      top: `${height}px`,
      fontSize: `${size}px`,
      lineHeight: "1",
      willChange: "transform, opacity",
    });
    layer.appendChild(piece);

    // A ballistic arc: launch up and sideways, then let gravity pull it back down.
    const vx = (Math.random() - 0.5) * 2 * burst.spread;
    const peak = height * (0.4 + Math.random() * (epic ? 0.6 : 0.55));
    const vy = -Math.sqrt(2 * GRAVITY * peak);
    const spin = (Math.random() - 0.5) * (epic ? 1800 : 900);
    const duration = (-2 * vy) / GRAVITY + 0.4;
    const keyframes = Array.from({ length: STEPS + 1 }, (_, i) => {
      const t = (i / STEPS) * duration;
      const x = vx * t;
      const y = vy * t + (GRAVITY * t * t) / 2;
      return {
        transform: `translate(${x}px, ${y}px) rotate(${spin * t}deg)`,
        opacity: i === STEPS ? 0 : 1,
      };
    });
    return piece.animate(keyframes, {
      duration: duration * 1000,
      delay: wave * burst.gap + Math.random() * 250,
      easing: "linear",
      fill: "both",
    });
  });

  Promise.all(animations.map((a) => a.finished)).finally(() => layer.remove());
}
