import { isOsSupported } from './os-support';

export type CheckStatus = 'ok' | 'warn' | 'crit' | 'no-data';

export interface CheckDetail {
  label:  string;
  status: CheckStatus;
}

export interface CheckResult {
  ok:    number;
  total: number;
  color: 'ok' | 'warn' | 'crit';
}

export interface CheckRing {
  result:  CheckResult;
  details: CheckDetail[];
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function computeColor(details: CheckDetail[]): 'ok' | 'warn' | 'crit' {
  if (details.some(d => d.status === 'crit')) return 'crit';
  if (details.some(d => d.status === 'warn' || d.status === 'no-data')) return 'warn';
  return 'ok';
}

function buildRing(details: CheckDetail[]): CheckRing {
  const ok = details.filter(d => d.status === 'ok').length;
  return { result: { ok, total: details.length, color: computeColor(details) }, details };
}

// ---------------------------------------------------------------------------
// Anillo de seguridad (3 comprobaciones fijas)
// ---------------------------------------------------------------------------

/** Formato del agente: { product, enabled, up_to_date } */
function checkAntivirus(antivirus: unknown): CheckStatus {
  if (!Array.isArray(antivirus) || antivirus.length === 0) return 'no-data';
  const hasActive = (antivirus as Array<{ enabled?: boolean; up_to_date?: boolean }>)
    .some(av => av?.enabled === true && av?.up_to_date === true);
  return hasActive ? 'ok' : 'crit';
}

/** windowsUpdate: { last_installed_at?: string } — OK si ≤ 45 días */
function checkWindowsUpdate(windowsUpdate: unknown, now: Date): CheckStatus {
  if (!windowsUpdate || typeof windowsUpdate !== 'object') return 'no-data';
  const wu = windowsUpdate as { last_installed_at?: string };
  if (!wu.last_installed_at) return 'no-data';
  const daysSince = (now.getTime() - new Date(wu.last_installed_at).getTime()) / 86_400_000;
  return daysSince <= 45 ? 'ok' : 'warn';
}

/** osInfo: { build?: string; name?: string } — comprueba contra la tabla de EOL según edición */
function checkOs(osInfo: unknown, now: Date): CheckStatus {
  if (!osInfo || typeof osInfo !== 'object') return 'no-data';
  const os = osInfo as { build?: string; name?: string };
  if (!os.build) return 'no-data';
  return isOsSupported(os.build, os.name, now) ? 'ok' : 'warn';
}

export function securityChecks(
  state: {
    antivirus?:    unknown;
    windowsUpdate?: unknown;
    osInfo?:       unknown;
  },
  now: Date = new Date(),
): CheckRing {
  return buildRing([
    { label: 'Antivirus activo y al día', status: checkAntivirus(state.antivirus) },
    { label: 'Actualizaciones (≤ 45 días)', status: checkWindowsUpdate(state.windowsUpdate, now) },
    { label: 'Sistema operativo con soporte', status: checkOs(state.osInfo, now) },
  ]);
}

// ---------------------------------------------------------------------------
// Anillo de rendimiento (variable según datos disponibles)
// ---------------------------------------------------------------------------

function checkCpu(cpuAvgPct: unknown): CheckDetail {
  if (typeof cpuAvgPct !== 'number') return { label: 'CPU (media)', status: 'no-data' };
  return { label: 'CPU (media)', status: cpuAvgPct < 90 ? 'ok' : 'warn' };
}

function checkRam(memoryUsedAvgPct: unknown): CheckDetail {
  if (typeof memoryUsedAvgPct !== 'number') return { label: 'Memoria', status: 'no-data' };
  return { label: 'Memoria', status: memoryUsedAvgPct < 90 ? 'ok' : 'warn' };
}

/** Volumes: [{ mount, free_bytes, total_bytes }] */
function checkVolumes(volumes: unknown): CheckDetail[] {
  if (!Array.isArray(volumes) || volumes.length === 0) return [];
  return (volumes as Array<{ mount?: string; free_bytes?: number; total_bytes?: number }>)
    .map(v => {
      const freePct = v.total_bytes && v.total_bytes > 0
        ? (v.free_bytes ?? 0) / v.total_bytes
        : null;
      let status: CheckStatus;
      if (freePct === null)   status = 'no-data';
      else if (freePct < 0.05) status = 'crit';
      else if (freePct < 0.15) status = 'warn';
      else                      status = 'ok';
      return { label: `Disco ${v.mount ?? '?'}`, status };
    });
}

/** PhysicalDisks: [{ health, predict_failure }] — OK si health==='Healthy' && !predict_failure */
function checkSmart(physicalDisks: unknown): CheckDetail | null {
  if (!Array.isArray(physicalDisks) || physicalDisks.length === 0) return null;
  const allOk = (physicalDisks as Array<{ health?: string; predict_failure?: boolean }>)
    .every(d => (d.health === 'Healthy' || d.health === 'OK') && !d.predict_failure);
  return { label: 'Salud de discos (SMART)', status: allOk ? 'ok' : 'crit' };
}

export function performanceChecks(
  state: {
    cpuAvgPct?:        unknown;
    memoryUsedAvgPct?: unknown;
    volumes?:          unknown;
    physicalDisks?:    unknown;
  },
): CheckRing {
  const details: CheckDetail[] = [
    checkCpu(state.cpuAvgPct),
    checkRam(state.memoryUsedAvgPct),
    ...checkVolumes(state.volumes),
  ];
  const smart = checkSmart(state.physicalDisks);
  if (smart) details.push(smart);
  return buildRing(details);
}
