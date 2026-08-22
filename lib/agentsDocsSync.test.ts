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

const readRepositoryFile = (relativePath: string) =>
  fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8')

const existsInRepository = (relativePath: string) =>
  fs.existsSync(path.join(REPOSITORY_ROOT, relativePath))

/** The bullet in AGENTS.md that enumerates the per-tool pointer files. */
const POINTER_FILE_RULE =
  /keep the thin per-tool pointer files in sync \(([^)]*)\)/

// Derived from that bullet rather than hand-listed. A hardcoded copy stays
// green while the bullet grows a fourth file whose citations nothing checks —
// which is this same drift one level up, in the guard itself.
//
// This is read once, at collection time, because `it.each` needs its cases
// then. That makes the first test load-bearing beyond its own assertion: if the
// bullet is reworded past the regex this returns `[]`, `it.each` registers no
// cases at all, and the only thing left saying so is that test re-running this
// parse and failing on it. Do not weaken it into something the `it.each` above
// could outlive.
const pointerFiles = () => {
  const rule = POINTER_FILE_RULE.exec(readRepositoryFile('AGENTS.md'))
  if (!rule) return []
  return Array.from(rule[1].matchAll(/`([^`]+)`/g), (match) => match[1])
}

const POINTER_FILES = pointerFiles()

// The one citation form the pointer files use: ``See **X** in `AGENTS.md`.``,
// or ``See **X** and **Y** in `AGENTS.md`.`` for a bullet that draws on two
// sections. Matching the whole clause rather than hunting for bold runs near
// the words `AGENTS.md` is what keeps this from sweeping up ordinary emphasis —
// these bullets are dense with it.
//
// `See\s+`, not a literal `See `: CLAUDE.md hard-wraps its longer bullets, and
// two of them wrap in the gap between `See` and the section name. The literal
// space skipped exactly those two, so the guard was blind to a rename of the
// one section they cite — a false negative, which for a guard is the direction
// that matters.
const SECTION_CITATION =
  /See\s+((?:\*\*[^*]+\*\*\s*(?:and\s+)?)+)in `AGENTS\.md`/g

// A section name can straddle a newline and its leading indent too.
const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

const citedSections = (contents: string) =>
  Array.from(contents.matchAll(SECTION_CITATION)).flatMap((match) =>
    Array.from(match[1].matchAll(/\*\*([^*]+)\*\*/g), (name) =>
      collapseWhitespace(name[1])
    )
  )

// Forms that used to appear and are no longer allowed. A single form is what
// makes the citations parseable here at all; without it this test would have to
// guess which bold run is a section name and which is ordinary emphasis. Naming
// a section in passing — ``**Some Section** applies.`` — is for the same reason
// not a citation as far as this file is concerned, and is invisible to it: say
// ``See **Some Section** in `AGENTS.md`.`` or the guard cannot help you.
const RETIRED_CITATION_FORMS: { pattern: RegExp; use: string }[] = [
  {
    pattern: /`AGENTS\.md` →/,
    use: 'See **Section Name** in `AGENTS.md`.'
  },
  {
    pattern: /section in `AGENTS\.md`/,
    use: 'See **Section Name** in `AGENTS.md`. (no "section" noun)'
  },
  {
    pattern: /subsection of `AGENTS\.md`/,
    use: 'See **Section Name** in `AGENTS.md`. (no "subsection" noun)'
  }
]

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
 * An ambiguous prefix counts as unresolved, so a new heading that shadows an
 * existing citation fails here rather than silently rebinding it.
 */
const resolvesToHeading = (citation: string, headings: string[]) => {
  if (headings.includes(citation)) return true
  return headings.filter((heading) => heading.startsWith(citation)).length === 1
}

describe('AGENTS.md and its per-tool pointer files', () => {
  it('lists only pointer files that exist', () => {
    // The rule text moving or being reworded must fail loudly rather than
    // quietly stop checking anything — including in the `it.each` below, which
    // draws its cases from this same list.
    expect(
      POINTER_FILE_RULE.exec(readRepositoryFile('AGENTS.md'))
    ).not.toBeNull()
    expect(POINTER_FILES.length).toBeGreaterThan(1)

    expect(POINTER_FILES.filter((file) => !existsInRepository(file))).toEqual(
      []
    )
  })

  it.each(POINTER_FILES)(
    'cites only real AGENTS.md sections from %s',
    (pointerFile) => {
      const headings = agentsHeadings()
      expect(headings.length).toBeGreaterThan(20)

      // Absence is the previous test's finding to report, with a better message
      // than the ENOENT this would otherwise throw.
      if (!existsInRepository(pointerFile)) return

      const unresolved = citedSections(readRepositoryFile(pointerFile)).filter(
        (citation) => !resolvesToHeading(citation, headings)
      )
      expect(unresolved).toEqual([])
    }
  )

  it('cites AGENTS.md sections in one form', () => {
    const offenders = POINTER_FILES.filter(existsInRepository).flatMap(
      (pointerFile) => {
        const contents = readRepositoryFile(pointerFile)
        return RETIRED_CITATION_FORMS.filter(({ pattern }) =>
          pattern.test(contents)
        ).map(({ use }) => `${pointerFile}: use ${use}`)
      }
    )

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
