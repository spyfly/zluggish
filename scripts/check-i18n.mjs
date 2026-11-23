import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from '../server/node_modules/typescript/lib/typescript.js';
import { candidates, files } from './i18n-source.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const exemptions = JSON.parse(fs.readFileSync('scripts/i18n-exemptions.json', 'utf8'));
const usedExemptions = new Set();
const failures = [];
for (const [roots, catalogPath] of [
  [['web/src/app'], 'web/src/lib/i18n/en.ts'],
  [['web/src/game'], 'web/src/lib/i18n/game-en.ts'],
  [['web/src/components', 'web/src/lib'], 'web/src/lib/i18n/shared-en.ts'],
  [['server/src'], 'server/src/i18n/en.ts'],
]) {
  const source = fs.readFileSync(catalogPath, 'utf8');
  const ast = ts.createSourceFile(catalogPath, source, ts.ScriptTarget.Latest, true);
  const catalog = new Map();
  function read(node) {
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.text;
      if (!ts.isStringLiteral(node.initializer)) failures.push(`${catalogPath}: ${key} must be a string`);
      else {
        if (catalog.has(key)) failures.push(`${catalogPath}: duplicate key ${key}`);
        catalog.set(key, node.initializer.text);
      }
    }
    ts.forEachChild(node, read);
  }
  read(ast);
  const used = new Set();
  for (const file of roots.flatMap(files)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
      used.add(match[1]);
      if (!catalog.has(match[1])) failures.push(`${file}: missing message ${match[1]}`);
      else {
        // Parse the call as TypeScript even when it occurs in Svelte markup.
        const callSource = ts.createSourceFile(file + '.ts', text.slice(match.index), ts.ScriptTarget.Latest, true);
        const statement = callSource.statements[0];
        const call = statement && ts.isExpressionStatement(statement) ? statement.expression : undefined;
        if (call && ts.isCallExpression(call)) {
          const values = call.arguments[1];
          const actual =
            values && ts.isObjectLiteralExpression(values)
              ? values.properties.map((property) => property.name?.text)
              : [];
          const expected = [...new Set([...catalog.get(match[1]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
          if (expected.some((name) => !actual.includes(name)) || actual.some((name) => !expected.includes(name))) {
            failures.push(`${file}: ${match[1]} expects interpolation values [${expected.join(', ')}]`);
          }
        }
      }
    }
    for (const candidate of candidates(text, file)) {
      const exemption = exemptions.findIndex((e) => e.file === file && e.value === candidate.value && e.reason);
      if (exemption !== -1) usedExemptions.add(exemption);
      else
        failures.push(
          `${file}:${text.slice(0, candidate.start).split('\n').length}: untranslated string ${JSON.stringify(candidate.value)}`,
        );
    }
  }
  for (const key of catalog.keys()) if (!used.has(key)) failures.push(`${catalogPath}: unused message ${key}`);
}
for (const [i, exemption] of exemptions.entries()) {
  if (!usedExemptions.has(i)) failures.push(`${exemption.file}: stale exemption ${JSON.stringify(exemption.value)}`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('English catalogs and user-facing strings are up to date.');
