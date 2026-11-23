/**
 * Tests unitarios de lib/device-status.ts
 * Uso: npm run test:dashboard (no requiere DB)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDevice,
  clientSemaphore,
  noReportThresholdMs,
  ONLINE_MS,
  NO_REPORT_THRESHOLDS_MS,
} from '../src/lib/device-status.js';

const NOW = new Date('2024-06-01T12:00:00Z');

function secsAgo(n: number) { return new Date(NOW.getTime() - n * 1000); }
function minsAgo(n: number) { return secsAgo(n * 60); }
function daysAgo(n: number) { return minsAgo(n * 24 * 60); }

describe('noReportThresholdMs', () => {
  it('server: 10 minutos', () =>
    assert.equal(noReportThresholdMs('server'), 10 * 60 * 1000));
  it('pc: 3 días', () =>
    assert.equal(noReportThresholdMs('pc'), 3 * 24 * 60 * 60 * 1000));
  it('laptop: 15 días', () =>
    assert.equal(noReportThresholdMs('laptop'), 15 * 24 * 60 * 60 * 1000));
  it('nas: 10 minutos', () =>
    assert.equal(noReportThresholdMs('nas'), 10 * 60 * 1000));
  it('sai: 10 minutos', () =>
    assert.equal(noReportThresholdMs('sai'), 10 * 60 * 1000));
  it('tipo desconocido: threshold por defecto (server)', () =>
    assert.equal(noReportThresholdMs('unknown'), NO_REPORT_THRESHOLDS_MS.server));
  it('null: threshold por defecto', () =>
    assert.equal(noReportThresholdMs(null), NO_REPORT_THRESHOLDS_MS.server));
});

describe('classifyDevice', () => {
  it('en línea: lastSeenAt hace 5 min, sin evento', () =>
    assert.equal(classifyDevice(minsAgo(5), 'server', null, NOW), 'online'));

  it('en línea: exactamente ONLINE_MS - 1ms', () => {
    const t = new Date(NOW.getTime() - ONLINE_MS + 1);
    assert.equal(classifyDevice(t, 'pc', null, NOW), 'online');
  });

  it('sin reportar: servidor visto hace 25 min (threshold 10 min)', () =>
    assert.equal(classifyDevice(minsAgo(25), 'server', null, NOW), 'no_report'));

  it('sin reportar: pc visto hace 4 días (threshold 3 días)', () =>
    assert.equal(classifyDevice(daysAgo(4), 'pc', null, NOW), 'no_report'));

  it('desconectado: último evento shutdown', () =>
    assert.equal(classifyDevice(minsAgo(30), 'server', 'shutdown', NOW), 'disconnected'));

  it('suspendido: último evento suspend', () =>
    assert.equal(classifyDevice(minsAgo(60), 'pc', 'suspend', NOW), 'suspended'));

  it('desconectado: laptop vista hace 2 días (dentro de threshold 15 días, sin evento)', () =>
    assert.equal(classifyDevice(daysAgo(2), 'laptop', null, NOW), 'disconnected'));

  it('desconectado: sin lastSeenAt', () =>
    assert.equal(classifyDevice(null, 'server', null, NOW), 'disconnected'));

  it('suspended tiene prioridad sobre lastSeenAt reciente', () =>
    assert.equal(classifyDevice(minsAgo(5), 'pc', 'suspend', NOW), 'suspended'));

  it('no_report: nas visto hace 15 min (threshold 10 min)', () =>
    assert.equal(classifyDevice(minsAgo(15), 'nas', null, NOW), 'no_report'));
});

describe('clientSemaphore', () => {
  it('ok: sin dispositivos sin reportar', () => {
    assert.equal(
      clientSemaphore([
        { status: 'online',       type: 'server' },
        { status: 'disconnected', type: 'laptop' },
      ]),
      'ok',
    );
  });

  it('crit: servidor sin reportar', () => {
    assert.equal(
      clientSemaphore([
        { status: 'online',    type: 'pc'     },
        { status: 'no_report', type: 'server' },
      ]),
      'crit',
    );
  });

  it('crit: nas sin reportar', () => {
    assert.equal(
      clientSemaphore([{ status: 'no_report', type: 'nas' }]),
      'crit',
    );
  });

  it('crit: sai sin reportar', () => {
    assert.equal(
      clientSemaphore([{ status: 'no_report', type: 'sai' }]),
      'crit',
    );
  });

  it('warn: solo pc sin reportar', () => {
    assert.equal(
      clientSemaphore([
        { status: 'online',    type: 'server' },
        { status: 'no_report', type: 'pc'     },
      ]),
      'warn',
    );
  });

  it('warn: solo laptop sin reportar', () => {
    assert.equal(
      clientSemaphore([{ status: 'no_report', type: 'laptop' }]),
      'warn',
    );
  });

  it('crit: mix de pc y servidor sin reportar → crit', () => {
    assert.equal(
      clientSemaphore([
        { status: 'no_report', type: 'pc'     },
        { status: 'no_report', type: 'server' },
      ]),
      'crit',
    );
  });

  it('ok: lista vacía', () =>
    assert.equal(clientSemaphore([]), 'ok'));
});
