# Judgement slice brief (GLM-5.3-flash)

RULES: Do this task yourself. No sub-agents, no delegation or hand-off to any other model or agent. The repository is READ-ONLY: write ONLY the one output file named below. Do not run git commands that change state. Your context is small: never cat a whole large file; use `grep -n` for test names (`grep -nE "^\s*(it|test|describe)(\.each|\.skip|\.only)?\(" FILE`) and `sed -n 'A,Bp'` for the few bodies you need. Write findings to the output file AFTER EACH test file (append), so partial work survives.

INPUT: the test files listed in test-audit/slices/NNN.txt (repo-relative paths, one per line). Per-file metrics: `grep -F "<path>," test-audit/raw/test-metrics.csv` (columns: path,lines,cases,expects,viMocks,viFnSpies,guard,reason,importsUnderTest,tier). Durations: `grep -F "<path>," test-audit/raw/durations.csv` (file,tests,durationMs,slowestTestName,slowestMs).

GOAL: the owner wants to cut redundant tests and treat all tests as one suite. For each file in the slice, find:
(a) TRIVIAL tests: constant/getter/type-shape checks, render-only smoke tests ("renders without crashing", only checks one text exists), tests that only assert a mock was called with what it was given, tests of a re-export or a one-line wrapper.
(b) DUPLICATES: the same behaviour asserted in two places (two test files, or two cases in one file, or a component/service test whose behaviour is already asserted by a route/page test). To find the other side, grep test files for the module or function name: `git grep -n "<name>" -- '*.test.ts' '*.test.tsx' | head -20`.
(c) GUARD tests that read source text or parse code to enforce a rule (note whether oxlint or TypeScript could enforce it instead).
Skip files with nothing to report (just list them in a final "clean" line). Do not invent: every item needs file:line.

OUTPUT: test-audit/04-judgement/NNN.md, markdown, sections "## Trivial", "## Duplicates", "## Guards", "## Clean files". One bullet per item:
`- path/to/file.test.ts:LINE — "test name" — reason (one line) — covered by: other/file.test.ts:LINE (or "none")`
End with one line: `SUMMARY: trivial=X duplicates=Y guards=Z files=N`.
Final answer: just the SUMMARY line.
