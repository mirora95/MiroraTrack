interface LogoMarkProps {
  label?: string
  decorative?: boolean
  className?: string
}

export function LogoMark({
  label = 'MiroraTrack',
  decorative = false,
  className,
}: LogoMarkProps) {
  return (
    <svg
      className={['logo-mark', className].filter(Boolean).join(' ')}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      focusable="false"
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': label })}
    >
      <rect width="64" height="64" rx="16" fill="#0F172A" />
      <g data-testid="logo-mirrored-form">
        <path
          d="M12 16 28 28v22L12 39Z"
          fill="#2563EB"
        />
        <path
          d="m52 16-16 12v22l16-11Z"
          fill="#0F766E"
        />
        <path
          d="m12 16 16 12-7 7-9-7Z"
          fill="#3B82F6"
        />
        <path
          d="m52 16-16 12 7 7 9-7Z"
          fill="#14B8A6"
        />
      </g>
      <path
        data-testid="logo-track-accent"
        d="M27 48c3-9 3-19 5-27 2 7 3 14 7 19"
        fill="none"
        stroke="#F59E0B"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      <circle cx="39" cy="40" r="2.5" fill="#F59E0B" />
    </svg>
  )
}
