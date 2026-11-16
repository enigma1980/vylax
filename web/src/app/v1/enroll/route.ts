import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import {
  enrollmentTokens,
  devices,
  deviceCurrentState,
} from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import {
  sha256hex,
  generateDeviceSecret,
  safeCompareHex,
  tokenPrefix,
} from '@/lib/crypto';
import { DEFAULT_CONFIG } from '@/lib/config-defaults';

// UUIDs de relleno que no identifican de forma fiable a un equipo
const PLACEHOLDER_UUIDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '03000200-0400-0500-0006-000700080009',
]);

function isPlaceholderUuid(uuid: string): boolean {
  return PLACEHOLDER_UUIDS.has(uuid.toLowerCase());
}

function getClientIp(req: NextRequest): string | null {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return req.ip ?? null;
}

const bodySchema = z.object({
  enrollment_token: z.string(),
  hostname: z.string(),
  smbios_uuid: z.string().optional(),
  serial_number: z.string().optional(),
  device_type_hint: z.string().optional(),
  agent_version: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'parámetros incorrectos' }, { status: 400 });
  }

  const data = parsed.data;
  const prefix = tokenPrefix(data.enrollment_token);
  const submittedHash = sha256hex(data.enrollment_token);

  // Buscar token por prefijo y verificar hash
  const candidates = await db
    .select()
    .from(enrollmentTokens)
    .where(and(eq(enrollmentTokens.tokenPrefix, prefix), isNull(enrollmentTokens.revokedAt)));

  let matchedToken: typeof enrollmentTokens.$inferSelect | null = null;
  for (const c of candidates) {
    if (safeCompareHex(submittedHash, c.tokenHash)) {
      matchedToken = c;
      break;
    }
  }

  if (!matchedToken) {
    return NextResponse.json({ error: 'token inválido' }, { status: 401 });
  }

  const orgId = matchedToken.organizationId;
  const publicIp = getClientIp(req);

  // Detectar reinstalación por smbios_uuid dentro de la misma organización
  const smbiosUuid =
    data.smbios_uuid && !isPlaceholderUuid(data.smbios_uuid)
      ? data.smbios_uuid
      : null;

  let existingDevice: typeof devices.$inferSelect | null = null;
  if (smbiosUuid) {
    const existing = await db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.organizationId, orgId),
          eq(devices.hardwareSmbiousUuid, smbiosUuid),
        ),
      )
      .limit(1);
    existingDevice = existing[0] ?? null;
  }

  // Generar nueva credencial
  const secret = generateDeviceSecret();
  const credentialHash = sha256hex(secret);

  let deviceId: string;

  if (existingDevice) {
    // Reinstalación: reutilizar el mismo device_id, rotar credencial
    deviceId = existingDevice.id;
    await db
      .update(devices)
      .set({
        hostname: data.hostname,
        status: 'active',
        credentialHash,
        enrollmentTokenId: matchedToken.id,
        clientId: matchedToken.clientId ?? existingDevice.clientId,
        siteId: matchedToken.siteId ?? existingDevice.siteId,
        agentVersion: data.agent_version ?? null,
        publicIp,
        uninstalledAt: null,
      })
      .where(eq(devices.id, deviceId));
  } else {
    // Alta nueva
    const inserted = await db
      .insert(devices)
      .values({
        organizationId: orgId,
        clientId: matchedToken.clientId,
        siteId: matchedToken.siteId,
        hostname: data.hostname,
        status: matchedToken.clientId ? 'active' : 'pending_assignment',
        deviceTypeHint: data.device_type_hint ?? null,
        hardwareSmbiousUuid: smbiosUuid,
        hardwareSerial: data.serial_number ?? null,
        publicIp,
        credentialHash,
        enrollmentTokenId: matchedToken.id,
        agentVersion: data.agent_version ?? null,
      })
      .returning({ id: devices.id });

    deviceId = inserted[0].id;

    // Crear fila inicial en device_current_state
    await db.insert(deviceCurrentState).values({
      deviceId,
      organizationId: orgId,
    }).onConflictDoNothing();
  }

  return NextResponse.json({
    device_id: deviceId,
    device_secret: secret,
    config: DEFAULT_CONFIG,
    request_inventory: true,
  });
}
