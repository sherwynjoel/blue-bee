import React from 'react';

/**
 * Blue Bee brand mark + wordmark (console demo-polish). The mark is a self-contained inline SVG (no
 * binary asset to ship, crisp at any size, and reused verbatim by `app/icon.svg` for the favicon): a
 * brand-blue rounded tile carrying a simple white striped bee. One accent colour throughout.
 */

const SIZES = {
  sm: { mark: 'h-6 w-6', text: 'text-base' },
  md: { mark: 'h-7 w-7', text: 'text-lg' },
  lg: { mark: 'h-12 w-12', text: 'text-2xl' },
} as const;

/** The bee mark on its own (icon-only). Sized via `className` (defaults to a small inline glyph). */
export function BeeMark({ className = 'h-7 w-7' }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Blue Bee" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bbTile" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1E73FF" />
          <stop offset="1" stopColor="#0B5FFF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#bbTile)" />
      {/* wings */}
      <ellipse cx="10.6" cy="12" rx="4" ry="5.2" fill="#ffffff" fillOpacity="0.55" transform="rotate(-22 10.6 12)" />
      <ellipse cx="21.4" cy="12" rx="4" ry="5.2" fill="#ffffff" fillOpacity="0.55" transform="rotate(22 21.4 12)" />
      {/* antennae */}
      <path d="M14 8.5 L12.4 5.4" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M18 8.5 L19.6 5.4" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="12.2" cy="5" r="1" fill="#ffffff" />
      <circle cx="19.8" cy="5" r="1" fill="#ffffff" />
      {/* striped body */}
      <rect x="12" y="9" width="8" height="15" rx="4" fill="#ffffff" />
      <rect x="12" y="13" width="8" height="1.8" fill="#0B5FFF" />
      <rect x="12" y="17" width="8" height="1.8" fill="#0B5FFF" />
    </svg>
  );
}

/** The full lockup: bee mark + "Blue Bee" wordmark, for the header and the login screen. */
export function Logo({ size = 'md', className = '' }: { size?: keyof typeof SIZES; className?: string }): React.ReactElement {
  const s = SIZES[size];
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <BeeMark className={s.mark} />
      <span className={`font-bold tracking-tight text-bb-ink ${s.text}`}>Blue Bee</span>
    </span>
  );
}
