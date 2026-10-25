/**
 * Sales tool: put an organisation on a plan managed outside self-serve
 * checkout (Enterprise contracts, pilots, extended trials).
 *
 *   npm run billing:set-plan -w @docsign/api -- <org id or user email> <plan> [--seats N] [--months N]
 *
 * Plans: enterprise | business | starter (billed manually) | trial (extends the trial by --months, default 1).
 */
import { prisma } from '../db.js';
import { isPlanId } from './plans.js';

const [who, plan, ...rest] = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? Number(rest[i + 1]) : fallback;
};

if (!who || !plan || !isPlanId(plan)) {
  console.error('Usage: set-plan <org id or user email> <trial|starter|business|enterprise> [--seats N] [--months N]');
  process.exit(1);
}

const org = who.includes('@')
  ? (await prisma.user.findUnique({ where: { email: who.toLowerCase() }, include: { org: true } }))?.org
  : await prisma.organization.findUnique({ where: { id: who } });
if (!org) {
  console.error(`No organisation found for ${who}`);
  process.exit(1);
}

const months = flag('months', plan === 'trial' ? 1 : 12);
const end = new Date();
end.setUTCMonth(end.getUTCMonth() + months);

const updated =
  plan === 'trial'
    ? await prisma.organization.update({ where: { id: org.id }, data: { plan, billingStatus: 'TRIALING', trialEndsAt: end } })
    : await prisma.organization.update({
        where: { id: org.id },
        data: {
          plan,
          seats: flag('seats', org.seats),
          billingStatus: 'ACTIVE',
          billingProvider: 'manual',
          subscriptionRef: null,
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date(),
          currentPeriodEnd: end,
        },
      });
console.log(`${updated.name}: ${updated.plan}, ${updated.seats} seats, until ${end.toISOString().slice(0, 10)}`);
await prisma.$disconnect();
