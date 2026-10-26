/**
 * Connects a Google account for converting Word, Excel and PowerPoint files
 * (CONVERTER=google). Run once on your computer:
 *
 *   npm run google:connect -w @docsign/api -- <client id> <client secret>
 *
 * It opens Google's consent page, then prints GOOGLE_REFRESH_TOKEN. The app only
 * asks for the `drive.file` permission: it can see the files it creates itself
 * (deleted right after each conversion), never the rest of your Drive.
 */
import { exec } from 'node:child_process';
import { createServer } from 'node:http';

const [clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Usage: npm run google:connect -w @docsign/api -- <client id> <client secret>');
  process.exit(1);
}

const port = 53682;
const redirectUri = `http://127.0.0.1:${port}`;
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/drive.file',
  access_type: 'offline',
  prompt: 'consent',
})}`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirectUri);
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end(url.searchParams.get('error') ?? 'No code');
    return;
  }
  const token = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  }).then((r) => r.json() as Promise<{ refresh_token?: string; error_description?: string }>);
  if (!token.refresh_token) {
    res.writeHead(500).end('Google did not return a refresh token. Check the terminal.');
    console.error('No refresh token:', token.error_description ?? token);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<p style="font-family:sans-serif">Connected. You can close this tab and go back to the terminal.</p>');
    console.log('\nAdd these to Vercel (Settings → Environment Variables):\n');
    console.log('CONVERTER=google');
    console.log(`GOOGLE_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${token.refresh_token}\n`);
  }
  server.close();
});

server.listen(port, '127.0.0.1', () => {
  console.log('Opening Google sign-in. If it does not open, visit:\n');
  console.log(authUrl, '\n');
  const open = process.platform === 'win32' ? `start "" "${authUrl}"` : process.platform === 'darwin' ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(open);
});
