import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { RTL_LOCALES, t } from '../i18n/messages.js';
import { mailIdentityFor } from '../governance/delivery.js';

const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
});

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  /** Sending organisation: its sender name, reply-to and verified domain (DKIM) are used */
  orgId?: string;
}

export async function sendMail(mail: Mail): Promise<void> {
  const { orgId, ...rest } = mail;
  const identity = orgId ? await mailIdentityFor(orgId) : { from: config.smtp.from };
  await transport.sendMail({ ...identity, ...rest });
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Minimal branded email layout. */
export function layout(opts: {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footer?: string;
  locale?: string;
  /** Sending organisation's branding; defaults to DocSign's. */
  brand?: { name: string; color: string | null; logoUrl: string | null };
}): { html: string; text: string } {
  const lang = opts.locale ?? 'en';
  const dir = RTL_LOCALES.includes(lang) ? 'rtl' : 'ltr';
  const color = opts.brand?.color ?? '#9a6f08';
  const header = opts.brand?.logoUrl
    ? `<img src="${escape(opts.brand.logoUrl)}" alt="${escape(opts.brand.name)}" style="max-height:40px;max-width:200px">`
    : `<div style="font-weight:700;font-size:18px;color:${color}">${escape(opts.brand?.name ?? 'DocSign')}</div>`;
  const ps = opts.paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.5">${escape(p)}</p>`).join('');
  const button = opts.button
    ? `<p style="margin:24px 0"><a href="${escape(opts.button.url)}" style="background:${color};color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escape(opts.button.label)}</a></p>`
    : '';
  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#f4f4f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
<div style="margin-bottom:16px">${header}</div>
<div style="background:#fff;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${escape(opts.heading)}</h1>${ps}${button}
</div>
<p style="font-size:12px;color:#6b7280;margin-top:16px;line-height:1.5">${escape(
    opts.footer ?? t(lang, 'personalLinkFooter'),
  )}${opts.brand ? '<br>Sent securely via DocSign.' : ''}</p>
</div></body></html>`;
  const text = [
    opts.heading,
    '',
    ...opts.paragraphs,
    ...(opts.button ? ['', `${opts.button.label}: ${opts.button.url}`] : []),
  ].join('\n');
  return { html, text };
}
