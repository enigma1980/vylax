/**
 * Tests de integración para sedes y tokens (Parte 4):
 *   - POST /api/clientes/[clientId]/sites → 403 para técnico
 *   - createToken: fullToken solo en la respuesta, no almacenado en BD
 *   - rotateToken: antiguo revocado, nuevo activo
 *   - deleteSite con equipos activos → 409
 *   - Token revocado no da de alta (/v1/enroll → 401)
 *
 * Requiere DATABASE_URL y servidor en localhost:3000:
 *   npm run test:sites-tokens
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { hash as argon2Hash } from '@node-rs/argon2';
import {
  generateEnrollmentToken,
  sha256hex,
  tokenPrefix,
  generateDeviceSecret,
} from '../src/lib/crypto.js';
import { createToken, createSite, deleteSite, rotateToken } from '../src/lib/sites-tokens.js';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const skip     = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:sites-tokens)'
  : false;

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null as never;
const db  = sql ? drizzle(sql, { schema }) : null as never;

// ---------------------------------------------------------------------------
// Fixtures compartidas
// ---------------------------------------------------------------------------

let orgId        = '';
let clientId     = '';
let adminUserId  = '';
let techUserId   = '';
let adminCookie  = '';
let techCookie   = '';

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
    name: '__test_sites_tokens__',
    slug: `test-sites-tokens-${Date.now()}`,
  }).returning();
  orgId = org.id;
  cleanup.orgs.push(org.id);

  const [client] = await db.insert(schema.clients).values({
    organizationId: orgId, name: 'Cliente Sedes Test',
  }).returning();
  clientId = client.id;
  cleanup.clients.push(client.id);

  const [admin] = await db.insert(schema.users).values({
    email: `test_st_admin_${Date.now()}@test.vylax`, passwordHash,
  }).returning({ id: schema.users.id });
  adminUserId = admin.id;
  cleanup.users.push(admin.id);
  await db.insert(schema.userOrganizations).values({ userId: adminUserId, orgId, role: 'admin' });

  const [tech] = await db.insert(schema.users).values({
    email: `test_st_tech_${Date.now()}@test.vylax`, passwordHash,
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
    await db.delete(schema.devices).where(inArray(schema.devices.id, cleanup.devices));
  }
  await db.delete(schema.enrollmentTokens).where(eq(schema.enrollmentTokens.organizationId, orgId));
  if (cleanup.sites.length > 0)
    await db.delete(schema.sites).where(inArray(schema.sites.id, cleanup.sites));
  if (cleanup.clients.length > 0)
    await db.delete(schema.clients).where(inArray(schema.clients.id, cleanup.clients));
  for (const uid of cleanup.users) {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid));
    await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, uid));
    await db.delete(schema.userOrganizations).where(eq(schema.userOrganizations.userId, uid));
    await db.delete(schema.users).where(eq(schema.users.id, uid));
  }
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, cleanup.orgs));
  await sql.end();
});

function apiPost(path: string, body: unknown, cookie: string) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Control de acceso: sedes
// ---------------------------------------------------------------------------

describe('POST /api/clientes/[clientId]/sites — control de acceso', { skip }, () => {
  it('técnico → 403', async () => {
    const res = await apiPost(`/api/clientes/${clientId}/sites`, { name: 'Sede X', publicIps: [] }, techCookie);
    assert.equal(res.status, 403);
  });

  it('sin sesión → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/clientes/${clientId}/sites`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sede X', publicIps: [] }),
    });
    assert.equal(res.status, 401);
  });

  it('admin → 201 y crea la sede', async () => {
    const res = await apiPost(`/api/clientes/${clientId}/sites`, { name: 'Sede Admin Test', publicIps: ['1.2.3.4'] }, adminCookie);
    assert.equal(res.status, 201);
    const body = await res.json() as { id: string };
    assert.ok(body.id);
    cleanup.sites.push(body.id);
  });
});

// ---------------------------------------------------------------------------
// createToken: fullToken no almacenado en BD
// ---------------------------------------------------------------------------

describe('createToken — fullToken no se almacena en BD', { skip }, () => {
  it('el tokenHash en BD es el SHA-256 del fullToken, no el token completo', async () => {
    const { token, fullToken } = await createToken(orgId, adminUserId, {
      clientId,
      siteId: null,
      label: 'Token test fullToken',
    });

    const record = await db.query.enrollmentTokens.findFirst({
      where: eq(schema.enrollmentTokens.id, token.id),
    });
    assert.ok(record, 'token debe existir en BD');
    assert.notEqual(record!.tokenHash, fullToken, 'tokenHash no debe ser igual al fullToken');
    assert.equal(record!.tokenHash, sha256hex(fullToken), 'tokenHash debe ser SHA-256 del fullToken');
    assert.ok(record!.tokenHash.length === 64, 'tokenHash debe ser un hex de 64 chars (SHA-256)');
  });
});

// ---------------------------------------------------------------------------
// rotateToken
// ---------------------------------------------------------------------------

describe('rotateToken', { skip }, () => {
  it('el token antiguo queda revocado y el nuevo está activo', async () => {
    const rawOld = generateEnrollmentToken();
    const [oldTok] = await db.insert(schema.enrollmentTokens).values({
      organizationId: orgId,
      clientId,
      tokenHash:   sha256hex(rawOld),
      tokenPrefix: tokenPrefix(rawOld),
      label:       'Token para rotar',
    }).returning();

    const { token: newTok } = await rotateToken(orgId, adminUserId, oldTok.id);

    const [oldRecord] = await db.select().from(schema.enrollmentTokens)
      .where(eq(schema.enrollmentTokens.id, oldTok.id));
    const [newRecord] = await db.select().from(schema.enrollmentTokens)
      .where(eq(schema.enrollmentTokens.id, newTok.id));

    assert.ok(oldRecord.revokedAt, 'token antiguo debe tener revokedAt');
    assert.equal(newRecord.revokedAt, null, 'token nuevo no debe estar revocado');
    assert.equal(newRecord.clientId, clientId, 'token nuevo debe pertenecer al mismo cliente');
  });

  it('registra token_revoked y token_created en audit_log', async () => {
    const rawOld = generateEnrollmentToken();
    const [oldTok] = await db.insert(schema.enrollmentTokens).values({
      organizationId: orgId,
      clientId,
      tokenHash:   sha256hex(rawOld),
      tokenPrefix: tokenPrefix(rawOld),
      label:       'Token audit rotar',
    }).returning();

    await rotateToken(orgId, adminUserId, oldTok.id);

    const logs = await db.select().from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, adminUserId), eq(schema.auditLog.orgId, orgId)));
    const events = logs.map(l => l.event);
    assert.ok(events.includes('token_revoked'), 'debe haber token_revoked');
    assert.ok(events.includes('token_created'), 'debe haber token_created (nuevo)');
  });
});

// ---------------------------------------------------------------------------
// deleteSite con equipos activos → error 409
// ---------------------------------------------------------------------------

describe('deleteSite con equipos activos', { skip }, () => {
  it('lanza error 409 si la sede tiene equipos activos', async () => {
    const [site] = await db.insert(schema.sites).values({
      organizationId: orgId, clientId,
      name: 'Sede con equipo', publicIps: [],
    }).returning();
    cleanup.sites.push(site.id);

    const credHash = sha256hex(generateDeviceSecret());
    const [dev] = await db.insert(schema.devices).values({
      organizationId: orgId, clientId, siteId: site.id,
      hostname: 'pc-delete-test', status: 'active', credentialHash: credHash,
    }).returning();
    cleanup.devices.push(dev.id);

    await assert.rejects(
      () => deleteSite(orgId, adminUserId, site.id),
      (err: Error & { httpStatus?: number }) => {
        assert.equal(err.httpStatus, 409);
        assert.ok(err.message.includes('equipo') || err.message.includes('activo'));
        return true;
      },
    );
  });

  it('devuelve 409 en la API (HTTP)', async () => {
    const [site] = await db.insert(schema.sites).values({
      organizationId: orgId, clientId,
      name: 'Sede con equipo HTTP', publicIps: [],
    }).returning();
    cleanup.sites.push(site.id);

    const credHash = sha256hex(generateDeviceSecret());
    const [dev] = await db.insert(schema.devices).values({
      organizationId: orgId, clientId, siteId: site.id,
      hostname: 'pc-delete-http', status: 'active', credentialHash: credHash,
    }).returning();
    cleanup.devices.push(dev.id);

    const res = await fetch(`${BASE_URL}/api/clientes/${clientId}/sites/${site.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.ok(body.error.includes('equipo'));
  });
});

// ---------------------------------------------------------------------------
// Token revocado → 401 en /v1/enroll
// ---------------------------------------------------------------------------

describe('token revocado → /v1/enroll devuelve 401', { skip }, () => {
  it('no puede usarse para dar de alta un equipo', async () => {
    const rawToken = generateEnrollmentToken();
    const [tok] = await db.insert(schema.enrollmentTokens).values({
      organizationId: orgId,
      clientId,
      tokenHash:   sha256hex(rawToken),
      tokenPrefix: tokenPrefix(rawToken),
      label:       'Token para revocar test enroll',
      revokedAt:   new Date(),
    }).returning();

    const res = await fetch(`${BASE_URL}/v1/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enrollment_token: rawToken,
        hostname: 'pc-revoked-token-test',
        hardware_id: { smbios_uuid: `revoked-${tok.id}` },
      }),
    });
    assert.equal(res.status, 401, 'token revocado debe devolver 401 en /v1/enroll');
  });
});
