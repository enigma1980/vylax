import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getPartialSession } from '@/lib/dal';
import { VerifyForm } from './VerifyForm';

export default async function Verificacion() {
  const session = await getPartialSession();

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  const method = user?.twoFaMethod ?? null;
  const email  = user?.email ?? '';

  return <VerifyForm method={method} email={email} />;
}
