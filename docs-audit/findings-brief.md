# Findings brief (shared by every slice run)

Rules: work alone. Do not start sub-agents, do not delegate or hand off to any other model or agent. The repository is read-only for you: write exactly ONE file, the output path your prompt names, under `docs-audit/parts/findings/`. Do not edit any other file, do not run git add/commit, do not write anywhere outside `docs-audit/`.

Context: llun/activities.next is a Next.js ActivityPub/Mastodon-compatible server. Its docs (README.md, CONTRIBUTING.md, AGENTS.md, REVIEW.md, docs/*.md) total about 1.6 MB and are being audited before a cleanup. AGENTS.md is a routing map for coding agents; many of its sections only say the durable rule now lives in a "Contributor rules" section of a docs/ guide or CONTRIBUTING.md. `docs/` is meant to hold durable reference only, not plans or PR write-ups.

Your prompt gives you ONE slice: a file and a line range. Read only that range (`sed -n 'A,Bp' file`, in pieces of about 150 lines if long). Do not read other docs whole; use `grep -n` / `git grep -n` to check things.

Find, in your slice only:
1. Duplicated content: the same rule, instruction or explanation stated in 2+ places. For each candidate pick a distinctive phrase or identifier and run `git grep -nF '<phrase>' -- README.md CONTRIBUTING.md AGENTS.md REVIEW.md 'docs/*.md'`. Report only duplicates you confirmed, with both locations (file:line).
2. Stale content: mentions of files, folders, scripts, package.json scripts, env vars, functions/symbols, commands, CLI flags or workflows that no longer exist. Verify each with `git ls-files | grep`, `git grep -n`, or `grep '"<name>"' package.json`. Report only ones you checked, saying what you ran and what it returned. If something exists, do not report it.
3. Change-log / history text: sentences about a single PR, a past bug, "used to", "was moved", "since vX", "we tried", PR numbers (#1234), dates, or narratives of how a rule came about, that do not belong in durable docs. Give line ranges and a short quote (under 15 words).
4. Very long sections: any ## / ### / #### section in your slice longer than 80 lines, with its line range and a one-line note on whether it could be shortened, split, or is reference tables that must stay.
5. Task/PR-specific content: checklists or instructions only meaningful for one task, one migration or one release.
6. Anything else that makes the slice hard to read (walls of text, nested caveats, repeated "never/always" rules), in one or two lines each.

Output format for your file (markdown, keep it under about 250 lines):

```
## <file> lines A-B
### Duplicates
- <file>:<line> ≈ <other file>:<line> — <what is duplicated>
### Stale
- <file>:<line> — `<thing>` — checked: `<command>` → <result>
### History / changelog text
- <file>:<A-B> — "<short quote>"
### Long sections
- <file>:<A-B> `<heading>` (<n> lines) — <note>
### Task/PR-specific
- ...
### Readability
- ...
### Slice summary
<2-3 lines: what this slice is, how much of it could go or move>
```

Write "none" under a heading with nothing. Line numbers are of the original file. Done = the output file exists. Reply with one line: counts per category.
