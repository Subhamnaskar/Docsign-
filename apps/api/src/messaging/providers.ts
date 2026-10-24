import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { sendMail } from '../lib/mailer.js';

export type Channel = 'sms' | 'whatsapp';

export interface OtpMessage {
  /** E.164, e.g. +919876543210 */
  to: string;
  code: string;
  /** Full text for providers that send free-form messages */
  text: string;
}

export interface MessageProvider {
  readonly id: string;
  sendOtp(channel: Channel, msg: OtpMessage): Promise<void>;
}

/**
 * Development provider: no real SMS. Messages are delivered to Mailpit as an
 * email to sms-<number>@sms.local so they are easy to read while testing.
 */
const consoleProvider: MessageProvider = {
  id: 'console',
  async sendOtp(channel, msg) {
    await sendMail({
      to: `${channel}-${msg.to.replace(/\D/g, '')}@sms.local`,
      subject: `[${channel.toUpperCase()} to ${msg.to}] ${msg.text}`,
      text: msg.text,
      html: `<p>${msg.text}</p>`,
    });
  },
};

/**
 * Twilio Programmable Messaging. WhatsApp uses the same API with
 * "whatsapp:" addresses and requires an approved sender and template.
 * https://www.twilio.com/docs/messaging/api/message-resource
 */
const twilioProvider: MessageProvider = {
  id: 'twilio',
  async sendOtp(channel, msg) {
    const { accountSid, authToken, from, whatsappFrom } = config.messaging.twilio;
    if (!accountSid || !authToken) throw new Error('Twilio is not configured');
    const sender = channel === 'whatsapp' ? `whatsapp:${whatsappFrom}` : from;
    const body = new URLSearchParams({
      To: channel === 'whatsapp' ? `whatsapp:${msg.to}` : msg.to,
      From: sender,
      Body: msg.text,
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Twilio responded ${res.status}`);
  },
};

/**
 * MSG91 Flow API (India). Requires a DLT-registered template whose variable
 * is named "otp". https://docs.msg91.com/reference/send-sms
 */
const msg91Provider: MessageProvider = {
  id: 'msg91',
  async sendOtp(channel, msg) {
    if (channel !== 'sms') throw new Error('MSG91 is configured for SMS only');
    const { authKey, templateId } = config.messaging.msg91;
    if (!authKey || !templateId) throw new Error('MSG91 is not configured');
    const res = await fetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: authKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [{ mobiles: msg.to.replace(/^\+/, ''), otp: msg.code }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`MSG91 responded ${res.status}`);
  },
};

const PROVIDERS: Record<string, MessageProvider> = { console: consoleProvider, twilio: twilioProvider, msg91: msg91Provider };

export async function sendOtpMessage(channel: Channel, msg: OtpMessage): Promise<void> {
  const id = channel === 'whatsapp' ? config.messaging.whatsappProvider : config.messaging.smsProvider;
  const provider = PROVIDERS[id];
  if (!provider) throw new HttpError(503, `Unknown ${channel} provider "${id}".`, 'messaging_unavailable');
  try {
    await provider.sendOtp(channel, msg);
  } catch {
    throw new HttpError(503, `We couldn't send a code by ${channel === 'sms' ? 'SMS' : 'WhatsApp'}. Try again shortly.`, 'messaging_failed');
  }
}

export const E164 = /^\+[1-9]\d{7,14}$/;

/** "•••• 3210": enough for the signer to recognise their number. */
export const maskPhone = (phone: string) => `•••• ${phone.slice(-4)}`;
