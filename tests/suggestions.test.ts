import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { analyzeStagedDiff } from '../src/diff';
import { buildSuggestions, categorizePath } from '../src/suggestions';
import type { AssistantSettings, StagedChange } from '../src/types';

const settings: AssistantSettings = {
  format: 'plain', language: 'en', scopeMode: 'auto', maxSubjectLength: 72,
  defaultCodeType: 'chore', analyzeDiff: true, commitMode: 'scm',
  statisticsEnabled: false, statisticsDays: 14, showStatisticsAfterSuggestion: false
};
function file(path: string, status: StagedChange['status'] = 'modified'): StagedChange {
  return { path, status, category: categorizePath(path), additions: 0, deletions: 0, binary: false };
}

test('one hunk can rename a parameter and introduce a separate function', () => {
  const changes = [file('notes.md'), file('src/filter.cpp')];
  const hints = analyzeStagedDiff([
    '@@ -1,2 +1,6 @@', '-bool matches(int x){', '-    return x && x;',
    '+bool matches(int y){', '+    return y && y;', '+}', '+',
    '+bool validate(int x){', '+    return true;',
    '@@ -10,0 +15 @@ void unrelated(){', '+ '
  ].join('\n'));
  const choices = buildSuggestions(changes, settings, [], new Map([['src/filter.cpp', hints]]));
  assert.match(choices[0].message, /^Add validate, rename parameter in matches,? and update notes$/);
  assert.deepEqual(choices.slice(1).map(s => s.message), [
    'Add validate function to filter', 'Rename parameter in matches', 'Update notes'
  ]);
});

test('files retain separate hints and all categories get focused suggestions', () => {
  const changes = [file('a/first.py'), file('b/second.ts'), file('tests/unit.py', 'added'), file('old.yml', 'deleted')];
  const patches = new Map([
    ['a/first.py', analyzeStagedDiff('@@ -0,0 +1 @@\n+def encode(x):')],
    ['b/second.ts', analyzeStagedDiff('@@ -0,0 +1 @@\n+function decode(x) {')]
  ]);
  const output = buildSuggestions(changes, {...settings, format: 'conventional', maxSubjectLength: 120}, [], patches);
  for (const name of ['encode', 'decode', 'unit tests', 'old.yml']) { assert.ok(output[0].message.includes(name)); }
  assert.ok(output.some(s => s.message === 'feat(a): add encode function to first'));
  assert.ok(output.some(s => s.message === 'feat(b): add decode function to second'));
  const short = buildSuggestions(changes, {...settings, language: 'ru', maxSubjectLength: 30}, [], patches);
  assert.equal(short.length, 5);
  assert.ok(short.every(s => s.message.length <= 30));
});

test('without diff evidence, paths and git actions still describe the whole commit', () => {
  const output = buildSuggestions([file('guide.md', 'added'), file('ci.yml', 'deleted')], settings);
  assert.equal(output[0].message, 'Add guide and remove ci.yml');
  assert.equal(buildSuggestions([file('parser.cpp')], settings)[0].message, 'Update parser');
  assert.deepEqual(buildSuggestions([], settings), []);
});

test('signature edits, moved functions and whitespace do not introduce new functions', () => {
  const hints = analyzeStagedDiff('@@ -1 +1 @@\n-int read(int x){\n+int read(long x){\n@@ -3 +3 @@\n-int old(int n){\n+int newer(int n){');
  assert.ok(hints.every(h => !h.addedFunctions));
  assert.deepEqual(analyzeStagedDiff('@@ -10,0 +11 @@ void other() {\n+   '), []);
});

test('large function additions retain their count in a mixed commit', () => {
  const hints = analyzeStagedDiff('@@ -0,0 +1,4 @@\n+def one():\n+def two():\n+def three():\n+def four():');
  const choices = buildSuggestions([file('parser.py'), file('guide.md')], settings, [], new Map([['parser.py', hints]]));
  assert.equal(choices[0].message, 'Add 4 functions and update guide');
  assert.equal(choices[1].message, 'Add 4 functions to parser');
});
