/**
 * Tests de la parte 6: ficha del equipo (getDevice, getDeviceMetrics).
 * Requiere DATABASE_URL.
 *   npm run test:device-detail
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { getDevice, getDeviceMetrics } from '../src/lib/dashboard.js';
import { securityChecks } from '../src/lib/device-checks.js';
import { closeDb } from '../src/db/index.js';

const skip = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:device-detail)'
  : false;

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null as never;
const db  = sql ? drizzle(sql, { schema }) : null as never;

function sha256(s: string) { return createHash('sha256').update(s).digest('hex'); }

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let orgId     = '';
let org2Id    = '';
let deviceId  = '';
let device2Id = '';

const cleanup = {
  events:  [] as string[],
  dcs:     [] as string[],
  devices: [] as string[],
  tokens:  [] as string[],
  sites:   [] as string[],
  clients: [] as string[],
  orgs:    [] as string[],
};

describe('ficha del equipo (Parte 6)', { skip }, () => {
  before(async () => {
    const ts = Date.now();

    const [org] = await db.insert(schema.organizations).values({
      name: '__test_dd__', slug: `test-dd-${ts}`,
    }).returning();
    orgId = org.id;
    cleanup.orgs.push(org.id);

    const [org2] = await db.insert(schema.organizations).values({
      name: '__test_dd_b__', slug: `test-dd-b-${ts}`,
    }).returning();
    org2Id = org2.id;
    cleanup.orgs.push(org2.id);

    const [client] = await db.insert(schema.clients).values({
      organizationId: orgId, name: 'DD Client',
    }).returning();
    cleanup.clients.push(client.id);

    const [site] = await db.insert(schema.sites).values({
      organizationId: orgId, clientId: client.id, name: 'DD Site',
    }).returning();
    cleanup.sites.push(site.id);

    const [token] = await db.insert(schema.enrollmentTokens).values({
      organizationId: orgId, clientId: client.id,
      tokenHash: sha256(`tok-dd-${ts}`), tokenPrefix: `tok-dd-${ts}`.slice(0, 8),
      label: 'dd-tok',
    }).returning();
    cleanup.tokens.push(token.id);

    // equipo en org A
    const [dev] = await db.insert(schema.devices).values({
      organizationId: orgId, clientId: client.id, siteId: site.id,
      hostname: 'ws-dd-test', credentialHash: sha256(`cred-dd-${ts}`),
      agentVersion: '1.2.3', enrollmentTokenId: token.id,
    }).returning();
    deviceId = dev.id;
    cleanup.devices.push(dev.id);

    // estado actual
    await db.insert(schema.deviceCurrentState).values({
      deviceId: dev.id, organizationId: orgId,
      cpuAvgPct: 35.5, memoryUsedAvgPct: 60.0,
      osInfo: { name: 'Windows 11 Pro', build: '26100' },
      antivirus: [{ product: 'Windows Defender', enabled: true, up_to_date: true }],
      windowsUpdate: { last_installed_at: new Date(Date.now() - 10 * 86400000).toISOString() },
    });
    cleanup.dcs.push(dev.id);

    // eventos
    const [ev1, ev2] = await db.insert(schema.agentEvents).values([
      { deviceId: dev.id, organizationId: orgId, eventType: 'device_enrolled', occurredAt: new Date(Date.now() - 3600000) },
      { deviceId: dev.id, organizationId: orgId, eventType: 'system_boot',     occurredAt: new Date(Date.now() - 1800000) },
    ]).returning();
    cleanup.events.push(ev1.id, ev2.id);

    // equipo en org B (aislamiento)
    const [dev2] = await db.insert(schema.devices).values({
      organizationId: org2Id,
      hostname: 'ws-dd-org2', credentialHash: sha256(`cred-org2-${ts}`),
    }).returning();
    device2Id = dev2.id;
    cleanup.devices.push(dev2.id);
  });

  after(async () => {
    if (cleanup.events.length)  await db.delete(schema.agentEvents).where(inArray(schema.agentEvents.id, cleanup.events));
    if (cleanup.dcs.length)     await db.delete(schema.deviceCurrentState).where(inArray(schema.deviceCurrentState.deviceId, cleanup.dcs));
    if (cleanup.devices.length) await db.delete(schema.devices).where(inArray(schema.devices.id, cleanup.devices));
    if (cleanup.tokens.length)  await db.delete(schema.enrollmentTokens).where(inArray(schema.enrollmentTokens.id, cleanup.tokens));
    if (cleanup.sites.length)   await db.delete(schema.sites).where(inArray(schema.sites.id, cleanup.sites));
    if (cleanup.clients.length) await db.delete(schema.clients).where(inArray(schema.clients.id, cleanup.clients));
    if (cleanup.orgs.length)    await db.delete(schema.organizations).where(inArray(schema.organizations.id, cleanup.orgs));
    await sql?.end();
    await closeDb();
  });

  // ── getDevice ──────────────────────────────────────────────────────────────

  describe('getDevice', () => {
    test('devuelve la ficha completa del equipo', async () => {
      const d = await getDevice(orgId, deviceId);
      assert.ok(d, 'getDevice debe devolver datos');
      assert.equal(d.hostname, 'ws-dd-test');
      assert.equal(d.clientName, 'DD Client');
      assert.equal(d.siteName, 'DD Site');
      assert.equal(d.agentVersion, '1.2.3');
      assert.ok(d.agentEvents.length >= 2, 'debe incluir eventos del agente');
    });

    test('orgId incorrecto → null (aislamiento)', async () => {
      const d = await getDevice('00000000-0000-0000-0000-000000000000', deviceId);
      assert.equal(d, null);
    });

    test('equipo de otra org → null', async () => {
      const d = await getDevice(orgId, device2Id);
      assert.equal(d, null);
    });

    test('deviceId inexistente → null', async () => {
      const d = await getDevice(orgId, '00000000-0000-0000-0000-000000000000');
      assert.equal(d, null);
    });
  });

  // ── getDeviceMetrics ───────────────────────────────────────────────────────

  describe('getDeviceMetrics', () => {
    test('sin datos en metrics_5min → array vacío (24h)', async () => {
      const pts = await getDeviceMetrics(orgId, deviceId, '24h');
      assert.ok(Array.isArray(pts), 'debe devolver array');
      assert.equal(pts.length, 0, 'sin datos → array vacío');
    });

    test('sin datos en metrics_5min → array vacío (7d)', async () => {
      const pts = await getDeviceMetrics(orgId, deviceId, '7d');
      assert.ok(Array.isArray(pts));
      assert.equal(pts.length, 0);
    });
  });

  // ── securityChecks sin antivirus ───────────────────────────────────────────

  describe('securityChecks', () => {
    test('sin campo antivirus → estado no-data, no cuenta como ok', () => {
      const ring = securityChecks({
        antivirus:    undefined,
        windowsUpdate: { last_installed_at: new Date(Date.now() - 5 * 86400000).toISOString() },
        osInfo:       { build: '26100', name: 'Windows 11 Enterprise' },
      });
      const avCheck = ring.details.find(d => d.label.toLowerCase().includes('antivirus'));
      assert.ok(avCheck, 'debe existir el check de antivirus');
      assert.equal(avCheck!.status, 'no-data');
      assert.ok(ring.result.ok < ring.result.total, 'no-data no debe contar como ok');
    });
  });
});
