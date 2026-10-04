import assert from 'node:assert/strict';
import { renameForRecovery } from '../desktop/restore-upgrade-backup.mjs';

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  let attempts = 0;
  const waits = [], paths = [];
  await renameForRecovery('synthetic-current', 'synthetic-preserved', {
    move: async (from, to) => { paths.push([from, to]); if (++attempts < 3) throw Object.assign(new Error('Synthetic lock'), { code }); },
    wait: async ms => { waits.push(ms); },
  });
  assert.equal(attempts, 3); assert.deepEqual(waits, [50, 100]);
  assert(paths.every(([from, to]) => from === 'synthetic-current' && to === 'synthetic-preserved'));
}
for (const code of ['ENOENT', 'ENOSPC', 'EIO']) {
  let attempts = 0;
  const error = Object.assign(new Error('Synthetic non-transient failure'), { code });
  await assert.rejects(renameForRecovery('from', 'to', { move: async () => { attempts++; throw error; }, wait: async () => { throw new Error('Must not retry'); } }), value => value === error);
  assert.equal(attempts, 1);
}
let attempts = 0, waited = 0;
const persistent = Object.assign(new Error('Synthetic persistent lock'), { code: 'EPERM' });
await assert.rejects(renameForRecovery('from', 'to', { move: async () => { attempts++; throw persistent; }, wait: async ms => { waited += ms; } }), error => error === persistent);
assert.equal(attempts, 8); assert.equal(waited, 5150);
console.log('Recovery rename checks passed: transient locks retry; other errors fail immediately; persistent locks stop after eight attempts / 5.15 seconds without deletion.');
