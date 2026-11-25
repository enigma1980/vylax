/**
 * Tests de integración para PATCH/DELETE /api/clientes/[clientId] (Parte 5b):
 *   - técnico → 403 en PATCH y DELETE
 *   - borrar cliente con equipo desinstalado → 409
 *
 * Requiere DATABASE_URL y servidor en localhost:3000:
 *   npm run test:ajustes-cliente
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { hash as argon2Hash } from '@node-rs/argon2';
import { generateDeviceSecret, sha256hex } from '../src/lib/crypto.js';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const skip     = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:ajustes-cliente)'
  : false;

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null as never;
const db  = sql ? drizzle(sql, { schema }) : null as never;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function createSession(userId: string, oId: string): Promise<string> {
  const token     = `test_session_${randomUUID()}`;
  const tokenHash = hashToken(token);
  const now       = new Date();
  await db.insert(schema.sessions).values({
    tokenHash, userId, orgId: oId,
    mfaVerifiedAt: now, lastActiveAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000),
  });
  return `session_token=${token}`;
}

async function patch(path: string, body: unknown, cookie: string) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

async function del(path: string, cookie: string) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let orgId       = '';
let adminUserId = '';
let techUserId  = '';
let adminCookie = '';
let techCookie  = '';

// IDs de registros a limpiar
const cleanup = {
  users:   [] as string[],
  orgs:    [] as string[],
  clients: [] as string[],
  devices: [] as string[],
};

before(async () => {
  if (skip) return;

  const passwordHash = await argon2Hash('TestPassword2026!!');

  const [org] = await db.insert(schema.organizations).values({
    name: '__test_ajustes_cliente__',
    slug: `test-ajustes-cliente-${Date.now()}`,
  }).returning();
  orgId = org.id;
  cleanup.orgs.push(org.id);

  const [admin] = await db.insert(schema.users).values({
    email: `test_ajustes_admin_${Date.now()}@test.vylax`,
    passwordHash,
  }).returning({ id: schema.users.id });
  adminUserId = admin.id;
  cleanup.users.push(admin.id);
  await db.insert(schema.userOrganizations).values({ userId: adminUserId, orgId, role: 'admin' });

  const [tech] = await db.insert(schema.users).values({
    email: `test_ajustes_tech_${Date.now()}@test.vylax`,
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

  if (cleanup.devices.length > 0) {
    await db.delete(schema.deviceCurrentState).where(inArray(schema.deviceCurrentState.deviceId, cleanup.devices)).catch(() => {});
    await db.delete(schema.devices).where(inArray(schema.devices.id, cleanup.devices)).catch(() => {});
  }

  for (const cid of cleanup.clients) {
    await db.delete(schema.enrollmentTokens).where(eq(schema.enrollmentTokens.clientId, cid)).catch(() => {});
    await db.delete(schema.sites).where(eq(schema.sites.clientId, cid)).catch(() => {});
    await db.delete(schema.clients).where(eq(schema.clients.id, cid)).catch(() => {});
  }

  for (const uid of cleanup.users) {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid)).catch(() => {});
    await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, uid)).catch(() => {});
    await db.delete(schema.userOrganizations).where(eq(schema.userOrganizations.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }

  if (cleanup.orgs.length > 0) {
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, cleanup.orgs)).catch(() => {});
  }

  await sql.end();
});

// ---------------------------------------------------------------------------
// Helpers para crear fixtures de test
// ---------------------------------------------------------------------------

async function createClient(name: string): Promise<string> {
  const [c] = await db.insert(schema.clients).values({
    organizationId: orgId,
    name,
  }).returning({ id: schema.clients.id });
  cleanup.clients.push(c.id);
  return c.id;
}

async function insertUninstalledDevice(clientId: string): Promise<string> {
  const secret = generateDeviceSecret();
  const [d] = await db.insert(schema.devices).values({
    organizationId: orgId,
    clientId,
    hostname: `HOST-TEST-${Date.now()}`,
    credentialHash: sha256hex(secret),
    status: 'uninstalled',
    uninstalledAt: new Date(),
  }).returning({ id: schema.devices.id });
  cleanup.devices.push(d.id);
  return d.id;
}

// ---------------------------------------------------------------------------
// Tests — control de acceso
// ---------------------------------------------------------------------------

describe('PATCH /api/clientes/:id — control de acceso', { skip }, () => {
  it('técnico → 403', async () => {
    const clientId = await createClient(`AjustesRenombreTech ${Date.now()}`);
    const res = await patch(`/api/clientes/${clientId}`, { name: 'Nuevo nombre' }, techCookie);
    assert.equal(res.status, 403);
  });

  it('sin sesión → 401', async () => {
    const clientId = await createClient(`AjustesRenombreSinSesion ${Date.now()}`);
    const res = await fetch(`${BASE_URL}/api/clientes/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    assert.equal(res.status, 401);
  });
});

describe('DELETE /api/clientes/:id — control de acceso', { skip }, () => {
  it('técnico → 403', async () => {
    const clientId = await createClient(`AjustesDeleteTech ${Date.now()}`);
    const res = await del(`/api/clientes/${clientId}`, techCookie);
    assert.equal(res.status, 403);
  });

  it('sin sesión → 401', async () => {
    const clientId = await createClient(`AjustesDeleteSinSesion ${Date.now()}`);
    const res = await fetch(`${BASE_URL}/api/clientes/${clientId}`, { method: 'DELETE' });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// Tests — semántica
// ---------------------------------------------------------------------------

describe('PATCH /api/clientes/:id — renombrar', { skip }, () => {
  it('admin puede renombrar el cliente', async () => {
    const clientId  = await createClient(`RenombreOrigen ${Date.now()}`);
    const nuevoNombre = `RenombreDestino ${Date.now()}`;
    const res = await patch(`/api/clientes/${clientId}`, { name: nuevoNombre }, adminCookie);
    assert.equal(res.status, 200);

    const c = await db.query.clients.findFirst({
      where: and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, orgId)),
    });
    assert.equal(c?.name, nuevoNombre, 'nombre actualizado en BD');
  });

  it('registra client_updated en audit_log', async () => {
    const clientId = await createClient(`AuditRenombre ${Date.now()}`);
    const res = await patch(`/api/clientes/${clientId}`, { name: 'NuevoNombreAudit' }, adminCookie);
    assert.equal(res.status, 200);

    const logs = await db.select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, adminUserId), eq(schema.auditLog.orgId, orgId)));
    assert.ok(logs.some(l => l.event === 'client_updated'), 'debe haber client_updated en audit_log');
  });
});

describe('DELETE /api/clientes/:id — borrar', { skip }, () => {
  it('cliente con equipo desinstalado → 409', async () => {
    const clientId = await createClient(`ClienteConDesinstalado ${Date.now()}`);
    await insertUninstalledDevice(clientId);

    const res = await del(`/api/clientes/${clientId}`, adminCookie);
    assert.equal(res.status, 409);

    const body = await res.json() as { error?: string };
    assert.ok(body.error?.includes('equipo'), `mensaje debe mencionar "equipo", recibido: ${body.error}`);
  });

  it('admin puede borrar cliente sin equipos y registra audit', async () => {
    const clientId = await createClient(`ClienteVacio ${Date.now()}`);
    const res = await del(`/api/clientes/${clientId}`, adminCookie);
    assert.equal(res.status, 200);

    const c = await db.query.clients.findFirst({
      where: and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, orgId)),
    });
    assert.equal(c, undefined, 'cliente eliminado de BD');

    const logs = await db.select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, adminUserId), eq(schema.auditLog.orgId, orgId)));
    assert.ok(logs.some(l => l.event === 'client_deleted'), 'debe haber client_deleted en audit_log');

    // Sacamos de cleanup ya que fue borrado por la API
    const idx = cleanup.clients.indexOf(clientId);
    if (idx >= 0) cleanup.clients.splice(idx, 1);
  });
});
