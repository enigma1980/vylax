import { db } from '@/db';
import { devices, clients, sites, auditLog } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';

function notFound(msg: string): never {
  throw Object.assign(new Error(msg), { httpStatus: 404 });
}

async function verifyDevice(orgId: string, deviceId: string) {
  const device = await db.query.devices.findFirst({
    where: and(eq(devices.id, deviceId), eq(devices.organizationId, orgId)),
  });
  if (!device) notFound('Equipo no encontrado o sin acceso');
  return device!;
}

export async function setDeviceType(
  orgId: string,
  userId: string,
  deviceId: string,
  type: 'server' | 'desktop' | 'laptop' | 'nas' | 'ups',
): Promise<void> {
  const device = await verifyDevice(orgId, deviceId);

  await db.transaction(async tx => {
    await tx.update(devices)
      .set({ deviceType: type })
      .where(and(eq(devices.id, deviceId), eq(devices.organizationId, orgId)));
    await tx.insert(auditLog).values({
      userId, orgId, event: 'device_type_changed',
      metadata: { deviceId, hostname: device.hostname, previousType: device.deviceType, newType: type },
    });
  });
}

export async function moveDevice(
  orgId: string,
  userId: string,
  deviceId: string,
  data: { clientId: string; siteId: string | null },
): Promise<void> {
  const device = await verifyDevice(orgId, deviceId);

  const targetClient = await db.query.clients.findFirst({
    where: and(eq(clients.id, data.clientId), eq(clients.organizationId, orgId)),
  });
  if (!targetClient) notFound('Cliente de destino no encontrado');

  if (data.siteId) {
    const targetSite = await db.query.sites.findFirst({
      where: and(
        eq(sites.id, data.siteId),
        eq(sites.organizationId, orgId),
        eq(sites.clientId, data.clientId),
      ),
    });
    if (!targetSite) notFound('Sede de destino no encontrada');
  }

  await db.transaction(async tx => {
    await tx.update(devices)
      .set({ clientId: data.clientId, siteId: data.siteId ?? null })
      .where(and(eq(devices.id, deviceId), eq(devices.organizationId, orgId)));
    await tx.insert(auditLog).values({
      userId, orgId, event: 'device_moved',
      metadata: {
        deviceId, hostname: device.hostname,
        previousClientId: device.clientId,
        newClientId: data.clientId,
        newSiteId: data.siteId,
      },
    });
  });
}

export async function updateCriticalServices(
  orgId: string,
  userId: string,
  deviceId: string,
  services: string[],
): Promise<void> {
  const device = await verifyDevice(orgId, deviceId);

  await db.transaction(async tx => {
    await tx.update(devices)
      .set({
        criticalServices: services,
        configVersion: sql`${devices.configVersion} + 1`,
      })
      .where(and(eq(devices.id, deviceId), eq(devices.organizationId, orgId)));
    await tx.insert(auditLog).values({
      userId, orgId, event: 'device_services_updated',
      metadata: { deviceId, hostname: device.hostname, services },
    });
  });
}

export async function revokeDeviceCredential(
  orgId: string,
  userId: string,
  deviceId: string,
): Promise<void> {
  const device = await verifyDevice(orgId, deviceId);

  await db.transaction(async tx => {
    await tx.update(devices)
      .set({ credentialRevokedAt: new Date() })
      .where(and(eq(devices.id, deviceId), eq(devices.organizationId, orgId)));
    await tx.insert(auditLog).values({
      userId, orgId, event: 'device_credential_revoked',
      metadata: { deviceId, hostname: device.hostname },
    });
  });
}
