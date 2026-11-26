/**
 * Tests de integración para /pendientes (Parte 9):
 *   - técnico → 403 al intentar asignar
 *   - assignDevice cambia status a 'active'
 *   - equipo asignado no aparece en getPendingDevices
 *
 * Requiere DATABASE_URL y servidor en localhost:3000:
 *   npm run test:pendientes
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { hash as argon2Hash } from '@node-rs/argon2';
import { generateDeviceSecret, sha256hex } from '../src/lib/crypto.js';
import { assignDevice } from '../src/lib/pending-devices.js';
import { getPendingDevices } from '../src/lib/dashboard.js';
import { closeDb } from '../src/db/index.js';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const skip     = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:pendientes)'
  : false;

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null as never;
const db  = process.env.DATABASE_URL ? drizzle(sql, { schema }) : null as never;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let orgId       = '';
let clientId    = '';
let device1Id   = '';
let device2Id   = '';
let adminUserId = '';
let techUserId  = '';
let adminCookie = '';
let techCookie  = '';

const cleanup = {
  users:   [] as string[],
  orgs:    [] as string[],
  clients: [] as string[],
  devices: [] as string[],
};

function hashToken(token: string) {
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

before(async () => {
  if (skip) return;

  const passwordHash = await argon2Hash('TestPassword2026!!');

  const [org] = await db.insert(schema.organizations).values({
    name: '__test_pendientes__',
    slug: `test-pendientes-${Date.now()}`,
  }).returning();
  orgId = org.id;
  cleanup.orgs.push(org.id);

  const [cA] = await db.insert(schema.clients).values({
    organizationId: orgId, name: 'Cliente Pendientes Test',
  }).returning();
  clientId = cA.id;
  cleanup.clients.push(cA.id);

  const secret1 = generateDeviceSecret();
  const [d1] = await db.insert(schema.devices).values({
    organizationId: orgId,
    hostname: 'pc-pending-1',
    credentialHash: sha256hex(secret1),
    status: 'pending_assignment',
  }).returning();
  device1Id = d1.id;
  cleanup.devices.push(d1.id);

  const secret2 = generateDeviceSecret();
  const [d2] = await db.insert(schema.devices).values({
    organizationId: orgId,
    hostname: 'pc-pending-2',
    credentialHash: sha256hex(secret2),
    status: 'pending_assignment',
  }).returning();
  device2Id = d2.id;
  cleanup.devices.push(d2.id);

  const [admin] = await db.insert(schema.users).values({
    email: `test_pend_admin_${Date.now()}@test.vylax`, passwordHash,
  }).returning({ id: schema.users.id });
  adminUserId = admin.id;
  cleanup.users.push(admin.id);
  await db.insert(schema.userOrganizations).values({ userId: adminUserId, orgId, role: 'admin' });

  const [tech] = await db.insert(schema.users).values({
    email: `test_pend_tech_${Date.now()}@test.vylax`, passwordHash,
  }).returning({ id: schema.users.id });
  techUserId = tech.id;
  cleanup.users.push(tech.id);
  await db.insert(schema.userOrganizations).values({ userId: techUserId, orgId, role: 'technician' });

  adminCookie = await createSession(adminUserId, orgId);
  techCookie  = await createSession(techUserId, orgId);
});

after(async () => {
  if (skip) return;
  await db.delete(schema.auditLog).where(eq(schema.auditLog.orgId, orgId));
  if (cleanup.devices.length > 0) {
    await db.delete(schema.deviceCurrentState).where(inArray(schema.deviceCurrentState.deviceId, cleanup.devices));
    await db.delete(schema.devices).where(inArray(schema.devices.id, cleanup.devices));
  }
  // Eliminar sedes y tokens antes de clientes (FK)
  await db.delete(schema.enrollmentTokens).where(eq(schema.enrollmentTokens.organizationId, orgId));
  await db.delete(schema.sites).where(eq(schema.sites.organizationId, orgId));
  if (cleanup.clients.length > 0) {
    await db.delete(schema.clients).where(inArray(schema.clients.id, cleanup.clients));
  }
  for (const uid of cleanup.users) {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid));
    await db.delete(schema.userOrganizations).where(eq(schema.userOrganizations.userId, uid));
    await db.delete(schema.users).where(eq(schema.users.id, uid));
  }
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, cleanup.orgs));
  await sql.end({ timeout: 5 });
  await closeDb();
});

// ---------------------------------------------------------------------------
// Control de acceso
// ---------------------------------------------------------------------------

describe('Control de acceso — técnico → 403', { skip }, () => {
  it('POST /api/pendientes/[id]/assign → 403 para técnico', async () => {
    const res = await fetch(`${BASE_URL}/api/pendientes/${device1Id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: techCookie },
      body: JSON.stringify({ clientId, siteId: null }),
    });
    assert.equal(res.status, 403);
  });
});

// ---------------------------------------------------------------------------
// assignDevice — DAL
// ---------------------------------------------------------------------------

describe('assignDevice', { skip }, () => {
  it('cambia status a active y fija clientId', async () => {
    await assignDevice(orgId, adminUserId, device1Id, { clientId, siteId: null });

    const [row] = await db.select({ status: schema.devices.status, clientId: schema.devices.clientId })
      .from(schema.devices).where(eq(schema.devices.id, device1Id));

    assert.equal(row.status,   'active',   'status debe ser active');
    assert.equal(row.clientId, clientId,   'clientId debe estar asignado');
  });

  it('equipo asignado no aparece en getPendingDevices', async () => {
    const pending = await getPendingDevices(orgId);
    const found   = pending.some(d => d.id === device1Id);
    assert.equal(found, false, 'el equipo asignado no debe aparecer en pendientes');
  });

  it('asignar creando cliente nuevo', async () => {
    await assignDevice(orgId, adminUserId, device2Id, {
      newClientName: 'Cliente Nuevo Test',
      newSiteName:   'Sede Nueva Test',
    });

    const [row] = await db.select({ status: schema.devices.status, clientId: schema.devices.clientId })
      .from(schema.devices).where(eq(schema.devices.id, device2Id));

    assert.equal(row.status, 'active', 'status debe ser active');
    assert.ok(row.clientId, 'debe tener un clientId asignado');

    // Limpiar el cliente creado
    cleanup.clients.push(row.clientId!);
  });
});
