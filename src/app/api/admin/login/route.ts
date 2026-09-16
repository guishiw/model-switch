import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { ADMIN_COOKIE, signAdminJwt } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));
  const user = await prisma.user.findUnique({ where: { username: String(username ?? '') } });
  if (!user || user.role !== 'ADMIN' || !(await bcrypt.compare(String(password ?? ''), user.passwordHash))) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }
  const jwt = await signAdminJwt(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, jwt, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 12 * 3600 });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, '', { maxAge: 0, path: '/' });
  return res;
}
