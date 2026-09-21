const PIECES = 48;
const GRAVITY = 1400; // px/s²
const STEPS = 12;

/**
 * Throws a burst of `emoji` confetti up from the bottom of the screen. Each
 * piece follows its own arc, then the overlay cleans itself up.
 */
export function throwConfetti(emoji: string) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

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
  const animations = Array.from({ length: PIECES }, () => {
    const piece = document.createElement("span");
    piece.textContent = emoji;
    const size = 22 + Math.random() * 26;
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
    const vx = (Math.random() - 0.5) * 700;
    const peak = height * (0.4 + Math.random() * 0.55);
    const vy = -Math.sqrt(2 * GRAVITY * peak);
    const spin = (Math.random() - 0.5) * 900;
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
      delay: Math.random() * 250,
      easing: "linear",
      fill: "both",
    });
  });

  Promise.all(animations.map((a) => a.finished)).finally(() => layer.remove());
}
