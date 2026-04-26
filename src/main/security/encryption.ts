import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits

/**
 * Get a stable encryption key based on machine fingerprint
 * Uses multiple system identifiers for better stability
 */
export function getEncryptionKey(): Buffer {
  const fingerprints = [
    process.platform,
    process.arch,
    process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown',
    process.env.USER || process.env.USERNAME || 'unknown',
    crypto.getRandomValues(new Uint8Array(16)).toString() // Add some randomness for development
  ].join('|');
  
  return crypto.createHash('sha256').update(fingerprints).digest().slice(0, KEY_LENGTH);
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(data: string): { encrypted: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag
  };
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(encrypted: string, iv: string, authTag: string): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generate a secure random API key
 */
export function generateSecureToken(prefix: string = 'sk'): string {
  const randomPart = crypto.randomBytes(24).toString('hex');
  return `${prefix}-${randomPart}`;
}

/**
 * Hash a value using SHA-256
 */
export function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Generate machine fingerprint for licensing/validation
 */
export function getMachineFingerprint(): string {
  const components = [
    process.platform,
    process.arch,
    process.env.COMPUTERNAME || 'unknown',
    process.env.USER || 'unknown',
    String(process.pid)
  ].join('|');
  
  return hashValue(components);
}
