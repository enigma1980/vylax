/**
 * Crea datos de demostración en la organización Global-Link.
 * Clientes: Clínica Serra, Despacho Martí, Transportes Vall.
 * Solo para desarrollo; no ejecutar desde db:reset.
 *
 * Uso: npm run dev:seed-demo
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';

const sql = postgres(process.env.DATABASE_URL!);
const db  = drizzle(sql, { schema });

const DEMO_CLIENTS = ['Clínica Serra', 'Despacho Martí', 'Transportes Vall'];

function gb(n: number) { return Math.round(n * 1_073_741_824); }

function vol(mount: string, totalGb: number, usedPct: number) {
  const total = gb(totalGb);
  const used  = Math.round(total * usedPct / 100);
  return { mount, total_bytes: total, used_bytes: used, free_bytes: total - used, filesystem: 'NTFS' };
}

function minsAgo(n: number) { return new Date(Date.now() - n * 60_000); }
function daysAgo(n: number) { return new Date(Date.now() - n * 86_400_000); }

async function main() {
  // Encontrar org Global-Link
  const org = await db.query.organizations.findFirst({
    where: (o, { eq }) => eq(o.slug, 'global-link'),
  });
  if (!org) {
    console.error('❌  No se encontró la organización Global-Link. Ejecuta npm run db:seed primero.');
    await sql.end();
    process.exit(1);
  }
  console.log('✔  Org:', org.name, org.id);

  // Limpiar clientes de demo anteriores
  const existing = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.organizationId, org.id),
        inArray(schema.clients.name, DEMO_CLIENTS),
      ),
    );

  if (existing.length > 0) {
    const ids = existing.map(c => c.id);
    const deviceRows = await db
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(inArray(schema.devices.clientId, ids));

    const devIds = deviceRows.map(d => d.id);

    if (devIds.length > 0) {
      await db.delete(schema.metrics5min).where(inArray(schema.metrics5min.deviceId, devIds));
      await db.delete(schema.dailyReports).where(inArray(schema.dailyReports.deviceId, devIds));
      await db.delete(schema.agentEvents).where(inArray(schema.agentEvents.deviceId, devIds));
      await db.delete(schema.deviceCurrentState).where(inArray(schema.deviceCurrentState.deviceId, devIds));
      await db.delete(schema.devices).where(inArray(schema.devices.id, devIds));
    }

    const siteRows = await db
      .select({ id: schema.sites.id })
      .from(schema.sites)
      .where(inArray(schema.sites.clientId, ids));
    if (siteRows.length > 0) {
      await db.delete(schema.sites).where(inArray(schema.sites.id, siteRows.map(s => s.id)));
    }
    await db.delete(schema.clients).where(inArray(schema.clients.id, ids));
    console.log('🗑  Datos de demo anteriores eliminados.');
  }

  // ── Clínica Serra ──────────────────────────────────────────────────────────
  const [serra] = await db
    .insert(schema.clients)
    .values({ organizationId: org.id, name: 'Clínica Serra' })
    .returning();

  const [serraSede1] = await db
    .insert(schema.sites)
    .values({ organizationId: org.id, clientId: serra.id, name: 'Sede Central' })
    .returning();
  const [serraSede2] = await db
    .insert(schema.sites)
    .values({ organizationId: org.id, clientId: serra.id, name: 'Clínica Norte' })
    .returning();

  const serraDevices = await db.insert(schema.devices).values([
    { organizationId: org.id, clientId: serra.id, siteId: serraSede1.id, hostname: 'SRV-CLINICA',   status: 'active', deviceTypeHint: 'server', credentialHash: 'demo1', lastSeenAt: minsAgo(25) },
    { organizationId: org.id, clientId: serra.id, siteId: serraSede1.id, hostname: 'PC-RECEPCION',  status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo2', lastSeenAt: minsAgo(2)  },
    { organizationId: org.id, clientId: serra.id, siteId: serraSede1.id, hostname: 'PC-CONSULTA1',  status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo3', lastSeenAt: minsAgo(3)  },
    { organizationId: org.id, clientId: serra.id, siteId: serraSede1.id, hostname: 'PC-CONSULTA2',  status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo4', lastSeenAt: minsAgo(4)  },
    { organizationId: org.id, clientId: serra.id, siteId: serraSede2.id, hostname: 'SRV-NORTE',     status: 'active', deviceTypeHint: 'server', credentialHash: 'demo5', lastSeenAt: minsAgo(7)  },
    { organizationId: org.id, clientId: serra.id, siteId: serraSede2.id, hostname: 'PC-NORTE1',     status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo6', lastSeenAt: minsAgo(5)  },
  ]).returning();

  // Estado actual
  for (const dev of serraDevices) {
    const isSrv = dev.deviceTypeHint === 'server';
    await db.insert(schema.deviceCurrentState).values({
      deviceId:       dev.id,
      organizationId: org.id,
      volumes: JSON.stringify([vol('C:', 200, isSrv ? 98 : 60)]),
      windowsUpdate: JSON.stringify({ days_since_last: isSrv ? 50 : 20, pending_count: isSrv ? 3 : 0 }),
      lastDailyAt:   daysAgo(1),
      updatedAt:     new Date(),
    });
  }

  // ── Despacho Martí ─────────────────────────────────────────────────────────
  const [marti] = await db
    .insert(schema.clients)
    .values({ organizationId: org.id, name: 'Despacho Martí' })
    .returning();

  const [martiSede] = await db
    .insert(schema.sites)
    .values({ organizationId: org.id, clientId: marti.id, name: 'Oficina Central' })
    .returning();

  const martiDevices = await db.insert(schema.devices).values([
    { organizationId: org.id, clientId: marti.id, siteId: martiSede.id, hostname: 'SRV-MARTI',    status: 'active', deviceTypeHint: 'server', credentialHash: 'demo7', lastSeenAt: minsAgo(8)  },
    { organizationId: org.id, clientId: marti.id, siteId: martiSede.id, hostname: 'PC-ADMIN',     status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo8', lastSeenAt: minsAgo(6)  },
    { organizationId: org.id, clientId: marti.id, siteId: martiSede.id, hostname: 'PC-RECEP',     status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo9', lastSeenAt: daysAgo(4)  },
    { organizationId: org.id, clientId: marti.id, siteId: martiSede.id, hostname: 'LAPTOP-MARTI', status: 'active', deviceTypeHint: 'laptop', credentialHash: 'demoA', lastSeenAt: minsAgo(10) },
  ]).returning();

  for (const dev of martiDevices) {
    await db.insert(schema.deviceCurrentState).values({
      deviceId:       dev.id,
      organizationId: org.id,
      volumes: JSON.stringify([vol('C:', 500, dev.hostname === 'PC-RECEP' ? 93 : 55)]),
      windowsUpdate: JSON.stringify({ days_since_last: 10, pending_count: 0 }),
      lastDailyAt:   daysAgo(1),
      updatedAt:     new Date(),
    });
  }

  // ── Transportes Vall ───────────────────────────────────────────────────────
  const [vall] = await db
    .insert(schema.clients)
    .values({ organizationId: org.id, name: 'Transportes Vall' })
    .returning();

  const [vallSede] = await db
    .insert(schema.sites)
    .values({ organizationId: org.id, clientId: vall.id, name: 'Sede Logística' })
    .returning();

  const vallDevices = await db.insert(schema.devices).values([
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'SRV-VALL',    status: 'active', deviceTypeHint: 'server', credentialHash: 'demoB', lastSeenAt: minsAgo(5)  },
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'PC-OFICINA1', status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demoC', lastSeenAt: minsAgo(3)  },
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'PC-OFICINA2', status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demoD', lastSeenAt: minsAgo(4)  },
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'LAPTOP-VAL1', status: 'active', deviceTypeHint: 'laptop', credentialHash: 'demoE', lastSeenAt: daysAgo(1)  },
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'LAPTOP-VAL2', status: 'active', deviceTypeHint: 'laptop', credentialHash: 'demoF', lastSeenAt: daysAgo(2)  },
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'LAPTOP-VAL3', status: 'active', deviceTypeHint: 'laptop', credentialHash: 'demoG', lastSeenAt: daysAgo(3)  },
  ]).returning();

  for (const dev of vallDevices) {
    await db.insert(schema.deviceCurrentState).values({
      deviceId:       dev.id,
      organizationId: org.id,
      volumes: JSON.stringify([vol('C:', dev.deviceTypeHint === 'server' ? 1000 : 256, 45)]),
      windowsUpdate: JSON.stringify({ days_since_last: 15, pending_count: 0 }),
      lastDailyAt:   daysAgo(1),
      updatedAt:     new Date(),
    });
  }

  // Eventos shutdown para laptops de Vall (apagadas normalmente)
  for (const dev of vallDevices.filter(d => d.deviceTypeHint === 'laptop')) {
    await db.insert(schema.agentEvents).values({
      deviceId:       dev.id,
      organizationId: org.id,
      eventType:      'shutdown',
      occurredAt:     dev.lastSeenAt!,
      data:           JSON.stringify({ reason: 'normal_shutdown' }),
    });
  }

  // Métricas de 7 días (para todos los dispositivos 'online' de los 3 clientes)
  const allDevices = [...serraDevices, ...martiDevices, ...vallDevices];
  const onlineDevices = allDevices.filter(d =>
    d.lastSeenAt && (Date.now() - d.lastSeenAt.getTime()) < 15 * 60_000
  );

  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    for (const dev of onlineDevices) {
      const periodStart = new Date(Date.now() - dayOffset * 86_400_000 - 5 * 60_000);
      const periodEnd   = new Date(periodStart.getTime() + 5 * 60_000);
      await db.insert(schema.metrics5min).values({
        deviceId:       dev.id,
        organizationId: org.id,
        periodStart,
        periodEnd,
        samples:        5,
        cpuAvgPct:      Math.random() * 30 + 5,
        cpuMaxPct:      Math.random() * 60 + 20,
        memoryUsedAvgPct: Math.random() * 40 + 20,
        memoryUsedMaxPct: Math.random() * 60 + 30,
      }).onConflictDoNothing();
    }
  }

  console.log(`✔  Clínica Serra: ${serraDevices.length} dispositivos`);
  console.log(`✔  Despacho Martí: ${martiDevices.length} dispositivos`);
  console.log(`✔  Transportes Vall: ${vallDevices.length} dispositivos`);
  console.log('\n✅  Datos de demo creados. Ejecuta npm run dev para ver el panel.');
  console.log('\nQué deberías ver en el panel:');
  console.log('  • Resumen: ~16 equipos, varios en línea, SRV-CLINICA y PC-RECEP sin reportar');
  console.log('  • Clínica Serra: estado Crítico (servidor sin reportar)');
  console.log('  • Despacho Martí: estado Aviso (PC-RECEP 4 días sin reportar)');
  console.log('  • Transportes Vall: estado Correcto (laptops apagadas normalmente)');
  console.log('  • Discos: SRV-CLINICA C: al 98 %, PC-RECEP C: al 93 %');
  console.log('  • Anillo actualizaciones: SRV-CLINICA y SRV-NORTE superan 45 días');
  console.log('  • Gráfica 7 días: línea con dispositivos en línea cada día');

  await sql.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
