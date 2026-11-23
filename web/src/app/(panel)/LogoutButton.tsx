'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoutButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function logout() {
    setLoading(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    router.push('/login');
  }

  return (
    <button
      onClick={logout}
      disabled={loading}
      style={{
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        color: 'var(--text-sec)',
        padding: '0.4rem 0.75rem',
        fontSize: '0.8rem',
        cursor: loading ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        width: '100%',
        transition: 'color 0.15s, border-color 0.15s',
      }}
    >
      {loading ? '…' : 'Cerrar sesión'}
    </button>
  );
}
