import { db } from '@/db';
import { userOrganizations, organizations } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { getPostMfaSession } from '@/lib/dal';
import { OrgSelect } from './OrgSelect';

export default async function OrganizacionPage() {
  const session = await getPostMfaSession();

  const memberships = await db.query.userOrganizations.findMany({
    where: eq(userOrganizations.userId, session.userId),
  });

  const orgIds = memberships.map(m => m.orgId);
  const orgsData = orgIds.length > 0
    ? await db.select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(inArray(organizations.id, orgIds))
    : [];

  const orgMap = new Map(orgsData.map(o => [o.id, o.name]));
  const orgs = memberships.map(m => ({
    id:   m.orgId,
    name: orgMap.get(m.orgId) ?? m.orgId,
    role: m.role,
  }));

  return <OrgSelect orgs={orgs} />;
}
