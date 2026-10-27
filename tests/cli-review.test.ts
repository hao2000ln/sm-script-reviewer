import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { reviewTarget } from '../src/reviewer/batch';
import { loadSource } from '../src/source/loader';

const cliPath = resolve(__dirname, '../src/cli/index.js');

test('review command handles one file and preserves inspect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-reviewer-cli-'));
  const file = join(root, 'single.js');
  try {
    await writeFile(file, 'function undocumented() {}', 'utf8');

    const reviewed = runCli('review', file);
    assert.equal(reviewed.status, 1);
    assert.match(reviewed.stdout, /WARNING SM-CMT-001 1:1/u);
    assert.match(reviewed.stdout, /Summary: files=1 findings=1 diagnostics=0/u);

    const inspected = runCli('inspect', file);
    assert.equal(inspected.status, 0);
    assert.match(inspected.stdout, /functions=1 comments=0 parseIssues=0/u);
    assert.doesNotMatch(inspected.stdout, /Summary:/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review command discovers JavaScript and text files recursively in stable order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-reviewer-batch-'));
  try {
    await Promise.all([
      mkdir(join(root, 'nested'), { recursive: true }),
      mkdir(join(root, '.git'), { recursive: true }),
      mkdir(join(root, 'node_modules'), { recursive: true }),
      mkdir(join(root, 'dist'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, 'z.js'), '/** documented */\nfunction z() {}', 'utf8'),
      writeFile(join(root, 'nested', 'a.txt'), 'print("debug");', 'utf8'),
      writeFile(join(root, '.git', 'ignored.js'), 'print("ignored");', 'utf8'),
      writeFile(join(root, 'node_modules', 'ignored.txt'), 'print("ignored");', 'utf8'),
      writeFile(join(root, 'dist', 'ignored.js'), 'print("ignored");', 'utf8'),
    ]);

    const result = runCli('review', root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /SM-DBG-001/u);
    assert.doesNotMatch(result.stdout, /ignored\.(?:js|txt)/u);
    assert.ok(
      result.stdout.indexOf(join(root, 'nested', 'a.txt'))
        < result.stdout.indexOf(join(root, 'z.js')),
    );
    assert.match(result.stdout, /Summary: files=2 findings=1 diagnostics=0/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('batch review isolates a file load failure and continues remaining files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-reviewer-failure-'));
  const first = join(root, 'a.js');
  const broken = join(root, 'b.txt');
  const last = join(root, 'c.js');
  try {
    await Promise.all([
      writeFile(first, '/** a */\nfunction a() {}', 'utf8'),
      writeFile(broken, 'unreadable placeholder', 'utf8'),
      writeFile(last, 'print("debug");', 'utf8'),
    ]);

    const batch = await reviewTarget(root, {
      load: async (path) => {
        if (path === broken) throw new Error('simulated read failure');
        return loadSource(path);
      },
    });

    assert.deepEqual(batch.files.map(({ filePath }) => filePath), [first, last]);
    assert.deepEqual(batch.failures, [{
      filePath: broken,
      message: 'simulated read failure',
    }]);
    assert.equal(batch.files[1].result.findings[0].ruleId, 'SM-DBG-001');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runCli(command: string, target: string, ...args: string[]) {
  return spawnSync(process.execPath, [cliPath, command, target, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}
