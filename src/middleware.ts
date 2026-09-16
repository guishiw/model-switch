import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Edge middleware:
 *  - /admin/**      -> require admin cookie JWT (redirect to /login)
 *  - /api/admin/**  -> require admin cookie JWT (401 JSON)
 *  - /api/v1/**     -> attach a request id; bearer auth happens in the route (needs Prisma/Redis, not edge-safe)
 */
const secret = new TextEncoder().encode(process.env.ADMIN_JWT_SECRET ?? '');

async function isAdmin(req: NextRequest) {
  const token = req.cookies.get('relay_admin')?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.role === 'ADMIN';
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/v1')) {
    const headers = new Headers(req.headers);
    headers.set('x-request-id', req.headers.get('x-request-id') ?? crypto.randomUUID());
    return NextResponse.next({ request: { headers } });
  }

  if (pathname.startsWith('/api/admin')) {
    if (pathname === '/api/admin/login') return NextResponse.next();
    if (!(await isAdmin(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.next();
  }

  if (pathname.startsWith('/admin')) {
    if (!(await isAdmin(req))) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*', '/api/:path*'] };
