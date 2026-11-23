import { hash, verify } from '@node-rs/argon2';

export const hashPassword  = hash;
export const verifyPassword = verify;

/** Hash ficticio para malgastar tiempo cuando el correo no existe (evitar enumeración). */
let _dummyHash: string | null = null;
export async function getDummyHash(): Promise<string> {
  if (!_dummyHash) _dummyHash = await hash('__vylax_timing_dummy__');
  return _dummyHash;
}
