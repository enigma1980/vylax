import { NextRequest, NextResponse } from 'next/server';
import { authenticateDevice } from '@/lib/device-auth';
import { DEFAULT_CONFIG } from '@/lib/config-defaults';

export async function GET(req: NextRequest) {
  const device = await authenticateDevice(req);
  if (device === 'gone') {
    return NextResponse.json({ error: 'equipo desinstalado' }, { status: 410 });
  }
  if (!device) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    ...DEFAULT_CONFIG,
    config_version: device.configVersion,  // version real del dispositivo
  });
}
