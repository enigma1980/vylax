import { NextRequest, NextResponse } from 'next/server';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { db } from '@/db';
import { clients, devices, deviceCurrentState } from '@/db/schema';
import { eq, or, ilike, sql, and } from 'drizzle-orm';

function escapeLike(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export async function GET(req: NextRequest) {
  let session;
  try {
    session = await getSession('route');
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    throw e;
  }

  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (q.length < 2) {
    return NextResponse.json({ clients: [], devices: [] });
  }

  const pattern = `%${escapeLike(q)}%`;

  const [clientsResult, devicesResult] = await Promise.all([
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.organizationId, session.orgId), ilike(clients.name, pattern)))
      .limit(5),

    db
      .selectDistinct({
        id: devices.id,
        hostname: devices.hostname,
        publicIp: devices.publicIp,
      })
      .from(devices)
      .leftJoin(deviceCurrentState, eq(devices.id, deviceCurrentState.deviceId))
      .where(
        and(
          eq(devices.organizationId, session.orgId),
          or(
            ilike(devices.hostname, pattern),
            ilike(devices.publicIp, pattern),
            sql`${deviceCurrentState.network}::text ilike ${pattern}`,
          ),
        ),
      )
      .limit(5),
  ]);

  return NextResponse.json({ clients: clientsResult, devices: devicesResult });
}
