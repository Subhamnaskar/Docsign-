import { z } from 'zod';

export const MANDATE_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'AS_PRESENTED'] as const;

/** MANDATE field settings: debit frequency and how many months the mandate runs. */
export const mandateConfig = z.object({ frequency: z.enum(MANDATE_FREQUENCIES).default('MONTHLY'), months: z.number().int().min(1).max(360).default(12) });
