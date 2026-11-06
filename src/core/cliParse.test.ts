import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from './cliParse';

test('parseCliArgs splits command, positional args and boolean flags', () => {
  const inv = parseCliArgs(['recon', 'example.com', '--pretty']);
  assert.equal(inv.command, 'recon');
  assert.deepEqual(inv.args, ['example.com']);
  assert.equal(inv.flags.pretty, true);
});

test('parseCliArgs supports --key=value flags and multi-word args', () => {
  const inv = parseCliArgs([
    'screen',
    'Viktor Morozov',
    '1968-04-14',
    '--jurisdiction=Cyprus',
    '--pretty',
  ]);
  assert.equal(inv.command, 'screen');
  assert.deepEqual(inv.args, ['Viktor Morozov', '1968-04-14']);
  assert.equal(inv.flags.jurisdiction, 'Cyprus');
  assert.equal(inv.flags.pretty, true);
});

test('parseCliArgs defaults to help when given nothing', () => {
  const inv = parseCliArgs([]);
  assert.equal(inv.command, 'help');
  assert.deepEqual(inv.args, []);
});
