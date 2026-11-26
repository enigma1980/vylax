import { db } from '@/db';
import { devices, clients, sites, auditLog } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

function notFound(msg: string): never {
  throw Object.assign(new Error(msg), { httpStatus: 404 });
}

export type AssignData =
  | { clientId: string; siteId: string | null }
  | { newClientName: string; newSiteName: string | null };

export async function assignDevice(
  orgId:    string,
  userId:   string,
  deviceId: string,
  data:     AssignData,
): Promise<void> {
  const device = await db.query.devices.findFirst({
    where: and(eq(devices.id, deviceId), eq(devices.organizationId, orgId)),
  });
  if (!device) notFound('Equipo no encontrado o sin acceso');
  if (device!.status !== 'pending_assignment') {
    throw Object.assign(new Error('El equipo no está pendiente de asignación'), { httpStatus: 409 });
  }

  await db.transaction(async tx => {
    let resolvedClientId: string;
    let resolvedSiteId: string | null = null;

    if ('newClientName' in data) {
      const [newClient] = await tx.insert(clients).values({
        organizationId: orgId,
        name: data.newClientName,
      }).returning();
      resolvedClientId = newClient.id;

      if (data.newSiteName) {
        const [newSite] = await tx.insert(sites).values({
          organizationId: orgId,
          clientId: resolvedClientId,
          name: data.newSiteName,
        }).returning();
        resolvedSiteId = newSite.id;
      }

      await tx.insert(auditLog).values({
        userId, orgId, event: 'client_created',
        metadata: { clientId: resolvedClientId, name: data.newClientName, source: 'device_assignment' },
      });
    } else {
      const clientRecord = await tx.query.clients.findFirst({
        where: and(eq(clients.id, data.clientId), eq(clients.organizationId, orgId)),
      });
      if (!clientRecord) notFound('Cliente no encontrado');

      resolvedClientId = data.clientId;
      resolvedSiteId   = data.siteId;
    }

    await tx.update(devices)
      .set({
        status:   'active',
        clientId: resolvedClientId,
        siteId:   resolvedSiteId,
      })
      .where(and(eq(devices.id, deviceId), eq(devices.organizationId, orgId)));

    await tx.insert(auditLog).values({
      userId, orgId, event: 'device_assigned',
      metadata: { deviceId, clientId: resolvedClientId, siteId: resolvedSiteId, hostname: device!.hostname },
    });
  });
}
