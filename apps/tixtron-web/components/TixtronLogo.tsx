// PLACEHOLDER MARK — a best-effort geometric approximation of the brand "T" logomark, built
// from straight-line segments to match the angular style shown in the brand guide. Swap the
// <path> below for the real exported SVG once the brand assets are provided.
export function TixtronMark({ className, color = '#FF6A00' }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path
        d="M8 18 L90 18 L78 34 L60 34 L46 90 L30 90 L42 34 L20 34 Z"
        fill={color}
      />
    </svg>
  );
}

export function TixtronLogo({ className, markClassName = 'w-7 h-7', textClassName = 'text-lg', color = '#FF6A00' }: {
  className?: string; markClassName?: string; textClassName?: string; color?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <TixtronMark className={markClassName} color={color} />
      <span className={`font-brand font-semibold tracking-wide ${textClassName}`}>TIXTRON</span>
    </span>
  );
}
