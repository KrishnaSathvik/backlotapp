import crypto from 'node:crypto';

/**
 * A Postgres SCRAM-SHA-256 password verifier (RFC 5802 / 7677), in the exact text form Postgres
 * stores in pg_authid.rolpassword. `ALTER ROLE r PASSWORD '<verifier>'` stores it as is, so the
 * plain password never reaches the server, the SQL Editor or its saved history.
 *
 * Passwords are limited to printable ASCII, where SASLprep (which Postgres applies) is the
 * identity, so the verifier matches what the server would compute itself.
 */
export function scramVerifier(password: string, salt: Buffer = crypto.randomBytes(16), iterations = 4096): string {
  if (!/^[\x21-\x7e]+$/.test(password)) throw new Error('Password must be printable ASCII without spaces.');
  const salted = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const hmac = (key: Buffer, text: string) => crypto.createHmac('sha256', key).update(text).digest();
  const storedKey = crypto.createHash('sha256').update(hmac(salted, 'Client Key')).digest();
  const serverKey = hmac(salted, 'Server Key');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
