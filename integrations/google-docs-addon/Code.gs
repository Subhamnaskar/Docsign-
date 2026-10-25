/**
 * DocSign for Google Docs: send the open document for signature.
 *
 * The document is exported as PDF and sent to the DocSign API with the user's
 * API key (stored in their own user properties). A draft is created with the
 * signer entered here; the user finishes fields and sends in DocSign.
 */

// Set to your DocSign URL (and add it to urlFetchWhitelist in appsscript.json).
var DOCSIGN_URL = 'https://app.example.com';

function onHomepage() {
  return buildCard_({});
}

function buildCard_(state) {
  var props = PropertiesService.getUserProperties();
  var hasKey = Boolean(props.getProperty('DOCSIGN_API_KEY'));
  var card = CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle('Send for signature'));
  var section = CardService.newCardSection();

  if (state.message) section.addWidget(CardService.newTextParagraph().setText(state.message));

  if (!hasKey) {
    section
      .addWidget(CardService.newTextParagraph().setText('Paste a DocSign API key (Settings → API & webhooks). It is stored only in your Google account.'))
      .addWidget(CardService.newTextInput().setFieldName('apiKey').setTitle('API key'))
      .addWidget(CardService.newTextButton().setText('Save key').setOnClickAction(CardService.newAction().setFunctionName('saveKey')));
    return card.addSection(section).build();
  }

  var title = DocumentApp.getActiveDocument().getName();
  section
    .addWidget(CardService.newTextInput().setFieldName('title').setTitle('Agreement title').setValue(title))
    .addWidget(CardService.newTextInput().setFieldName('signerName').setTitle('Signer name'))
    .addWidget(CardService.newTextInput().setFieldName('signerEmail').setTitle('Signer email'))
    .addWidget(CardService.newTextButton().setText('Create agreement').setOnClickAction(CardService.newAction().setFunctionName('createAgreement')))
    .addWidget(CardService.newTextButton().setText('Forget API key').setOnClickAction(CardService.newAction().setFunctionName('forgetKey')));
  return card.addSection(section).build();
}

function saveKey(e) {
  var key = (e.formInput.apiKey || '').trim();
  if (key.indexOf('dsk_') !== 0) return notify_('That does not look like a DocSign API key.');
  PropertiesService.getUserProperties().setProperty('DOCSIGN_API_KEY', key);
  return CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().updateCard(buildCard_({ message: 'Key saved.' }))).build();
}

function forgetKey() {
  PropertiesService.getUserProperties().deleteProperty('DOCSIGN_API_KEY');
  return CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().updateCard(buildCard_({}))).build();
}

function api_(method, path, payload, isMultipart) {
  var key = PropertiesService.getUserProperties().getProperty('DOCSIGN_API_KEY');
  var options = { method: method, headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true };
  if (payload !== undefined) {
    if (isMultipart) options.payload = payload;
    else {
      options.contentType = 'application/json';
      options.payload = JSON.stringify(payload);
    }
  }
  var res = UrlFetchApp.fetch(DOCSIGN_URL + '/api/v1' + path, options);
  var body = res.getContentText() ? JSON.parse(res.getContentText()) : null;
  if (res.getResponseCode() >= 400) throw new Error((body && body.error && body.error.message) || 'DocSign error ' + res.getResponseCode());
  return body;
}

function createAgreement(e) {
  try {
    var doc = DocumentApp.getActiveDocument();
    var pdf = DriveApp.getFileById(doc.getId()).getAs('application/pdf').setName(doc.getName() + '.pdf');
    var title = (e.formInput.title || doc.getName()).trim();
    var env = api_('post', '/envelopes', { title: title });
    api_('post', '/envelopes/' + env.id + '/documents', { file: pdf }, true);
    var name = (e.formInput.signerName || '').trim();
    var email = (e.formInput.signerEmail || '').trim();
    if (name && email) api_('put', '/envelopes/' + env.id + '/recipients', [{ name: name, email: email }]);
    var url = DOCSIGN_URL + '/envelopes/' + env.id + '/edit';
    return CardService.newActionResponseBuilder()
      .setOpenLink(CardService.newOpenLink().setUrl(url).setOpenAs(CardService.OpenAs.FULL_SIZE))
      .setNotification(CardService.newNotification().setText('Draft created. Add fields and send in DocSign.'))
      .build();
  } catch (err) {
    return notify_(String(err.message || err));
  }
}

function notify_(text) {
  return CardService.newActionResponseBuilder().setNotification(CardService.newNotification().setText(text)).build();
}
