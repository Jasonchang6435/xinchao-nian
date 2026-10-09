import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Run on YOUR computer. Password is entered only on the existing OB's page.
// Output is a private credential FILE, never a printed access/refresh token.
if (!process.argv[2]) throw new Error('Pass the intended OB HTTPS MCP URL explicitly; use a separate test grant output file for DRYRUN');
const resource = new URL(process.argv[2]);
const output = resolve(process.argv[3] || '.private/ob-oauth.json');
if (resource.protocol !== 'https:') throw new Error('Use the existing public HTTPS MCP URL');
const metadataUrl = new URL('/.well-known/oauth-authorization-server', resource);
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`OB OAuth request failed: HTTP ${response.status}`);
  return response.json();
}
const metadata = await jsonRequest(metadataUrl);
for (const key of ['registration_endpoint', 'authorization_endpoint', 'token_endpoint']) {
  if (new URL(metadata[key]).origin !== resource.origin) throw new Error(`Unexpected OAuth ${key} origin`);
}
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(32).toString('base64url');
let complete;
const done = new Promise((resolve, reject) => { complete = { resolve, reject }; });
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const received = Buffer.from(url.searchParams.get('state') || '');
  const expected = Buffer.from(state);
  if (url.pathname !== '/callback' || received.length !== expected.length || !timingSafeEqual(received, expected)) {
    response.writeHead(400).end('Invalid callback'); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('授权已收到，请返回终端。');
  if (url.searchParams.has('error') || !url.searchParams.get('code')) complete.reject(new Error('OB authorization was declined'));
  else complete.resolve(url.searchParams.get('code'));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const redirect = `http://127.0.0.1:${server.address().port}/callback`;
const timer = setTimeout(() => complete.reject(new Error('OB authorization timed out')), 600000);
try {
  const client = await jsonRequest(metadata.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Xinchao external OB bridge', redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  if (!client.client_id) throw new Error('OB registration returned no client ID');
  const authorize = new URL(metadata.authorization_endpoint);
  authorize.search = new URLSearchParams({ response_type: 'code', client_id: client.client_id,
    redirect_uri: redirect, state, code_challenge: challenge, code_challenge_method: 'S256', scope: 'mcp', resource: resource.href }).toString();
  console.log(`在同一台电脑的浏览器打开以下地址，使用原 OB 的授权方式登录：\n${authorize.href}`);
  const code = await done;
  const token = await jsonRequest(metadata.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, code,
      redirect_uri: redirect, code_verifier: verifier, resource: resource.href }) });
  if (!token.access_token || !token.refresh_token || !(Number(token.expires_in) > 0)) throw new Error('OB returned no durable OAuth grant');
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify({ client_id: client.client_id, token_endpoint: metadata.token_endpoint,
    resource: resource.href, access_token: token.access_token, refresh_token: token.refresh_token,
    expires_at: Date.now() + Number(token.expires_in) * 1000 }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(`授权凭据已保存到 ${output}。仅将它导入新心潮服务的私有状态卷；不要提交到 GitHub。`);
} finally {
  clearTimeout(timer); server.close();
}
