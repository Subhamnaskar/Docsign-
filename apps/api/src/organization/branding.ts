import { config } from '../config.js';
import { prisma } from '../db.js';

export interface Branding {
  name: string;
  color: string | null;
  logoUrl: string | null;
}

/** Public branding for an organisation, used on emails and the signing page. */
export async function getBranding(orgId: string): Promise<Branding> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, brandColor: true, logoKey: true } });
  return {
    name: org.name,
    color: org.brandColor,
    // The key changes on every upload, so it doubles as a cache buster
    logoUrl: org.logoKey ? `${config.appUrl}/api/v1/branding/${orgId}/logo?v=${org.logoKey.split('/').pop()}` : null,
  };
}
