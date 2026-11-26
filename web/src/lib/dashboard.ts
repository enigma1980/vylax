import { db } from '@/db';
import { devices, deviceCurrentState, clients, sites, metrics5min, agentEvents, inventorySnapshots } from '@/db/schema';
import { eq, and, ne, count, isNotNull, sql, inArray, desc, gte } from 'drizzle-orm';
import {
  classifyDevice,
  clientSemaphore,
  effectiveDeviceType,
  type DeviceStatus,
  type SemaphoreLevel,
} from '@/lib/device-status';

export interface ClientOverview {
  id:        string;
  name:      string;
  sites:     number;
  online:    number;
  total:     number;
  servers:   number;
  pcs:       number;
  laptops:   number;
  semaphore: SemaphoreLevel;
  reason:    string;
}

export interface DiskEntry {
  hostname: string;
  mount:    string;
  usedPct:  number;
  freeGb:   number;
  totalGb:  number;
}

export interface DayCount {
  day:   string;
  count: number;
}

export interface OverviewData {
  totalDevices: number;
  onlineCount:  number;
  noRepCount:   number;
  pendingCount: number;
  clientList:   ClientOverview[];
  updatePct:    number;
  atDay:        number;
  withDaily:    number;
  dayCountArr:  DayCount[];
  disks:        DiskEntry[];
}

const SEM_ORDER: Record<SemaphoreLevel, number> = { crit: 0, warn: 1, ok: 2 };

export async function getClientList(orgId: string): Promise<ClientOverview[]> {
  const now = new Date();

  const allClients = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.organizationId, orgId))
    .orderBy(clients.name);

  if (allClients.length === 0) return [];

  const clientIds = allClients.map(c => c.id);

  const [activeRows, latestEventsRaw, siteCounts] = await Promise.all([
    db
      .select({
        id:             devices.id,
        hostname:       devices.hostname,
        deviceType:     devices.deviceType,
        deviceTypeHint: devices.deviceTypeHint,
        lastSeenAt:     devices.lastSeenAt,
        clientId:       devices.clientId,
      })
      .from(devices)
      .where(
        and(
          eq(devices.organizationId, orgId),
          ne(devices.status, 'uninstalled'),
          ne(devices.status, 'pending_assignment'),
          inArray(devices.clientId, clientIds),
        ),
      ),

    db.execute<{ device_id: string; event_type: string }>(sql`
      SELECT DISTINCT ON (device_id) device_id, event_type
      FROM agent_events
      WHERE organization_id = ${orgId}
      ORDER BY device_id, occurred_at DESC
    `),

    db
      .select({ clientId: sites.clientId, cnt: count() })
      .from(sites)
      .where(inArray(sites.clientId, clientIds))
      .groupBy(sites.clientId),
  ]);

  const eventMap = new Map(
    (latestEventsRaw as Array<{ device_id: string; event_type: string }>)
      .map(r => [r.device_id, r.event_type]),
  );

  const classified = activeRows.map(row => {
    const effType = effectiveDeviceType(row);
    return {
      ...row,
      effType,
      status: classifyDevice(row.lastSeenAt, effType, eventMap.get(row.id) ?? null, now),
    };
  });

  const devicesByClient = new Map<string, typeof classified>();
  for (const d of classified) {
    if (!d.clientId) continue;
    if (!devicesByClient.has(d.clientId)) devicesByClient.set(d.clientId, []);
    devicesByClient.get(d.clientId)!.push(d);
  }

  const siteCountMap = new Map(siteCounts.map(r => [r.clientId, Number(r.cnt)]));

  const list = allClients.map(c => {
    const devs      = devicesByClient.get(c.id) ?? [];
    const online    = devs.filter(d => d.status === 'online').length;
    const total     = devs.length;
    const semaphore = clientSemaphore(devs.map(d => ({ status: d.status as DeviceStatus, type: d.effType })));
    const noRepDevs = devs.filter(d => d.status === 'no_report');
    const reason    = total === 0
      ? 'Sin equipos'
      : noRepDevs.length > 0
        ? `${noRepDevs[0].hostname} sin reportar`
        : 'Sin incidencias';

    return {
      id:      c.id,
      name:    c.name,
      sites:   siteCountMap.get(c.id) ?? 0,
      online,
      total,
      servers: devs.filter(d => d.effType === 'server').length,
      pcs:     devs.filter(d => d.effType === 'pc').length,
      laptops: devs.filter(d => d.effType === 'laptop').length,
      semaphore,
      reason,
    };
  });

  list.sort((a, b) => SEM_ORDER[a.semaphore] - SEM_ORDER[b.semaphore]);
  return list;
}

export async function getOverviewData(orgId: string): Promise<OverviewData> {
  const now = new Date();

  const [activeRows, pendingResult, latestEventsRaw, dayCountsRaw, disksRaw] =
    await Promise.all([
      db
        .select({
          id:             devices.id,
          hostname:       devices.hostname,
          deviceType:     devices.deviceType,
          deviceTypeHint: devices.deviceTypeHint,
          lastSeenAt:     devices.lastSeenAt,
          clientId:       devices.clientId,
          lastDailyAt:    deviceCurrentState.lastDailyAt,
          windowsUpdate:  deviceCurrentState.windowsUpdate,
        })
        .from(devices)
        .leftJoin(deviceCurrentState, eq(devices.id, deviceCurrentState.deviceId))
        .where(
          and(
            eq(devices.organizationId, orgId),
            ne(devices.status, 'uninstalled'),
            ne(devices.status, 'pending_assignment'),
          ),
        ),

      db
        .select({ n: count() })
        .from(devices)
        .where(
          and(
            eq(devices.organizationId, orgId),
            eq(devices.status, 'pending_assignment'),
          ),
        ),

      db.execute<{ device_id: string; event_type: string }>(sql`
        SELECT DISTINCT ON (device_id) device_id, event_type
        FROM agent_events
        WHERE organization_id = ${orgId}
        ORDER BY device_id, occurred_at DESC
      `),

      db.execute<{ day: string; count: string }>(sql`
        SELECT
          date_trunc('day', period_start)::date::text AS day,
          COUNT(DISTINCT device_id)::text             AS count
        FROM metrics_5min
        WHERE organization_id = ${orgId}
          AND period_start >= NOW() - INTERVAL '7 days'
        GROUP BY 1
        ORDER BY 1
      `),

      db.execute<{
        hostname:    string;
        mount:       string;
        used_bytes:  string;
        free_bytes:  string;
        total_bytes: string;
      }>(sql`
        SELECT
          d.hostname,
          v->>'mount'                              AS mount,
          (v->>'used_bytes')::bigint::text         AS used_bytes,
          (v->>'free_bytes')::bigint::text         AS free_bytes,
          (v->>'total_bytes')::bigint::text        AS total_bytes
        FROM device_current_state dcs
        JOIN devices d ON d.id = dcs.device_id
        CROSS JOIN LATERAL jsonb_array_elements(dcs.volumes) v
        WHERE dcs.organization_id = ${orgId}
          AND d.organization_id   = ${orgId}
          AND dcs.volumes IS NOT NULL
          AND jsonb_typeof(dcs.volumes) = 'array'
          AND (v->>'total_bytes')::bigint > 0
        ORDER BY
          (v->>'free_bytes')::float / (v->>'total_bytes')::float ASC
        LIMIT 5
      `),
    ]);

  const pendingCount = Number(pendingResult[0]?.n ?? 0);

  const eventMap = new Map(
    (latestEventsRaw as Array<{ device_id: string; event_type: string }>)
      .map(r => [r.device_id, r.event_type]),
  );

  const classified = activeRows.map(row => {
    const effType = effectiveDeviceType(row);
    return {
      ...row,
      effType,
      status: classifyDevice(row.lastSeenAt, effType, eventMap.get(row.id) ?? null, now),
    };
  });

  const totalDevices = classified.length;
  const onlineCount  = classified.filter(d => d.status === 'online').length;
  const noRepCount   = classified.filter(d => d.status === 'no_report').length;

  // Update ring
  const dailyDevices = classified.filter(d => d.lastDailyAt != null);
  const withDaily    = dailyDevices.length;
  const atDay        = dailyDevices.filter(d => {
    const wu = d.windowsUpdate as { days_since_last?: number } | null;
    return wu != null && typeof wu.days_since_last === 'number' && wu.days_since_last <= 45;
  }).length;
  const updatePct = withDaily > 0 ? Math.round((atDay / withDaily) * 100) : 0;

  // 7-day chart
  const dayCountArr: DayCount[] = (
    dayCountsRaw as Array<{ day: string; count: string }>
  ).map(r => ({ day: r.day, count: Number(r.count) }));

  // Disks
  const disks: DiskEntry[] = (
    disksRaw as Array<{
      hostname: string; mount: string;
      used_bytes: string; free_bytes: string; total_bytes: string;
    }>
  ).map(r => {
    const total = Number(r.total_bytes);
    const used  = Number(r.used_bytes);
    const free  = Number(r.free_bytes);
    return {
      hostname: r.hostname,
      mount:    r.mount,
      usedPct:  total > 0 ? Math.round((used / total) * 100) : 0,
      freeGb:   Math.round((free  / 1_073_741_824) * 10) / 10,
      totalGb:  Math.round((total / 1_073_741_824) * 10) / 10,
    };
  });

  // Client list
  const clientDeviceMap = new Map<string, typeof classified>();
  for (const d of classified) {
    const cid = d.clientId ?? '__none__';
    if (!clientDeviceMap.has(cid)) clientDeviceMap.set(cid, []);
    clientDeviceMap.get(cid)!.push(d);
  }

  const clientIds = [...clientDeviceMap.keys()].filter(id => id !== '__none__');
  let clientList: ClientOverview[] = [];

  if (clientIds.length > 0) {
    const [clientRows, siteCounts] = await Promise.all([
      db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(inArray(clients.id, clientIds)),
      db
        .select({ clientId: sites.clientId, cnt: count() })
        .from(sites)
        .where(inArray(sites.clientId, clientIds))
        .groupBy(sites.clientId),
    ]);

    const siteCountMap = new Map(
      siteCounts.map(r => [r.clientId, Number(r.cnt)]),
    );

    clientList = clientRows.map(c => {
      const devs       = clientDeviceMap.get(c.id) ?? [];
      const online     = devs.filter(d => d.status === 'online').length;
      const total      = devs.length;
      const semaphore  = clientSemaphore(devs.map(d => ({ status: d.status as DeviceStatus, type: d.effType })));
      const noRepDevs  = devs.filter(d => d.status === 'no_report');
      const reason     = noRepDevs.length > 0 ? `${noRepDevs[0].hostname} sin reportar` : 'Sin incidencias';

      return {
        id:      c.id,
        name:    c.name,
        sites:   siteCountMap.get(c.id) ?? 0,
        online,
        total,
        servers: devs.filter(d => d.effType === 'server').length,
        pcs:     devs.filter(d => d.effType === 'pc').length,
        laptops: devs.filter(d => d.effType === 'laptop').length,
        semaphore,
        reason,
      };
    });

    clientList.sort((a, b) => SEM_ORDER[a.semaphore] - SEM_ORDER[b.semaphore]);
  }

  return {
    totalDevices,
    onlineCount,
    noRepCount,
    pendingCount,
    clientList,
    updatePct,
    atDay,
    withDaily,
    dayCountArr,
    disks,
  };
}

// ---------------------------------------------------------------------------
// Vista de cliente: tipos e interfaces
// ---------------------------------------------------------------------------

export interface ClientDetail {
  id:          string;
  name:        string;
  sites:       Array<{ id: string; name: string }>;
  deviceCount: number;
}

export interface DeviceEvent {
  eventType:  string;
  occurredAt: string;
}

export interface DeviceRow {
  id:               string;
  hostname:         string;
  status:           DeviceStatus;
  effType:          string | null;
  deviceType:       string | null;
  deviceTypeHint:   string | null;
  siteId:           string | null;
  lastSeenAt:       string | null;
  // State
  osName:           string | null;
  osBuild:          string | null;
  manufacturer:     string | null;
  cpuAvgPct:        number | null;
  memoryUsedAvgPct: number | null;
  ramTotalBytes:    number | null;
  volumes:          Array<{ mount: string; label?: string; free_bytes: number; total_bytes: number }> | null;
  antivirus:        Array<{ product: string; enabled: boolean; up_to_date: boolean }> | null;
  windowsUpdate:    { last_installed_at?: string; days_since_last?: number } | null;
  physicalDisks:    Array<{ serial: string; health: string; predict_failure: boolean }> | null;
  loggedOnUser:     string | null;
  agentVersion:     string | null;
  agentMemBytes:    number | null;
  network:          { adapters?: Array<{ name: string; ipv4?: string[]; link_speed_mbps?: number }> } | null;
  lastEvents:       DeviceEvent[];
}

export async function getClientDetail(orgId: string, clientId: string): Promise<ClientDetail | null> {
  const clientRecord = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.organizationId, orgId)),
  });
  if (!clientRecord) return null;

  const [siteRows, deviceCount] = await Promise.all([
    db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.clientId, clientId), eq(sites.organizationId, orgId)))
      .orderBy(sites.name),
    db
      .select({ n: count() })
      .from(devices)
      .where(and(
        eq(devices.clientId, clientId),
        eq(devices.organizationId, orgId),
        ne(devices.status, 'uninstalled'),
        ne(devices.status, 'pending_assignment'),
      )),
  ]);

  return {
    id:          clientRecord.id,
    name:        clientRecord.name,
    sites:       siteRows,
    deviceCount: Number(deviceCount[0]?.n ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Ficha del equipo
// ---------------------------------------------------------------------------

export interface DeviceDetail {
  id:               string;
  hostname:         string;
  status:           DeviceStatus;
  effType:          string | null;
  deviceType:       string | null;
  deviceTypeHint:   string | null;
  agentVersion:     string | null;
  createdAt:        string;
  clientId:         string | null;
  clientName:       string | null;
  siteId:           string | null;
  siteName:         string | null;
  lastSeenAt:       string | null;
  // estado actual
  osInfo:           { name?: string; build?: string; manufacturer?: string; install_date?: string } | null;
  cpuAvgPct:        number | null;
  memoryUsedAvgPct: number | null;
  ramTotalBytes:    number | null;
  volumes:          Array<{ mount: string; label?: string; free_bytes: number; total_bytes: number }> | null;
  antivirus:        Array<{ product: string; enabled: boolean; up_to_date: boolean }> | null;
  windowsUpdate:    { last_installed_at?: string; days_since_last?: number } | null;
  physicalDisks:    Array<{ model?: string; type?: string; serial?: string; health: string; predict_failure: boolean; temperature_c?: number; wear_pct?: number }> | null;
  loggedOnUser:     string | null;
  agentMemBytes:    number | null;
  agentCpuPct:      number | null;
  network:          { adapters?: Array<{ name: string; ipv4?: string[]; mac?: string; link_speed_mbps?: number; gateway?: string; dns?: string[] }> } | null;
  services:         Array<{ name: string; display_name?: string; status: string }> | null;
  uptimeSecs:       number | null;
  lastBootAt:       string | null;
  rebootPending:    boolean | null;
  // inventario
  systemInfo:       { manufacturer?: string; model?: string; bios_version?: string; bios_date?: string } | null;
  cpuInfo:          { name?: string; cores?: number; logical_processors?: number } | null;
  memoryTotalBytes: number | null;
  // eventos
  agentEvents:      Array<{ eventType: string; occurredAt: string; data: unknown }>;
}

export async function getDevice(orgId: string, deviceId: string): Promise<DeviceDetail | null> {
  const row = await db
    .select({
      id:               devices.id,
      hostname:         devices.hostname,
      deviceType:       devices.deviceType,
      deviceTypeHint:   devices.deviceTypeHint,
      agentVersion:     devices.agentVersion,
      createdAt:        devices.createdAt,
      clientId:         devices.clientId,
      siteId:           devices.siteId,
      lastSeenAt:       devices.lastSeenAt,
      organizationId:   devices.organizationId,
      // estado
      cpuAvgPct:        deviceCurrentState.cpuAvgPct,
      memoryUsedAvgPct: deviceCurrentState.memoryUsedAvgPct,
      ramTotalBytes:    deviceCurrentState.ramTotalBytes,
      volumes:          deviceCurrentState.volumes,
      antivirus:        deviceCurrentState.antivirus,
      windowsUpdate:    deviceCurrentState.windowsUpdate,
      physicalDisks:    deviceCurrentState.physicalDisks,
      osInfo:           deviceCurrentState.osInfo,
      loggedOnUser:     deviceCurrentState.loggedOnUser,
      agentMemBytes:    deviceCurrentState.agentMemBytes,
      agentCpuPct:      deviceCurrentState.agentCpuPct,
      network:          deviceCurrentState.network,
      services:         deviceCurrentState.services,
      uptimeSecs:       deviceCurrentState.uptimeSecs,
      lastBootAt:       deviceCurrentState.lastBootAt,
      rebootPending:    deviceCurrentState.rebootPending,
    })
    .from(devices)
    .leftJoin(deviceCurrentState, eq(devices.id, deviceCurrentState.deviceId))
    .where(and(eq(devices.id, deviceId), eq(devices.organizationId, orgId)))
    .limit(1);

  if (!row[0]) return null;
  const r = row[0];

  if (r.organizationId !== orgId) return null;

  // Inventario más reciente
  const invRow = await db
    .select({
      systemInfo:       inventorySnapshots.systemInfo,
      cpuInfo:          inventorySnapshots.cpuInfo,
      memoryTotalBytes: inventorySnapshots.memoryTotalBytes,
    })
    .from(inventorySnapshots)
    .where(and(eq(inventorySnapshots.deviceId, deviceId), eq(inventorySnapshots.organizationId, orgId)))
    .orderBy(desc(inventorySnapshots.collectedAt))
    .limit(1);

  // Eventos del agente (20 últimos)
  const evRows = await db
    .select({ eventType: agentEvents.eventType, occurredAt: agentEvents.occurredAt, data: agentEvents.data })
    .from(agentEvents)
    .where(and(eq(agentEvents.deviceId, deviceId), eq(agentEvents.organizationId, orgId)))
    .orderBy(desc(agentEvents.occurredAt))
    .limit(20);

  // Cliente y sede
  const [clientRow, siteRow] = await Promise.all([
    r.clientId
      ? db.query.clients.findFirst({ where: and(eq(clients.id, r.clientId), eq(clients.organizationId, orgId)) })
      : Promise.resolve(null),
    r.siteId
      ? db.query.sites.findFirst({ where: and(eq(sites.id, r.siteId), eq(sites.organizationId, orgId)) })
      : Promise.resolve(null),
  ]);

  const effType     = effectiveDeviceType(r);
  const latestEvent = evRows[0]?.eventType ?? null;
  const status      = classifyDevice(r.lastSeenAt, effType, latestEvent);
  const inv         = invRow[0] ?? null;

  return {
    id:               r.id,
    hostname:         r.hostname,
    status,
    effType,
    deviceType:       r.deviceType,
    deviceTypeHint:   r.deviceTypeHint,
    agentVersion:     r.agentVersion ?? null,
    createdAt:        r.createdAt.toISOString(),
    clientId:         r.clientId ?? null,
    clientName:       clientRow?.name ?? null,
    siteId:           r.siteId ?? null,
    siteName:         siteRow?.name ?? null,
    lastSeenAt:       r.lastSeenAt?.toISOString() ?? null,
    osInfo:           r.osInfo as DeviceDetail['osInfo'],
    cpuAvgPct:        r.cpuAvgPct ?? null,
    memoryUsedAvgPct: r.memoryUsedAvgPct ?? null,
    ramTotalBytes:    r.ramTotalBytes ?? null,
    volumes:          r.volumes as DeviceDetail['volumes'],
    antivirus:        r.antivirus as DeviceDetail['antivirus'],
    windowsUpdate:    r.windowsUpdate as DeviceDetail['windowsUpdate'],
    physicalDisks:    r.physicalDisks as DeviceDetail['physicalDisks'],
    loggedOnUser:     r.loggedOnUser ?? null,
    agentMemBytes:    r.agentMemBytes ?? null,
    agentCpuPct:      r.agentCpuPct ?? null,
    network:          r.network as DeviceDetail['network'],
    services:         r.services as DeviceDetail['services'],
    uptimeSecs:       r.uptimeSecs ?? null,
    lastBootAt:       r.lastBootAt?.toISOString() ?? null,
    rebootPending:    r.rebootPending ?? null,
    systemInfo:       inv?.systemInfo as DeviceDetail['systemInfo'] ?? null,
    cpuInfo:          inv?.cpuInfo as DeviceDetail['cpuInfo'] ?? null,
    memoryTotalBytes: inv?.memoryTotalBytes ?? null,
    agentEvents:      evRows.map(e => ({
      eventType:  e.eventType,
      occurredAt: e.occurredAt.toISOString(),
      data:       e.data,
    })),
  };
}

export interface MetricPoint {
  ts:               string;
  cpuAvgPct:        number | null;
  memoryUsedAvgPct: number | null;
}

export async function getDeviceMetrics(
  orgId: string,
  deviceId: string,
  period: '24h' | '7d',
): Promise<MetricPoint[]> {
  const trunc    = period === '24h' ? 'hour' : 'day';
  const interval = period === '24h' ? '24 hours' : '7 days';

  const rows = await db.execute<{ ts: string; cpu: string | null; mem: string | null }>(sql`
    SELECT
      date_trunc(${trunc}, period_start)::text AS ts,
      AVG(cpu_avg_pct)::text                   AS cpu,
      AVG(memory_used_avg_pct)::text           AS mem
    FROM metrics_5min
    WHERE device_id        = ${deviceId}
      AND organization_id  = ${orgId}
      AND period_start    >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
    GROUP BY 1
    ORDER BY 1
  `);

  return (rows as Array<{ ts: string; cpu: string | null; mem: string | null }>).map(r => ({
    ts:               r.ts,
    cpuAvgPct:        r.cpu != null ? parseFloat(r.cpu) : null,
    memoryUsedAvgPct: r.mem != null ? parseFloat(r.mem) : null,
  }));
}

export async function getDevicesForClient(orgId: string, clientId: string): Promise<DeviceRow[]> {
  const clientRecord = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.organizationId, orgId)),
  });
  if (!clientRecord) throw new Error('Cliente no encontrado o sin acceso');

  const now = new Date();

  const rows = await db
    .select({
      id:               devices.id,
      hostname:         devices.hostname,
      deviceType:       devices.deviceType,
      deviceTypeHint:   devices.deviceTypeHint,
      lastSeenAt:       devices.lastSeenAt,
      siteId:           devices.siteId,
      agentVersion:     deviceCurrentState.agentVersion,
      cpuAvgPct:        deviceCurrentState.cpuAvgPct,
      memoryUsedAvgPct: deviceCurrentState.memoryUsedAvgPct,
      ramTotalBytes:    deviceCurrentState.ramTotalBytes,
      volumes:          deviceCurrentState.volumes,
      antivirus:        deviceCurrentState.antivirus,
      windowsUpdate:    deviceCurrentState.windowsUpdate,
      physicalDisks:    deviceCurrentState.physicalDisks,
      osInfo:           deviceCurrentState.osInfo,
      loggedOnUser:     deviceCurrentState.loggedOnUser,
      agentMemBytes:    deviceCurrentState.agentMemBytes,
      network:          deviceCurrentState.network,
    })
    .from(devices)
    .leftJoin(deviceCurrentState, eq(devices.id, deviceCurrentState.deviceId))
    .where(
      and(
        eq(devices.organizationId, orgId),
        eq(devices.clientId, clientId),
        ne(devices.status, 'uninstalled'),
        ne(devices.status, 'pending_assignment'),
      ),
    )
    .orderBy(devices.hostname);

  if (rows.length === 0) return [];

  const deviceIds = rows.map(r => r.id);

  const eventRows = await db
    .select({
      deviceId:   agentEvents.deviceId,
      eventType:  agentEvents.eventType,
      occurredAt: agentEvents.occurredAt,
    })
    .from(agentEvents)
    .where(and(
      eq(agentEvents.organizationId, orgId),
      inArray(agentEvents.deviceId, deviceIds),
    ))
    .orderBy(agentEvents.deviceId, desc(agentEvents.occurredAt));

  const eventsByDevice = new Map<string, Array<{ eventType: string; occurredAt: Date }>>();
  for (const ev of eventRows) {
    if (!eventsByDevice.has(ev.deviceId)) eventsByDevice.set(ev.deviceId, []);
    const list = eventsByDevice.get(ev.deviceId)!;
    if (list.length < 10) list.push({ eventType: ev.eventType, occurredAt: ev.occurredAt! });
  }

  return rows.map(row => {
    const effType        = effectiveDeviceType(row);
    const devEvents      = eventsByDevice.get(row.id) ?? [];
    const latestEvent    = devEvents[0]?.eventType ?? null;
    const status         = classifyDevice(row.lastSeenAt, effType, latestEvent, now);
    const osInfo         = row.osInfo as { name?: string; build?: string; manufacturer?: string } | null;

    return {
      id:               row.id,
      hostname:         row.hostname,
      status,
      effType,
      deviceType:       row.deviceType,
      deviceTypeHint:   row.deviceTypeHint,
      siteId:           row.siteId,
      lastSeenAt:       row.lastSeenAt?.toISOString() ?? null,
      agentVersion:     row.agentVersion ?? null,
      osName:           osInfo?.name ?? null,
      osBuild:          osInfo?.build ?? null,
      manufacturer:     osInfo?.manufacturer ?? null,
      cpuAvgPct:        row.cpuAvgPct ?? null,
      memoryUsedAvgPct: row.memoryUsedAvgPct ?? null,
      ramTotalBytes:    row.ramTotalBytes ?? null,
      volumes:          row.volumes as DeviceRow['volumes'],
      antivirus:        row.antivirus as DeviceRow['antivirus'],
      windowsUpdate:    row.windowsUpdate as DeviceRow['windowsUpdate'],
      physicalDisks:    row.physicalDisks as DeviceRow['physicalDisks'],
      loggedOnUser:     row.loggedOnUser ?? null,
      agentMemBytes:    row.agentMemBytes ?? null,
      network:          row.network as DeviceRow['network'],
      lastEvents:       devEvents.slice(0, 3).map(e => ({
        eventType:  e.eventType,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  });
}
