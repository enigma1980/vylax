import type { DeviceRow } from './dashboard';

export type FilterType = 'all' | 'con_avisos' | 'server' | 'pc' | 'laptop';

export function hasIssues(d: DeviceRow): boolean {
  // Antivirus conocido y con problema
  const avList = Array.isArray(d.antivirus)
    ? (d.antivirus as Array<{ enabled?: boolean; up_to_date?: boolean }>)
    : [];
  if (avList.length > 0 && !avList.some(av => av.enabled && av.up_to_date)) return true;

  // Windows Update > 45 días
  const wu = d.windowsUpdate as { last_installed_at?: string } | null;
  if (wu?.last_installed_at) {
    const days = (Date.now() - new Date(wu.last_installed_at).getTime()) / 86_400_000;
    if (days > 45) return true;
  }

  // CPU / RAM saturados
  if ((d.cpuAvgPct ?? 0) >= 90)        return true;
  if ((d.memoryUsedAvgPct ?? 0) >= 90) return true;

  // Disco lleno (≥ 85 %)
  const vols = Array.isArray(d.volumes)
    ? (d.volumes as Array<{ total_bytes: number; free_bytes: number }>)
    : [];
  if (vols.some(v => v.total_bytes > 0 && (v.total_bytes - v.free_bytes) / v.total_bytes >= 0.85)) return true;

  // SMART fallo
  const disks = Array.isArray(d.physicalDisks)
    ? (d.physicalDisks as Array<{ health?: string; predict_failure?: boolean }>)
    : [];
  if (disks.some(d => (d.health !== 'Healthy' && d.health !== 'OK') || d.predict_failure)) return true;

  return false;
}

export function applyFilters(
  devices: DeviceRow[],
  siteId:  string,
  filter:  FilterType,
): DeviceRow[] {
  return devices.filter(d => {
    if (siteId && d.siteId !== siteId) return false;
    if (filter === 'con_avisos') return hasIssues(d);
    if (filter === 'server')     return d.effType === 'server';
    if (filter === 'pc')         return d.effType === 'pc';
    if (filter === 'laptop')     return d.effType === 'laptop';
    return true;
  });
}

export function computeCounts(
  devices: DeviceRow[],
  siteId:  string,
): Record<FilterType, number> {
  const base = siteId ? devices.filter(d => d.siteId === siteId) : devices;
  return {
    all:        base.length,
    con_avisos: base.filter(d => hasIssues(d)).length,
    server:     base.filter(d => d.effType === 'server').length,
    pc:         base.filter(d => d.effType === 'pc').length,
    laptop:     base.filter(d => d.effType === 'laptop').length,
  };
}
