// Mechanical per-test-file metrics for slice 2.
// Input: `git ls-files '*.test.ts' '*.test.tsx'` plus the test-pg job file list
// parsed out of .github/workflows/ci.yml.
// Output: test-audit/raw/test-metrics.csv and test-audit/raw/test-metrics.json.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function stripCommentsAndStrings(src) {
  // Replaces comment bodies and string/template interiors with spaces so
  // regex counting only sees real code. Keeps string quotes in place.
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code'; // code | line | block | s | d | t
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { state = 's'; out += c; i++; continue; }
      if (c === '"') { state = 'd'; out += c; i++; continue; }
      if (c === '`') { state = 't'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; } else { out += ' '; }
      i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; out += '   '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' ';
      i++; continue;
    }
    // inside strings
    if (state === 's' && c === '\\') { out += '  '; i += 2; continue; }
    if (state === 'd' && c === '\\') { out += '  '; i += 2; continue; }
    if (state === 't' && c === '\\') { out += '  '; i += 2; continue; }
    if (state === 's' && c === "'") { state = 'code'; out += c; i++; continue; }
    if (state === 'd' && c === '"') { state = 'code'; out += c; i++; continue; }
    if (state === 't' && c === '`') { state = 'code'; out += c; i++; continue; }
    out += state === 't' ? c : ' '; // template interiors kept (may embed code)
    i++;
  }
  return out;
}

const files = execSync("git ls-files '*.test.ts' '*.test.tsx'", { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n')
  .filter(Boolean);

// Parse the test-pg job file list out of ci.yml (files appear as args to yarn test).
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const pgJob = ci.slice(ci.indexOf('test-pg:'));
const pgList = new Set();
for (const m of pgJob.matchAll(/^\s+([\w\-./[\]()']+\.test\.(ts|tsx))\s*\?$/gm)) {
  pgList.add(m[1]);
}

const rows = [];
for (const rel of files) {
  const src = readFileSync(rel, 'utf8');
  const stripped = stripCommentsAndStrings(src);
  const lines = src.split('\n').length;
  const cases = (stripped.match(/\b(?:it|test)\s*(?:\.\s*\w+)?\s*\(/g) || []).length;
  const expects = (stripped.match(/\bexpect\s*\(/g) || []).length;
  const viMocks = (stripped.match(/\bvi\s*\.\s*mock\s*\(/g) || []).length;
  const viFn = (stripped.match(/\bvi\s*\.\s*(?:fn|spyOn)\s*\(/g) || []).length;

  // Guard (refined): reads repo files at runtime - directly via fs APIs, or
// indirectly through lib/testing/moduleImports or a local fs-walking helper -
// or parses source structure with @swc/core / typescript / moduleImports.
  // Guard (refined): reads repo files at runtime — directly via fs APIs, or
  // indirectly through lib/testing/moduleImports or a local fs-walking helper —
  // or parses source structure with @swc/core / typescript / moduleImports.
  // Reads confined to __fixtures__/ or fixtures/ dirs are not guards.
  const guardPatterns = [];
  const usesFsRead = /\b(?:readFileSync|readFile|readdirSync|readdir|globSync|glob)\s*\(/.test(src) || /from ['"](?:node:)?fs(?:\/promises)?['"]/.test(src);
  const parsesSource = /@swc\/core|from ['"]typescript['"]|moduleImports/.test(src);
  if (usesFsRead) guardPatterns.push('reads repo files at runtime (fs APIs)');
  if (parsesSource) guardPatterns.push('asserts on code structure (source parsing / moduleImports)');
  // NEW: source-structure assertions via @swc/core or the typescript compiler,
  // and ?raw source imports (vite reads the file, the test asserts on it).
  if (/\b(?:from|require)\s*\(\s*['"]@swc\/core['"]|from ['"]@swc\/core['"]/.test(src)) {
    guardPatterns.push('parses source with @swc/core');
  }
  if (/from ['"]typescript['"]|\brequire\s*\(\s*['"]typescript['"]\s*\)/.test(src)) {
    guardPatterns.push('parses source with the typescript compiler');
  }
  if (/\?raw['"`]/.test(src)) {
    guardPatterns.push('?raw source import');
  }
  // NEW: imports of the lib/testing/moduleImports source-walking helper.
  if (/\bmoduleImports\b/.test(src)) {
    guardPatterns.push('imports lib/testing/moduleImports source walker');
  }
  const fixtureReads = /__fixtures__|fixtures\//.test(src);
  const guard = guardPatterns.length > 0;
  const reason = guardPatterns.join('; ');

  // Imports under test: relative (./ ../) and @/ imports, excluding obvious
  // test-infrastructure modules (vitest, testing-library, mocks, fixtures).
  // Imports and guard detection run on the RAW source: the stripper blanks
  // string interiors, which would erase import specifiers and path literals.
  const importTargets = [];
  for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) importTargets.push(m[1]);
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) importTargets.push(m[1]);
  for (const m of src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) importTargets.push(m[1]);
  const importsUnderTest = importTargets.filter(
    (s) => s.startsWith('.') || s.startsWith('..') || s.startsWith('@/'),
  );
  const testInfra = /vitest|testing-library|jest|mock|fixture|__tests__/i;
  const real = importsUnderTest.filter((s) => !testInfra.test(s));

  // Tier: first match wins, in the order route > pg > component > db > service > other.
  let tier = 'other';
  if (/^app\/.*route\.test\.tsx?$/.test(rel)) tier = 'route';
  else if (pgList.has(rel)) tier = 'pg';
  else if (/\.tsx$/.test(rel) && /^(lib\/components|app)\//.test(rel)) tier = 'component';
  else if (/^lib\/database\//.test(rel)) tier = 'db';
  else if (/^lib\/services\//.test(rel)) tier = 'service';

  rows.push({
    path: rel,
    lines,
    cases,
    expects,
    viMocks,
    viFnSpies: viFn,
    guard,
    reason,
    tier,
    importsUnderTest: real,
  });
}

mkdirSync('test-audit/raw', { recursive: true });

// CSV
const esc = (v) => {
  const s = Array.isArray(v) ? v.join(';') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const header = 'path,lines,cases,expects,viMocks,viFnSpies,guard,reason,importsUnderTest,tier';
const csv = [header];
for (const r of rows) {
  csv.push(
    [
      r.path, r.lines, r.cases, r.expects, r.viMocks, r.viFnSpies,
      r.guard, r.reason, r.importsUnderTest.join(';'), r.tier,
    ].map(esc).join(','),
  );
}
writeFileSync('test-audit/raw/test-metrics.csv', csv.join('\n') + '\n');

// JSON
writeFileSync(
  'test-audit/raw/test-metrics.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2) + '\n',
);

// Summary
const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
const tierCounts = {};
for (const r of rows) tierCounts[r.tier] = (tierCounts[r.tier] || 0) + 1;
console.log('files:', rows.length);
console.log('cases:', sum('cases'), 'expects:', sum('expects'), 'viMocks:', sum('viMocks'), 'viFnSpies:', sum('viFnSpies'));
console.log('guard files:', rows.filter((r) => r.guard).length);
console.log('tiers:', JSON.stringify(tierCounts));
console.log('empty importsUnderTest:', rows.filter((r) => r.importsUnderTest.length === 0).length);
