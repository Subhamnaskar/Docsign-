import type { Recipient } from '@prisma/client';
import { prisma } from '../db.js';

/**
 * Adds everyone an agreement was sent to into the address book, or refreshes
 * when they were last sent to. Names and details people edited by hand win.
 */
export async function rememberRecipients(orgId: string, recipients: Pick<Recipient, 'name' | 'email' | 'locale'>[]) {
  const now = new Date();
  for (const r of recipients) {
    const email = r.email.trim().toLowerCase();
    if (!email) continue;
    await prisma.contact.upsert({
      where: { orgId_email: { orgId, email } },
      create: { orgId, email, name: r.name.trim() || email, locale: r.locale, source: 'auto', lastSentAt: now },
      update: { lastSentAt: now },
    });
  }
}

/** Splits one CSV line, honouring double quotes. */
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export interface ContactRow {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  locale?: string;
  tags?: string[];
}

const HEADERS: Record<string, keyof ContactRow> = {
  name: 'name',
  'full name': 'name',
  email: 'email',
  'email address': 'email',
  phone: 'phone',
  mobile: 'phone',
  company: 'company',
  organisation: 'company',
  organization: 'company',
  title: 'jobTitle',
  'job title': 'jobTitle',
  language: 'locale',
  locale: 'locale',
  tags: 'tags',
};

/** Parses a contacts CSV with a header row; unknown columns are ignored. */
export function parseContactsCsv(csv: string): { rows: ContactRow[]; problems: string[] } {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { rows: [], problems: ['The file is empty.'] };
  const header = csvLine(lines[0]).map((h) => HEADERS[h.toLowerCase()]);
  if (!header.includes('email')) return { rows: [], problems: ['Add a header row with at least an "email" column.'] };
  const rows: ContactRow[] = [];
  const problems: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = csvLine(line);
    const row: Partial<ContactRow> = {};
    header.forEach((key, j) => {
      const v = cells[j];
      if (!key || !v) return;
      if (key === 'tags') row.tags = v.split(/[;|]/).map((t) => t.trim()).filter(Boolean);
      else row[key] = v;
    });
    const email = row.email?.toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      problems.push(`Row ${i + 2}: missing or invalid email.`);
      return;
    }
    rows.push({ ...row, email, name: row.name || email } as ContactRow);
  });
  return { rows, problems };
}
