/**
 * Tests para device-filters (unitario) y getDevicesForClient (integración).
 * Los tests de integración requieren DATABASE_URL y servidor Next.js en :3000:
 *   npm run test:client-devices
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Tests unitarios de device-filters
// ---------------------------------------------------------------------------

import { applyFilters, computeCounts } from '../src/lib/device-filters.js';
import type { DeviceRow } from '../src/lib/dashboard.js';

function makeDevice(overrides: Partial<DeviceRow>): DeviceRow {
  return {
    id: randomUUID(), hostname: 'HOST', status: 'online', effType: 'pc',
    deviceType: null, deviceTypeHint: null, siteId: 'site-a',
    lastSeenAt: null, agentVersion: null, osName: null, osBuild: null,
    manufacturer: null,
    cpuAvgPct: null, memoryUsedAvgPct: null, ramTotalBytes: null,
    volumes: null, antivirus: null, windowsUpdate: null,
    physicalDisks: null, loggedOnUser: null, agentMemBytes: null,
    network: null, lastEvents: [],
    ...overrides,
  };
}

const SITE_A = 'site-a';
const SITE_B = 'site-b';

const devices: DeviceRow[] = [
  makeDevice({ id: '1', hostname: 'SRV-01', effType: 'server', status: 'online',       siteId: SITE_A }),
  makeDevice({ id: '2', hostname: 'PC-01',  effType: 'pc',     status: 'online',       siteId: SITE_A }),
  makeDevice({ id: '3', hostname: 'LAP-01', effType: 'laptop', status: 'no_report',    siteId: SITE_A }),
  makeDevice({ id: '4', hostname: 'PC-02',  effType: 'pc',     status: 'disconnected', siteId: SITE_B }),
];

describe('applyFilters — sin sede', () => {
  it('all → todos', () => {
    assert.equal(applyFilters(devices, '', 'all').length, 4);
  });

  it('con_avisos → solo con issues', () => {
    const devWithIssues = [
      ...devices,
      makeDevice({ id: '5', hostname: 'AV-01', effType: 'pc', status: 'online', siteId: SITE_A,
        antivirus: [{ product: 'Defender', enabled: false, up_to_date: false }] }),
    ];
    const r = applyFilters(devWithIssues, '', 'con_avisos');
    assert.equal(r.length, 1);
    assert.equal(r[0].hostname, 'AV-01');
  });

  it('server → solo servidores', () => {
    const r = applyFilters(devices, '', 'server');
    assert.equal(r.length, 1);
    assert.equal(r[0].hostname, 'SRV-01');
  });

  it('pc → solo PCs', () => {
    const r = applyFilters(devices, '', 'pc');
    assert.equal(r.length, 2);
    assert.ok(r.every(d => d.effType === 'pc'));
  });

  it('laptop → solo portátiles', () => {
    const r = applyFilters(devices, '', 'laptop');
    assert.equal(r.length, 1);
    assert.equal(r[0].hostname, 'LAP-01');
  });
});

describe('applyFilters — con sede', () => {
  it('sede A, all → 3 equipos', () => {
    assert.equal(applyFilters(devices, SITE_A, 'all').length, 3);
  });

  it('sede B, all → 1 equipo', () => {
    assert.equal(applyFilters(devices, SITE_B, 'all').length, 1);
  });

  it('sede B, server → ninguno', () => {
    assert.equal(applyFilters(devices, SITE_B, 'server').length, 0);
  });
});

describe('computeCounts', () => {
  it('sin sede → contadores globales', () => {
    const c = computeCounts(devices, '');
    assert.equal(c.all,        4);
    assert.equal(c.con_avisos, 0);
    assert.equal(c.server,     1);
    assert.equal(c.pc,         2);
    assert.equal(c.laptop,     1);
  });

  it('sede A → contadores parciales', () => {
    const c = computeCounts(devices, SITE_A);
    assert.equal(c.all, 3);
    assert.equal(c.pc,  1);
  });
});

// ---------------------------------------------------------------------------
// Tests de integración: getDevicesForClient con aislamiento
// ---------------------------------------------------------------------------

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { getDevicesForClient } from '../src/lib/dashboard.js';
import { closeDb } from '../src/db/index.js';

const skip = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:client-devices)'
  : false;

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null as never;
const db  = sql ? drizzle(sql, { schema }) : null as never;

let orgAId = ''; let orgBId = '';
let clientAId = ''; let clientBId = '';
const cleanup = { orgs: [] as string[], clients: [] as string[] };

before(async () => {
  if (skip) return;

  const [orgA] = await db.insert(schema.organizations).values({
    name: '__test_devfilter_A__', slug: `test-devfilter-a-${Date.now()}`,
  }).returning();
  orgAId = orgA.id; cleanup.orgs.push(orgA.id);

  const [orgB] = await db.insert(schema.organizations).values({
    name: '__test_devfilter_B__', slug: `test-devfilter-b-${Date.now()}`,
  }).returning();
  orgBId = orgB.id; cleanup.orgs.push(orgB.id);

  const [cA] = await db.insert(schema.clients).values({
    organizationId: orgAId, name: 'Cliente A test',
  }).returning();
  clientAId = cA.id; cleanup.clients.push(cA.id);

  const [cB] = await db.insert(schema.clients).values({
    organizationId: orgBId, name: 'Cliente B test (otra org)',
  }).returning();
  clientBId = cB.id; cleanup.clients.push(cB.id);
});

after(async () => {
  if (skip) return;
  if (cleanup.clients.length > 0) {
    await db.delete(schema.clients).where(inArray(schema.clients.id, cleanup.clients));
  }
  if (cleanup.orgs.length > 0) {
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, cleanup.orgs));
  }
  await sql.end({ timeout: 5 });
  await closeDb();
});

describe('getDevicesForClient — aislamiento multiempresa', { skip }, () => {
  it('clientId de org B con orgId de A → error', async () => {
    await assert.rejects(
      () => getDevicesForClient(orgAId, clientBId),
      (err: Error) => {
        assert.ok(err.message.includes('sin acceso') || err.message.includes('no encontrado'));
        return true;
      },
    );
  });

  it('clientId propio → devuelve array (aunque esté vacío)', async () => {
    const result = await getDevicesForClient(orgAId, clientAId);
    assert.ok(Array.isArray(result));
  });
});
