import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SourceDocument } from '../src/core/types';
import { analyze } from '../src/parser/analyze';

const inspect = (content: string) => analyze({
  id: 'test',
  filePath: 'test.js',
  content,
  hash: 'test',
} as SourceDocument);

test('indexes supported function forms, nesting, and anonymous functions', () => {
  const result = inspect(`
function declared() {}
const expressed = function () { function nested() {} };
const arrow = () => {};
const object = {
  method() {},
  property: function () {},
  arrowProperty: () => {},
};
(function () {})();
`);

  assert.deepEqual(
    result.functions.map(({ name, kind }) => [name, kind]),
    [
      ['declared', 'FunctionDeclaration'],
      ['expressed', 'FunctionExpression'],
      ['nested', 'FunctionDeclaration'],
      ['arrow', 'ArrowFunction'],
      ['method', 'MethodDeclaration'],
      ['property', 'FunctionExpression'],
      ['arrowProperty', 'ArrowFunction'],
      ['<anonymous>', 'FunctionExpression'],
    ],
  );
});

test('infers qualified names from assignment expressions', () => {
  const result = inspect(`
obj.load = function () {};
exports.save = () => {};
namespace["quoted"] = (function () {});
`);

  assert.deepEqual(
    result.functions.map(({ name }) => name),
    ['obj.load', 'exports.save', 'namespace["quoted"]'],
  );
});

test('uses the nearest assignment target for a chained assignment', () => {
  const result = inspect('/** Chained assignment. */\nouter = inner = function () {};');

  assert.equal(result.functions[0].name, 'inner');
  assert.equal(result.functions[0].leadingComment, '/** Chained assignment. */');
});

test('indexes real comments but ignores comment-like template, string, and regex text', () => {
  const result = inspect(`
const stringValue = "http://example.test/*not-comment*/";
const templateValue = \`value: \${stringValue} // not a comment\`;
const regexValue = /[/*]/;
// real comment
function run() {}
`);

  assert.deepEqual(result.comments.map(({ text }) => text), ['// real comment']);
});

test('indexes comments between tokens, inside blocks, and at end of file', () => {
  const result = inspect(`
call(first, /* middle */ second);
function run() { // inside block
  return true;
}
// final comment`);

  assert.deepEqual(
    result.comments.map(({ kind, text }) => [kind, text]),
    [
      ['block', '/* middle */'],
      ['line', '// inside block'],
      ['line', '// final comment'],
    ],
  );
});

test('associates a contiguous leading comment group', () => {
  const result = inspect('// First line.\n// Second line.\nfunction documented() {}');

  assert.equal(
    result.functions[0].leadingComment,
    '// First line.\n// Second line.',
  );
});

test('associates a same-line block comment before a function', () => {
  const result = inspect('/** Same-line documentation. */ function documented() {}');

  assert.equal(
    result.functions[0].leadingComment,
    '/** Same-line documentation. */',
  );
});

test('associates comments with variable, property, and assignment function anchors', () => {
  const result = inspect(`
// Variable function.
const variableFunction = function () {};
const object = {
  // Property function.
  propertyFunction: () => {},
};
// Assignment function.
obj.assignmentFunction = function () {};
`);

  assert.deepEqual(
    result.functions.map(({ name, leadingComment }) => [name, leadingComment]),
    [
      ['variableFunction', '// Variable function.'],
      ['propertyFunction', '// Property function.'],
      ['obj.assignmentFunction', '// Assignment function.'],
    ],
  );
});

test('associates a statement comment only with its first function declarator', () => {
  const result = inspect(`
// Documents the first declarator.
const first = function () {}, second = function () {};
`);

  assert.deepEqual(
    result.functions.map(({ name, leadingComment }) => [name, leadingComment]),
    [
      ['first', '// Documents the first declarator.'],
      ['second', undefined],
    ],
  );
});

test('associates a direct comment with a later variable declarator', () => {
  const result = inspect(`
const first = function () {},
// Documents the second declarator.
second = function () {};
`);

  assert.deepEqual(
    result.functions.map(({ name, leadingComment }) => [name, leadingComment]),
    [
      ['first', undefined],
      ['second', '// Documents the second declarator.'],
    ],
  );
});

test('does not associate a trailing comment from the previous statement', () => {
  const result = inspect('const state = 1; // state value\nfunction undocumented() {}');

  assert.equal(result.functions[0].leadingComment, undefined);
});

test('does not associate a same-line block comment when code precedes it', () => {
  const result = inspect('const state = 1; /** state value */ function undocumented() {}');

  assert.equal(result.comments[0].text, '/** state value */');
  assert.equal(result.functions[0].leadingComment, undefined);
});

test('does not associate a comment separated by a blank line', () => {
  const result = inspect('// Detached documentation.\n\nfunction undocumented() {}');

  assert.equal(result.functions[0].leadingComment, undefined);
});

test('preserves multiline comments and their exact locations', () => {
  const source = '/**\n * Documentation.\n */\nfunction documented() {}';
  const result = inspect(source);

  assert.equal(result.comments[0].text, '/**\n * Documentation.\n */');
  assert.deepEqual(result.comments[0].start, { line: 1, column: 1, offset: 0 });
  assert.deepEqual(result.comments[0].end, { line: 3, column: 4, offset: 25 });
  assert.equal(result.functions[0].leadingComment, result.comments[0].text);
});

test('uses 1-based lines and columns, end-exclusive UTF-16 offsets', () => {
  const result = inspect('// 😀\nfunction f() {}');

  assert.deepEqual(result.comments[0].start, { line: 1, column: 1, offset: 0 });
  assert.deepEqual(result.comments[0].end, { line: 1, column: 6, offset: 5 });
  assert.deepEqual(result.functions[0].start, { line: 2, column: 1, offset: 6 });
  assert.deepEqual(result.functions[0].end, { line: 2, column: 16, offset: 21 });
});

test('uses the same location contract with CRLF input', () => {
  const result = inspect('// docs\r\nfunction f() {}');

  assert.deepEqual(result.comments[0].end, { line: 1, column: 8, offset: 7 });
  assert.deepEqual(result.functions[0].start, { line: 2, column: 1, offset: 9 });
});

test('associates an adjacent leading comment with a CRLF function declaration', () => {
  const result = inspect('// Count records.\r\nfunction countFile() {}\r\n');
  assert.equal(result.functions[0].leadingComment, '// Count records.');
});

test('returns diagnostics and recovers independent functions when possible', () => {
  const result = inspect('function before() {}\nconst = ;\nfunction after() {}');

  assert.ok(result.issues.length > 0);
  assert.deepEqual(result.functions.map(({ name }) => name), ['before', 'after']);
  assert.ok(result.issues.every(({ start }) => Object.hasOwn(start, 'offset')));
});

test('reports parse diagnostics with the public location contract', () => {
  const valid = inspect('const value = 1;');
  const invalid = inspect('const value = ;');

  assert.deepEqual(valid.issues, []);
  assert.deepEqual(invalid.issues, [{
    message: 'Expression expected.',
    start: { line: 1, column: 15, offset: 14 },
  }]);
});

test('does not crash when parsing severely malformed source', () => {
  assert.doesNotThrow(() => inspect('function broken( {'));
  assert.ok(inspect('function broken( {').issues.length > 0);
});
