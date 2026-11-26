/**
 * Tests de integración de getOverviewData con 3 clientes.
 * Verifica que la consulta de sedes funciona con múltiples clientes (inArray)
 * y que los datos devueltos son correctos.
 * Requiere DATABASE_URL.
 *
 * Uso: npm run test:dashboard
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { getOverviewData } from '../src/lib/dashboard.js';
import { closeDb } from '../src/db/index.js';

const skip = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:dashboard)'
  : false;

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null as never;
const db  = sql ? drizzle(sql, { schema }) : null as never;

let orgId = '';
const cleanupIds: { devices: string[]; sites: string[]; clients: string[]; orgs: string[] } = {
  devices: [], sites: [], clients: [], orgs: [],
};

describe('getOverviewData con 3 clientes', { skip }, () => {
  before(async () => {
    const [org] = await db.insert(schema.organizations).values({
      name: '__test_overview__', slug: `test-overview-${Date.now()}`,
    }).returning();
    orgId = org.id;
    cleanupIds.orgs.push(org.id);

    // Crear 3 clientes, cada uno con 1 sede y 1 dispositivo activo
    const clientNames = ['TestClientA', 'TestClientB', 'TestClientC'];
    for (const name of clientNames) {
      const [c] = await db.insert(schema.clients)
        .values({ organizationId: orgId, name })
        .returning();
      const [s] = await db.insert(schema.sites)
        .values({ organizationId: orgId, clientId: c.id, name: `Sede ${name}` })
        .returning();
      const [d] = await db.insert(schema.devices).values({
        organizationId: orgId,
        clientId: c.id,
        siteId: s.id,
        hostname: `PC-${name.toUpperCase()}`,
        status: 'active',
        deviceTypeHint: 'pc',
        credentialHash: `hash-${name}-${Date.now()}`,
        lastSeenAt: new Date(),
      }).returning();
      await db.insert(schema.deviceCurrentState).values({
        deviceId: d.id,
        organizationId: orgId,
        updatedAt: new Date(),
      });
      cleanupIds.clients.push(c.id);
      cleanupIds.sites.push(s.id);
      cleanupIds.devices.push(d.id);
    }
  });

  after(async () => {
    if (cleanupIds.devices.length > 0) {
      await db.delete(schema.deviceCurrentState)
        .where(inArray(schema.deviceCurrentState.deviceId, cleanupIds.devices));
      await db.delete(schema.devices)
        .where(inArray(schema.devices.id, cleanupIds.devices));
    }
    if (cleanupIds.sites.length > 0) {
      await db.delete(schema.sites)
        .where(inArray(schema.sites.id, cleanupIds.sites));
    }
    if (cleanupIds.clients.length > 0) {
      await db.delete(schema.clients)
        .where(inArray(schema.clients.id, cleanupIds.clients));
    }
    await db.delete(schema.organizations)
      .where(inArray(schema.organizations.id, cleanupIds.orgs));
    await Promise.all([sql.end({ timeout: 5 }), closeDb()]);
  });

  it('devuelve exactamente 3 clientes', async () => {
    const data = await getOverviewData(orgId);
    assert.equal(data.clientList.length, 3, 'debe haber 3 clientes en la vista general');
  });

  it('totalDevices es 3', async () => {
    const data = await getOverviewData(orgId);
    assert.equal(data.totalDevices, 3, 'debe haber 3 dispositivos activos en total');
  });

  it('cada cliente tiene 1 sede', async () => {
    const data = await getOverviewData(orgId);
    for (const c of data.clientList) {
      assert.equal(c.sites, 1, `cliente ${c.name} debe tener 1 sede`);
    }
  });

  it('cada cliente tiene 1 equipo en línea (lastSeenAt=ahora)', async () => {
    const data = await getOverviewData(orgId);
    for (const c of data.clientList) {
      assert.equal(c.total, 1);
      assert.equal(c.online, 1);
    }
  });

  it('semáforo de todos los clientes es ok', async () => {
    const data = await getOverviewData(orgId);
    for (const c of data.clientList) {
      assert.equal(c.semaphore, 'ok', `cliente ${c.name} debe estar en estado ok`);
    }
  });
});
