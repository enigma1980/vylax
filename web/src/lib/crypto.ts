import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Genera un token de alta: vx_enr_ + 24 bytes base64url */
export function generateEnrollmentToken(): string {
  return 'vx_enr_' + randomBytes(24).toString('base64url');
}

/** Genera una credencial de dispositivo: vx_sec_ + 32 bytes base64url */
export function generateDeviceSecret(): string {
  return 'vx_sec_' + randomBytes(32).toString('base64url');
}

/** Extrae los 8 primeros caracteres del token (después del prefijo) */
export function tokenPrefix(token: string): string {
  // token = "vx_enr_<base64url>" → prefijo = chars 7..15
  return token.slice(7, 15);
}

/** Comparación en tiempo constante de dos hashes hex (mismo tamaño garantizado) */
export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
