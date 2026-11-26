/**
 * Tests de integración para:
 *   A) Asignación de sede por IP pública en /v1/enroll
 *   B) 401 cuando la credencial está revocada
 *   C) Re-alta que limpia credential_revoked_at y registra device_reenrolled
 *
 * Requiere DATABASE_URL y servidor en localhost:3000:
 *   npm run test:enroll
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import {
  sha256hex,
  generateDeviceSecret,
  generateEnrollmentToken,
  tokenPrefix,
} from '../src/lib/crypto.js';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const skip     = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:enroll)'
  : false;

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null as never;
const db  = sql ? drizzle(sql, { schema }) : null as never;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TEST_IP   = '203.0.113.42';  // TEST-NET-3, solo para pruebas
const OTHER_IP  = '203.0.113.99';  // IP que no coincide con ninguna sede
const SMBIOS    = `test-smbios-${randomUUID()}`;

let orgId     = '';
let clientId  = '';
let siteId    = '';
let tokenRaw  = '';   // token para tests A y C
let tokenRaw2 = '';   // token org-level para test B

// IDs para limpieza
const cleanup = { devices: [] as string[], sites: [] as string[], clients: [] as string[], orgs: [] as string[] };

before(async () => {
  if (skip) return;

  const [org] = await db.insert(schema.organizations).values({
    name: '__test_enroll_ip__',
    slug: `test-enroll-ip-${Date.now()}`,
  }).returning();
  orgId = org.id;
  cleanup.orgs.push(org.id);

  const [client] = await db.insert(schema.clients).values({
    organizationId: orgId,
    name: 'Cliente IP Test',
  }).returning();
  clientId = client.id;
  cleanup.clients.push(client.id);

  // Sede con la IP de test
  const [site] = await db.insert(schema.sites).values({
    organizationId: orgId,
    clientId,
    name: 'Sede con IP',
    publicIps: [TEST_IP],
  }).returning();
  siteId = site.id;
  cleanup.sites.push(site.id);

  // Token de cliente (sin sede): usado para los tests A y C
  const rawA    = generateEnrollmentToken();
  tokenRaw      = rawA;
  await db.insert(schema.enrollmentTokens).values({
    organizationId: orgId,
    clientId,
    siteId:   null,
    tokenHash:   sha256hex(rawA),
    tokenPrefix: tokenPrefix(rawA),
    label:   'Token cliente test',
  });

  // Token de org (sin cliente): usado para el test B (revocación)
  const rawB  = generateEnrollmentToken();
  tokenRaw2   = rawB;
  await db.insert(schema.enrollmentTokens).values({
    organizationId: orgId,
    clientId: null,
    siteId:   null,
    tokenHash:   sha256hex(rawB),
    tokenPrefix: tokenPrefix(rawB),
    label:   'Token org test revocación',
  });
});

after(async () => {
  if (skip) return;
  if (cleanup.devices.length > 0) {
    await db.delete(schema.deviceCurrentState).where(inArray(schema.deviceCurrentState.deviceId, cleanup.devices));
    await db.delete(schema.agentEvents).where(inArray(schema.agentEvents.deviceId, cleanup.devices));
    await db.delete(schema.devices).where(inArray(schema.devices.id, cleanup.devices));
  }
  await db.delete(schema.enrollmentTokens).where(eq(schema.enrollmentTokens.organizationId, orgId));
  if (cleanup.sites.length > 0)
    await db.delete(schema.sites).where(inArray(schema.sites.id, cleanup.sites));
  if (cleanup.clients.length > 0)
    await db.delete(schema.clients).where(inArray(schema.clients.id, cleanup.clients));
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, cleanup.orgs));
  await sql.end({ timeout: 5 });
});

async function postEnroll(body: object, forwardedFor?: string) {
  return fetch(`${BASE_URL}/v1/enroll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function postReports(deviceId: string, secret: string, body: object) {
  return fetch(`${BASE_URL}/v1/reports`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-device-id': deviceId,
      'Authorization': `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// A) Asignación de sede por IP pública
// ---------------------------------------------------------------------------

describe('/v1/enroll — asignación de sede por IP', { skip }, () => {
  it('asigna la sede cuya public_ips contiene la IP del agente', async () => {
    const res = await postEnroll({
      enrollment_token: tokenRaw,
      hostname: 'pc-ip-test',
      hardware_id: { smbios_uuid: `ip-match-${randomUUID()}` },
    }, TEST_IP);

    assert.equal(res.status, 200, 'enroll debe responder 200');
    const body = await res.json() as { device_id: string };
    cleanup.devices.push(body.device_id);

    const [dev] = await db.select({ siteId: schema.devices.siteId })
      .from(schema.devices)
      .where(eq(schema.devices.id, body.device_id));
    assert.equal(dev.siteId, siteId, 'el equipo debe quedar asignado a la sede con esa IP');
  });

  it('sin coincidencia de IP → siteId null ("Remotos / sin sede")', async () => {
    const res = await postEnroll({
      enrollment_token: tokenRaw,
      hostname: 'pc-ip-no-match',
      hardware_id: { smbios_uuid: `ip-no-match-${randomUUID()}` },
    }, OTHER_IP);

    assert.equal(res.status, 200);
    const body = await res.json() as { device_id: string };
    cleanup.devices.push(body.device_id);

    const [dev] = await db.select({ siteId: schema.devices.siteId })
      .from(schema.devices)
      .where(eq(schema.devices.id, body.device_id));
    assert.equal(dev.siteId, null, 'sin coincidencia de IP el equipo queda sin sede');
  });
});

// ---------------------------------------------------------------------------
// B) 401 con credencial revocada  +  C) Re-alta que la limpia
// ---------------------------------------------------------------------------

describe('credential_revoked_at', { skip }, () => {
  let deviceId   = '';
  let deviceSecret = '';

  before(async () => {
    // Crear dispositivo con credencial revocada
    const secret       = generateDeviceSecret();
    deviceSecret       = secret;
    const credHash     = sha256hex(secret);
    const [dev] = await db.insert(schema.devices).values({
      organizationId:     orgId,
      hostname:           'pc-revoked',
      status:             'active',
      credentialHash:     credHash,
      credentialRevokedAt: new Date(),
      hardwareSmbiousUuid: SMBIOS,
    }).returning();
    deviceId = dev.id;
    cleanup.devices.push(dev.id);
    await db.insert(schema.deviceCurrentState).values({
      deviceId: dev.id,
      organizationId: orgId,
    }).onConflictDoNothing();
  });

  it('devuelve 401 cuando credential_revoked_at está establecida', async () => {
    // Envío mínimo de reports; lo importante es el código de respuesta
    const minEnvelope = {
      schema_version: 1,
      agent_version: '0.1.0',
      sent_at: new Date().toISOString(),
      reports: [],
    };
    const res = await postReports(deviceId, deviceSecret, minEnvelope);
    assert.equal(res.status, 401, 'credencial revocada debe devolver 401');
  });

  it('re-alta con mismo hardware UUID limpia credential_revoked_at', async () => {
    const res = await postEnroll({
      enrollment_token: tokenRaw2,
      hostname: 'pc-revoked-reenlolled',
      hardware_id: { smbios_uuid: SMBIOS },
    });
    assert.equal(res.status, 200, 're-alta debe responder 200');

    const [dev] = await db.select({ credentialRevokedAt: schema.devices.credentialRevokedAt })
      .from(schema.devices)
      .where(eq(schema.devices.id, deviceId));
    assert.equal(dev.credentialRevokedAt, null, 'credential_revoked_at debe haberse limpiado');
  });

  it('registra el evento device_reenrolled tras la re-alta', async () => {
    const events = await db.select()
      .from(schema.agentEvents)
      .where(and(
        eq(schema.agentEvents.deviceId, deviceId),
        eq(schema.agentEvents.eventType, 'device_reenrolled'),
      ));
    assert.ok(events.length > 0, 'debe existir al menos un evento device_reenrolled');
  });
});
