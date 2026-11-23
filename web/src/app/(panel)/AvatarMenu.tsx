'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export function AvatarMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const router  = useRouter();

  const initials = email
    .split('@')[0]
    .split(/[\.\-_]/)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '')
    .join('') || email.slice(0, 2).toUpperCase();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function logout() {
    setLoading(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    router.push('/login');
  }

  return (
    <div className="avatar-wrap" ref={wrapRef}>
      <button
        className="avatar-btn"
        aria-label={`Menú de usuario (${email})`}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        {initials}
      </button>

      {open && (
        <div className="avatar-dropdown" role="menu">
          <div className="avatar-dropdown-email">{email}</div>
          <button
            className="avatar-dropdown-item danger"
            role="menuitem"
            disabled={loading}
            onClick={logout}
          >
            {loading ? '…' : 'Cerrar sesión'}
          </button>
        </div>
      )}
    </div>
  );
}
