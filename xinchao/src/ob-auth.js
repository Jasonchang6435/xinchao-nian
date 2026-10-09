import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

// Credentials belong to this service, never to Dashboard responses or logs.
export class ObAuth {
  constructor(config) { this.config = config; this.refreshing = null; this.credentials = null; }

  async load() {
    if (!this.credentials) {
      try { this.credentials = JSON.parse(await readFile(this.config.oauthStatePath, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw new Error('OB OAuth state is unreadable');
        this.credentials = {
          client_id: this.config.oauthClientId,
          refresh_token: this.config.oauthRefreshToken,
          token_endpoint: this.config.oauthTokenUrl,
          resource: this.config.oauthResource || this.config.url,
        };
      }
    }
    return this.credentials;
  }

  async token(forceRefresh = false) {
    if (this.config.authMode !== 'oauth') return this.config.token;
    const credentials = await this.load();
    if (!forceRefresh && credentials.access_token && Number(credentials.expires_at) > Date.now() + 60000) {
      return credentials.access_token;
    }
    if (!this.refreshing) this.refreshing = this.refresh(credentials).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async refreshRejected(token) {
    const credentials = await this.load();
    // Another concurrent request may already have rotated the rejected token.
    if (credentials.access_token && credentials.access_token !== token) return this.token();
    return this.token(true);
  }

  async refresh(credentials) {
    if (!credentials.client_id || !credentials.refresh_token || !credentials.token_endpoint) {
      throw new Error('OB OAuth needs authorization: run scripts/authorize-ob.mjs and import its private state');
    }
    const endpoint = new URL(credentials.token_endpoint);
    if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) {
      throw new Error('OB OAuth token endpoint must use HTTPS');
    }
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: credentials.client_id,
        refresh_token: credentials.refresh_token, ...(credentials.resource ? { resource: credentials.resource } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`OB OAuth refresh failed: HTTP ${response.status}; reauthorize if the grant expired`);
    const data = await response.json();
    if (!data.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) {
      throw new Error('OB OAuth returned invalid credentials');
    }
    const next = { ...credentials, access_token: data.access_token,
      refresh_token: data.refresh_token || credentials.refresh_token,
      expires_at: Date.now() + Number(data.expires_in) * 1000 };
    await mkdir(dirname(this.config.oauthStatePath), { recursive: true });
    const temp = `${this.config.oauthStatePath}.tmp`;
    await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
    await rename(temp, this.config.oauthStatePath);
    this.credentials = next;
    return next.access_token;
  }
}
