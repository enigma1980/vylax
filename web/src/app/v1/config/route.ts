import { NextRequest, NextResponse } from 'next/server';
import { authenticateDevice } from '@/lib/device-auth';
import { DEFAULT_CONFIG } from '@/lib/config-defaults';

export async function GET(req: NextRequest) {
  const device = await authenticateDevice(req);
  if (!device) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    schema_version: DEFAULT_CONFIG.schema_version,
    config_version: device.configVersion,
    ...DEFAULT_CONFIG,
  });
}
