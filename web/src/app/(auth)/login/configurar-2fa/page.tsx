import { db } from '@/db';
import { userOrganizations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getPartialSession } from '@/lib/dal';
import { SetupForm } from './SetupForm';

export default async function ConfigurarDosFA() {
  const session = await getPartialSession();

  const memberships = await db.query.userOrganizations.findMany({
    where: eq(userOrganizations.userId, session.userId),
  });
  const isAdmin = memberships.some(m => m.role === 'admin');

  return <SetupForm isAdmin={isAdmin} />;
}
