/**
 * Outlook add-in manifest: a "Send for signature" button on received
 * messages that sends an attachment to Nuronix eSign. Sideload it from Outlook
 * (Get Add-ins → My add-ins → Add a custom add-in) or the admin centre.
 */
export function GET(req: Request) {
  const origin = process.env.PUBLIC_APP_URL ?? new URL(req.url).origin;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:mailappor="http://schemas.microsoft.com/office/mailappversionoverrides/1.0" xsi:type="MailApp">
  <Id>8b2d4e61-0f3a-4c7d-b5e9-6a1c3f7d2e40</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>Nuronix eSign</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Nuronix eSign"/>
  <Description DefaultValue="Send email attachments for electronic signature."/>
  <IconUrl DefaultValue="${origin}/icons/icon-64.png"/>
  <HighResolutionIconUrl DefaultValue="${origin}/icons/icon-128.png"/>
  <SupportUrl DefaultValue="${origin}/help"/>
  <AppDomains><AppDomain>${origin}</AppDomain></AppDomains>
  <Hosts><Host Name="Mailbox"/></Hosts>
  <Requirements><Sets><Set Name="Mailbox" MinVersion="1.8"/></Sets></Requirements>
  <FormSettings>
    <Form xsi:type="ItemRead"><DesktopSettings><SourceLocation DefaultValue="${origin}/office/taskpane?host=outlook"/><RequestedHeight>450</RequestedHeight></DesktopSettings></Form>
  </FormSettings>
  <Permissions>ReadItem</Permissions>
  <Rule xsi:type="RuleCollection" Mode="Or"><Rule xsi:type="ItemIs" ItemType="Message" FormType="Read"/></Rule>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Requirements><bt:Sets DefaultMinVersion="1.8"><bt:Set Name="Mailbox"/></bt:Sets></Requirements>
    <Hosts>
      <Host xsi:type="MailHost">
        <DesktopFormFactor>
          <ExtensionPoint xsi:type="MessageReadCommandSurface">
            <OfficeTab id="TabDefault">
              <Group id="DocSign.Group">
                <Label resid="Group.Label"/>
                <Control xsi:type="Button" id="DocSign.Open">
                  <Label resid="Button.Label"/>
                  <Supertip><Title resid="Button.Label"/><Description resid="Button.Tooltip"/></Supertip>
                  <Icon><bt:Image size="16" resid="Icon.16"/><bt:Image size="32" resid="Icon.32"/><bt:Image size="80" resid="Icon.80"/></Icon>
                  <Action xsi:type="ShowTaskpane"><SourceLocation resid="Taskpane.Url"/></Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16" DefaultValue="${origin}/icons/icon-16.png"/>
        <bt:Image id="Icon.32" DefaultValue="${origin}/icons/icon-32.png"/>
        <bt:Image id="Icon.80" DefaultValue="${origin}/icons/icon-80.png"/>
      </bt:Images>
      <bt:Urls><bt:Url id="Taskpane.Url" DefaultValue="${origin}/office/taskpane?host=outlook"/></bt:Urls>
      <bt:ShortStrings>
        <bt:String id="Group.Label" DefaultValue="Nuronix eSign"/>
        <bt:String id="Button.Label" DefaultValue="Send for signature"/>
      </bt:ShortStrings>
      <bt:LongStrings><bt:String id="Button.Tooltip" DefaultValue="Send an attachment from this email for electronic signature."/></bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
