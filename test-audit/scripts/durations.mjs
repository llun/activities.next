// Join vitest's JSON reporter output into per-file duration metrics.
// Input: test-audit/raw/vitest.json (vitest --reporter=json --outputFile=...)
// Output: test-audit/raw/durations.csv with columns
//   file, tests, durationMs, slowestTestName, slowestMs
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('test-audit/raw/vitest.json', 'utf8'));

const rows = [];
for (const tr of data.testResults || []) {
  const file = tr.name;
  const tests = tr.assertionResults || [];
  const total = (tests.reduce((a, t) => a + (t.duration || 0), 0)) || tr.duration || 0;
  let slowest = null;
  let slowestMs = 0;
  for (const t of tests) {
    if ((t.duration || 0) > slowestMs) {
      slowestMs = t.duration || 0;
      slowest = t.fullName || t.title || '';
    }
  }
  rows.push({
    file,
    tests: tests.length,
    durationMs: Math.round(total),
    slowestTestName: slowest || '',
    slowestMs,
  });
}

rows.sort((a, b) => b.durationMs - a.durationMs);

const esc = (v) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = ['file,tests,durationMs,slowestTestName,slowestMs'];
for (const r of rows) {
  csv.push([r.file, r.tests, r.durationMs, esc(r.slowestTestName), r.slowestMs].join(','));
}
writeFileSync('test-audit/raw/durations.csv', csv.join('\n') + '\n');
console.log('wrote', rows.length, 'rows to test-audit/raw/durations.csv');
