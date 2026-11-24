import type { DeviceRow } from './dashboard';

export type FilterType = 'all' | 'online' | 'no_report' | 'server' | 'pc' | 'laptop';

export function applyFilters(
  devices: DeviceRow[],
  siteId:  string,
  filter:  FilterType,
): DeviceRow[] {
  return devices.filter(d => {
    if (siteId && d.siteId !== siteId)       return false;
    if (filter === 'online')    return d.status === 'online';
    if (filter === 'no_report') return d.status === 'no_report';
    if (filter === 'server')    return d.effType === 'server';
    if (filter === 'pc')        return d.effType === 'pc';
    if (filter === 'laptop')    return d.effType === 'laptop';
    return true;
  });
}

export function computeCounts(
  devices: DeviceRow[],
  siteId:  string,
): Record<FilterType, number> {
  const base = siteId ? devices.filter(d => d.siteId === siteId) : devices;
  return {
    all:       base.length,
    online:    base.filter(d => d.status === 'online').length,
    no_report: base.filter(d => d.status === 'no_report').length,
    server:    base.filter(d => d.effType === 'server').length,
    pc:        base.filter(d => d.effType === 'pc').length,
    laptop:    base.filter(d => d.effType === 'laptop').length,
  };
}
