import { db } from '@/db';
import { clients, sites, devices, enrollmentTokens, auditLog } from '@/db/schema';
import { and, eq, ne, count, sql } from 'drizzle-orm';
import { generateEnrollmentToken, sha256hex, tokenPrefix as makePrefix } from './crypto';

export interface SiteRow {
  id:          string;
  name:        string;
  publicIps:   string[];
  deviceCount: number;
  createdAt:   string;
}

export interface TokenRow {
  id:          string;
  label:       string;
  tokenPrefix: string;
  siteId:      string | null;
  siteName:    string | null;
  revokedAt:   string | null;
  createdAt:   string;
  lastUsedAt:  string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notFound(msg: string): never {
  throw Object.assign(new Error(msg), { httpStatus: 404 });
}

function conflict(msg: string): never {
  throw Object.assign(new Error(msg), { httpStatus: 409 });
}

async function verifyClient(orgId: string, clientId: string) {
  const record = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.organizationId, orgId)),
  });
  if (!record) notFound('Cliente no encontrado o sin acceso');
  return record!;
}

// ---------------------------------------------------------------------------
// Sedes
// ---------------------------------------------------------------------------

export async function getSites(orgId: string, clientId: string): Promise<SiteRow[]> {
  await verifyClient(orgId, clientId);

  const [siteRows, deviceCounts] = await Promise.all([
    db.select()
      .from(sites)
      .where(and(eq(sites.clientId, clientId), eq(sites.organizationId, orgId)))
      .orderBy(sites.name),
    db.select({ siteId: devices.siteId, cnt: count() })
      .from(devices)
      .where(and(
        eq(devices.clientId, clientId),
        eq(devices.organizationId, orgId),
        ne(devices.status, 'uninstalled'),
      ))
      .groupBy(devices.siteId),
  ]);

  const countMap = new Map<string | null, number>(
    deviceCounts.map(r => [r.siteId, Number(r.cnt)]),
  );

  return siteRows.map(s => ({
    id:          s.id,
    name:        s.name,
    publicIps:   s.publicIps,
    deviceCount: countMap.get(s.id) ?? 0,
    createdAt:   s.createdAt!.toISOString(),
  }));
}

export async function createSite(
  orgId: string,
  userId: string,
  clientId: string,
  data: { name: string; publicIps: string[] },
): Promise<SiteRow> {
  await verifyClient(orgId, clientId);

  const [site] = await db.transaction(async tx => {
    const [s] = await tx.insert(sites).values({
      organizationId: orgId,
      clientId,
      name:      data.name,
      publicIps: data.publicIps,
    }).returning();
    await tx.insert(auditLog).values({
      userId, orgId, event: 'site_created',
      metadata: { siteId: s.id, clientId, name: data.name },
    });
    return [s];
  });

  return {
    id:          site.id,
    name:        site.name,
    publicIps:   site.publicIps,
    deviceCount: 0,
    createdAt:   site.createdAt!.toISOString(),
  };
}

export async function updateSite(
  orgId: string,
  userId: string,
  siteId: string,
  data: { name: string; publicIps: string[] },
): Promise<void> {
  const site = await db.query.sites.findFirst({
    where: and(eq(sites.id, siteId), eq(sites.organizationId, orgId)),
  });
  if (!site) notFound('Sede no encontrada');

  await db.transaction(async tx => {
    await tx.update(sites)
      .set({ name: data.name, publicIps: data.publicIps })
      .where(and(eq(sites.id, siteId), eq(sites.organizationId, orgId)));
    await tx.insert(auditLog).values({
      userId, orgId, event: 'site_updated',
      metadata: { siteId, name: data.name },
    });
  });
}

export async function deleteSite(orgId: string, userId: string, siteId: string): Promise<void> {
  const site = await db.query.sites.findFirst({
    where: and(eq(sites.id, siteId), eq(sites.organizationId, orgId)),
  });
  if (!site) notFound('Sede no encontrada');

  const [result] = await db.select({ n: count() })
    .from(devices)
    .where(and(
      eq(devices.siteId, siteId),
      eq(devices.organizationId, orgId),
      ne(devices.status, 'uninstalled'),
    ));
  const n = Number(result.n);
  if (n > 0) {
    conflict(`No se puede eliminar la sede: tiene ${n} equipo${n !== 1 ? 's' : ''} activo${n !== 1 ? 's' : ''}`);
  }

  await db.transaction(async tx => {
    await tx.delete(sites).where(and(eq(sites.id, siteId), eq(sites.organizationId, orgId)));
    await tx.insert(auditLog).values({
      userId, orgId, event: 'site_deleted',
      metadata: { siteId, name: site!.name },
    });
  });
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export async function getTokens(orgId: string, clientId: string): Promise<TokenRow[]> {
  await verifyClient(orgId, clientId);

  const rows = await db.execute<{
    id: string;
    label: string;
    token_prefix: string;
    site_id: string | null;
    site_name: string | null;
    revoked_at: string | null;
    created_at: string;
    last_used_at: string | null;
  }>(sql`
    SELECT
      et.id,
      et.label,
      et.token_prefix,
      et.site_id,
      s.name   AS site_name,
      et.revoked_at,
      et.created_at,
      (SELECT MAX(d.created_at) FROM devices d WHERE d.enrollment_token_id = et.id) AS last_used_at
    FROM enrollment_tokens et
    LEFT JOIN sites s ON s.id = et.site_id
    WHERE et.organization_id = ${orgId}
      AND et.client_id       = ${clientId}
    ORDER BY et.created_at DESC
  `);

  return (rows as Array<typeof rows[0]>).map(r => ({
    id:          r.id,
    label:       r.label,
    tokenPrefix: r.token_prefix,
    siteId:      r.site_id,
    siteName:    r.site_name,
    revokedAt:   r.revoked_at   ? new Date(r.revoked_at).toISOString()   : null,
    createdAt:   r.created_at   ? new Date(r.created_at).toISOString()   : new Date().toISOString(),
    lastUsedAt:  r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
  }));
}

export async function createToken(
  orgId: string,
  userId: string,
  data: { clientId: string; siteId: string | null; label: string },
): Promise<{ token: TokenRow; fullToken: string }> {
  await verifyClient(orgId, data.clientId);

  if (data.siteId) {
    const site = await db.query.sites.findFirst({
      where: and(eq(sites.id, data.siteId), eq(sites.organizationId, orgId)),
    });
    if (!site) notFound('Sede no encontrada');
  }

  const fullToken = generateEnrollmentToken();
  const hash      = sha256hex(fullToken);
  const prefix    = makePrefix(fullToken);

  const [t] = await db.transaction(async tx => {
    const [rec] = await tx.insert(enrollmentTokens).values({
      organizationId: orgId,
      clientId:    data.clientId,
      siteId:      data.siteId,
      tokenHash:   hash,
      tokenPrefix: prefix,
      label:       data.label,
    }).returning();
    await tx.insert(auditLog).values({
      userId, orgId, event: 'token_created',
      metadata: { tokenId: rec.id, clientId: data.clientId, siteId: data.siteId, prefix },
    });
    return [rec];
  });

  return {
    token: {
      id:          t.id,
      label:       t.label,
      tokenPrefix: t.tokenPrefix,
      siteId:      t.siteId,
      siteName:    null,
      revokedAt:   null,
      createdAt:   t.createdAt!.toISOString(),
      lastUsedAt:  null,
    },
    fullToken,
  };
}

export async function revokeToken(orgId: string, userId: string, tokenId: string): Promise<void> {
  const token = await db.query.enrollmentTokens.findFirst({
    where: and(eq(enrollmentTokens.id, tokenId), eq(enrollmentTokens.organizationId, orgId)),
  });
  if (!token) notFound('Token no encontrado');
  if (token!.revokedAt) conflict('El token ya está revocado');

  await db.transaction(async tx => {
    await tx.update(enrollmentTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(enrollmentTokens.id, tokenId), eq(enrollmentTokens.organizationId, orgId)));
    await tx.insert(auditLog).values({
      userId, orgId, event: 'token_revoked',
      metadata: { tokenId, clientId: token!.clientId },
    });
  });
}

// ---------------------------------------------------------------------------
// Clientes (renombrar y borrar)
// ---------------------------------------------------------------------------

export async function updateClient(
  orgId: string,
  userId: string,
  clientId: string,
  data: { name: string },
): Promise<void> {
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.organizationId, orgId)),
  });
  if (!client) notFound('Cliente no encontrado');

  await db.transaction(async tx => {
    await tx.update(clients)
      .set({ name: data.name })
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId)));
    await tx.insert(auditLog).values({
      userId, orgId, event: 'client_updated',
      metadata: { clientId, name: data.name, previousName: client!.name },
    });
  });
}

export async function deleteClient(
  orgId: string,
  userId: string,
  clientId: string,
): Promise<void> {
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.organizationId, orgId)),
  });
  if (!client) notFound('Cliente no encontrado');

  const [result] = await db.select({ n: count() })
    .from(devices)
    .where(and(eq(devices.clientId, clientId), eq(devices.organizationId, orgId)));
  const n = Number(result.n);
  if (n > 0) {
    conflict(
      `No se puede eliminar el cliente: tiene ${n} equipo${n !== 1 ? 's' : ''}` +
      (n > 0 ? ' (incluidos desinstalados)' : ''),
    );
  }

  await db.transaction(async tx => {
    await tx.delete(enrollmentTokens).where(
      and(eq(enrollmentTokens.clientId, clientId), eq(enrollmentTokens.organizationId, orgId)),
    );
    await tx.delete(sites).where(
      and(eq(sites.clientId, clientId), eq(sites.organizationId, orgId)),
    );
    await tx.delete(clients).where(
      and(eq(clients.id, clientId), eq(clients.organizationId, orgId)),
    );
    await tx.insert(auditLog).values({
      userId, orgId, event: 'client_deleted',
      metadata: { clientId, name: client!.name },
    });
  });
}

export async function rotateToken(
  orgId: string,
  userId: string,
  tokenId: string,
): Promise<{ token: TokenRow; fullToken: string }> {
  const old = await db.query.enrollmentTokens.findFirst({
    where: and(eq(enrollmentTokens.id, tokenId), eq(enrollmentTokens.organizationId, orgId)),
  });
  if (!old) notFound('Token no encontrado');
  if (!old!.clientId) conflict('Solo se pueden rotar tokens de cliente');

  const fullToken = generateEnrollmentToken();
  const hash      = sha256hex(fullToken);
  const prefix    = makePrefix(fullToken);

  const [t] = await db.transaction(async tx => {
    await tx.update(enrollmentTokens)
      .set({ revokedAt: new Date() })
      .where(eq(enrollmentTokens.id, tokenId));
    const [rec] = await tx.insert(enrollmentTokens).values({
      organizationId: orgId,
      clientId:    old!.clientId,
      siteId:      old!.siteId,
      tokenHash:   hash,
      tokenPrefix: prefix,
      label:       old!.label,
    }).returning();
    await tx.insert(auditLog).values([
      { userId, orgId, event: 'token_revoked', metadata: { tokenId, clientId: old!.clientId, reason: 'rotate' } },
      { userId, orgId, event: 'token_created', metadata: { tokenId: rec.id, clientId: old!.clientId, siteId: old!.siteId, prefix, rotatedFrom: tokenId } },
    ]);
    return [rec];
  });

  return {
    token: {
      id:          t.id,
      label:       t.label,
      tokenPrefix: t.tokenPrefix,
      siteId:      t.siteId,
      siteName:    null,
      revokedAt:   null,
      createdAt:   t.createdAt!.toISOString(),
      lastUsedAt:  null,
    },
    fullToken,
  };
}
