import fs from 'node:fs';
import ts from '../server/node_modules/typescript/lib/typescript.js';

export const sections = ['app', 'game', 'shared', 'server'];
const placeholders = (value) => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();

/** Parse strict JSON and inspect the syntax tree before duplicate keys can be lost. */
export function readCatalog(file) {
  const source = fs.readFileSync(file, 'utf8');
  const errors = [];
  let catalog;
  try {
    catalog = JSON.parse(source);
  } catch (error) {
    return { catalog: undefined, errors: [`${file}: ${error.message}`] };
  }
  const ast = ts.parseJsonText(file, source);
  function read(node, prefix = '') {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set();
      for (const property of node.properties) {
        const key = property.name.text;
        const path = prefix ? `${prefix}.${key}` : key;
        if (seen.has(key)) errors.push(`${file}: duplicate key ${path}`);
        seen.add(key);
        read(property.initializer, path);
      }
    }
  }
  read(ast.statements[0].expression);
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return { catalog: undefined, errors: [...errors, `${file}: expected a catalog object`] };
  }
  for (const section of Object.keys(catalog)) {
    if (!sections.includes(section)) errors.push(`${file}: unknown section ${section}`);
  }
  for (const section of sections) {
    const messages = catalog[section];
    if (!messages || typeof messages !== 'object' || Array.isArray(messages)) {
      errors.push(`${file}: expected ${section} messages`);
      continue;
    }
    for (const [key, value] of Object.entries(messages)) {
      if (typeof value !== 'string' || !value.trim())
        errors.push(`${file}: ${section}.${key} must be a nonempty string`);
    }
  }
  return { catalog: errors.length ? undefined : catalog, errors };
}

/** Other languages must cover the English keys and preserve interpolation names. */
export function compareCatalogs(english, translated, file) {
  const errors = [];
  for (const section of sections) {
    for (const [key, value] of Object.entries(english[section])) {
      const translation = translated[section][key];
      if (translation === undefined) errors.push(`${file}: missing message ${section}.${key}`);
      else if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(translation))) {
        errors.push(`${file}: interpolation values differ for ${section}.${key}`);
      }
    }
    for (const key of Object.keys(translated[section])) {
      if (!Object.hasOwn(english[section], key)) errors.push(`${file}: unused message ${section}.${key}`);
    }
  }
  return errors;
}
