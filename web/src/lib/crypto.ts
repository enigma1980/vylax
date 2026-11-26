import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Genera un token de alta: gq_enr_ + 24 bytes base64url */
export function generateEnrollmentToken(): string {
  return 'gq_enr_' + randomBytes(24).toString('base64url');
}

/** Genera una credencial de dispositivo: gq_sec_ + 32 bytes base64url */
export function generateDeviceSecret(): string {
  return 'gq_sec_' + randomBytes(32).toString('base64url');
}

/** Extrae los 8 primeros caracteres del token (después del prefijo de 7 chars) */
export function tokenPrefix(token: string): string {
  // token = "gq_enr_<base64url>" (o legado "vx_enr_<base64url>") → prefijo = chars 7..15
  return token.slice(7, 15);
}

/** Comparación en tiempo constante de dos hashes hex (mismo tamaño garantizado) */
export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
