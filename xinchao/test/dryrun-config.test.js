import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, validateConfig } from '../src/config.js';
function withEnv(values, fn) {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (/^(OMBRE_|DRYRUN|CONTEXT_OMBRE_ENABLED)/.test(key)) delete process.env[key];
  Object.assign(process.env, values);
  try { return fn(); } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
test('default DRYRUN never borrows any live endpoint or credential', () => withEnv({
  OMBRE_MCP_URL: 'https://live.test/mcp', OMBRE_MCP_EXTRA_URL: 'https://live.test/mcp-extra',
  OMBRE_MCP_TOKEN: 'live-secret', OMBRE_OAUTH_REFRESH_TOKEN: 'live-refresh',
  OMBRE_DASHBOARD_PASSWORD: 'live-password', OMBRE_WRITE_ENABLED: 'true',
}, () => {
  const c = loadConfig(); assert.equal(c.dryRun, true); assert.equal(c.ombre.target, 'test');
  for (const key of ['url','extraUrl','token','oauthClientId','oauthRefreshToken','oauthTokenUrl','oauthResource','dashboardBaseUrl','dashboardPassword','dashboardSession']) assert.equal(c.ombre[key], '');
  assert.equal(c.ombre.writeEnabled, false); assert.equal(c.ombre.oauthStatePath, '/app/state/ob-test-oauth.json');
}));
test('enabling reads without a test endpoint fails closed', () => withEnv({
  OMBRE_READ_ENABLED: 'true', OMBRE_MCP_URL: 'https://live.test/mcp', OMBRE_MCP_TOKEN: 'secret',
}, () => assert.throws(() => validateConfig(loadConfig()), /OMBRE_TEST_MCP_URL/)));
test('test credentials and test writes are independent from production flags', () => withEnv({
  DRYRUN: 'True', OMBRE_READ_ENABLED: 'true', OMBRE_MCP_URL: 'https://live.test/mcp',
  OMBRE_TEST_MCP_URL: 'https://sandbox.test/mcp', OMBRE_TEST_AUTH_MODE: 'oauth',
  OMBRE_TEST_OAUTH_REFRESH_TOKEN: 'sandbox-refresh', OMBRE_TEST_WRITE_ENABLED: 'true', OMBRE_WRITE_ENABLED: 'false',
}, () => {
  const c = validateConfig(loadConfig()); assert.equal(c.ombre.writeEnabled, true);
  assert.equal(c.ombre.oauthRefreshToken, 'sandbox-refresh'); assert.equal(c.ombre.authMode, 'oauth');
}));
test('test origins cannot alias a configured production origin through another path', () => withEnv({
  OMBRE_MCP_URL: 'https://live.test/mcp', OMBRE_TEST_MCP_URL: 'https://live.test/test-mcp',
}, () => assert.throws(() => validateConfig(loadConfig()), /different origins/)));
test('test Dashboard and OAuth origins are checked and grant files must be separate', () => {
  withEnv({ OMBRE_MCP_URL: 'https://live.test/mcp', OMBRE_TEST_DASHBOARD_BASE_URL: 'https://live.test' },
    () => assert.throws(() => validateConfig(loadConfig()), /different origins/));
  withEnv({ OMBRE_TEST_OAUTH_STATE_PATH: '/app/state/ob-oauth.json' },
    () => assert.throws(() => validateConfig(loadConfig()), /separate test OB OAuth/));
});
test('switching to live stays write-disabled until its own explicit write opt-in', () => withEnv({
  DRYRUN: 'false', OMBRE_TEST_WRITE_ENABLED: 'true', OMBRE_MCP_URL: 'https://live.test/mcp',
}, () => {
  const c = loadConfig(); assert.equal(c.ombre.target, 'live'); assert.equal(c.ombre.url, 'https://live.test/mcp');
  assert.equal(c.ombre.writeEnabled, false); assert.equal(c.ombre.dreamWriteEnabled, false);
  assert.equal(c.ombre.allowDestructiveWrites, false); assert.equal(c.ombre.oauthStatePath, '/app/state/ob-oauth.json');
}));
test('misspelled DRYRUN values fail rather than select live', () => withEnv({ DRYRUN: 'flase' },
  () => assert.throws(() => loadConfig(), /DRYRUN must/)));

test('test heart state never carries test bucket IDs into live state or shares a gateway grant', () => withEnv({
  STATE_PATH: '/app/state/state.json', OAUTH_STATE_PATH: '/app/state/oauth.json',
}, () => {
  const c = loadConfig(); assert.equal(c.statePath, '/app/state/test/state.json');
  assert.equal(c.oauth.statePath, '/app/state/test/oauth.json');
  assert.equal(c.box.statePath, '/app/state/test/black-box.json');
}));
test('explicit test state aliases to production files fail closed', () => withEnv({
  TEST_STATE_PATH: '/app/state/state.json',
}, () => assert.throws(() => validateConfig(loadConfig()), /separate test heart state/)));
