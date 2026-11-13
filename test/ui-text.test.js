import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|css|html)$/.test(e.name) ? [join(dir, e.name)] : []));

test('the UI has no placeholder text or "e.g." sample values', () => {
  const all = files(new URL('../src/ui', import.meta.url).pathname).map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.ok(!/placeholder/i.test(all), 'remove placeholder attributes and styles; use a label or hint instead');
  assert.ok(!/e\.g\./i.test(all), 'do not show example values in the UI');
});
