import fs from 'fs'
import path from 'path'

// `AGENTS.md` is the canonical rulebook. The per-tool files — `CLAUDE.md`,
// `GEMINI.md`, `.github/copilot-instructions.md` — are thin restatements that
// point back at it by section name, and AGENTS.md's own Documentation
// Maintenance section lists which files those are.
//
// Both halves of that arrangement drift silently. `.cursor/rules/agents.mdc`
// was deleted in #1424 and stayed in the list for months, so the rule told
// every agent to update a file that was not there. In the other direction, a
// renamed AGENTS.md heading leaves the pointers citing a section that no longer
// exists, which is worse than no pointer: it sends a reader looking for
// guidance under a name nothing answers to. Neither shows up in lint, the
// build, or a rendered Markdown preview.
//
// This file is the guard for both. It deliberately checks structure, not
// content — whether the two documents AGREE is a judgement no test can make.
const REPOSITORY_ROOT = process.cwd()

/** The bullet in AGENTS.md that enumerates the per-tool pointer files. */
const POINTER_FILE_RULE =
  /keep the thin per-tool pointer files in sync \(([^)]*)\)/

// The one citation form the pointer files use: ``See **X** in `AGENTS.md`.``,
// or ``See **X** and **Y** in `AGENTS.md`.`` for a bullet that draws on two
// sections. Matching the whole clause rather than hunting for bold runs near
// the words `AGENTS.md` is what keeps this from sweeping up ordinary emphasis —
// these bullets are dense with it.
const SECTION_CITATION =
  /See ((?:\*\*[^*]+\*\*\s*(?:and\s+)?)+)in `AGENTS\.md`/g

// CLAUDE.md hard-wraps its longer bullets, so a section name can straddle a
// newline and its leading indent.
const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

const citedSections = (contents: string) =>
  Array.from(contents.matchAll(SECTION_CITATION)).flatMap((match) =>
    Array.from(match[1].matchAll(/\*\*([^*]+)\*\*/g), (name) =>
      collapseWhitespace(name[1])
    )
  )

// Forms that used to appear and are no longer allowed. A single form is what
// makes the citations parseable here at all; without it this test would have to
// guess which bold run is a section name and which is ordinary emphasis.
const RETIRED_CITATION_FORMS: { pattern: RegExp; use: string }[] = [
  {
    pattern: /`AGENTS\.md` →/,
    use: 'See **Section Name** in `AGENTS.md`.'
  },
  {
    pattern: /section in `AGENTS\.md`/,
    use: 'See **Section Name** in `AGENTS.md`. (no "section" noun)'
  }
]

const readRepositoryFile = (relativePath: string) =>
  fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8')

const agentsHeadings = () =>
  readRepositoryFile('AGENTS.md')
    .split('\n')
    .filter((line) => /^#+ /.test(line))
    .map((line) => line.replace(/^#+ /, '').trim())

/**
 * A citation resolves when it names a heading outright, or is the unambiguous
 * opening of exactly one. The prefix case is real and worth allowing: the
 * heading `Local Actors ("does this server host this actor?")` is cited as
 * `Local Actors`, which identifies it precisely and reads far better inline.
 */
const resolvesToHeading = (citation: string, headings: string[]) => {
  if (headings.includes(citation)) return true
  return headings.filter((heading) => heading.startsWith(citation)).length === 1
}

describe('AGENTS.md and its per-tool pointer files', () => {
  it('lists only pointer files that exist', () => {
    const rule = POINTER_FILE_RULE.exec(readRepositoryFile('AGENTS.md'))
    // The rule text moving or being reworded must fail loudly rather than
    // quietly stop checking anything.
    expect(rule).not.toBeNull()

    const listed = Array.from(rule![1].matchAll(/`([^`]+)`/g), (m) => m[1])
    expect(listed.length).toBeGreaterThan(1)

    const missing = listed.filter(
      (file) => !fs.existsSync(path.join(REPOSITORY_ROOT, file))
    )
    expect(missing).toEqual([])
  })

  // Every file the rule above names has to be readable here, so a pointer file
  // added to the list without being created fails on both counts.
  it.each(['CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md'])(
    'cites only real AGENTS.md sections from %s',
    (pointerFile) => {
      const headings = agentsHeadings()
      expect(headings.length).toBeGreaterThan(20)

      const citations = citedSections(readRepositoryFile(pointerFile))

      const unresolved = citations.filter(
        (citation) => !resolvesToHeading(citation, headings)
      )
      expect(unresolved).toEqual([])
    }
  )

  it('cites AGENTS.md sections in one form', () => {
    const offenders = [
      'CLAUDE.md',
      'GEMINI.md',
      '.github/copilot-instructions.md'
    ].flatMap((pointerFile) => {
      const contents = readRepositoryFile(pointerFile)
      return RETIRED_CITATION_FORMS.filter(({ pattern }) =>
        pattern.test(contents)
      ).map(({ use }) => `${pointerFile}: use ${use}`)
    })

    expect(offenders).toEqual([])
  })

  // CLAUDE.md is the one pointer file dense enough to drift into a second
  // rulebook. It carries ~50 rules; if it stops citing AGENTS.md at all, the
  // two have come apart regardless of what any individual bullet says.
  it('keeps CLAUDE.md pointing back at AGENTS.md throughout', () => {
    expect(
      citedSections(readRepositoryFile('CLAUDE.md')).length
    ).toBeGreaterThan(20)
  })
})
