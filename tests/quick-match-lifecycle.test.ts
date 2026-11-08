import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
test('quick-match hook clears completed identities before requeue', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', '--test', '--test-reporter=tap', 'tests/fixtures/quick-match-lifecycle.ts'], { cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_TEST_CONTEXT: undefined }, timeout: 15000 });
  assert.ok(stdout.includes('# fail 0'));
});
