// Coreflow gear spinner — pure-SVG rebuild of the old spinner.mp4 video.
// The gear and inner arc rotate as one rigid body (SMIL animateTransform:
// perfectly smooth, no loop seam, runs until unmounted); the swoosh arrow
// stays static, matching the original animation. Transparent background,
// scales to any size. Geometry traced from the video frames.
export default function CoreflowSpinner({ size = 192 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="72 67 384 384" xmlns="http://www.w3.org/2000/svg" aria-label="Loading">
      <g>
        <animateTransform attributeName="transform" type="rotate" from="0 264.0 259.0" to="360 264.0 259.0" dur="2.8s" repeatCount="indefinite" />
        <g fill="#17416F">
          <circle cx="264.0" cy="259.0" r="118" />
          <path d="M 237.0 147.0 L 240.0 119.0 Q 240.0 109.0 250.0 109.0 L 278.0 109.0 Q 288.0 109.0 288.0 119.0 L 291.0 147.0 Z" transform="rotate(0 264.0 259.0)" />
          <path d="M 237.0 147.0 L 240.0 119.0 Q 240.0 109.0 250.0 109.0 L 278.0 109.0 Q 288.0 109.0 288.0 119.0 L 291.0 147.0 Z" transform="rotate(45 264.0 259.0)" />
          <path d="M 237.0 147.0 L 240.0 119.0 Q 240.0 109.0 250.0 109.0 L 278.0 109.0 Q 288.0 109.0 288.0 119.0 L 291.0 147.0 Z" transform="rotate(90 264.0 259.0)" />
          <path d="M 237.0 147.0 L 240.0 119.0 Q 240.0 109.0 250.0 109.0 L 278.0 109.0 Q 288.0 109.0 288.0 119.0 L 291.0 147.0 Z" transform="rotate(135 264.0 259.0)" />
          <path d="M 237.0 147.0 L 240.0 119.0 Q 240.0 109.0 250.0 109.0 L 278.0 109.0 Q 288.0 109.0 288.0 119.0 L 291.0 147.0 Z" transform="rotate(180 264.0 259.0)" />
          <path d="M 237.0 147.0 L 240.0 119.0 Q 240.0 109.0 250.0 109.0 L 278.0 109.0 Q 288.0 109.0 288.0 119.0 L 291.0 147.0 Z" transform="rotate(225 264.0 259.0)" />
          <path d="M 237.0 147.0 L 240.0 119.0 Q 240.0 109.0 250.0 109.0 L 278.0 109.0 Q 288.0 109.0 288.0 119.0 L 291.0 147.0 Z" transform="rotate(270 264.0 259.0)" />
          <path d="M 237.0 147.0 L 240.0 119.0 Q 240.0 109.0 250.0 109.0 L 278.0 109.0 Q 288.0 109.0 288.0 119.0 L 291.0 147.0 Z" transform="rotate(315 264.0 259.0)" />
        </g>
        <circle cx="264.0" cy="259.0" r="84" fill="#FFFFFF" />
        <path d="M 219.1 287.1 A 53 53 0 1 1 315.2 272.7" fill="none" stroke="#474747" strokeWidth="20" strokeLinecap="round" />
      </g>
      <path d="M 96 297 C 130 275, 162 259, 197 259 C 232 259, 262 273, 296 275 C 336 276, 370 257, 399 232 L 392 213 L 468 201 L 430 268 L 421 250 C 384 282, 348 299, 298 303 C 252 300, 226 281, 193 278 C 157 276, 127 288, 96 297 Z" fill="#00AAA3" stroke="#FFFFFF" strokeWidth="7" paintOrder="stroke" />
    </svg>
  );
}

// Route-level loading screen: the gear fades in only after 400ms, so fast
// screens never flash it; it then spins until Next.js unmounts it.
export function CoreflowLoadingScreen({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div className={`flex items-center justify-center ${fullScreen ? "min-h-screen bg-slate-50" : "min-h-[60vh]"}`}>
      <style>{`@keyframes cf-fade-in { to { opacity: 1 } }`}</style>
      <div style={{ opacity: 0, animation: "cf-fade-in 0.2s ease 0.4s forwards" }}>
        <CoreflowSpinner size={192} />
      </div>
    </div>
  );
}
