export function AuthAside() {
  return (
    <aside aria-hidden="true" className="auth-aside">
      <svg
        viewBox="0 0 720 780"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        className="auth-aside-bg"
      >
        <line x1="164" y1="682" x2="256" y2="682" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="348" y1="442" x2="440" y2="562" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="348" y1="442" x2="394" y2="442" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="164" y1="442" x2="210" y2="442" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="532" y1="442" x2="440" y2="442" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="164" y1="202" x2="256" y2="322" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="164" y1="202" x2="210" y2="322" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="72"  y1="442" x2="118" y2="562" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="256" y1="322" x2="348" y2="442" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="348" y1="562" x2="256" y2="562" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="164" y1="682" x2="210" y2="802" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="348" y1="682" x2="394" y2="682" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="348" y1="442" x2="256" y2="562" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="348" y1="682" x2="256" y2="802" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="164" y1="82"  x2="256" y2="82"  stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="164" y1="82"  x2="72"  y2="202" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="72"  y1="82"  x2="118" y2="202" stroke="#1E293B" strokeWidth="1.5"/>
        <line x1="440" y1="82"  x2="348" y2="202" stroke="#1E293B" strokeWidth="1.5"/>
        {[
          [40,60],[132,60],[224,60],[316,60],[408,60],[500,60],[592,60],
          [86,180],[178,180],[270,180],[362,180],[454,180],[546,180],[638,180],
          [40,300],[132,300],[224,300],[316,300],[408,300],[500,300],[592,300],
          [86,420],[178,420],[270,420],[362,420],[454,420],[546,420],[638,420],
          [40,540],[132,540],[224,540],[316,540],[408,540],[500,540],[592,540],
          [86,660],[178,660],[270,660],[362,660],[454,660],[546,660],[638,660],
        ].map(([x, y], i) => (
          <g key={i} opacity={0.4 + (i % 7) * 0.08}>
            <rect x={x} y={y} width="64" height="44" rx="8" fill="#0F172A" stroke="#1E293B"/>
            <rect x={x+10} y={y+12} width="30" height="4" rx="2" fill="#1E293B"/>
            <rect x={x+10} y={y+22} width="20" height="4" rx="2" fill="#1E293B"/>
            <circle cx={x+52} cy={y+14} r="4" fill={i % 11 === 4 ? '#818CF8' : i % 9 === 2 ? '#FBBF24' : '#34D399'}/>
          </g>
        ))}
      </svg>
      <div className="auth-tagline">
        <span className="auth-tagline-title">
          Cada equipo vigilado.<br />Cada problema, antes de que llamen.
        </span>
        <span className="auth-tagline-sub">
          Monitorización proactiva para empresas de servicios informáticos.
        </span>
      </div>
    </aside>
  );
}
