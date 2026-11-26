'use client';
import { useRouter, useSearchParams } from 'next/navigation';

interface Props {
  paramName: string;
  value:     '24h' | '7d';
  ariaLabel: string;
}

const selectStyle: React.CSSProperties = {
  background:   '#0A0F1E',
  color:        '#E2E8F0',
  border:       '1px solid #1E293B',
  borderRadius: '8px',
  padding:      '8px',
  fontFamily:   'inherit',
  fontSize:     '13px',
  cursor:       'pointer',
};

export function PeriodSelect({ paramName, value, ariaLabel }: Props) {
  const router = useRouter();
  const sp     = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(sp.toString());
    params.set(paramName, e.target.value);
    router.push('?' + params.toString(), { scroll: false });
  }

  return (
    <select aria-label={ariaLabel} value={value} onChange={onChange} style={selectStyle}>
      <option value="24h">24 horas</option>
      <option value="7d">7 días</option>
    </select>
  );
}
