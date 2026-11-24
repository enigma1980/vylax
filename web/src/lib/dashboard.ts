import { db } from '@/db';
import { devices, deviceCurrentState, clients, sites, metrics5min } from '@/db/schema';
import { eq, and, ne, count, isNotNull, sql, inArray } from 'drizzle-orm';
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
