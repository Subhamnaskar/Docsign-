/**
 * Word add-in manifest (XML add-in-only manifest). Sideload it in Word
 * (Insert → Add-ins → Upload My Add-in) or deploy it from the Microsoft 365
 * admin centre. URLs come from the request's origin, so the same manifest
 * works for any deployment.
 */
export function GET(req: Request) {
  const origin = process.env.PUBLIC_APP_URL ?? new URL(req.url).origin;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="TaskPaneApp">
  <Id>3f0e8d2a-6c51-4b8e-9a1e-2d7c4b9f6a10</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>DocSign</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="DocSign"/>
  <Description DefaultValue="Send the open document for electronic signature."/>
  <IconUrl DefaultValue="${origin}/icons/icon-64.png"/>
  <HighResolutionIconUrl DefaultValue="${origin}/icons/icon-128.png"/>
  <SupportUrl DefaultValue="${origin}/help"/>
  <AppDomains><AppDomain>${origin}</AppDomain></AppDomains>
  <Hosts><Host Name="Document"/></Hosts>
  <DefaultSettings><SourceLocation DefaultValue="${origin}/office/taskpane?host=word"/></DefaultSettings>
  <Permissions>ReadDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Document">
        <DesktopFormFactor>
          <FunctionFile resid="Taskpane.Url"/>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="DocSign.Group">
                <Label resid="Group.Label"/>
                <Icon><bt:Image size="16" resid="Icon.16"/><bt:Image size="32" resid="Icon.32"/><bt:Image size="80" resid="Icon.80"/></Icon>
                <Control xsi:type="Button" id="DocSign.Open">
                  <Label resid="Button.Label"/>
                  <Supertip><Title resid="Button.Label"/><Description resid="Button.Tooltip"/></Supertip>
                  <Icon><bt:Image size="16" resid="Icon.16"/><bt:Image size="32" resid="Icon.32"/><bt:Image size="80" resid="Icon.80"/></Icon>
                  <Action xsi:type="ShowTaskpane"><TaskpaneId>DocSign.Taskpane</TaskpaneId><SourceLocation resid="Taskpane.Url"/></Action>
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
      <bt:Urls><bt:Url id="Taskpane.Url" DefaultValue="${origin}/office/taskpane?host=word"/></bt:Urls>
      <bt:ShortStrings>
        <bt:String id="Group.Label" DefaultValue="DocSign"/>
        <bt:String id="Button.Label" DefaultValue="Send for signature"/>
      </bt:ShortStrings>
      <bt:LongStrings><bt:String id="Button.Tooltip" DefaultValue="Send this document for electronic signature with DocSign."/></bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
