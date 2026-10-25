# Office and Google add-ins

## Microsoft Word and Outlook

The add-ins are served by the web app; nothing to build.

| Add-in | Manifest URL | What it does |
|---|---|---|
| Word | `<APP_URL>/office/manifest-word.xml` | "Send for signature" on the Home tab: sends the open document (as PDF) to a new DocSign draft |
| Outlook | `<APP_URL>/office/manifest-outlook.xml` | "Send for signature" on received messages: sends an attachment, with the message's sender as the first signer |

Install for yourself: Word → Insert → Add-ins → Upload My Add-in (or Outlook → Get Add-ins → My add-ins → Add a custom add-in → From URL). For everyone: Microsoft 365 admin centre → Integrated apps → Upload custom apps.

Sign-in uses the user's DocSign account. In Office on the web the task pane runs in a cross-site frame, so sign-in opens a dialog that hands a session token back to the pane (`/office/connect`). Set `PUBLIC_APP_URL` on the web app if it runs behind a proxy, so the manifests point at the public address.

Untested in Office until deployed on an HTTPS domain; Office requires HTTPS for add-ins.

## Google Docs

`google-docs-addon/` is a Google Workspace add-on (Apps Script):

1. Create a new Apps Script project, copy `Code.gs` and `appsscript.json` (show the manifest under Project settings).
2. Replace `https://app.example.com` with your DocSign URL in both files.
3. Deploy → Test deployments → Google Workspace add-on, or publish it to your domain from the Google Workspace Marketplace SDK.

Users paste a DocSign API key once; it is stored in their own Google user properties. The add-on exports the open Doc as PDF, creates a draft with the signer they enter and opens it in DocSign.
