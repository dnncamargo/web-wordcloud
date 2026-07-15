export default function CloudIllustration() {
  return (
    <svg
      className="empty-evaporation-cloud"
      viewBox="0 0 360 230"
      role="img"
      aria-label="Nuvem"
    >
      <defs>
        <linearGradient id="cloudFill" x1="72" y1="42" x2="296" y2="190">
          <stop offset="0%" stopColor="#959da7" />
        </linearGradient>

        <linearGradient id="cloudStroke" x1="56" y1="56" x2="308" y2="192">
          <stop offset="0%" stopColor="#ecf9ff7c" />
          <stop offset="100%" stopColor="#8fc9e8" />
        </linearGradient>

        <filter id="cloudShadow" x="-20%" y="-25%" width="140%" height="160%">
          <feDropShadow
            dx="0"
            dy="14"
            stdDeviation="14"
            floodColor="#6aaed6"
            floodOpacity="0.22"
          />
        </filter>
      </defs>

      <g filter="url(#cloudShadow)">
        <path
          d="
            M 92 178
            C 58 178, 32 155, 32 125
            C 32 98, 53 76, 80 72
            C 91 45, 117 28, 148 33
            C 164 13, 191 7, 215 19
            C 238 30, 250 51, 250 73
            C 283 76, 308 101, 308 131
            C 308 158, 286 178, 258 178
            Z
          "
          fill="url(#cloudFill)"
          stroke="url(#cloudStroke)"
          strokeWidth="7"
          strokeLinejoin="round"
        />


      </g>
    </svg>
  );
}