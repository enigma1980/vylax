import { type NextRequest, NextResponse } from 'next/server';

/** Solo disponible en desarrollo. Establece una sesión existente por token. */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token requerido' }, { status: 400 });

  const res = NextResponse.redirect(new URL('/', req.url));
  res.cookies.set('session_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7200,
  });
  return res;
}
