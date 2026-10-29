# Route-contains-unit verdicts (GLM-5.3-flash)

RULES: Do this yourself. No sub-agents, no delegation or hand-off to any other model. The repository is READ-ONLY: write ONLY your one output CSV named below (no other file anywhere, not even a placeholder). No git commands that change state. Keep context lean: grep -n test names, sed -n line ranges; never cat a whole large file.

INPUT: test-audit/slices/rcu/partNN (one lib/services or lib/database unit test file per line). Per-test coverage shows each file's distinctive covered lines are >= 90% inside one or more app/api route tests:
`grep -F ",<path>," test-audit/raw/coverage-overlap.csv | grep route-contains-unit` (columns: category,A,B,containmentPct,aDistinctLines,bDistinctLines,moduleUnderTest).
Earlier reviewer notes: `grep -rn -F "<path>" test-audit/04-judgement/ | head`. Case counts: `grep -F "<path>," test-audit/raw/test-metrics.csv`.

GOAL: the owner wants ONE suite and to remove unit tests whose behaviour a route test already asserts. Default is DELETE when the route test asserts the same observable behaviour. For each file:
1. List its cases (`grep -nE "^\s*(it|test)(\.each)?\(" FILE`).
2. Pick the strongest covering route test(s) and list their case names the same way; read bodies only where unsure.
3. Verdict: `delete` (route tests assert every behaviour this file asserts), `trim` (keep only the named unique cases: edge-case tables, error branches the route never hits, pure-logic boundaries), or `keep` (the route tests only pass through this code without asserting its behaviour; say what is unasserted).

OUTPUT: test-audit/raw/rcu-partNN.csv with header
`file,cases,verdict,casesToKeep,keepLines,coveringRouteTest,reason`
one row per input file. casesToKeep = number of cases kept (0 for delete, all for keep); keepLines = `file:line;file:line` of kept cases for trim (empty otherwise); reason = one short sentence without commas. Append each row as you finish that file.
Final answer: counts of delete/trim/keep and total cases removed.

STRICT EVIDENCE RULE (added after a rerun): coverage containment only shows the route test EXECUTES the code. A `delete` is valid only when, for every case in the unit file, you found a route-test case that ASSERTS the same observable output (same field/header/status/rendered text). Put that evidence in coveringRouteTest as `route.test.ts:LINE` (the asserting `it(` line), several separated by `;`. If the route test mocks the unit (vi.mock of its module) or never asserts its output (e.g. email subject/html, cache TTL, error branch), the verdict is `trim` or `keep`. A previous run deleted email template tests because a status route executed them, though that route never asserts a subject or html; do not repeat that.
