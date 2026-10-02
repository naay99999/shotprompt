import { expect, it } from 'bun:test';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const vaultModule: any = await import('../src/ai/credential-vault').catch(() => ({}));
const scope = { profileId: 'profile-1', credentialVersion: 'v1', protocol: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' };
function setup(hasCredentials = false) { const root = mkdtempSync(join(tmpdir(), 'shotprompt-vault-')); return { root, secretsDir: join(root, 'secrets'), make: () => vaultModule.createCredentialVault({ secretsDir: join(root, 'secrets'), hasCredentials: () => hasCredentials }), close: () => rmSync(root, { recursive: true, force: true }) }; }

it('roundtrips AES-GCM ciphertext bound to profile, version and destination', () => {
  const t = setup();
  try {
    const vault = t.make(), secret = 'router-secret-123', encrypted = vault.encrypt(scope, secret);
    expect(vault.decrypt(scope, encrypted)).toBe(secret);
    expect(JSON.stringify(encrypted)).not.toContain(secret);
    expect(vault.encrypt(scope, secret).ciphertext).not.toBe(encrypted.ciphertext);
    for (const wrong of [{ ...scope, profileId: 'other' }, { ...scope, credentialVersion: 'v2' }, { ...scope, baseUrl: 'https://evil.example' }]) expect(() => vault.decrypt(wrong, encrypted)).toThrow();
    const tampered = { ...encrypted, authTag: 'A'.repeat(encrypted.authTag.length) };
    expect(() => vault.decrypt(scope, tampered)).toThrow();
  } finally { t.close(); }
});

it('creates a 32-byte master key with restrictive Unix permissions and reuses concurrent initializers', async () => {
  const t = setup();
  try {
    const [one, two] = await Promise.all([Promise.resolve().then(t.make), Promise.resolve().then(t.make)]);
    const cipher = one.encrypt(scope, 'secret'), secret = two.decrypt(scope, cipher);
    const master = lstatSync(join(t.secretsDir, 'ai-vault.key'));
    expect(readFileSync(join(t.secretsDir, 'ai-vault.key'))).toHaveLength(32);
    if (process.platform !== 'win32') { expect(master.mode & 0o777).toBe(0o600); expect(lstatSync(t.secretsDir).mode & 0o777).toBe(0o700); }
    expect(secret).toBe('secret');
  } finally { t.close(); }
});

it('rejects master key symlinks, invalid keys and a missing key when ciphertext exists', () => {
  const symlink = setup();
  try { symlink.make().encrypt(scope, 'secret'); const path = join(symlink.secretsDir, 'ai-vault.key'); rmSync(path); writeFileSync(join(symlink.root, 'target'), Buffer.alloc(32)); symlinkSync(join(symlink.root, 'target'), path); expect(() => symlink.make().encrypt(scope, 'secret')).toThrow(); }
  finally { symlink.close(); }
  const invalid = setup();
  try { const fs = awaitableWrite(invalid); expect(fs).toBe(true); expect(() => invalid.make().encrypt(scope, 'secret')).toThrow(); }
  finally { invalid.close(); }
  const missing = setup(true);
  try { expect(() => missing.make().encrypt(scope, 'secret')).toThrow(); expect(() => lstatSync(join(missing.secretsDir, 'ai-vault.key'))).toThrow(); }
  finally { missing.close(); }
});
function awaitableWrite(t: ReturnType<typeof setup>) { mkdirSync(t.secretsDir, { recursive: true }); writeFileSync(join(t.secretsDir, 'ai-vault.key'), Buffer.alloc(31)); return true; }
