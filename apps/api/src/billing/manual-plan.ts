import { prisma } from '../db.js';
import type { PlanId } from './plans.js';

/**
 * Puts an organisation on a plan managed outside self-serve checkout
 * (Enterprise contracts, pilots, extended trials). Used by the set-plan
 * script and the platform console.
 *
 * `trial` extends the trial by `months`; other plans are billed manually
 * for `months` from today.
 */
export async function applyManualPlan(orgId: string, plan: PlanId, opts: { seats?: number; months?: number } = {}) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
  });
  const months = opts.months ?? (plan === 'trial' ? 1 : 12);
  const end = new Date();
  end.setUTCMonth(end.getUTCMonth() + months);
  const updated =
    plan === 'trial'
      ? await prisma.organization.update({
          where: { id: org.id },
          data: { plan, billingStatus: 'TRIALING', trialEndsAt: end },
        })
      : await prisma.organization.update({
          where: { id: org.id },
          data: {
            plan,
            seats: opts.seats ?? org.seats,
            billingStatus: 'ACTIVE',
            billingProvider: 'manual',
            subscriptionRef: null,
            cancelAtPeriodEnd: false,
            currentPeriodStart: new Date(),
            currentPeriodEnd: end,
          },
        });
  return { org: updated, until: end };
}
