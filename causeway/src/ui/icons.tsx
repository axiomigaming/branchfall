import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const IconShield = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
export const IconSliders = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
);
export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconSound = (p: SVGProps<SVGSVGElement> & { off?: boolean }) => {
  const { off, ...rest } = p;
  return (
    <svg {...base(rest)}>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      {off ? <path d="M17 9l4 6M21 9l-4 6" /> : <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" />}
    </svg>
  );
};
export const IconHistory = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 103-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </svg>
);
export const IconExpand = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);
export const IconCopy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="8" y="8" width="12" height="12" rx="1.5" />
    <path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8" />
  </svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const IconDice = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="9" cy="9" r="1" fill="currentColor" />
    <circle cx="15" cy="15" r="1" fill="currentColor" />
    <circle cx="15" cy="9" r="1" fill="currentColor" />
    <circle cx="9" cy="15" r="1" fill="currentColor" />
  </svg>
);
export const IconMinus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ strokeWidth: 2.2, ...p })}>
    <path d="M6 12h12" />
  </svg>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ strokeWidth: 2.2, ...p })}>
    <path d="M6 12h12M12 6v12" />
  </svg>
);
/** The mark: an arch over a causeway. */
export const Mark = (p: SVGProps<SVGSVGElement>) => (
  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden {...p}>
    <path d="M6 26V14a10 10 0 0120 0v12h-4.5V14a5.5 5.5 0 00-11 0v12z" fill="currentColor" />
    <path d="M3 28.5h26" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
