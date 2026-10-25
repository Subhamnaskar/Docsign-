'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Sender-app translations (signers have their own in lib/i18n.ts). English
 * and Hindi; add a language by adding a dictionary with the same keys.
 * The Hindi is a first draft: have a native speaker review it before launch.
 */

const en = {
  // Navigation and shell
  'nav.home': 'Home',
  'nav.agreements': 'Agreements',
  'nav.workflows': 'Workflows',
  'nav.contacts': 'Contacts',
  'nav.templates': 'Templates',
  'nav.repository': 'Repository',
  'nav.reports': 'Reports',
  'nav.verify': 'Verify',
  'nav.settings': 'Settings',
  'nav.help': 'Help',
  'nav.signOut': 'Sign out',
  'nav.console': 'Platform console',
  'banner.confirmEmail': 'Confirm your email address to start sending. We sent a link to {email}.',
  'banner.resend': 'Resend email',
  'banner.resent': 'Sent. Check your inbox.',
  'banner.mfaRequired': 'Your organisation requires two-factor authentication. Set it up below to continue.',
  'banner.trialEnds': 'Your free trial ends in {days} day(s).',
  'banner.paymentFailed': 'Your last payment failed. Update your payment method to avoid interruption.',
  'banner.choosePlan': 'Choose a plan',
  'banner.goToBilling': 'Go to billing',
  'banner.askAdmin': 'Ask an admin to choose a plan.',
  // Dashboard
  'dash.title': 'Agreements',
  'dash.subtitle': 'Send documents for signature and track their progress.',
  'dash.export': 'Export CSV',
  'dash.new': '+ New agreement',
  'dash.awaitingOthers': 'Awaiting others',
  'dash.completed': 'Completed',
  'dash.drafts': 'Drafts',
  'dash.declinedExpired': 'Declined / expired',
  'dash.filterAll': 'All',
  'dash.waiting': 'Waiting for others',
  'dash.inReview': 'In review',
  'dash.sentByMe': 'Sent by me',
  'dash.awaitingApproval': 'Awaiting approval',
  'dash.search': 'Search title or recipient',
  'dash.selected': '{n} selected',
  'dash.downloadSigned': 'Download signed',
  'dash.moveToFolder': 'Move to folder…',
  'dash.removeFromFolder': 'Remove from folder',
  'dash.clear': 'Clear',
  'dash.noMatching': 'No matching agreements',
  'dash.noneYet': 'No agreements yet',
  'dash.createFirst': 'Create your first agreement to send it for signature.',
  'dash.to': 'To: {names}',
  'dash.noRecipients': 'No recipients yet',
  'dash.from': 'from {name}',
  'dash.signedOf': '{signed} of {total} signed',
  'dash.test': 'Test',
  // Statuses
  'status.DRAFT': 'Draft',
  'status.SENT': 'Out for signature',
  'status.COMPLETED': 'Completed',
  'status.DECLINED': 'Declined',
  'status.VOIDED': 'Voided',
  'status.EXPIRED': 'Expired',
  'status.CREATED': 'Waiting',
  'status.VIEWED': 'Viewed',
  'status.SIGNED': 'Signed',
  'status.recipientSent': 'Sent',
  // Builder
  'builder.documents': 'Documents',
  'builder.recipients': 'Recipients',
  'builder.fields': 'Fields',
  'builder.review': 'Review & send',
  // Agreement page
  'env.back': '← Agreements',
  'env.remind': 'Send reminder',
  'env.void': 'Void',
  'env.duplicate': 'Duplicate',
  'env.saveTemplate': 'Save as template',
  'env.recipients': 'Recipients',
  'env.documents': 'Documents',
  'env.audit': 'Audit trail',
  // Settings
  'settings.title': 'Settings',
  'tab.organization': 'Organization',
  'tab.security': 'Security',
  'tab.team': 'Team',
  'tab.billing': 'Billing',
  'tab.branding': 'Branding',
  'tab.sso': 'Single sign-on',
  'tab.departments': 'Departments',
  'tab.integrations': 'Integrations',
  'tab.governance': 'Governance',
  'tab.developers': 'API & webhooks',
  'tab.activity': 'Activity',
  'profile.title': 'Profile',
  'profile.name': 'Name',
  'profile.language': 'App language',
  'profile.languageHint': 'Signers see emails and the signing page in the language you choose for each of them.',
  'common.save': 'Save',
  'common.saved': 'Saved',
  // Sign in and registration
  'auth.signIn': 'Sign in',
  'auth.newHere': 'New here?',
  'auth.createAccount': 'Create an account',
  'auth.email': 'Email',
  'auth.workEmail': 'Work email',
  'auth.password': 'Password',
  'auth.forgot': 'Forgot password?',
  'auth.withSso': 'Sign in with SSO',
  'auth.withPassword': 'Sign in with a password instead',
  'auth.continueSso': 'Continue with SSO',
};

export type AppKey = keyof typeof en;

const hi: Record<AppKey, string> = {
  'nav.home': 'होम',
  'nav.agreements': 'समझौते',
  'nav.workflows': 'वर्कफ़्लो',
  'nav.contacts': 'संपर्क',
  'nav.templates': 'टेम्पलेट',
  'nav.repository': 'संग्रह',
  'nav.reports': 'रिपोर्ट',
  'nav.verify': 'सत्यापन',
  'nav.settings': 'सेटिंग्स',
  'nav.help': 'सहायता',
  'nav.signOut': 'साइन आउट',
  'nav.console': 'प्लेटफ़ॉर्म कंसोल',
  'banner.confirmEmail': 'भेजना शुरू करने के लिए अपने ईमेल पते की पुष्टि करें। हमने {email} पर एक लिंक भेजा है।',
  'banner.resend': 'ईमेल दोबारा भेजें',
  'banner.resent': 'भेज दिया गया। अपना इनबॉक्स देखें।',
  'banner.mfaRequired': 'आपके संगठन में दो-चरणीय सत्यापन ज़रूरी है। जारी रखने के लिए इसे नीचे सेट करें।',
  'banner.trialEnds': 'आपका निःशुल्क ट्रायल {days} दिन में समाप्त हो जाएगा।',
  'banner.paymentFailed': 'आपका पिछला भुगतान नहीं हो सका। रुकावट से बचने के लिए भुगतान का तरीका अपडेट करें।',
  'banner.choosePlan': 'प्लान चुनें',
  'banner.goToBilling': 'बिलिंग पर जाएँ',
  'banner.askAdmin': 'प्लान चुनने के लिए किसी एडमिन से कहें।',
  'dash.title': 'समझौते',
  'dash.subtitle': 'हस्ताक्षर के लिए दस्तावेज़ भेजें और उनकी प्रगति देखें।',
  'dash.export': 'CSV डाउनलोड करें',
  'dash.new': '+ नया समझौता',
  'dash.awaitingOthers': 'दूसरों की प्रतीक्षा में',
  'dash.completed': 'पूर्ण',
  'dash.drafts': 'ड्राफ़्ट',
  'dash.declinedExpired': 'अस्वीकृत / समय-सीमा समाप्त',
  'dash.filterAll': 'सभी',
  'dash.waiting': 'दूसरों की प्रतीक्षा में',
  'dash.inReview': 'समीक्षा में',
  'dash.sentByMe': 'मेरे द्वारा भेजे गए',
  'dash.awaitingApproval': 'स्वीकृति की प्रतीक्षा में',
  'dash.search': 'शीर्षक या प्राप्तकर्ता खोजें',
  'dash.selected': '{n} चुने गए',
  'dash.downloadSigned': 'हस्ताक्षरित डाउनलोड करें',
  'dash.moveToFolder': 'फ़ोल्डर में ले जाएँ…',
  'dash.removeFromFolder': 'फ़ोल्डर से निकालें',
  'dash.clear': 'साफ़ करें',
  'dash.noMatching': 'कोई मिलता-जुलता समझौता नहीं मिला',
  'dash.noneYet': 'अभी तक कोई समझौता नहीं',
  'dash.createFirst': 'हस्ताक्षर के लिए भेजने हेतु अपना पहला समझौता बनाएँ।',
  'dash.to': 'प्रति: {names}',
  'dash.noRecipients': 'अभी कोई प्राप्तकर्ता नहीं',
  'dash.from': '{name} द्वारा',
  'dash.signedOf': '{total} में से {signed} ने हस्ताक्षर किए',
  'dash.test': 'परीक्षण',
  'status.DRAFT': 'ड्राफ़्ट',
  'status.SENT': 'हस्ताक्षर के लिए भेजा गया',
  'status.COMPLETED': 'पूर्ण',
  'status.DECLINED': 'अस्वीकृत',
  'status.VOIDED': 'रद्द',
  'status.EXPIRED': 'समय-सीमा समाप्त',
  'status.CREATED': 'प्रतीक्षा में',
  'status.VIEWED': 'देखा गया',
  'status.SIGNED': 'हस्ताक्षरित',
  'status.recipientSent': 'भेजा गया',
  'builder.documents': 'दस्तावेज़',
  'builder.recipients': 'प्राप्तकर्ता',
  'builder.fields': 'फ़ील्ड',
  'builder.review': 'समीक्षा करें और भेजें',
  'env.back': '← समझौते',
  'env.remind': 'रिमाइंडर भेजें',
  'env.void': 'रद्द करें',
  'env.duplicate': 'प्रतिलिपि बनाएँ',
  'env.saveTemplate': 'टेम्पलेट के रूप में सहेजें',
  'env.recipients': 'प्राप्तकर्ता',
  'env.documents': 'दस्तावेज़',
  'env.audit': 'ऑडिट ट्रेल',
  'settings.title': 'सेटिंग्स',
  'tab.organization': 'संगठन',
  'tab.security': 'सुरक्षा',
  'tab.team': 'टीम',
  'tab.billing': 'बिलिंग',
  'tab.branding': 'ब्रांडिंग',
  'tab.sso': 'सिंगल साइन-ऑन',
  'tab.departments': 'विभाग',
  'tab.integrations': 'इंटीग्रेशन',
  'tab.governance': 'डेटा नियंत्रण',
  'tab.developers': 'API और वेबहुक',
  'tab.activity': 'गतिविधि',
  'profile.title': 'प्रोफ़ाइल',
  'profile.name': 'नाम',
  'profile.language': 'ऐप की भाषा',
  'profile.languageHint': 'हस्ताक्षरकर्ताओं को ईमेल और हस्ताक्षर पेज उसी भाषा में दिखते हैं जो आप हर एक के लिए चुनते हैं।',
  'common.save': 'सहेजें',
  'common.saved': 'सहेजा गया',
  'auth.signIn': 'साइन इन करें',
  'auth.newHere': 'नए हैं?',
  'auth.createAccount': 'खाता बनाएँ',
  'auth.email': 'ईमेल',
  'auth.workEmail': 'कार्यालय का ईमेल',
  'auth.password': 'पासवर्ड',
  'auth.forgot': 'पासवर्ड भूल गए?',
  'auth.withSso': 'SSO से साइन इन करें',
  'auth.withPassword': 'इसके बजाय पासवर्ड से साइन इन करें',
  'auth.continueSso': 'SSO के साथ जारी रखें',
};

export const APP_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'हिन्दी (Hindi)' },
] as const;

const DICTS: Record<string, Record<AppKey, string>> = { en, hi };

export function appT(locale: string, key: AppKey, vars: Record<string, string | number> = {}) {
  const text = (DICTS[locale] ?? en)[key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export type AppTranslate = (key: AppKey, vars?: Record<string, string | number>) => string;

/** Provided by the app shell from the signed-in user's language. */
export const AppLocaleContext = createContext('en');

export function useAppT(): AppTranslate {
  const locale = useContext(AppLocaleContext);
  return useCallback((key, vars) => appT(locale, key, vars), [locale]);
}

const STORED = 'ds_app_locale';

/** Language before sign-in (login, registration), remembered on this device. */
export function useStoredLocale(): [string, (l: string) => void] {
  const [locale, setLocale] = useState('en');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORED);
      if (saved && DICTS[saved]) setLocale(saved);
      else if (navigator.language.toLowerCase().startsWith('hi')) setLocale('hi');
    } catch {
      // storage unavailable: English
    }
  }, []);
  const set = (l: string) => {
    setLocale(l);
    try {
      localStorage.setItem(STORED, l);
    } catch {
      // ignore
    }
  };
  return [locale, set];
}
