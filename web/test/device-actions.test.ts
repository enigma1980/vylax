/**
 * Tests de integración para las acciones de la ficha del equipo (Parte 7):
 *   - técnico → 403 en todas las rutas de acción (HTTP)
 *   - revokeDeviceCredential → credential_revoked_at IS NOT NULL; hash sin cambiar
 *   - credencial revocada → 401 en /v1/reports
 *   - updateCriticalServices → config_version += 1
 *   - moveDevice → client_id y site_id actualizados; agent_events intactos
 *
 * Requiere DATABASE_URL y servidor en localhost:3000:
 *   npm run test:device-actions
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
import {
  setDeviceType,
  moveDevice,
  updateCriticalServices,
  revokeDeviceCredential,
} from '../src/lib/device-actions.js';
import { closeDb } from '../src/db/index.js';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const skip     = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:device-actions)'
  : false;

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null as never;
const db  = sql ? drizzle(sql, { schema }) : null as never;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let orgId        = '';
let clientId     = '';
let clientBId    = '';
let siteId       = '';
let deviceId     = '';
let adminUserId  = '';
let techUserId   = '';
let adminCookie  = '';
let techCookie   = '';
let deviceSecret = '';

const cleanup = {
  users:   [] as string[],
  orgs:    [] as string[],
  clients: [] as string[],
  sites:   [] as string[],
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
    name: '__test_device_actions__',
    slug: `test-device-actions-${Date.now()}`,
  }).returning();
  orgId = org.id;
  cleanup.orgs.push(org.id);

  const [cA] = await db.insert(schema.clients).values({
    organizationId: orgId, name: 'Cliente A (acciones)',
  }).returning();
  clientId = cA.id;
  cleanup.clients.push(cA.id);

  const [cB] = await db.insert(schema.clients).values({
    organizationId: orgId, name: 'Cliente B (destino)',
  }).returning();
  clientBId = cB.id;
  cleanup.clients.push(cB.id);

  const [site] = await db.insert(schema.sites).values({
    organizationId: orgId, clientId: clientBId, name: 'Sede destino',
  }).returning();
  siteId = site.id;
  cleanup.sites.push(site.id);

  deviceSecret = generateDeviceSecret();
  const [dev] = await db.insert(schema.devices).values({
    organizationId: orgId, clientId,
    hostname: 'pc-acciones-test',
    credentialHash: sha256hex(deviceSecret),
    status: 'active',
    configVersion: 1,
  }).returning();
  deviceId = dev.id;
  cleanup.devices.push(dev.id);

  const [admin] = await db.insert(schema.users).values({
    email: `test_da_admin_${Date.now()}@test.vylax`, passwordHash,
  }).returning({ id: schema.users.id });
  adminUserId = admin.id;
  cleanup.users.push(admin.id);
  await db.insert(schema.userOrganizations).values({ userId: adminUserId, orgId, role: 'admin' });

  const [tech] = await db.insert(schema.users).values({
    email: `test_da_tech_${Date.now()}@test.vylax`, passwordHash,
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
    await db.delete(schema.deviceCurrentState).where(inArray(schema.deviceCurrentState.deviceId, cleanup.devices));
    await db.delete(schema.agentEvents).where(inArray(schema.agentEvents.deviceId, cleanup.devices));
    await db.delete(schema.auditLog).where(eq(schema.auditLog.orgId, orgId));
    await db.delete(schema.devices).where(inArray(schema.devices.id, cleanup.devices));
  }
  if (cleanup.sites.length > 0)
    await db.delete(schema.sites).where(inArray(schema.sites.id, cleanup.sites));
  if (cleanup.clients.length > 0)
    await db.delete(schema.clients).where(inArray(schema.clients.id, cleanup.clients));
  for (const uid of cleanup.users) {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid));
    await db.delete(schema.userOrganizations).where(eq(schema.userOrganizations.userId, uid));
    await db.delete(schema.users).where(eq(schema.users.id, uid));
  }
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, cleanup.orgs));
  await sql.end({ timeout: 5 });
  await closeDb();
});

function apiPatch(path: string, body: unknown, cookie: string) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

function apiPost(path: string, body: unknown, cookie: string) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Control de acceso: técnico → 403
// ---------------------------------------------------------------------------

describe('Control de acceso — técnico → 403', { skip }, () => {
  it('PATCH /api/equipos/[id]/type → 403', async () => {
    const res = await apiPatch(`/api/equipos/${deviceId}/type`, { type: 'server' }, techCookie);
    assert.equal(res.status, 403);
  });

  it('POST /api/equipos/[id]/move → 403', async () => {
    const res = await apiPost(`/api/equipos/${deviceId}/move`, { clientId, siteId: null }, techCookie);
    assert.equal(res.status, 403);
  });

  it('PATCH /api/equipos/[id]/services → 403', async () => {
    const res = await apiPatch(`/api/equipos/${deviceId}/services`, { services: [] }, techCookie);
    assert.equal(res.status, 403);
  });

  it('POST /api/equipos/[id]/revoke-credential → 403', async () => {
    const res = await fetch(`${BASE_URL}/api/equipos/${deviceId}/revoke-credential`, {
      method: 'POST', headers: { Cookie: techCookie },
    });
    assert.equal(res.status, 403);
  });
});

// ---------------------------------------------------------------------------
// setDeviceType
// ---------------------------------------------------------------------------

describe('setDeviceType', { skip }, () => {
  it('actualiza device_type en la BD', async () => {
    await setDeviceType(orgId, adminUserId, deviceId, 'server');
    const [row] = await db.select({ deviceType: schema.devices.deviceType })
      .from(schema.devices).where(eq(schema.devices.id, deviceId));
    assert.equal(row.deviceType, 'server');
  });
});

// ---------------------------------------------------------------------------
// updateCriticalServices → config_version += 1
// ---------------------------------------------------------------------------

describe('updateCriticalServices', { skip }, () => {
  it('incrementa config_version en +1 y guarda los servicios', async () => {
    const [before] = await db.select({ configVersion: schema.devices.configVersion })
      .from(schema.devices).where(eq(schema.devices.id, deviceId));
    const prevVersion = before.configVersion;

    await updateCriticalServices(orgId, adminUserId, deviceId, ['MSSQLSERVER', 'VeeamBackupSvc']);

    const [after] = await db.select({
      configVersion:    schema.devices.configVersion,
      criticalServices: schema.devices.criticalServices,
    }).from(schema.devices).where(eq(schema.devices.id, deviceId));

    assert.equal(after.configVersion, prevVersion + 1, 'config_version debe haber subido en 1');
    const svcs = after.criticalServices as string[];
    assert.ok(svcs.includes('MSSQLSERVER'), 'debe contener MSSQLSERVER');
    assert.ok(svcs.includes('VeeamBackupSvc'), 'debe contener VeeamBackupSvc');
  });
});

// ---------------------------------------------------------------------------
// moveDevice → client_id y site_id actualizados; agent_events intactos
// ---------------------------------------------------------------------------

describe('moveDevice', { skip }, () => {
  it('actualiza client_id y site_id sin tocar agent_events', async () => {
    // Insertar un evento de agente para verificar que no se borra
    await db.insert(schema.agentEvents).values({
      organizationId: orgId, deviceId,
      eventType: 'system_boot', occurredAt: new Date(),
    });

    await moveDevice(orgId, adminUserId, deviceId, { clientId: clientBId, siteId });

    const [row] = await db.select({
      clientId: schema.devices.clientId,
      siteId:   schema.devices.siteId,
    }).from(schema.devices).where(eq(schema.devices.id, deviceId));

    assert.equal(row.clientId, clientBId, 'clientId debe ser el nuevo cliente');
    assert.equal(row.siteId,   siteId,    'siteId debe ser la nueva sede');

    const events = await db.select({ id: schema.agentEvents.id })
      .from(schema.agentEvents)
      .where(and(eq(schema.agentEvents.deviceId, deviceId), eq(schema.agentEvents.organizationId, orgId)));
    assert.ok(events.length > 0, 'los agent_events deben seguir intactos');
  });
});

// ---------------------------------------------------------------------------
// revokeDeviceCredential → credential_revoked_at IS NOT NULL; hash sin cambiar
// ---------------------------------------------------------------------------

describe('revokeDeviceCredential', { skip }, () => {
  it('fija credential_revoked_at sin cambiar credential_hash', async () => {
    const [before] = await db.select({
      credentialHash:      schema.devices.credentialHash,
      credentialRevokedAt: schema.devices.credentialRevokedAt,
    }).from(schema.devices).where(eq(schema.devices.id, deviceId));

    assert.equal(before.credentialRevokedAt, null, 'antes de revocar debe ser null');

    await revokeDeviceCredential(orgId, adminUserId, deviceId);

    const [after] = await db.select({
      credentialHash:      schema.devices.credentialHash,
      credentialRevokedAt: schema.devices.credentialRevokedAt,
    }).from(schema.devices).where(eq(schema.devices.id, deviceId));

    assert.ok(after.credentialRevokedAt !== null, 'credential_revoked_at debe tener valor');
    assert.equal(after.credentialHash, before.credentialHash, 'el hash no debe cambiar');
  });

  it('credencial revocada → 401 en /v1/reports', async () => {
    // El equipo ya tiene credential_revoked_at seteado por el test anterior
    const res = await fetch(`${BASE_URL}/v1/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deviceSecret}`,
        'X-Device-Id':   deviceId,
      },
      body: JSON.stringify({ schema_version: 1, type: 'metrics', reports: [] }),
    });
    assert.equal(res.status, 401, 'credential revocada debe devolver 401 en /v1/reports');
  });
});
