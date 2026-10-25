/**
 * Sales tool: put an organisation on a plan managed outside self-serve
 * checkout (Enterprise contracts, pilots, extended trials).
 *
 *   npm run billing:set-plan -w @docsign/api -- <org id or user email> <plan> [--seats N] [--months N]
 *
 * Plans: enterprise | business | starter (billed manually) | trial (extends the trial by --months, default 1).
 */
import { prisma } from '../db.js';
import { applyManualPlan } from './manual-plan.js';
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

const { org: updated, until: end } = await applyManualPlan(org.id, plan, {
  seats: rest.includes('--seats') ? flag('seats', org.seats) : undefined,
  months: rest.includes('--months') ? flag('months', 1) : undefined,
});
console.log(`${updated.name}: ${updated.plan}, ${updated.seats} seats, until ${end.toISOString().slice(0, 10)}`);
await prisma.$disconnect();
