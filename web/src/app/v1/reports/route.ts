import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gunzip } from 'zlib';
import { db } from '@/db';
import {
  devices,
  deviceCurrentState,
  metrics5min,
  dailyReports,
  inventorySnapshots,
  agentEvents,
} from '@/db/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { authenticateDevice } from '@/lib/device-auth';
import {
  reportEnvelopeSchema,
  MetricsReport,
  StatusReport,
  DailyReport,
  InventoryReport,
  EventReport,
} from '@/validators/reports';

const gunzipAsync = promisify(gunzip);

function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return null;
}

async function readBody(req: NextRequest): Promise<unknown> {
  const encoding = req.headers.get('content-encoding');
  if (encoding === 'gzip') {
    const buf = Buffer.from(await req.arrayBuffer());
    const decompressed = await gunzipAsync(buf);
    return JSON.parse(decompressed.toString('utf8'));
  }
  return req.json();
}

// ---------------------------------------------------------------------------
// Procesadores por tipo de informe
// ---------------------------------------------------------------------------

async function processMetrics(deviceId: string, orgId: string, r: MetricsReport) {
  await db
    .insert(metrics5min)
    .values({
      deviceId,
      organizationId: orgId,
      periodStart:        new Date(r.period_start),
      periodEnd:          new Date(r.period_end),
      samples:            r.samples,
      cpuAvgPct:          r.cpu.avg_pct,
      cpuMaxPct:          r.cpu.max_pct,
      memoryUsedAvgPct:   r.memory.used_avg_pct,
      memoryUsedMaxPct:   r.memory.used_max_pct,
      ramTotalBytes:      r.memory.total_bytes,
      volumes:            r.volumes ?? null,
      services:           r.services ?? null,
      uptimeSecs:         r.uptime_seconds ?? null,     // campo real del agente
      agentCpuPct:        r.agent?.cpu_avg_pct ?? null, // campo real del agente
      agentMemBytes:      r.agent?.mem_bytes ?? null,
    })
    .onConflictDoNothing();

  await db
    .insert(deviceCurrentState)
    .values({
      deviceId,
      organizationId:   orgId,
      cpuAvgPct:        r.cpu.avg_pct,
      cpuMaxPct:        r.cpu.max_pct,
      memoryUsedAvgPct: r.memory.used_avg_pct,
      memoryUsedMaxPct: r.memory.used_max_pct,
      ramTotalBytes:    r.memory.total_bytes,
      volumes:          r.volumes ?? null,
      services:         r.services ?? null,
      uptimeSecs:       r.uptime_seconds ?? null,
      agentCpuPct:      r.agent?.cpu_avg_pct ?? null,
      agentMemBytes:    r.agent?.mem_bytes ?? null,
      lastMetricsAt:    new Date(r.period_end),
      lastReportAt:     new Date(),
      updatedAt:        new Date(),
    })
    .onConflictDoUpdate({
      target: deviceCurrentState.deviceId,
      set: {
        cpuAvgPct:        sql`excluded.cpu_avg_pct`,
        cpuMaxPct:        sql`excluded.cpu_max_pct`,
        memoryUsedAvgPct: sql`excluded.memory_used_avg_pct`,
        memoryUsedMaxPct: sql`excluded.memory_used_max_pct`,
        ramTotalBytes:    sql`excluded.ram_total_bytes`,
        volumes:          sql`excluded.volumes`,
        services:         sql`excluded.services`,
        uptimeSecs:       sql`excluded.uptime_secs`,
        agentCpuPct:      sql`excluded.agent_cpu_pct`,
        agentMemBytes:    sql`excluded.agent_mem_bytes`,
        lastMetricsAt:    sql`excluded.last_metrics_at`,
        lastReportAt:     sql`excluded.last_report_at`,
        updatedAt:        sql`excluded.updated_at`,
      },
    });
}

async function processStatus(
  deviceId: string,
  orgId: string,
  r: StatusReport,
  storedHash: string | null,
): Promise<boolean> {
  const hashChanged =
    r.inventory_hash != null && r.inventory_hash !== storedHash;

  await db
    .insert(deviceCurrentState)
    .values({
      deviceId,
      organizationId:       orgId,
      lastBootAt:           r.last_boot_at ? new Date(r.last_boot_at) : null,
      rebootPending:        r.reboot_pending ?? null,
      rebootPendingReasons: r.reboot_pending_reasons ?? null,
      antivirus:            r.antivirus ?? null,
      loggedOnUser:         r.logged_on_user ?? null,
      network:              r.network ?? null,
      meteredConnection:    r.metered_connection ?? null,
      onBattery:            r.on_battery ?? null,
      inventoryHash:        r.inventory_hash ?? null,
      lastStatusAt:         new Date(r.collected_at),
      lastReportAt:         new Date(),
      updatedAt:            new Date(),
    })
    .onConflictDoUpdate({
      target: deviceCurrentState.deviceId,
      set: {
        lastBootAt:           sql`excluded.last_boot_at`,
        rebootPending:        sql`excluded.reboot_pending`,
        rebootPendingReasons: sql`excluded.reboot_pending_reasons`,
        antivirus:            sql`excluded.antivirus`,
        loggedOnUser:         sql`excluded.logged_on_user`,
        network:              sql`excluded.network`,
        meteredConnection:    sql`excluded.metered_connection`,
        onBattery:            sql`excluded.on_battery`,
        inventoryHash:        sql`excluded.inventory_hash`,
        lastStatusAt:         sql`excluded.last_status_at`,
        lastReportAt:         sql`excluded.last_report_at`,
        updatedAt:            sql`excluded.updated_at`,
      },
    });

  return hashChanged;
}

async function processDaily(deviceId: string, orgId: string, r: DailyReport) {
  await db.insert(dailyReports).values({
    deviceId,
    organizationId: orgId,
    collectedAt:    new Date(r.collected_at),
    physicalDisks:  r.physical_disks ?? null,
    windowsUpdate:  r.windows_update ?? null,
  }).onConflictDoNothing();

  await db
    .insert(deviceCurrentState)
    .values({
      deviceId,
      organizationId: orgId,
      physicalDisks:  r.physical_disks ?? null,
      windowsUpdate:  r.windows_update ?? null,
      lastDailyAt:    new Date(r.collected_at),
      lastReportAt:   new Date(),
      updatedAt:      new Date(),
    })
    .onConflictDoUpdate({
      target: deviceCurrentState.deviceId,
      set: {
        physicalDisks: sql`excluded.physical_disks`,
        windowsUpdate: sql`excluded.windows_update`,
        lastDailyAt:   sql`excluded.last_daily_at`,
        lastReportAt:  sql`excluded.last_report_at`,
        updatedAt:     sql`excluded.updated_at`,
      },
    });
}

// inventory no tiene collected_at propio; se usa sent_at del sobre
async function processInventory(
  deviceId: string,
  orgId: string,
  r: InventoryReport,
  sentAt: string,
) {
  // Solo guardar snapshot nuevo si el hash difiere del ÚLTIMO guardado para
  // este dispositivo. Un índice único (device_id, hash) rechazaría A→B→A,
  // así que la deduplicación se hace a nivel de aplicación.
  const latestSnapshot = await db
    .select({ hash: inventorySnapshots.hash })
    .from(inventorySnapshots)
    .where(eq(inventorySnapshots.deviceId, deviceId))
    .orderBy(desc(inventorySnapshots.createdAt))
    .limit(1);

  if (!latestSnapshot.length || latestSnapshot[0].hash !== r.hash) {
    await db.insert(inventorySnapshots).values({
      deviceId,
      organizationId:   orgId,
      collectedAt:      new Date(sentAt),
      hash:             r.hash,
      systemInfo:       r.system ?? null,
      cpuInfo:          r.cpu ?? null,
      memoryTotalBytes: r.memory_total_bytes ?? null,
      osInfo:           r.os ?? null,
      physicalDisks:    r.physical_disks ?? null,
    });
  }

  await db
    .insert(deviceCurrentState)
    .values({
      deviceId,
      organizationId:  orgId,
      osInfo:          r.os ?? null,
      inventoryHash:   r.hash,
      lastInventoryAt: new Date(sentAt),
      lastReportAt:    new Date(),
      updatedAt:       new Date(),
    })
    .onConflictDoUpdate({
      target: deviceCurrentState.deviceId,
      set: {
        osInfo:          sql`excluded.os_info`,
        inventoryHash:   sql`excluded.inventory_hash`,
        lastInventoryAt: sql`excluded.last_inventory_at`,
        lastReportAt:    sql`excluded.last_report_at`,
        updatedAt:       sql`excluded.updated_at`,
      },
    });
}

async function processEvent(
  deviceId: string,
  orgId: string,
  r: EventReport,
): Promise<void> {
  await db
    .insert(agentEvents)
    .values({
      deviceId,
      organizationId: orgId,
      eventType:      r.event,
      occurredAt:     new Date(r.occurred_at),
      data:           r.data ?? null,
    })
    .onConflictDoNothing();

  const eventData = r.data as { reason?: string } | undefined;
  if (r.event === 'uninstall' && eventData?.reason === 'manual') {
    await db
      .update(devices)
      .set({ status: 'uninstalled', uninstalledAt: new Date(r.occurred_at) })
      .where(eq(devices.id, deviceId));
  }
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const device = await authenticateDevice(req);
  if (!device) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await readBody(req);
  } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 });
  }

  const parsed = reportEnvelopeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'esquema inválido', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const envelope = parsed.data;
  const publicIp = getClientIp(req);

  // Leer estado actual para calcular request_inventory al final
  const stateRows = await db
    .select({
      lastInventoryAt: deviceCurrentState.lastInventoryAt,
      inventoryHash:   deviceCurrentState.inventoryHash,
    })
    .from(deviceCurrentState)
    .where(eq(deviceCurrentState.deviceId, device.id))
    .limit(1);

  const currentState = stateRows[0] ?? null;
  let requestInventory = !currentState || currentState.lastInventoryAt === null;
  let inventoryProcessed = false;

  for (const report of envelope.reports) {
    switch (report.type) {
      case 'metrics':
        await processMetrics(device.id, device.organizationId, report);
        break;

      case 'status': {
        const hashChanged = await processStatus(
          device.id,
          device.organizationId,
          report,
          currentState?.inventoryHash ?? null,
        );
        if (hashChanged) requestInventory = true;
        break;
      }

      case 'daily':
        await processDaily(device.id, device.organizationId, report);
        break;

      case 'inventory':
        await processInventory(device.id, device.organizationId, report, envelope.sent_at);
        inventoryProcessed = true;
        break;

      case 'event':
        await processEvent(device.id, device.organizationId, report);
        break;
    }
  }

  // Si en este mismo lote vino un inventory, ya no hace falta pedirlo
  if (inventoryProcessed) requestInventory = false;

  // Actualizar IP pública y versión del agente en el dispositivo
  await db
    .update(devices)
    .set({
      publicIp:     publicIp,
      agentVersion: envelope.agent_version ?? null,
    })
    .where(eq(devices.id, device.id));

  return NextResponse.json({
    accepted:          envelope.reports.length,
    config_version:    device.configVersion,
    request_inventory: requestInventory,
  });
}
