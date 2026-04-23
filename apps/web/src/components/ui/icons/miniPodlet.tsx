

export default function MiniPodletIcon() {
  return (
    <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bodyGradient" cx="50%" cy="50%" r="50%" fx="40%" fy="40%">
          <stop offset="0%" style="stop-color:#FFF4E0" />
          <stop offset="100%" style="stop-color:#F5DEB3" />
        </radialGradient>
      </defs>

      <ellipse cx="200" cy="350" rx="60" ry="15" fill="#E0D0B0" opacity="0.3" />

      <rect x="145" y="300" width="35" height="40" rx="17.5" fill="#F5DEB3" stroke="#2D2926" stroke-width="6" />
      <rect x="220" y="300" width="35" height="40" rx="17.5" fill="#F5DEB3" stroke="#2D2926" stroke-width="6" />
      <rect x="110" y="240" width="30" height="40" rx="15" fill="#F5DEB3" stroke="#2D2926" stroke-width="6" transform="rotate(20 125 260)" />
      <rect x="260" y="240" width="30" height="40" rx="15" fill="#F5DEB3" stroke="#2D2926" stroke-width="6" transform="rotate(-20 275 260)" />

      <circle cx="200" cy="220" r="110" fill="url(#bodyGradient)" stroke="#2D2926" stroke-width="8" />

      <path d="M200,110 Q200,40 240,30 Q260,60 200,110" fill="#8FBC8F" stroke="#2D2926" stroke-width="6" stroke-linejoin="round" />
      <path d="M200,110 Q225,65 240,30" fill="none" stroke="#2D2926" stroke-width="3" opacity="0.4" />

      <ellipse cx="140" cy="245" rx="18" ry="10" fill="#D8BFD8" opacity="0.6" />
      <ellipse cx="260" cy="245" rx="18" ry="10" fill="#D8BFD8" opacity="0.6" />

      <g id="eyes">
        <circle cx="155" cy="215" r="28" fill="#2D2926" />
        <circle cx="165" cy="202" r="9" fill="white" />
        <circle cx="148" cy="225" r="4" fill="white" />

        <circle cx="245" cy="215" r="28" fill="#2D2926" />
        <circle cx="255" cy="202" r="9" fill="white" />
        <circle cx="238" cy="225" r="4" fill="white" />
      </g>

      <path d="M185,255 Q200,275 215,255" fill="none" stroke="#2D2926" stroke-width="6" stroke-linecap="round" />
    </svg>
  )
}
