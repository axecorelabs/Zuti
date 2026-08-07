// A faint torn-ticket-stub motif — perforated divider, notched edges — used behind the copy on
// the auth pages' left panel. Grounds the page in what the product actually is (ticketing),
// not a generic dot-grid template default.
export function TicketMotif() {
  return (
    <svg className="absolute inset-0 pointer-events-none" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g transform="rotate(-14 300 300)" opacity="0.85">
        <rect x="60" y="180" width="420" height="170" rx="18" fill="none" stroke="#FF6A00" strokeOpacity="0.16" strokeWidth="2" />
        <circle cx="60" cy="265" r="16" fill="#0F1115" stroke="#FF6A00" strokeOpacity="0.16" strokeWidth="2" />
        <circle cx="480" cy="265" r="16" fill="#0F1115" stroke="#FF6A00" strokeOpacity="0.16" strokeWidth="2" />
        <line x1="380" y1="180" x2="380" y2="350" stroke="#FF6A00" strokeOpacity="0.14" strokeWidth="2" strokeDasharray="5 7" />
      </g>
      <g transform="rotate(9 300 560)" opacity="0.6">
        <rect x="120" y="480" width="360" height="140" rx="16" fill="none" stroke="#FF6A00" strokeOpacity="0.1" strokeWidth="2" />
        <circle cx="120" cy="550" r="14" fill="#0F1115" stroke="#FF6A00" strokeOpacity="0.1" strokeWidth="2" />
        <circle cx="480" cy="550" r="14" fill="#0F1115" stroke="#FF6A00" strokeOpacity="0.1" strokeWidth="2" />
        <line x1="360" y1="480" x2="360" y2="620" stroke="#FF6A00" strokeOpacity="0.09" strokeWidth="2" strokeDasharray="5 7" />
      </g>
    </svg>
  );
}
