import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'session_token';

/** Excluir de cualquier comprobación */
function isPublic(pathname: string): boolean {
  return (
    pathname.startsWith('/v1/') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  );
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'no autenticado' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
