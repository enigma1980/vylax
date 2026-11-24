export type DeviceType = 'server' | 'pc' | 'laptop' | 'nas' | 'sai';
export type DeviceStatus = 'online' | 'no_report' | 'suspended' | 'disconnected';
export type SemaphoreLevel = 'ok' | 'warn' | 'crit';

export const ONLINE_MS = 15 * 60 * 1000;

export const NO_REPORT_THRESHOLDS_MS: Record<string, number> = {
  server:  10 * 60 * 1000,
  pc:      3 * 24 * 60 * 60 * 1000,
  laptop:  15 * 24 * 60 * 60 * 1000,
  nas:     10 * 60 * 1000,
  sai:     10 * 60 * 1000,
};

const DEFAULT_THRESHOLD_MS = NO_REPORT_THRESHOLDS_MS.server;

export function noReportThresholdMs(type: string | null): number {
  if (!type) return DEFAULT_THRESHOLD_MS;
  return NO_REPORT_THRESHOLDS_MS[type] ?? DEFAULT_THRESHOLD_MS;
}

export function classifyDevice(
  lastSeenAt: Date | null,
  deviceType: string | null,
  lastEventType: string | null,
  now: Date = new Date(),
): DeviceStatus {
  if (lastEventType === 'suspend')  return 'suspended';
  if (lastEventType === 'shutdown') return 'disconnected';

  if (!lastSeenAt) return 'disconnected';

  const elapsed = now.getTime() - lastSeenAt.getTime();
  if (elapsed < ONLINE_MS) return 'online';

  const threshold = noReportThresholdMs(deviceType);
  if (elapsed >= threshold) return 'no_report';

  return 'disconnected';
}

export function effectiveDeviceType(device: {
  deviceType?: string | null;
  deviceTypeHint?: string | null;
}): string | null {
  return device.deviceType ?? device.deviceTypeHint ?? null;
}

const CRIT_TYPES = new Set(['server', 'nas', 'sai']);

export function clientSemaphore(
  devices: Array<{ status: DeviceStatus; type: string | null }>,
): SemaphoreLevel {
  const noRep = devices.filter(d => d.status === 'no_report');
  if (noRep.length === 0) return 'ok';
  const hasCrit = noRep.some(d => d.type && CRIT_TYPES.has(d.type));
  return hasCrit ? 'crit' : 'warn';
}
