'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/theme';

const DOT_SPACING = 26;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/** One "heartbeat" light source anchored to a point on the bottom edge, looping forever on its
 * own clock. Duration/delay are randomized once per mount (so a page refresh gets a fresh feel)
 * and deliberately don't share a common period across the three beacons below — with incommensurate
 * cycle lengths (e.g. ~5.3s / ~6.7s / ~9.8s), the three drift in and out of phase with each other
 * over time instead of ever locking into a synchronized, predictable metronome. */
function PulseBeacon({
  left, size, keyframe, minDuration, maxDuration, minDelay, maxDelay, dotColor, maskStops, dotRadius = 1.8, blur = 2.5,
}: {
  left: string; size: number; keyframe: string;
  minDuration: number; maxDuration: number; minDelay: number; maxDelay: number;
  dotColor: string; maskStops: string; dotRadius?: number; blur?: number;
}) {
  const [timing] = useState(() => ({
    duration: randomBetween(minDuration, maxDuration),
    delay: randomBetween(minDelay, maxDelay),
  }));

  return (
    <div
      className="absolute motion-reduce:hidden"
      style={{
        left,
        bottom: 0,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginBottom: -size / 2,
        backgroundImage: `radial-gradient(${dotColor} ${dotRadius}px, transparent ${dotRadius}px)`,
        backgroundSize: `${DOT_SPACING}px ${DOT_SPACING}px`,
        filter: `blur(${blur}px)`,
        WebkitMaskImage: `radial-gradient(circle, ${maskStops})`,
        maskImage: `radial-gradient(circle, ${maskStops})`,
        animationName: keyframe,
        animationDuration: `${timing.duration}s`,
        animationDelay: `${timing.delay}s`,
        animationTimingFunction: 'ease-out',
        animationIterationCount: 'infinite',
        animationFillMode: 'backwards',
      }}
    />
  );
}

// Three stacked dot layers, pixel-aligned on the same grid: a static faint base layer, an
// orange/larger layer revealed only inside a circle that follows the cursor, and three
// irregularly-timed "heartbeat" pulses lighting up from the bottom corners + centre for ambient
// depth. Inline styles (not Tailwind classes) so the base dot color has to switch on the theme
// explicitly rather than via dark:.
export function HeroDotGrid() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const baseDotColor = theme === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(15,17,21,0.14)';

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      el.style.setProperty('--my', `${e.clientY - rect.top}px`);
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ ['--mx' as string]: '50%', ['--my' as string]: '50%' }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(${baseDotColor} 1px, transparent 1px)`,
          backgroundSize: `${DOT_SPACING}px ${DOT_SPACING}px`,
        }}
      />

      {/* Corner heartbeats */}
      <PulseBeacon
        left="0%" size={1700} keyframe="hero-pulse-beat"
        minDuration={5} maxDuration={5.6} minDelay={0} maxDelay={1}
        dotColor="rgba(255,148,74,0.95)" maskStops="black 0%, black 42%, transparent 70%"
        dotRadius={3.2} blur={1.8}
      />
      <PulseBeacon
        left="100%" size={1700} keyframe="hero-pulse-beat"
        minDuration={6.4} maxDuration={7} minDelay={0.6} maxDelay={1.6}
        dotColor="rgba(255,148,74,0.95)" maskStops="black 0%, black 42%, transparent 70%"
        dotRadius={3.2} blur={1.8}
      />

      {/* Ambient centre pulse — slower and softer, for depth underneath the two corner beats */}
      <PulseBeacon
        left="50%" size={2300} keyframe="hero-pulse-ambient"
        minDuration={9.5} maxDuration={10.2} minDelay={0} maxDelay={2}
        dotColor="rgba(255,138,56,0.55)" maskStops="black 0%, black 35%, transparent 68%"
        dotRadius={2} blur={2}
      />

      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,138,56,0.6) 1.8px, transparent 1.8px)',
          backgroundSize: `${DOT_SPACING}px ${DOT_SPACING}px`,
          filter: 'blur(2.5px)',
          WebkitMaskImage: 'radial-gradient(circle 90px at var(--mx) var(--my), black 0%, black 45%, transparent 100%)',
          maskImage: 'radial-gradient(circle 90px at var(--mx) var(--my), black 0%, black 45%, transparent 100%)',
        }}
      />
    </div>
  );
}
