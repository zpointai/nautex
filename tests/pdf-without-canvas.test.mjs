import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { pdf } from './helpers/pdf-fixture.mjs';

const fixtures = [
  [{ text: 'Synthetic Nautex PDF extraction' }],
  [{ text: 'Synthetic page one' }, { text: 'Synthetic page two' }],
  [{ text: 'Synthetic rotated page', rotation: 90 }],
  [{ text: '' }],
].map(pdf);

function run(candidate) {
  const script = `
    import Module from 'node:module';
    const fixtures = ${JSON.stringify(fixtures)};
    if (${candidate}) {
      const load = Module._load;
      Module._load = function(id, ...args) {
        if (id.startsWith('@napi-rs/canvas')) throw Error('Native Canvas intentionally unavailable');
        return load.call(this, id, ...args);
      };
    }
    const results = [];
    for (const data of fixtures) {
      if (${candidate}) {
        const { extractUploadedDocument } = await import('./lib/documents/extract.ts');
        results.push(await extractUploadedDocument({name:'synthetic.pdf',data}));
      } else {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({data:Buffer.from(data,'base64')});
        try { results.push({text:(await parser.getText({pageJoiner:''})).text}); }
        finally { await parser.destroy(); }
      }
    }
    console.log('RESULT_JSON='+JSON.stringify(results));
  `;
  const output = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 60000,
  });
  assert.equal(output.status, 0, output.stderr + output.stdout);
  const result = output.stdout.split('\n').find(line => line.startsWith('RESULT_JSON='));
  assert.ok(result, output.stdout);
  return JSON.parse(result.slice('RESULT_JSON='.length));
}

test('PDF text extraction matches native baseline without Canvas', () => {
  const baseline = run(false), candidate = run(true);
  assert.deepEqual(candidate.map(r => r.text), baseline.map(r => r.text));
  assert.match(candidate[0].text, /Synthetic Nautex PDF extraction/);
  assert.match(candidate[1].text, /Synthetic page one/);
  assert.match(candidate[1].text, /Synthetic page two/);
  assert.match(candidate[2].text, /Synthetic rotated page/);
  assert.equal(candidate[3].text.trim(), '');
  assert.match(candidate[3].warnings.join(' '), /no selectable text/);
  assert.ok(candidate.slice(0, 3).every(r => r.warnings.length === 0));
});
