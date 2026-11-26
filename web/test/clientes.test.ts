/**
 * Tests de integración para POST /api/clientes.
 * Requiere DATABASE_URL y servidor en localhost:3000:
 *   npm run test:clientes
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { hash as argon2Hash } from '@node-rs/argon2';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const skip     = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:clientes)'
  : false;

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null as never;
const db  = sql ? drizzle(sql, { schema }) : null as never;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function createSession(userId: string, orgId: string): Promise<string> {
  const token     = `test_session_${randomUUID()}`;
  const tokenHash = hashToken(token);
  const now       = new Date();
  await db.insert(schema.sessions).values({
    tokenHash,
    userId,
    orgId,
    mfaVerifiedAt: now,
    lastActiveAt:  now,
    expiresAt:     new Date(now.getTime() + 3600_000),
  });
  return `session_token=${token}`;
}

async function post(path: string, body: unknown, cookie: string) {
  return fetch(`${BASE_URL}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body:    JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let orgId        = '';
let adminUserId  = '';
let techUserId   = '';
let adminCookie  = '';
let techCookie   = '';

const cleanup = {
  users:   [] as string[],
  orgs:    [] as string[],
  clients: [] as string[],
};

before(async () => {
  if (skip) return;

  const passwordHash = await argon2Hash('TestPassword2026!!');

  const [org] = await db.insert(schema.organizations).values({
    name: '__test_clientes__',
    slug: `test-clientes-${Date.now()}`,
  }).returning();
  orgId = org.id;
  cleanup.orgs.push(org.id);

  const [admin] = await db.insert(schema.users).values({
    email: `test_clientes_admin_${Date.now()}@test.vylax`,
    passwordHash,
  }).returning({ id: schema.users.id });
  adminUserId = admin.id;
  cleanup.users.push(admin.id);
  await db.insert(schema.userOrganizations).values({ userId: adminUserId, orgId, role: 'admin' });

  const [tech] = await db.insert(schema.users).values({
    email: `test_clientes_tech_${Date.now()}@test.vylax`,
    passwordHash,
  }).returning({ id: schema.users.id });
  techUserId = tech.id;
  cleanup.users.push(tech.id);
  await db.insert(schema.userOrganizations).values({ userId: techUserId, orgId, role: 'technician' });

  adminCookie = await createSession(adminUserId, orgId);
  techCookie  = await createSession(techUserId, orgId);
});

after(async () => {
  if (skip) return;

  if (cleanup.clients.length > 0) {
    await db.delete(schema.enrollmentTokens).where(inArray(schema.enrollmentTokens.clientId, cleanup.clients));
    await db.delete(schema.sites).where(inArray(schema.sites.clientId, cleanup.clients));
    await db.delete(schema.clients).where(inArray(schema.clients.id, cleanup.clients));
  }

  for (const uid of cleanup.users) {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid));
    await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, uid));
    await db.delete(schema.userOrganizations).where(eq(schema.userOrganizations.userId, uid));
    await db.delete(schema.users).where(eq(schema.users.id, uid));
  }

  if (cleanup.orgs.length > 0) {
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, cleanup.orgs));
  }

  await sql.end({ timeout: 5 });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/clientes — control de acceso', { skip }, () => {
  it('sin sesión → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/clientes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName: 'X', siteName: 'Y' }),
    });
    assert.equal(res.status, 401);
  });

  it('técnico → 403', async () => {
    const res = await post('/api/clientes', { clientName: 'Cliente Técnico', siteName: 'Sede' }, techCookie);
    assert.equal(res.status, 403);
  });
});

describe('POST /api/clientes — creación por admin', { skip }, () => {
  it('admin → 201 con clientId y fullToken', async () => {
    const res = await post('/api/clientes', {
      clientName: `Cliente Test ${Date.now()}`,
      siteName:   'Sede Central',
    }, adminCookie);

    assert.equal(res.status, 201);
    const body = await res.json() as { clientId: string; fullToken: string };
    assert.ok(body.clientId,  'debe devolver clientId');
    assert.ok(body.fullToken, 'debe devolver fullToken');
    assert.ok(body.fullToken.startsWith('vx_enr_'), 'token debe empezar con vx_enr_');

    cleanup.clients.push(body.clientId);
  });

  it('crea cliente, sede y token en la misma transacción', async () => {
    const clientName = `Tx Test ${Date.now()}`;
    const siteName   = 'Sede TX';

    const res = await post('/api/clientes', { clientName, siteName }, adminCookie);
    assert.equal(res.status, 201);
    const { clientId } = await res.json() as { clientId: string; fullToken: string };
    cleanup.clients.push(clientId);

    // Verificar cliente
    const client = await db.query.clients.findFirst({
      where: and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, orgId)),
    });
    assert.ok(client, 'cliente debe existir en BD');
    assert.equal(client!.name, clientName);

    // Verificar sede
    const site = await db.query.sites.findFirst({
      where: and(eq(schema.sites.clientId, clientId), eq(schema.sites.organizationId, orgId)),
    });
    assert.ok(site, 'sede debe existir en BD');
    assert.equal(site!.name, siteName);

    // Verificar token
    const token = await db.query.enrollmentTokens.findFirst({
      where: and(
        eq(schema.enrollmentTokens.clientId, clientId),
        eq(schema.enrollmentTokens.organizationId, orgId),
      ),
    });
    assert.ok(token, 'token debe existir en BD');
    assert.equal(token!.siteId, null, 'token de cliente sin sede asignada');
  });

  it('registra 3 entradas en audit_log', async () => {
    const clientName = `Audit Test ${Date.now()}`;
    const res = await post('/api/clientes', { clientName, siteName: 'Sede Audit' }, adminCookie);
    assert.equal(res.status, 201);
    const { clientId } = await res.json() as { clientId: string; fullToken: string };
    cleanup.clients.push(clientId);

    const logs = await db.select()
      .from(schema.auditLog)
      .where(and(
        eq(schema.auditLog.userId, adminUserId),
        eq(schema.auditLog.orgId, orgId),
      ));

    const events = logs.map(l => l.event);
    assert.ok(events.includes('client_created'), 'debe haber client_created en audit_log');
    assert.ok(events.includes('site_created'),   'debe haber site_created en audit_log');
    assert.ok(events.includes('token_created'),  'debe haber token_created en audit_log');
  });

  it('body inválido → 400', async () => {
    const res = await post('/api/clientes', { clientName: '' }, adminCookie);
    assert.equal(res.status, 400);
  });
});
