import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalLedger } from './ledger.ts';

/** The deletion ledger survives outside the database (restore reconciliation). */
test('LG1. ledger records one entry per account, lists them, and purges only old ones', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'backlot-ledger-'));
  const ledger = createLocalLedger(dir);
  await ledger.record({ uid: 'uid/odd chars', jobId: 1, requestedAt: '2026-01-01T00:00:00.000Z' });
  await ledger.record({ uid: 'uid-2', jobId: 2, requestedAt: '2026-11-10T00:00:00.000Z' });
  await ledger.record({ uid: 'uid-2', jobId: 2, requestedAt: '2026-11-10T00:00:00.000Z' }); // idempotent
  assert.deepEqual((await ledger.list()).map((e) => e.uid).sort(), ['uid-2', 'uid/odd chars']);
  assert.equal(await ledger.purge(new Date('2026-06-01T00:00:00Z')), 1);
  assert.deepEqual((await ledger.list()).map((e) => e.uid), ['uid-2']);
  await fsp.rm(dir, { recursive: true, force: true });
});
