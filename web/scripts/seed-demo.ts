/**
 * Crea datos de demostración en la organización Global-Link.
 * Clientes: Clínica Serra, Despacho Martí, Transportes Vall.
 * Re-ejecutable sin db:reset (limpia datos de demo anteriores).
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
function mb(n: number) { return Math.round(n * 1_048_576); }

function vol(mount: string, label: string, totalGb: number, usedPct: number) {
  const total = gb(totalGb);
  const used  = Math.round(total * usedPct / 100);
  return { mount, label, total_bytes: total, used_bytes: used, free_bytes: total - used, filesystem: 'NTFS' };
}

function minsAgo(n: number) { return new Date(Date.now() - n * 60_000); }
function daysAgo(n: number) { return new Date(Date.now() - n * 86_400_000); }

function wuState(daysSince: number, pending = 0) {
  return { last_installed_at: daysAgo(daysSince).toISOString(), pending_count: pending };
}

function avState(product: string, enabled: boolean, upToDate: boolean) {
  return [{ product, enabled, up_to_date: upToDate, real_time: enabled, last_update: daysAgo(upToDate ? 1 : 10).toISOString() }];
}

function osInfoState(name: string, build: string, manufacturer?: string) {
  return { name, build, edition: 'Pro', arch: 'x64', ...(manufacturer ? { manufacturer } : {}) };
}

function networkState(ip: string, speedMbps: number) {
  return { adapters: [{ name: 'Ethernet0', ipv4: [ip], mac: 'AA:BB:CC:DD:EE:FF', link_speed_mbps: speedMbps }] };
}

async function main() {
  // ── Encontrar org Global-Link ───────────────────────────────────────────────
  const org = await db.query.organizations.findFirst({
    where: (o, { eq }) => eq(o.slug, 'global-link'),
  });
  if (!org) {
    console.error('❌  No se encontró la organización Global-Link. Ejecuta npm run db:seed primero.');
    await sql.end();
    process.exit(1);
  }
  console.log('✔  Org:', org.name, org.id);

  // ── Limpiar datos de demo anteriores ───────────────────────────────────────
  const existing = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(and(eq(schema.clients.organizationId, org.id), inArray(schema.clients.name, DEMO_CLIENTS)));

  if (existing.length > 0) {
    const ids    = existing.map(c => c.id);
    const devIds = (await db.select({ id: schema.devices.id }).from(schema.devices)
      .where(inArray(schema.devices.clientId, ids))).map(d => d.id);
    const siteIds = (await db.select({ id: schema.sites.id }).from(schema.sites)
      .where(inArray(schema.sites.clientId, ids))).map(s => s.id);

    if (devIds.length > 0) {
      await db.delete(schema.metrics5min).where(inArray(schema.metrics5min.deviceId, devIds));
      await db.delete(schema.dailyReports).where(inArray(schema.dailyReports.deviceId, devIds));
      await db.delete(schema.agentEvents).where(inArray(schema.agentEvents.deviceId, devIds));
      await db.delete(schema.deviceCurrentState).where(inArray(schema.deviceCurrentState.deviceId, devIds));
      await db.delete(schema.devices).where(inArray(schema.devices.id, devIds));
    }
    if (siteIds.length > 0) {
      await db.delete(schema.enrollmentTokens).where(inArray(schema.enrollmentTokens.siteId, siteIds));
    }
    await db.delete(schema.enrollmentTokens).where(inArray(schema.enrollmentTokens.clientId, ids));
    if (siteIds.length > 0) await db.delete(schema.sites).where(inArray(schema.sites.id, siteIds));
    await db.delete(schema.clients).where(inArray(schema.clients.id, ids));
    console.log('🗑  Datos de demo anteriores eliminados.');
  }

  // ── Clínica Serra ──────────────────────────────────────────────────────────
  const [serra] = await db.insert(schema.clients)
    .values({ organizationId: org.id, name: 'Clínica Serra' }).returning();

  const [serraSede1] = await db.insert(schema.sites)
    .values({ organizationId: org.id, clientId: serra.id, name: 'Sede Central' }).returning();
  const [serraSede2] = await db.insert(schema.sites)
    .values({ organizationId: org.id, clientId: serra.id, name: 'Clínica Norte' }).returning();

  // Token de alta para Clínica Serra
  await db.insert(schema.enrollmentTokens).values({
    organizationId: org.id, clientId: serra.id,
    tokenHash: 'demo_hash_serra', tokenPrefix: 'vx_demo1', label: 'Alta inicial',
  });

  const serraDevs = await db.insert(schema.devices).values([
    { organizationId: org.id, clientId: serra.id, siteId: serraSede1.id, hostname: 'SRV-CLINICA',  status: 'active', deviceTypeHint: 'server', credentialHash: 'demo1', lastSeenAt: minsAgo(25), agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: serra.id, siteId: serraSede1.id, hostname: 'PC-RECEPCION', status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo2', lastSeenAt: minsAgo(2),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: serra.id, siteId: serraSede1.id, hostname: 'PC-CONSULTA1', status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo3', lastSeenAt: minsAgo(3),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: serra.id, siteId: serraSede1.id, hostname: 'PC-CONSULTA2', status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo4', lastSeenAt: minsAgo(4),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: serra.id, siteId: serraSede2.id, hostname: 'SRV-NORTE',    status: 'active', deviceTypeHint: 'server', credentialHash: 'demo5', lastSeenAt: minsAgo(7),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: serra.id, siteId: serraSede2.id, hostname: 'PC-NORTE1',    status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo6', lastSeenAt: minsAgo(5),  agentVersion: '1.0.0' },
  ]).returning();

  const serraDcsData = [
    // SRV-CLINICA: disco crítico, AV problema, actualizaciones 51d
    {
      cpuAvgPct: 72, memoryUsedAvgPct: 68, ramTotalBytes: gb(32),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 200, 98), vol('D:', 'Datos', 2000, 60)]),
      antivirus: JSON.stringify(avState('ESET Server Security', false, false)),
      osInfo:    JSON.stringify(osInfoState('Windows Server 2019', '17763.4252', 'HP')),
      network:   JSON.stringify(networkState('192.168.1.10', 1000)),
      windowsUpdate: JSON.stringify(wuState(51, 5)),
      agentVersion: '1.0.0', agentMemBytes: mb(28),
    },
    // PC-RECEPCION: ok
    {
      cpuAvgPct: 20, memoryUsedAvgPct: 45, ramTotalBytes: gb(8),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 500, 55), vol('E:', 'Backups', 1000, 30)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows 11 Pro', '22621.2715', 'Dell')),
      network:   JSON.stringify(networkState('192.168.1.21', 100)),
      windowsUpdate: JSON.stringify(wuState(10, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(22),
      loggedOnUser: 'CLINICA\\recepcion',
    },
    // PC-CONSULTA1: ok
    {
      cpuAvgPct: 15, memoryUsedAvgPct: 38, ramTotalBytes: gb(16),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 256, 60)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows 11 Pro', '22621.2715', 'HP')),
      network:   JSON.stringify(networkState('192.168.1.22', 100)),
      windowsUpdate: JSON.stringify(wuState(8, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(20),
    },
    // PC-CONSULTA2: ok
    {
      cpuAvgPct: 10, memoryUsedAvgPct: 30, ramTotalBytes: gb(16),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 256, 45)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows 11 Pro', '22621.2715', 'Lenovo')),
      network:   JSON.stringify(networkState('192.168.1.23', 100)),
      windowsUpdate: JSON.stringify(wuState(5, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(20),
    },
    // SRV-NORTE: actualizaciones 48d
    {
      cpuAvgPct: 55, memoryUsedAvgPct: 72, ramTotalBytes: gb(64),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 500, 70), vol('D:', 'BBDD', 4000, 55)]),
      antivirus: JSON.stringify(avState('ESET Server Security', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows Server 2022', '20348.2113', 'HP')),
      network:   JSON.stringify(networkState('192.168.2.10', 1000)),
      windowsUpdate: JSON.stringify(wuState(48, 2)),
      agentVersion: '1.0.0', agentMemBytes: mb(32),
    },
    // PC-NORTE1: ok
    {
      cpuAvgPct: 25, memoryUsedAvgPct: 40, ramTotalBytes: gb(8),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 256, 50)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows 10 Pro', '19045.3570', 'HP')),
      network:   JSON.stringify(networkState('192.168.2.21', 100)),
      windowsUpdate: JSON.stringify(wuState(12, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(18),
    },
  ];

  for (let i = 0; i < serraDevs.length; i++) {
    const d = serraDevs[i]; const s = serraDcsData[i];
    await db.insert(schema.deviceCurrentState).values({
      deviceId: d.id, organizationId: org.id,
      cpuAvgPct: s.cpuAvgPct, memoryUsedAvgPct: s.memoryUsedAvgPct, ramTotalBytes: s.ramTotalBytes,
      volumes: s.volumes, antivirus: s.antivirus, osInfo: s.osInfo, network: s.network,
      windowsUpdate: s.windowsUpdate, agentVersion: s.agentVersion, agentMemBytes: s.agentMemBytes,
      loggedOnUser: (s as { loggedOnUser?: string }).loggedOnUser ?? null,
      lastDailyAt: daysAgo(1), updatedAt: new Date(),
    });
    // dailyReport
    await db.insert(schema.dailyReports).values({
      deviceId: d.id, organizationId: org.id, collectedAt: daysAgo(1),
      physicalDisks: JSON.stringify([{ model: 'Samsung 870 EVO 1TB', health: 'Healthy', predict_failure: false, type: 'SSD' }]),
      windowsUpdate: s.windowsUpdate,
    });
    // eventos recientes
    await db.insert(schema.agentEvents).values([
      { deviceId: d.id, organizationId: org.id, eventType: 'system_boot', occurredAt: daysAgo(1), data: JSON.stringify({}) },
    ]);
  }

  // ── Despacho Martí ─────────────────────────────────────────────────────────
  const [marti] = await db.insert(schema.clients)
    .values({ organizationId: org.id, name: 'Despacho Martí' }).returning();

  const [martiSede] = await db.insert(schema.sites)
    .values({ organizationId: org.id, clientId: marti.id, name: 'Oficina Central' }).returning();

  await db.insert(schema.enrollmentTokens).values({
    organizationId: org.id, clientId: marti.id, siteId: martiSede.id,
    tokenHash: 'demo_hash_marti', tokenPrefix: 'vx_demo2', label: 'Alta inicial',
  });

  const martiDevs = await db.insert(schema.devices).values([
    { organizationId: org.id, clientId: marti.id, siteId: martiSede.id, hostname: 'SRV-MARTI',    status: 'active', deviceTypeHint: 'server', credentialHash: 'demo7', lastSeenAt: minsAgo(8),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: marti.id, siteId: martiSede.id, hostname: 'PC-ADMIN',     status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo8', lastSeenAt: minsAgo(6),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: marti.id, siteId: martiSede.id, hostname: 'PC-RECEP',     status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demo9', lastSeenAt: daysAgo(4),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: marti.id, siteId: martiSede.id, hostname: 'LAPTOP-MARTI', status: 'active', deviceTypeHint: 'laptop', credentialHash: 'demoA', lastSeenAt: minsAgo(10), agentVersion: '1.0.0' },
  ]).returning();

  const martiDcsData = [
    // SRV-MARTI: ok
    {
      cpuAvgPct: 35, memoryUsedAvgPct: 60, ramTotalBytes: gb(32),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 500, 65), vol('D:', 'Datos', 2000, 40)]),
      antivirus: JSON.stringify(avState('ESET Server Security', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows Server 2022', '20348.2113', 'Dell')),
      network:   JSON.stringify(networkState('10.0.1.10', 1000)),
      windowsUpdate: JSON.stringify(wuState(10, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(30),
    },
    // PC-ADMIN: ok
    {
      cpuAvgPct: 18, memoryUsedAvgPct: 50, ramTotalBytes: gb(16),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 500, 50)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows 11 Pro', '22621.2715', 'Dell')),
      network:   JSON.stringify(networkState('10.0.1.21', 100)),
      windowsUpdate: JSON.stringify(wuState(7, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(20),
      loggedOnUser: 'MARTI\\admin',
    },
    // PC-RECEP: disco al 93 %, sin reportar 4 días
    {
      cpuAvgPct: null, memoryUsedAvgPct: null, ramTotalBytes: gb(8),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 500, 93)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, false)),
      osInfo:    JSON.stringify(osInfoState('Windows 10 Pro', '19045.3570', 'Lenovo')),
      network:   JSON.stringify(networkState('10.0.1.22', 100)),
      windowsUpdate: JSON.stringify(wuState(60, 8)),
      agentVersion: '1.0.0', agentMemBytes: mb(18),
    },
    // LAPTOP-MARTI: batería
    {
      cpuAvgPct: 30, memoryUsedAvgPct: 55, ramTotalBytes: gb(16),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 512, 60)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows 11 Pro', '22621.2715', 'Dell')),
      network:   JSON.stringify(networkState('10.0.1.30', 100)),
      windowsUpdate: JSON.stringify(wuState(15, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(22),
      onBattery: true, loggedOnUser: 'MARTI\\jmarti',
    },
  ];

  for (let i = 0; i < martiDevs.length; i++) {
    const d = martiDevs[i]; const s = martiDcsData[i];
    await db.insert(schema.deviceCurrentState).values({
      deviceId: d.id, organizationId: org.id,
      cpuAvgPct: s.cpuAvgPct ?? null, memoryUsedAvgPct: s.memoryUsedAvgPct ?? null, ramTotalBytes: s.ramTotalBytes,
      volumes: s.volumes, antivirus: s.antivirus, osInfo: s.osInfo, network: s.network,
      windowsUpdate: s.windowsUpdate, agentVersion: s.agentVersion, agentMemBytes: s.agentMemBytes,
      loggedOnUser: (s as { loggedOnUser?: string }).loggedOnUser ?? null,
      onBattery:    (s as { onBattery?: boolean }).onBattery ?? null,
      lastDailyAt: daysAgo(1), updatedAt: new Date(),
    });
    await db.insert(schema.dailyReports).values({
      deviceId: d.id, organizationId: org.id, collectedAt: daysAgo(1),
      physicalDisks: JSON.stringify([{ model: 'WD Blue 500GB', health: 'Healthy', predict_failure: false, type: 'HDD' }]),
      windowsUpdate: s.windowsUpdate,
    });
    await db.insert(schema.agentEvents).values([
      { deviceId: d.id, organizationId: org.id, eventType: 'system_boot', occurredAt: daysAgo(2), data: JSON.stringify({}) },
    ]);
    if (d.deviceTypeHint === 'laptop') {
      await db.insert(schema.agentEvents).values({
        deviceId: d.id, organizationId: org.id, eventType: 'system_shutdown', occurredAt: d.lastSeenAt!, data: JSON.stringify({ reason: 'normal_shutdown' }),
      });
    }
  }

  // ── Transportes Vall ───────────────────────────────────────────────────────
  const [vall] = await db.insert(schema.clients)
    .values({ organizationId: org.id, name: 'Transportes Vall' }).returning();

  const [vallSede] = await db.insert(schema.sites)
    .values({ organizationId: org.id, clientId: vall.id, name: 'Sede Logística' }).returning();

  await db.insert(schema.enrollmentTokens).values({
    organizationId: org.id, clientId: vall.id, siteId: vallSede.id,
    tokenHash: 'demo_hash_vall', tokenPrefix: 'vx_demo3', label: 'Alta inicial',
  });

  const vallDevs = await db.insert(schema.devices).values([
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'SRV-VALL',    status: 'active', deviceTypeHint: 'server', credentialHash: 'demoB', lastSeenAt: minsAgo(5),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'PC-OFICINA1', status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demoC', lastSeenAt: minsAgo(3),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'PC-OFICINA2', status: 'active', deviceTypeHint: 'pc',     credentialHash: 'demoD', lastSeenAt: minsAgo(4),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'LAPTOP-VAL1', status: 'active', deviceTypeHint: 'laptop', credentialHash: 'demoE', lastSeenAt: daysAgo(1),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'LAPTOP-VAL2', status: 'active', deviceTypeHint: 'laptop', credentialHash: 'demoF', lastSeenAt: daysAgo(2),  agentVersion: '1.0.0' },
    { organizationId: org.id, clientId: vall.id, siteId: vallSede.id, hostname: 'LAPTOP-VAL3', status: 'active', deviceTypeHint: 'laptop', credentialHash: 'demoG', lastSeenAt: daysAgo(3),  agentVersion: '1.0.0' },
  ]).returning();

  const vallDcsData = [
    // SRV-VALL: ok
    {
      cpuAvgPct: 42, memoryUsedAvgPct: 55, ramTotalBytes: gb(64),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 1000, 45), vol('D:', 'Backups', 8000, 30)]),
      antivirus: JSON.stringify(avState('ESET Server Security', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows Server 2019', '17763.4252')),
      network:   JSON.stringify(networkState('172.16.0.10', 1000)),
      windowsUpdate: JSON.stringify(wuState(20, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(35),
    },
    // PC-OFICINA1: ok
    {
      cpuAvgPct: 22, memoryUsedAvgPct: 48, ramTotalBytes: gb(8),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 256, 55)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows 10 Pro', '19045.3570')),
      network:   JSON.stringify(networkState('172.16.0.21', 100)),
      windowsUpdate: JSON.stringify(wuState(14, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(19),
    },
    // PC-OFICINA2: ok
    {
      cpuAvgPct: 18, memoryUsedAvgPct: 42, ramTotalBytes: gb(8),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 256, 48)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows 10 Pro', '19045.3570')),
      network:   JSON.stringify(networkState('172.16.0.22', 100)),
      windowsUpdate: JSON.stringify(wuState(14, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(19),
    },
    // LAPTOP-VAL1
    {
      cpuAvgPct: null, memoryUsedAvgPct: null, ramTotalBytes: gb(16),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 512, 65)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows 11 Pro', '22621.2715')),
      network:   JSON.stringify(networkState('172.16.0.30', 100)),
      windowsUpdate: JSON.stringify(wuState(5, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(21),
    },
    // LAPTOP-VAL2
    {
      cpuAvgPct: null, memoryUsedAvgPct: null, ramTotalBytes: gb(16),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 512, 60)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows 11 Pro', '22621.2715')),
      network:   JSON.stringify(networkState('172.16.0.31', 100)),
      windowsUpdate: JSON.stringify(wuState(5, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(21),
    },
    // LAPTOP-VAL3
    {
      cpuAvgPct: null, memoryUsedAvgPct: null, ramTotalBytes: gb(16),
      volumes:   JSON.stringify([vol('C:', 'Sistema', 512, 58)]),
      antivirus: JSON.stringify(avState('Windows Defender', true, true)),
      osInfo:    JSON.stringify(osInfoState('Windows 11 Pro', '22621.2715')),
      network:   JSON.stringify(networkState('172.16.0.32', 100)),
      windowsUpdate: JSON.stringify(wuState(5, 0)),
      agentVersion: '1.0.0', agentMemBytes: mb(21),
    },
  ];

  for (let i = 0; i < vallDevs.length; i++) {
    const d = vallDevs[i]; const s = vallDcsData[i];
    await db.insert(schema.deviceCurrentState).values({
      deviceId: d.id, organizationId: org.id,
      cpuAvgPct: s.cpuAvgPct ?? null, memoryUsedAvgPct: s.memoryUsedAvgPct ?? null, ramTotalBytes: s.ramTotalBytes,
      volumes: s.volumes, antivirus: s.antivirus, osInfo: s.osInfo, network: s.network,
      windowsUpdate: s.windowsUpdate, agentVersion: s.agentVersion, agentMemBytes: s.agentMemBytes,
      lastDailyAt: daysAgo(1), updatedAt: new Date(),
    });
    await db.insert(schema.dailyReports).values({
      deviceId: d.id, organizationId: org.id, collectedAt: daysAgo(1),
      physicalDisks: JSON.stringify([{ model: 'Samsung 870 EVO 500GB', health: 'Healthy', predict_failure: false, type: 'SSD' }]),
      windowsUpdate: s.windowsUpdate,
    });
    // Todos los dispositivos tienen boot reciente; laptops además tienen shutdown
    await db.insert(schema.agentEvents).values({
      deviceId: d.id, organizationId: org.id, eventType: 'system_boot', occurredAt: daysAgo(d.deviceTypeHint === 'laptop' ? 1 : 0.1), data: JSON.stringify({}),
    });
    if (d.deviceTypeHint === 'laptop') {
      await db.insert(schema.agentEvents).values({
        deviceId: d.id, organizationId: org.id, eventType: 'system_shutdown', occurredAt: d.lastSeenAt!, data: JSON.stringify({ reason: 'normal_shutdown' }),
      });
    }
  }

  // ── Métricas 5min últimos 7 días ────────────────────────────────────────────
  const allDevs = [...serraDevs, ...martiDevs, ...vallDevs];
  const activeDevs = allDevs.filter(d => d.lastSeenAt && (Date.now() - d.lastSeenAt.getTime()) < 15 * 60_000);

  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    for (const dev of activeDevs) {
      const periodStart = new Date(Date.now() - dayOffset * 86_400_000 - 5 * 60_000);
      const periodEnd   = new Date(periodStart.getTime() + 5 * 60_000);
      await db.insert(schema.metrics5min).values({
        deviceId: dev.id, organizationId: org.id,
        periodStart, periodEnd, samples: 5,
        cpuAvgPct: Math.random() * 30 + 5,
        cpuMaxPct: Math.random() * 60 + 20,
        memoryUsedAvgPct: Math.random() * 40 + 20,
        memoryUsedMaxPct: Math.random() * 60 + 30,
      }).onConflictDoNothing();
    }
  }

  console.log(`✔  Clínica Serra:     ${serraDevs.length} dispositivos (SRV-CLINICA: AV+discos críticos; SRV-NORTE: actualizaciones 48d)`);
  console.log(`✔  Despacho Martí:    ${martiDevs.length} dispositivos (PC-RECEP: 93 % disco, AV desactualizado)`);
  console.log(`✔  Transportes Vall:  ${vallDevs.length} dispositivos (laptops apagadas normalmente, estado ok)`);
  console.log('\n✅  Datos de demo creados. Ejecuta npm run dev para ver el panel.');

  await sql.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
