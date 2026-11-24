/**
 * Tests unitarios (sin BD) de:
 *   - lib/os-support.ts   → isOsSupported, getEolDate
 *   - lib/device-status.ts → effectiveDeviceType
 *   - lib/device-checks.ts → securityChecks, performanceChecks
 *
 * Uso: npm run test:checks
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isOsSupported, getEolDate }   from '../src/lib/os-support.js';
import { effectiveDeviceType }          from '../src/lib/device-status.js';
import { securityChecks, performanceChecks } from '../src/lib/device-checks.js';

// ---------------------------------------------------------------------------
// os-support
// ---------------------------------------------------------------------------

describe('os-support', () => {
  // Fecha de referencia: 2026-11-24 (hoy)
  const NOW = new Date('2026-11-24T12:00:00Z');

  it('W10 22H2 (19045) NO está soportado — todas las ediciones igual', () => {
    assert.equal(isOsSupported('19045', null, NOW), false);
  });

  it('W11 24H2 Enterprise (26100) SÍ está soportado (EOL oct 2028)', () => {
    assert.equal(isOsSupported('26100', 'Windows 11 Enterprise', NOW), true);
  });

  it('W11 24H2 Pro (26100) NO está soportado (EOL oct 2026, antes de hoy)', () => {
    assert.equal(isOsSupported('26100', 'Windows 11 Pro', NOW), false);
  });

  it('W11 23H2 Enterprise (22631) NO está soportado (EOL 10-nov-2026, antes de hoy)', () => {
    assert.equal(isOsSupported('22631', 'Windows 11 Enterprise', NOW), false);
  });

  it('sin osName se usa tabla Pro (más conservadora)', () => {
    // Sin osName, 26100 usa Pro: EOL 2026-10-13 → no soportado
    assert.equal(isOsSupported('26100', null, NOW), false);
  });

  it('build con parte menor (19045.6466) extrae el build mayor', () => {
    assert.equal(isOsSupported('19045.6466', null, NOW), false);
  });

  it('build desconocido → no soportado (conservador)', () => {
    assert.equal(isOsSupported('99999', null, NOW), false);
  });

  it('getEolDate con W10 22H2 devuelve la fecha correcta (igual en todas las ediciones)', () => {
    const d = getEolDate('19045');
    assert.ok(d instanceof Date);
    assert.equal(d!.toISOString().slice(0, 10), '2025-10-14');
  });

  it('getEolDate con W11 24H2 Enterprise devuelve oct 2028', () => {
    const d = getEolDate('26100', 'Windows 11 Enterprise');
    assert.ok(d instanceof Date);
    assert.equal(d!.toISOString().slice(0, 10), '2028-10-10');
  });

  it('getEolDate con W11 24H2 Pro devuelve oct 2026', () => {
    const d = getEolDate('26100', 'Windows 11 Pro');
    assert.ok(d instanceof Date);
    assert.equal(d!.toISOString().slice(0, 10), '2026-10-13');
  });

  it('getEolDate devuelve null para build desconocido', () => {
    assert.equal(getEolDate('99999'), null);
  });

  it('Server 2022 (20348) está soportado (EOL oct 2031)', () => {
    // Server usa tabla Enterprise automáticamente por fallback
    assert.equal(isOsSupported('20348', 'Windows Server 2022 Standard', NOW), true);
  });

  it('Server build sin nombre también encuentra EOL (fallback a tabla Enterprise)', () => {
    assert.equal(isOsSupported('20348', null, NOW), true);
  });
});

// ---------------------------------------------------------------------------
// effectiveDeviceType
// ---------------------------------------------------------------------------

describe('effectiveDeviceType', () => {
  it('devuelve deviceType cuando está definido', () => {
    assert.equal(effectiveDeviceType({ deviceType: 'server', deviceTypeHint: 'pc' }), 'server');
  });

  it('cae a deviceTypeHint cuando deviceType es null', () => {
    assert.equal(effectiveDeviceType({ deviceType: null, deviceTypeHint: 'laptop' }), 'laptop');
  });

  it('devuelve null cuando ambos son null', () => {
    assert.equal(effectiveDeviceType({ deviceType: null, deviceTypeHint: null }), null);
  });

  it('devuelve null cuando ambos son undefined', () => {
    assert.equal(effectiveDeviceType({}), null);
  });
});

// ---------------------------------------------------------------------------
// securityChecks
// ---------------------------------------------------------------------------

describe('securityChecks', () => {
  const NOW = new Date('2026-11-24T12:00:00Z');
  // Fecha dentro de los 45 días
  const RECENT_UPDATE = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
  // Fecha fuera de los 45 días
  const OLD_UPDATE    = new Date(NOW.getTime() - 60 * 86_400_000).toISOString();

  const AV_OK   = [{ product: 'Windows Defender', enabled: true,  up_to_date: true }];
  const AV_FAIL = [{ product: 'Windows Defender', enabled: true,  up_to_date: false }];
  const OS_OK   = { build: '26100', name: 'Windows 11 Enterprise' }; // soportado (Enterprise EOL oct 2028)
  const OS_OLD  = { build: '19045', name: 'Windows 10 Pro' };       // no soportado
  const WU_OK   = { last_installed_at: RECENT_UPDATE };
  const WU_OLD  = { last_installed_at: OLD_UPDATE };

  it('3/3 OK: AV activo, updates < 45d, OS soportado → color ok', () => {
    const r = securityChecks({ antivirus: AV_OK, windowsUpdate: WU_OK, osInfo: OS_OK }, NOW);
    assert.equal(r.result.ok, 3);
    assert.equal(r.result.total, 3);
    assert.equal(r.result.color, 'ok');
  });

  it('AV ok, updates 60d, OS W10 caducado → 1/3, color warn', () => {
    const r = securityChecks({ antivirus: AV_OK, windowsUpdate: WU_OLD, osInfo: OS_OLD }, NOW);
    assert.equal(r.result.ok, 1);
    assert.equal(r.result.total, 3);
    assert.equal(r.result.color, 'warn');
  });

  it('sin antivirus → estado no-data, no cuenta como ok', () => {
    const r = securityChecks({ antivirus: [], windowsUpdate: WU_OK, osInfo: OS_OK }, NOW);
    assert.equal(r.details[0].status, 'no-data');
    assert.equal(r.result.ok, 2); // WU + OS sí pasan
  });

  it('antivirus enabled pero signatures caducadas → crit', () => {
    const r = securityChecks({ antivirus: AV_FAIL, windowsUpdate: WU_OK, osInfo: OS_OK }, NOW);
    assert.equal(r.details[0].status, 'crit');
    assert.equal(r.result.color, 'crit');
  });

  it('sin datos de windowsUpdate → no-data', () => {
    const r = securityChecks({ antivirus: AV_OK, windowsUpdate: null, osInfo: OS_OK }, NOW);
    assert.equal(r.details[1].status, 'no-data');
  });

  it('osInfo sin build → no-data', () => {
    const r = securityChecks({ antivirus: AV_OK, windowsUpdate: WU_OK, osInfo: { name: 'Windows' } }, NOW);
    assert.equal(r.details[2].status, 'no-data');
  });
});

// ---------------------------------------------------------------------------
// performanceChecks
// ---------------------------------------------------------------------------

describe('performanceChecks', () => {
  const VOL_OK   = [{ mount: 'C:', free_bytes: 50_000_000_000, total_bytes: 100_000_000_000 }];
  const VOL_WARN = [{ mount: 'D:', free_bytes: 10_000_000_000, total_bytes: 100_000_000_000 }]; // 10 %
  const VOL_CRIT = [{ mount: 'E:', free_bytes:  3_000_000_000, total_bytes: 100_000_000_000 }]; // 3 %
  const DISK_OK  = [{ serial: 'ABC', health: 'Healthy', predict_failure: false }];
  const DISK_FAIL= [{ serial: 'XYZ', health: 'Unhealthy', predict_failure: false }];

  it('CPU 17 %, RAM 78 %, volúmenes y SMART ok → todo verde', () => {
    const r = performanceChecks({
      cpuAvgPct: 17, memoryUsedAvgPct: 78,
      volumes: VOL_OK, physicalDisks: DISK_OK,
    });
    assert.equal(r.result.color, 'ok');
    assert.equal(r.result.ok, r.result.total);
  });

  it('CPU 95 % → warn', () => {
    const r = performanceChecks({ cpuAvgPct: 95, memoryUsedAvgPct: 50, volumes: VOL_OK });
    assert.equal(r.details[0].status, 'warn');
    assert.equal(r.result.color, 'warn');
  });

  it('volumen con 10 % libre → warn', () => {
    const r = performanceChecks({ cpuAvgPct: 20, memoryUsedAvgPct: 50, volumes: VOL_WARN });
    const volDetail = r.details.find(d => d.label.startsWith('Disco'));
    assert.equal(volDetail?.status, 'warn');
  });

  it('volumen con 3 % libre → crit', () => {
    const r = performanceChecks({ cpuAvgPct: 20, memoryUsedAvgPct: 50, volumes: VOL_CRIT });
    const volDetail = r.details.find(d => d.label.startsWith('Disco'));
    assert.equal(volDetail?.status, 'crit');
    assert.equal(r.result.color, 'crit');
  });

  it('disco SMART unhealthy → crit', () => {
    const r = performanceChecks({
      cpuAvgPct: 20, memoryUsedAvgPct: 50,
      volumes: VOL_OK, physicalDisks: DISK_FAIL,
    });
    const smartDetail = r.details.find(d => d.label.includes('SMART'));
    assert.equal(smartDetail?.status, 'crit');
  });

  it('sin datos de CPU ni RAM → no-data en ambos', () => {
    const r = performanceChecks({});
    assert.equal(r.details[0].status, 'no-data');
    assert.equal(r.details[1].status, 'no-data');
  });

  it('sin physicalDisks → no aparece el detalle SMART', () => {
    const r = performanceChecks({ cpuAvgPct: 20, memoryUsedAvgPct: 50, volumes: VOL_OK });
    const smartDetail = r.details.find(d => d.label.includes('SMART'));
    assert.equal(smartDetail, undefined);
  });

  it('múltiples volúmenes: 2 críticos y 1 ok → 2 crit en detalles', () => {
    const r = performanceChecks({
      cpuAvgPct: 20, memoryUsedAvgPct: 50,
      volumes: [
        { mount: 'C:', free_bytes: 2_000_000_000, total_bytes: 100_000_000_000 }, // 2 % crit
        { mount: 'D:', free_bytes: 2_000_000_000, total_bytes: 100_000_000_000 }, // 2 % crit
        { mount: 'E:', free_bytes: 50_000_000_000, total_bytes: 100_000_000_000 }, // 50 % ok
      ],
    });
    const critVols = r.details.filter(d => d.label.startsWith('Disco') && d.status === 'crit');
    assert.equal(critVols.length, 2);
    assert.equal(r.result.color, 'crit');
  });
});
