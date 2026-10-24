/**
 * Strings for emails sent to signers. Recipients have a `locale`; senders
 * pick it per recipient. Translations are first drafts and should be reviewed
 * by native speakers (and legal, for consent wording) before production use.
 */

export const SUPPORTED_LOCALES = ['en', 'hi', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ar', 'ja'];
export const RTL_LOCALES = ['ar'];

type Messages = {
  inviteSubject: string;
  inviteHeading: string;
  reminderSubject: string;
  reminderHeading: string;
  hello: string;
  waiting: string;
  senderMessage: string;
  expires: string;
  reviewAndSign: string;
  otpSubject: string;
  otpHeading: string;
  otpIntro: string;
  otpExpiry: string;
  completedSubject: string;
  completedBody: string;
  completedAttached: string;
  completedTooLarge: string;
  voidedSubject: string;
  voidedBody: string;
  reason: string;
  personalLinkFooter: string;
};

const en: Messages = {
  inviteSubject: 'Please sign: {title}',
  inviteHeading: '{sender} sent you a document to sign',
  reminderSubject: 'Reminder: {title}',
  reminderHeading: 'Reminder: please sign "{title}"',
  hello: 'Hello {name},',
  waiting: '"{title}" is waiting for your signature.',
  senderMessage: 'Message from {sender}: {message}',
  expires: 'This request expires on {date}.',
  reviewAndSign: 'Review and sign',
  otpSubject: '{code} is your DocSign verification code',
  otpHeading: 'Your signing code',
  otpIntro: 'Use this code to verify your identity and open "{title}":',
  otpExpiry: 'The code expires in 10 minutes. If you did not request it, ignore this email.',
  completedSubject: 'Completed: {title}',
  completedBody: 'All parties have signed "{title}".',
  completedAttached: 'The signed documents and the certificate of completion are attached. Keep them for your records.',
  completedTooLarge: 'The signed documents are too large to attach. The sender can share them from DocSign.',
  voidedSubject: 'Voided: {title}',
  voidedBody: 'The sender has voided "{title}". No further action is needed.',
  reason: 'Reason: {reason}',
  personalLinkFooter: 'Do not share this email. The link above is personal to you.',
};

const MESSAGES: Record<string, Messages> = {
  en,
  hi: {
    inviteSubject: 'कृपया हस्ताक्षर करें: {title}',
    inviteHeading: '{sender} ने आपको हस्ताक्षर के लिए एक दस्तावेज़ भेजा है',
    reminderSubject: 'अनुस्मारक: {title}',
    reminderHeading: 'अनुस्मारक: कृपया "{title}" पर हस्ताक्षर करें',
    hello: 'नमस्ते {name},',
    waiting: '"{title}" आपके हस्ताक्षर की प्रतीक्षा कर रहा है।',
    senderMessage: '{sender} का संदेश: {message}',
    expires: 'यह अनुरोध {date} को समाप्त हो जाएगा।',
    reviewAndSign: 'देखें और हस्ताक्षर करें',
    otpSubject: '{code} आपका DocSign सत्यापन कोड है',
    otpHeading: 'आपका हस्ताक्षर कोड',
    otpIntro: 'अपनी पहचान सत्यापित करने और "{title}" खोलने के लिए यह कोड उपयोग करें:',
    otpExpiry: 'यह कोड 10 मिनट में समाप्त हो जाएगा। यदि आपने इसका अनुरोध नहीं किया है, तो इस ईमेल को अनदेखा करें।',
    completedSubject: 'पूर्ण: {title}',
    completedBody: 'सभी पक्षों ने "{title}" पर हस्ताक्षर कर दिए हैं।',
    completedAttached: 'हस्ताक्षरित दस्तावेज़ और पूर्णता प्रमाणपत्र संलग्न हैं। इन्हें अपने रिकॉर्ड के लिए रखें।',
    completedTooLarge: 'हस्ताक्षरित दस्तावेज़ संलग्न करने के लिए बहुत बड़े हैं। प्रेषक इन्हें DocSign से साझा कर सकता है।',
    voidedSubject: 'रद्द: {title}',
    voidedBody: 'प्रेषक ने "{title}" को रद्द कर दिया है। कोई और कार्रवाई आवश्यक नहीं है।',
    reason: 'कारण: {reason}',
    personalLinkFooter: 'यह ईमेल साझा न करें। ऊपर दिया गया लिंक केवल आपके लिए है।',
  },
  es: {
    inviteSubject: 'Firme, por favor: {title}',
    inviteHeading: '{sender} le ha enviado un documento para firmar',
    reminderSubject: 'Recordatorio: {title}',
    reminderHeading: 'Recordatorio: firme "{title}"',
    hello: 'Hola, {name}:',
    waiting: '"{title}" está pendiente de su firma.',
    senderMessage: 'Mensaje de {sender}: {message}',
    expires: 'Esta solicitud vence el {date}.',
    reviewAndSign: 'Revisar y firmar',
    otpSubject: '{code} es su código de verificación de DocSign',
    otpHeading: 'Su código de firma',
    otpIntro: 'Use este código para verificar su identidad y abrir "{title}":',
    otpExpiry: 'El código vence en 10 minutos. Si no lo ha solicitado, ignore este correo.',
    completedSubject: 'Completado: {title}',
    completedBody: 'Todas las partes han firmado "{title}".',
    completedAttached: 'Se adjuntan los documentos firmados y el certificado de finalización. Consérvelos para sus registros.',
    completedTooLarge: 'Los documentos firmados son demasiado grandes para adjuntarlos. El remitente puede compartirlos desde DocSign.',
    voidedSubject: 'Anulado: {title}',
    voidedBody: 'El remitente ha anulado "{title}". No es necesario hacer nada más.',
    reason: 'Motivo: {reason}',
    personalLinkFooter: 'No comparta este correo. El enlace anterior es personal.',
  },
  fr: {
    inviteSubject: 'À signer : {title}',
    inviteHeading: '{sender} vous a envoyé un document à signer',
    reminderSubject: 'Rappel : {title}',
    reminderHeading: 'Rappel : veuillez signer « {title} »',
    hello: 'Bonjour {name},',
    waiting: '« {title} » attend votre signature.',
    senderMessage: 'Message de {sender} : {message}',
    expires: 'Cette demande expire le {date}.',
    reviewAndSign: 'Consulter et signer',
    otpSubject: '{code} est votre code de vérification DocSign',
    otpHeading: 'Votre code de signature',
    otpIntro: 'Utilisez ce code pour vérifier votre identité et ouvrir « {title} » :',
    otpExpiry: "Le code expire dans 10 minutes. Si vous ne l'avez pas demandé, ignorez cet e-mail.",
    completedSubject: 'Terminé : {title}',
    completedBody: 'Toutes les parties ont signé « {title} ».',
    completedAttached: "Les documents signés et le certificat d'achèvement sont joints. Conservez-les dans vos archives.",
    completedTooLarge: "Les documents signés sont trop volumineux pour être joints. L'expéditeur peut les partager depuis DocSign.",
    voidedSubject: 'Annulé : {title}',
    voidedBody: "L'expéditeur a annulé « {title} ». Aucune autre action n'est nécessaire.",
    reason: 'Motif : {reason}',
    personalLinkFooter: 'Ne partagez pas cet e-mail. Le lien ci-dessus vous est personnel.',
  },
  de: {
    inviteSubject: 'Bitte unterschreiben: {title}',
    inviteHeading: '{sender} hat Ihnen ein Dokument zur Unterschrift gesendet',
    reminderSubject: 'Erinnerung: {title}',
    reminderHeading: 'Erinnerung: Bitte unterschreiben Sie „{title}“',
    hello: 'Hallo {name},',
    waiting: '„{title}“ wartet auf Ihre Unterschrift.',
    senderMessage: 'Nachricht von {sender}: {message}',
    expires: 'Diese Anfrage läuft am {date} ab.',
    reviewAndSign: 'Prüfen und unterschreiben',
    otpSubject: '{code} ist Ihr DocSign-Bestätigungscode',
    otpHeading: 'Ihr Signaturcode',
    otpIntro: 'Verwenden Sie diesen Code, um Ihre Identität zu bestätigen und „{title}“ zu öffnen:',
    otpExpiry: 'Der Code läuft in 10 Minuten ab. Falls Sie ihn nicht angefordert haben, ignorieren Sie diese E-Mail.',
    completedSubject: 'Abgeschlossen: {title}',
    completedBody: 'Alle Parteien haben „{title}“ unterschrieben.',
    completedAttached: 'Die unterschriebenen Dokumente und das Abschlusszertifikat sind beigefügt. Bitte bewahren Sie sie auf.',
    completedTooLarge: 'Die unterschriebenen Dokumente sind zu groß für einen Anhang. Der Absender kann sie über DocSign teilen.',
    voidedSubject: 'Storniert: {title}',
    voidedBody: 'Der Absender hat „{title}“ storniert. Es ist nichts weiter zu tun.',
    reason: 'Grund: {reason}',
    personalLinkFooter: 'Leiten Sie diese E-Mail nicht weiter. Der Link oben ist persönlich.',
  },
  pt: {
    inviteSubject: 'Assine, por favor: {title}',
    inviteHeading: '{sender} enviou um documento para você assinar',
    reminderSubject: 'Lembrete: {title}',
    reminderHeading: 'Lembrete: assine "{title}"',
    hello: 'Olá, {name},',
    waiting: '"{title}" está aguardando sua assinatura.',
    senderMessage: 'Mensagem de {sender}: {message}',
    expires: 'Esta solicitação expira em {date}.',
    reviewAndSign: 'Revisar e assinar',
    otpSubject: '{code} é o seu código de verificação DocSign',
    otpHeading: 'Seu código de assinatura',
    otpIntro: 'Use este código para verificar sua identidade e abrir "{title}":',
    otpExpiry: 'O código expira em 10 minutos. Se você não o solicitou, ignore este e-mail.',
    completedSubject: 'Concluído: {title}',
    completedBody: 'Todas as partes assinaram "{title}".',
    completedAttached: 'Os documentos assinados e o certificado de conclusão estão anexados. Guarde-os para seus registros.',
    completedTooLarge: 'Os documentos assinados são grandes demais para anexar. O remetente pode compartilhá-los pelo DocSign.',
    voidedSubject: 'Cancelado: {title}',
    voidedBody: 'O remetente cancelou "{title}". Nenhuma outra ação é necessária.',
    reason: 'Motivo: {reason}',
    personalLinkFooter: 'Não compartilhe este e-mail. O link acima é pessoal.',
  },
  it: {
    inviteSubject: 'Da firmare: {title}',
    inviteHeading: '{sender} ti ha inviato un documento da firmare',
    reminderSubject: 'Promemoria: {title}',
    reminderHeading: 'Promemoria: firma "{title}"',
    hello: 'Ciao {name},',
    waiting: '"{title}" è in attesa della tua firma.',
    senderMessage: 'Messaggio da {sender}: {message}',
    expires: 'Questa richiesta scade il {date}.',
    reviewAndSign: 'Rivedi e firma',
    otpSubject: '{code} è il tuo codice di verifica DocSign',
    otpHeading: 'Il tuo codice di firma',
    otpIntro: 'Usa questo codice per verificare la tua identità e aprire "{title}":',
    otpExpiry: "Il codice scade tra 10 minuti. Se non l'hai richiesto, ignora questa email.",
    completedSubject: 'Completato: {title}',
    completedBody: 'Tutte le parti hanno firmato "{title}".',
    completedAttached: 'In allegato trovi i documenti firmati e il certificato di completamento. Conservali per i tuoi archivi.',
    completedTooLarge: 'I documenti firmati sono troppo grandi per essere allegati. Il mittente può condividerli da DocSign.',
    voidedSubject: 'Annullato: {title}',
    voidedBody: 'Il mittente ha annullato "{title}". Non è necessaria alcuna azione.',
    reason: 'Motivo: {reason}',
    personalLinkFooter: 'Non condividere questa email. Il link qui sopra è personale.',
  },
  nl: {
    inviteSubject: 'Graag ondertekenen: {title}',
    inviteHeading: '{sender} heeft u een document gestuurd om te ondertekenen',
    reminderSubject: 'Herinnering: {title}',
    reminderHeading: 'Herinnering: onderteken "{title}"',
    hello: 'Beste {name},',
    waiting: '"{title}" wacht op uw handtekening.',
    senderMessage: 'Bericht van {sender}: {message}',
    expires: 'Dit verzoek verloopt op {date}.',
    reviewAndSign: 'Bekijken en ondertekenen',
    otpSubject: '{code} is uw DocSign-verificatiecode',
    otpHeading: 'Uw ondertekeningscode',
    otpIntro: 'Gebruik deze code om uw identiteit te bevestigen en "{title}" te openen:',
    otpExpiry: 'De code verloopt over 10 minuten. Hebt u deze niet aangevraagd, negeer dan deze e-mail.',
    completedSubject: 'Voltooid: {title}',
    completedBody: 'Alle partijen hebben "{title}" ondertekend.',
    completedAttached: 'De ondertekende documenten en het voltooiingscertificaat zijn bijgevoegd. Bewaar ze voor uw administratie.',
    completedTooLarge: 'De ondertekende documenten zijn te groot om bij te voegen. De afzender kan ze via DocSign delen.',
    voidedSubject: 'Ingetrokken: {title}',
    voidedBody: 'De afzender heeft "{title}" ingetrokken. U hoeft niets meer te doen.',
    reason: 'Reden: {reason}',
    personalLinkFooter: 'Deel deze e-mail niet. De link hierboven is persoonlijk.',
  },
  ar: {
    inviteSubject: 'يرجى التوقيع: {title}',
    inviteHeading: 'أرسل إليك {sender} مستندًا للتوقيع',
    reminderSubject: 'تذكير: {title}',
    reminderHeading: 'تذكير: يرجى توقيع "{title}"',
    hello: 'مرحبًا {name}،',
    waiting: '"{title}" بانتظار توقيعك.',
    senderMessage: 'رسالة من {sender}: {message}',
    expires: 'ينتهي هذا الطلب في {date}.',
    reviewAndSign: 'المراجعة والتوقيع',
    otpSubject: '{code} هو رمز التحقق الخاص بك في DocSign',
    otpHeading: 'رمز التوقيع الخاص بك',
    otpIntro: 'استخدم هذا الرمز للتحقق من هويتك وفتح "{title}":',
    otpExpiry: 'تنتهي صلاحية الرمز خلال 10 دقائق. إذا لم تطلبه، فتجاهل هذه الرسالة.',
    completedSubject: 'مكتمل: {title}',
    completedBody: 'وقّع جميع الأطراف على "{title}".',
    completedAttached: 'المستندات الموقعة وشهادة الإتمام مرفقة. احتفظ بها في سجلاتك.',
    completedTooLarge: 'المستندات الموقعة كبيرة جدًا لإرفاقها. يمكن للمرسل مشاركتها من DocSign.',
    voidedSubject: 'ملغى: {title}',
    voidedBody: 'ألغى المرسل "{title}". لا يلزم اتخاذ أي إجراء آخر.',
    reason: 'السبب: {reason}',
    personalLinkFooter: 'لا تشارك هذه الرسالة. الرابط أعلاه خاص بك.',
  },
  ja: {
    inviteSubject: '署名のお願い: {title}',
    inviteHeading: '{sender} さんから署名依頼の文書が届いています',
    reminderSubject: 'リマインダー: {title}',
    reminderHeading: 'リマインダー: 「{title}」に署名してください',
    hello: '{name} 様',
    waiting: '「{title}」があなたの署名を待っています。',
    senderMessage: '{sender} さんからのメッセージ: {message}',
    expires: 'この依頼の有効期限は {date} です。',
    reviewAndSign: '確認して署名する',
    otpSubject: 'DocSign の確認コードは {code} です',
    otpHeading: '署名用コード',
    otpIntro: '本人確認を行い「{title}」を開くには、次のコードを使用してください:',
    otpExpiry: 'このコードは 10 分後に失効します。心当たりがない場合は、このメールを無視してください。',
    completedSubject: '完了: {title}',
    completedBody: 'すべての当事者が「{title}」に署名しました。',
    completedAttached: '署名済み文書と完了証明書を添付しています。記録として保管してください。',
    completedTooLarge: '署名済み文書のサイズが大きいため添付できません。送信者が DocSign から共有できます。',
    voidedSubject: '無効: {title}',
    voidedBody: '送信者が「{title}」を無効にしました。対応は不要です。',
    reason: '理由: {reason}',
    personalLinkFooter: 'このメールを共有しないでください。上記のリンクはあなた専用です。',
  },
};

export function t(locale: string | null | undefined, key: keyof Messages, vars: Record<string, string> = {}): string {
  const template = (MESSAGES[locale ?? 'en'] ?? en)[key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export function formatDateFor(locale: string | null | undefined, date: Date): string {
  try {
    return new Intl.DateTimeFormat(locale ?? 'en', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
