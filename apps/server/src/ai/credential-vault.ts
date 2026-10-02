import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { AiProviderError, type CredentialScope } from '@shotprompt/core';
export interface EncryptedCredential { version: 1; ciphertext: string; nonce: string; authTag: string }
export interface CredentialVault { encrypt(scope: CredentialScope, key: string): EncryptedCredential; decrypt(scope: CredentialScope, value: EncryptedCredential): string; available(): boolean }
const vaultError = () => new AiProviderError('credential-vault-unavailable');
const aad = (scope: CredentialScope) => Buffer.from(JSON.stringify({ profileId: scope.profileId, credentialVersion: scope.credentialVersion, protocol: scope.protocol, baseUrl: scope.baseUrl }));
function readKey(path: string): Buffer {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); } catch { throw vaultError(); }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size !== 32 || (process.platform !== 'win32' && (info.mode & 0o777) !== 0o600)) throw vaultError();
    const key = readFileSync(fd); if (key.length !== 32) throw vaultError(); return key;
  } finally { closeSync(fd); }
}
export function createCredentialVault(options: { secretsDir: string; hasCredentials: () => boolean }): CredentialVault {
  const path = join(options.secretsDir, 'ai-vault.key');
  function loadKey(create: boolean): Buffer | null {
    try { const dir = lstatSync(options.secretsDir); if (!dir.isDirectory() || dir.isSymbolicLink()) throw vaultError(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !options.hasCredentials()) return null; throw vaultError(); }
      try { mkdirSync(options.secretsDir, { recursive: true, mode: 0o700 }); if (process.platform !== 'win32') chmodSync(options.secretsDir, 0o700); } catch { throw vaultError(); }
      try { const dir = lstatSync(options.secretsDir); if (!dir.isDirectory() || dir.isSymbolicLink()) throw vaultError(); } catch { throw vaultError(); }
    }
    try { lstatSync(path); return readKey(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create || options.hasCredentials()) throw vaultError();
      let fd: number;
      try { fd = openSync(path, 'wx', 0o600); } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code === 'EEXIST') return readKey(path);
        throw vaultError();
      }
      try {
        const key = randomBytes(32); if (process.platform !== 'win32') fchmodSync(fd, 0o600);
        writeSync(fd, key); fsyncSync(fd); return key;
      } catch { throw vaultError(); } finally { closeSync(fd); }
    }
  }
  return {
    available() { try { return !!loadKey(false) || !options.hasCredentials(); } catch { return false; } },
    encrypt(scope, key) {
      const master = loadKey(true); if (!master) throw vaultError();
      try {
        const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', master, nonce); cipher.setAAD(aad(scope));
        const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
        return { version: 1, ciphertext: ciphertext.toString('base64'), nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
      } catch { throw vaultError(); }
    },
    decrypt(scope, value) {
      const master = loadKey(false); if (!master || value.version !== 1) throw vaultError();
      try {
        const nonce = Buffer.from(value.nonce, 'base64'), authTag = Buffer.from(value.authTag, 'base64'), ciphertext = Buffer.from(value.ciphertext, 'base64');
        if (nonce.length !== 12 || authTag.length !== 16) throw vaultError();
        const decipher = createDecipheriv('aes-256-gcm', master, nonce); decipher.setAAD(aad(scope)); decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch { throw vaultError(); }
    },
  };
}
