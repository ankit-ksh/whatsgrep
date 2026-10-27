import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the UI has no placeholder text or "e.g." sample values', () => {
  const html = readFileSync(new URL('../src/ui/index.html', import.meta.url), 'utf8');
  assert.ok(!/placeholder/i.test(html), 'remove placeholder attributes and styles; use a label or hint instead');
  assert.ok(!/e\.g\./i.test(html), 'do not show example values in the UI');
});
