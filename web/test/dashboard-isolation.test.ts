/**
 * Test de aislamiento multiorganización del dashboard.
 * Verifica a nivel de BD que las consultas filtradas por orgId
 * no devuelven datos de otra organización.
 * Requiere DATABASE_URL.
 *
 * Uso: npm run test:dashboard
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and, ne, inArray, count } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';

const skip = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:dashboard)'
  : false;

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null as never;
const db  = sql ? drizzle(sql, { schema }) : null as never;

let org1Id = '';
let org2Id = '';
let cleanupIds: { devices: string[]; sites: string[]; orgs: string[]; clients: string[] } = {
  devices: [], sites: [], orgs: [], clients: [],
};

describe('aislamiento multiorg (nivel BD)', { skip }, () => {
  before(async () => {
    const [o1] = await db.insert(schema.organizations).values({
      name: '__test_org1__', slug: `test-org1-${Date.now()}`,
    }).returning();
    const [o2] = await db.insert(schema.organizations).values({
      name: '__test_org2__', slug: `test-org2-${Date.now()}`,
    }).returning();
    org1Id = o1.id;
    org2Id = o2.id;
    cleanupIds.orgs.push(o1.id, o2.id);

    // Org1: 1 cliente, 1 sede, 1 PC activo
    const [c1] = await db.insert(schema.clients).values({ organizationId: o1.id, name: 'ClienteOrg1' }).returning();
    const [s1] = await db.insert(schema.sites).values({ organizationId: o1.id, clientId: c1.id, name: 'Sede1' }).returning();
    const [d1] = await db.insert(schema.devices).values({
      organizationId: o1.id, clientId: c1.id, siteId: s1.id,
      hostname: 'PC-ORG1', status: 'active', deviceTypeHint: 'pc',
      credentialHash: 'iso1', lastSeenAt: new Date(),
    }).returning();
    await db.insert(schema.deviceCurrentState).values({ deviceId: d1.id, organizationId: o1.id, updatedAt: new Date() });
    cleanupIds.clients.push(c1.id);
    cleanupIds.sites.push(s1.id);
    cleanupIds.devices.push(d1.id);

    // Org2: 1 cliente, 1 sede, 2 servidores activos
    const [c2] = await db.insert(schema.clients).values({ organizationId: o2.id, name: 'ClienteOrg2' }).returning();
    const [s2] = await db.insert(schema.sites).values({ organizationId: o2.id, clientId: c2.id, name: 'Sede2' }).returning();
    const [d2a, d2b] = await db.insert(schema.devices).values([
      { organizationId: o2.id, clientId: c2.id, siteId: s2.id, hostname: 'SRV-ORG2-A', status: 'active', deviceTypeHint: 'server', credentialHash: 'iso2a', lastSeenAt: new Date() },
      { organizationId: o2.id, clientId: c2.id, siteId: s2.id, hostname: 'SRV-ORG2-B', status: 'active', deviceTypeHint: 'server', credentialHash: 'iso2b', lastSeenAt: new Date() },
    ]).returning();
    for (const d of [d2a, d2b]) {
      await db.insert(schema.deviceCurrentState).values({ deviceId: d.id, organizationId: o2.id, updatedAt: new Date() });
    }
    cleanupIds.clients.push(c2.id);
    cleanupIds.sites.push(s2.id);
    cleanupIds.devices.push(d2a.id, d2b.id);
  });

  after(async () => {
    if (cleanupIds.devices.length > 0) {
      await db.delete(schema.deviceCurrentState).where(inArray(schema.deviceCurrentState.deviceId, cleanupIds.devices));
      await db.delete(schema.devices).where(inArray(schema.devices.id, cleanupIds.devices));
    }
    if (cleanupIds.sites.length > 0) {
      await db.delete(schema.sites).where(inArray(schema.sites.id, cleanupIds.sites));
    }
    if (cleanupIds.clients.length > 0) {
      await db.delete(schema.clients).where(inArray(schema.clients.id, cleanupIds.clients));
    }
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, cleanupIds.orgs));
    await sql.end();
  });

  it('dispositivos de org1: exactamente 1', async () => {
    const rows = await db
      .select({ n: count() })
      .from(schema.devices)
      .where(and(
        eq(schema.devices.organizationId, org1Id),
        ne(schema.devices.status, 'uninstalled'),
        ne(schema.devices.status, 'pending_assignment'),
      ));
    assert.equal(Number(rows[0]?.n), 1, 'org1 debe tener exactamente 1 dispositivo activo');
  });

  it('dispositivos de org2: exactamente 2', async () => {
    const rows = await db
      .select({ n: count() })
      .from(schema.devices)
      .where(and(
        eq(schema.devices.organizationId, org2Id),
        ne(schema.devices.status, 'uninstalled'),
        ne(schema.devices.status, 'pending_assignment'),
      ));
    assert.equal(Number(rows[0]?.n), 2, 'org2 debe tener exactamente 2 dispositivos activos');
  });

  it('device_current_state de org1 no contiene filas de org2', async () => {
    const rows = await db
      .select({ n: count() })
      .from(schema.deviceCurrentState)
      .where(eq(schema.deviceCurrentState.organizationId, org1Id));
    assert.equal(Number(rows[0]?.n), 1, 'device_current_state debe tener solo 1 fila para org1');
  });

  it('métricas 5min de org2 no aparecen en consultas de org1', async () => {
    // Insertar una métrica solo en org2
    const [d2] = await db
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(eq(schema.devices.organizationId, org2Id))
      .limit(1);

    await db.insert(schema.metrics5min).values({
      deviceId:   d2.id,
      organizationId: org2Id,
      periodStart: new Date(),
      periodEnd:   new Date(),
      samples:     1,
    });

    const rows = await db
      .select({ n: count() })
      .from(schema.metrics5min)
      .where(eq(schema.metrics5min.organizationId, org1Id));
    assert.equal(Number(rows[0]?.n), 0, 'org1 no debe ver métricas de org2');

    // Limpiar la métrica de prueba
    await db.delete(schema.metrics5min).where(eq(schema.metrics5min.deviceId, d2.id));
  });
});
