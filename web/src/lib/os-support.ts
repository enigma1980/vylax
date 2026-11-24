/**
 * Tabla de versiones de Windows con fechas de fin de soporte.
 * Clave: build mayor (antes del punto). Valor: fecha de fin de soporte mainstream.
 *
 * Build menor (p.ej. 19045.6466) → se extrae solo la parte antes del punto.
 * Build desconocido → conservador: no soportado.
 */

const EOL_DATES: Record<string, Date> = {
  // Windows 10
  '19041': new Date('2021-12-14'), // 2004
  '19042': new Date('2022-05-10'), // 20H2
  '19043': new Date('2022-12-13'), // 21H1
  '19044': new Date('2023-06-13'), // 21H2 Home/Pro
  '19045': new Date('2025-10-14'), // 22H2 Home/Pro  ← ya caducado
  // Windows 11
  '22000': new Date('2023-10-10'), // 21H2 Home/Pro
  '22621': new Date('2024-10-08'), // 22H2 Home/Pro
  '22631': new Date('2025-11-11'), // 23H2
  '26100': new Date('2027-04-14'), // 24H2 Enterprise/Education
  // Windows Server
  '14393': new Date('2027-01-12'), // Server 2016
  '17763': new Date('2029-01-09'), // Server 2019
  '20348': new Date('2031-10-14'), // Server 2022
  '26080': new Date('2034-10-10'), // Server 2025
};

function majorBuild(buildNumber: string): string {
  return buildNumber.split('.')[0];
}

export function isOsSupported(buildNumber: string, now: Date = new Date()): boolean {
  const eol = EOL_DATES[majorBuild(buildNumber)];
  if (!eol) return false; // desconocido → conservador
  return now < eol;
}

export function getEolDate(buildNumber: string): Date | null {
  return EOL_DATES[majorBuild(buildNumber)] ?? null;
}
