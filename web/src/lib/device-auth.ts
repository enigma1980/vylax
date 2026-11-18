import { NextRequest } from 'next/server';
import { db } from '@/db';
import { devices } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { sha256hex, safeCompareHex } from './crypto';

export type AuthedDevice = {
  id: string;
  organizationId: string;
  clientId: string | null;
  siteId: string | null;
  status: string;
  configVersion: number;
};

export async function authenticateDevice(
  req: NextRequest,
): Promise<AuthedDevice | null | 'gone'> {
  const authHeader = req.headers.get('authorization') ?? '';
  const deviceId = req.headers.get('x-device-id') ?? '';

  if (!authHeader.startsWith('Bearer ') || !deviceId) return null;

  const secret = authHeader.slice(7);
  const secretHash = sha256hex(secret);

  const rows = await db
    .select({
      id: devices.id,
      organizationId: devices.organizationId,
      clientId: devices.clientId,
      siteId: devices.siteId,
      status: devices.status,
      credentialHash: devices.credentialHash,
      configVersion: devices.configVersion,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);

  if (rows.length === 0) return null;
  const device = rows[0];

  if (!safeCompareHex(secretHash, device.credentialHash)) return null;
  // Dispositivo desinstalado: credenciales válidas pero equipo eliminado → 410
  if (device.status === 'uninstalled') return 'gone';

  return {
    id: device.id,
    organizationId: device.organizationId,
    clientId: device.clientId,
    siteId: device.siteId,
    status: device.status,
    configVersion: device.configVersion,
  };
}
