/**
 * Tabla de versiones de Windows con fechas de fin de soporte.
 *
 * La EOL depende de la edición: Pro/Home tiene soporte más corto que Enterprise/Education.
 * Se pasa el nombre del SO del inventario (os.name) para detectar la edición.
 * Windows Server usa siempre la tabla Enterprise (solo existe esa edición).
 *
 * Build menor (p.ej. 19045.6466) → se extrae solo la parte antes del punto.
 * Build o edición desconocidos → conservador: no soportado.
 */

// Fin de soporte para ediciones Pro / Home
const EOL_PRO: Record<string, Date> = {
  // Windows 10 (misma fecha en todas las ediciones)
  '19041': new Date('2021-12-14'), // 2004
  '19042': new Date('2022-05-10'), // 20H2
  '19043': new Date('2022-12-13'), // 21H1
  '19044': new Date('2023-06-13'), // 21H2
  '19045': new Date('2025-10-14'), // 22H2
  // Windows 11 Pro / Home
  '22000': new Date('2023-10-10'), // 21H2
  '22621': new Date('2024-10-08'), // 22H2
  '22631': new Date('2025-11-11'), // 23H2
  '26100': new Date('2026-10-13'), // 24H2
};

// Fin de soporte para ediciones Enterprise / Education y Windows Server
const EOL_ENT: Record<string, Date> = {
  // Windows 10 (misma fecha que Pro para todos estos builds)
  '19041': new Date('2021-12-14'),
  '19042': new Date('2022-05-10'),
  '19043': new Date('2022-12-13'),
  '19044': new Date('2023-06-13'),
  '19045': new Date('2025-10-14'),
  // Windows 11 Enterprise / Education
  '22000': new Date('2024-10-08'), // 21H2
  '22621': new Date('2025-10-14'), // 22H2
  '22631': new Date('2026-11-10'), // 23H2
  '26100': new Date('2028-10-10'), // 24H2
  // Windows Server
  '14393': new Date('2027-01-12'), // Server 2016
  '17763': new Date('2029-01-09'), // Server 2019
  '20348': new Date('2031-10-14'), // Server 2022
  '26080': new Date('2034-10-10'), // Server 2025
};

function majorBuild(buildNumber: string): string {
  return buildNumber.split('.')[0];
}

/** Detecta edición Enterprise/Education o Server a partir del nombre del SO. */
function isEnterpriseEdition(osName: string | null | undefined): boolean {
  if (!osName) return false;
  const n = osName.toLowerCase();
  return n.includes('enterprise') || n.includes('education') || n.includes('server');
}

/**
 * Devuelve la fecha de fin de soporte para un build y edición.
 * Si osName no se facilita se usa la tabla Pro (más conservadora).
 * Los builds de servidor solo existen en EOL_ENT; si la tabla Pro no tiene
 * el build se hace fallback a EOL_ENT automáticamente.
 */
export function getEolDate(buildNumber: string, osName?: string | null): Date | null {
  const major = majorBuild(buildNumber);
  const ent = isEnterpriseEdition(osName);
  return (ent ? EOL_ENT[major] : EOL_PRO[major]) ?? EOL_ENT[major] ?? null;
}

export function isOsSupported(
  buildNumber: string,
  osName?: string | null,
  now: Date = new Date(),
): boolean {
  const eol = getEolDate(buildNumber, osName);
  if (!eol) return false;
  return now < eol;
}
