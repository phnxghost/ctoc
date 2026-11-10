'use strict';

/**
 * Touched-only build-end check (owner decision 2026-11-10).
 *
 * A project that declares an npm `gate` script owns its own choice of what to run for a change
 * (lint, types, tests, build, only what the change touches). VERIFY then runs ONE required check,
 * `npm run gate`, that stands for lint, types and tests, and does NOT run `npm test` (the whole
 * suite). A project with no `gate` script is unchanged. The "0 skipped" contract still applies
 * to the gate's output.
 *
 * Real projects on disk, real subprocesses: each script appends its own name to calls.log.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const verify = require('../src/lib/step-13-verify');
process.env.npm_config_update_notifier = 'false';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctoc-gate-script-')); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

/** A library-shaped project (no bin/start: app launch is not applicable) whose scripts log their name. */
function seed(scriptNames, gateOutput = 'gate ok') {
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = {};\n');
  fs.writeFileSync(
    path.join(dir, 'run.js'),
    `require('fs').appendFileSync('calls.log', process.argv[2] + '\\n');\n` +
    `if (process.argv[2] === 'gate') process.stdout.write(${JSON.stringify(gateOutput)});\n`
  );
  const scripts = {};
  for (const n of scriptNames) scripts[n] = `node run.js ${n}`;
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'g', version: '1.0.0', private: true, main: 'index.js', scripts })
  );
}
const calls = () => (fs.existsSync(path.join(dir, 'calls.log'))
  ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n') : []);

describe('VERIFY with a project `gate` script', () => {
  it('runs `npm run gate` once and neither `npm test`, lint nor typecheck', () => {
    seed(['lint', 'typecheck', 'test', 'gate']);
    const res = verify.runVerify(dir);
    assert.deepEqual(calls(), ['gate']);
    assert.equal(res.checks.tests.command, 'npm run gate');
    assert.equal(res.checks.tests.passed, true);
    assert.equal(res.checks.lint.ran, false, 'the gate stands for lint');
    assert.equal(res.checks.types.ran, false, 'the gate stands for types');
    assert.equal(res.passed, true, JSON.stringify(res.errors));
  });

  it('a failing gate fails VERIFY', () => {
    seed(['test', 'gate']);
    fs.writeFileSync(path.join(dir, 'run.js'), 'process.exit(1);\n');
    const res = verify.runVerify(dir);
    assert.equal(res.passed, false);
    assert.equal(res.checks.tests.passed, false);
  });

  it('a skipped test in the gate output still breaks the 0-skipped contract', () => {
    seed(['gate'], 'ℹ tests 3\nℹ pass 2\nℹ fail 0\nℹ skipped 1\nℹ todo 0\n');
    const res = verify.runVerify(dir);
    assert.equal(res.passed, false);
    assert.ok(res.errors.some((e) => /skipped/.test(e)), JSON.stringify(res.errors));
  });
});

describe('VERIFY without a `gate` script is unchanged', () => {
  it('runs lint, typecheck and `npm test`', () => {
    seed(['lint', 'typecheck', 'test']);
    const res = verify.runVerify(dir);
    assert.deepEqual(calls(), ['lint', 'typecheck', 'test']);
    assert.equal(res.checks.tests.command, 'npm test');
    assert.equal(res.passed, true, JSON.stringify(res.errors));
  });
});
