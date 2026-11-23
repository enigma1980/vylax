const CARDS: [number, number, number, string][] = [
  [40,60,0.45,'#34D399'],[132,60,0.40,'#34D399'],[224,60,0.59,'#34D399'],
  [316,60,0.68,'#34D399'],[408,60,0.63,'#34D399'],[500,60,0.41,'#34D399'],[592,60,0.89,'#34D399'],
  [86,180,0.50,'#34D399'],[178,180,0.97,'#34D399'],[270,180,0.61,'#34D399'],
  [362,180,0.38,'#818CF8'],[454,180,0.54,'#34D399'],[546,180,0.43,'#34D399'],[638,180,0.88,'#34D399'],
  [40,300,0.73,'#34D399'],[132,300,0.59,'#34D399'],[224,300,0.39,'#34D399'],
  [316,300,0.48,'#34D399'],[408,300,0.63,'#34D399'],[500,300,0.73,'#34D399'],[592,300,0.54,'#34D399'],
  [86,420,0.80,'#34D399'],[178,420,0.72,'#34D399'],[270,420,0.92,'#34D399'],
  [362,420,0.54,'#34D399'],[454,420,0.43,'#818CF8'],[546,420,0.84,'#34D399'],[638,420,0.67,'#34D399'],
  [40,540,0.78,'#34D399'],[132,540,0.72,'#34D399'],[224,540,0.55,'#FBBF24'],
  [316,540,0.74,'#34D399'],[408,540,0.65,'#34D399'],[500,540,0.96,'#34D399'],[592,540,0.78,'#34D399'],
  [86,660,0.81,'#34D399'],[178,660,1.00,'#34D399'],[270,660,0.53,'#34D399'],
  [362,660,0.78,'#34D399'],[454,660,0.65,'#34D399'],[546,660,0.43,'#34D399'],[638,660,0.85,'#34D399'],
];

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
        {CARDS.map(([x, y, opacity, dot], i) => (
          <g key={i} opacity={opacity}>
            <rect x={x} y={y} width="64" height="44" rx="8" fill="#0F172A" stroke="#1E293B"/>
            <rect x={x+10} y={y+12} width="30" height="4" rx="2" fill="#1E293B"/>
            <rect x={x+10} y={y+22} width="20" height="4" rx="2" fill="#1E293B"/>
            <circle cx={x+52} cy={y+14} r="4" fill={dot}/>
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
