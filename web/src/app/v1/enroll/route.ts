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
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return null;
}

const bodySchema = z.object({
  schema_version:    z.number().optional(),
  enrollment_token:  z.string(),
  agent_version:     z.string().optional(),
  hostname:          z.string(),
  hardware_id: z.object({
    smbios_uuid:   z.string().optional(),
    serial_number: z.string().optional(),
  }).optional(),
  os:               z.any().optional(),
  device_type_hint: z.string().optional(),
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

  try {
    return await handleEnroll(req, parsed.data);
  } catch (err) {
    console.error('[enroll] error interno:', err);
    return NextResponse.json({ error: 'error interno del servidor' }, { status: 500 });
  }
}

async function handleEnroll(
  req: NextRequest,
  data: ReturnType<typeof bodySchema.parse>,
) {
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
  const rawUuid = data.hardware_id?.smbios_uuid;
  const smbiosUuid =
    rawUuid && !isPlaceholderUuid(rawUuid) ? rawUuid : null;

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
  let deviceStatus: string;

  if (existingDevice) {
    // Reinstalación: reutilizar el mismo device_id, rotar credencial
    const finalClientId = matchedToken.clientId ?? existingDevice.clientId;
    deviceStatus = finalClientId ? 'active' : 'pending_assignment';

    await db
      .update(devices)
      .set({
        hostname:          data.hostname,
        status:            deviceStatus,
        credentialHash,
        enrollmentTokenId: matchedToken.id,
        clientId:          finalClientId,
        siteId:            matchedToken.siteId ?? existingDevice.siteId,
        agentVersion:      data.agent_version ?? null,
        publicIp,
        uninstalledAt:     null,
      })
      .where(eq(devices.id, existingDevice.id));

    deviceId = existingDevice.id;

    // Garantizar que existe la fila de estado (puede faltar en dispositivos creados manualmente)
    await db.insert(deviceCurrentState).values({
      deviceId,
      organizationId: orgId,
    }).onConflictDoNothing();
  } else {
    // Alta nueva
    deviceStatus = matchedToken.clientId ? 'active' : 'pending_assignment';
    const inserted = await db
      .insert(devices)
      .values({
        organizationId:      orgId,
        clientId:            matchedToken.clientId,
        siteId:              matchedToken.siteId,
        hostname:            data.hostname,
        status:              deviceStatus,
        deviceTypeHint:      data.device_type_hint ?? null,
        hardwareSmbiousUuid: smbiosUuid,
        hardwareSerial:      data.hardware_id?.serial_number ?? null,
        publicIp,
        credentialHash,
        enrollmentTokenId:   matchedToken.id,
        agentVersion:        data.agent_version ?? null,
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
    device_id:     deviceId,
    device_secret: secret,
    status:        deviceStatus,
    config:        DEFAULT_CONFIG,
  });
}
