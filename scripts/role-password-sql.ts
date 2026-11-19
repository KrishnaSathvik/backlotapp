/**
 * Prints the SQL that sets a Backlot database role's password, for manual setup step 10
 * (ops/supabase/manual-setup/README.md). It prints a SCRAM-SHA-256 verifier, never the password:
 *
 *   openssl rand -hex 32                        # generate; save it in the password manager
 *   node scripts/role-password-sql.ts backlot_app      # paste it at the hidden prompt
 *
 * Paste the printed ALTER ROLE line into the Supabase SQL Editor. Nothing is sent anywhere and
 * nothing is written to disk. Piped input works too (`pbpaste | node scripts/role-password-sql.ts backlot_app`).
 */
import readline from 'node:readline';
import { scramVerifier } from '../src/db/scram.ts';

const ROLES = ['backlot_app', 'backlot_backup'];
const role = process.argv[2] ?? '';
if (!ROLES.includes(role)) {
  console.error(`Usage: node scripts/role-password-sql.ts <${ROLES.join('|')}>`);
  process.exit(2);
}

async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    let s = '';
    for await (const chunk of process.stdin) s += chunk;
    return s.replace(/\r?\n$/, '');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  process.stderr.write(`Password for ${role} (input hidden): `);
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined;
  const answer = await new Promise<string>((resolve) => rl.question('', resolve));
  rl.close();
  process.stderr.write('\n');
  return answer;
}

const password = await readSecret();
if (password.length < 32) {
  console.error('Refusing: use a generated password of at least 32 characters (openssl rand -hex 32).');
  process.exit(1);
}
let verifier: string;
try {
  verifier = scramVerifier(password);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
console.log(`ALTER ROLE ${role} WITH PASSWORD '${verifier}';`);
