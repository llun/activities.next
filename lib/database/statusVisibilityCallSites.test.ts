import { parseSync } from '@swc/core'
import fs from 'fs'
import path from 'path'

// `getActorStatuses` and `getAttachmentsForActor` take their visibility as four
// individually optional arguments, and omitting all of them means "no filter"
// rather than "the safe default". That is a deliberate mode — the owner's own
// profile and the full-history export in `scripts/backup/actorArchive.ts` both
// rely on it — but it means a caller that simply forgets gets the unfiltered
// query and no error.
//
// The profile page did exactly that: `getProfileData` passed only
// `currentActorId`, which is hydration-only, so a logged-out visitor's page
// server-rendered the actor's followers-only posts, their direct messages to
// third parties, and (through the attachments call beside it) the images on
// all of them.
//
// Making the argument required in the type would be the stronger guard, but it
// would also force the two legitimately-unfiltered callers to restate their
// intent in a way the type cannot check either. So the rule is enforced here
// instead: every call must either name a visibility argument or carry an
// explicit opt-out marker, which is a line a reviewer can see.
//
// Arguments are read from the AST rather than matched with a regex because the
// object literal spans newlines and can contain nested objects and spreads; a
// regex either stops at the first `}` or swallows the next argument.

const OPT_OUT_MARKER = 'visibility-unfiltered'

const GUARDED_METHODS = new Set(['getActorStatuses', 'getAttachmentsForActor'])

const VISIBILITY_KEYS = new Set([
  'publicOnly',
  'visibleToActorId',
  'includeFollowersOnly'
])

// A caller may pass a resolved audience in one piece rather than key by key
// (the profile page spreads `visibilityScope`), so a spread counts — but only
// when the thing being spread is named for what it is. Any spread at all would
// be too permissive: `...(maxStatusId ? { maxStatusId } : null)` is a pagination
// cursor, and treating it as a visibility statement would exempt the
// deliberately-unfiltered archive walker without anyone saying so.
const AUDIENCE_IDENTIFIER = /visibilit|audience|scope/i

const SCANNED_ROOTS = [
  path.join(process.cwd(), 'app'),
  path.join(process.cwd(), 'lib'),
  path.join(process.cwd(), 'scripts')
]

const collectSourceFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : collectSourceFiles(fullPath)
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [fullPath]
      : []
  })
}

type CallSite = {
  file: string
  line: number
  method: string
  statesVisibility: boolean
}

// SWC reports byte offsets that continue across files parsed in one process, so
// derive the line from the file's own text rather than from `span.start`.
const lineOfOffset = (source: string, offset: number, base: number) => {
  const index = Math.max(0, offset - base)
  return source.slice(0, index).split('\n').length
}

const collectCallSites = (file: string): CallSite[] => {
  const source = fs.readFileSync(file, 'utf-8')
  if (![...GUARDED_METHODS].some((method) => source.includes(method))) return []

  const module = parseSync(source, {
    syntax: 'typescript',
    tsx: file.endsWith('.tsx'),
    target: 'es2022'
  })
  const base = module.span.start
  const sites: CallSite[] = []

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }

    const candidate = node as {
      type?: string
      callee?: {
        type?: string
        property?: { type?: string; value?: string }
      }
      arguments?: { expression?: unknown }[]
      span?: { start: number }
    }

    if (
      candidate.type === 'CallExpression' &&
      candidate.callee?.type === 'MemberExpression' &&
      candidate.callee.property?.type === 'Identifier' &&
      GUARDED_METHODS.has(candidate.callee.property.value ?? '')
    ) {
      const [firstArgument] = candidate.arguments ?? []
      const expression = firstArgument?.expression as
        | {
            type?: string
            properties?: {
              type?: string
              key?: { type?: string; value?: string }
            }[]
          }
        | undefined

      const properties: {
        type?: string
        key?: { type?: string; value?: string }
      }[] =
        expression?.type === 'ObjectExpression'
          ? (expression.properties ?? [])
          : []
      const statesVisibility = properties.some((property) => {
        if (property.type === 'SpreadElement') {
          const spread = property as {
            arguments?: { type?: string; value?: string }
          }
          return (
            spread.arguments?.type === 'Identifier' &&
            AUDIENCE_IDENTIFIER.test(spread.arguments.value ?? '')
          )
        }
        return VISIBILITY_KEYS.has(property.key?.value ?? '')
      })

      sites.push({
        file: path.relative(process.cwd(), file),
        line: lineOfOffset(source, candidate.span?.start ?? base, base),
        method: candidate.callee.property.value ?? '',
        statesVisibility
      })
    }

    Object.values(node as Record<string, unknown>).forEach(walk)
  }

  walk(module)
  return sites
}

describe('status and attachment visibility call sites', () => {
  const files = SCANNED_ROOTS.flatMap(collectSourceFiles)
  const callSites = files.flatMap(collectCallSites)

  it('finds the call sites it is meant to guard', () => {
    // A refactor that renames these methods must not turn this suite into a
    // vacuous pass.
    expect(callSites.length).toBeGreaterThan(0)
    expect(new Set(callSites.map((site) => site.method))).toEqual(
      GUARDED_METHODS
    )
  })

  it('has every call either state a visibility audience or opt out explicitly', () => {
    const unstated = callSites.filter((site) => {
      if (site.statesVisibility) return false
      const source = fs.readFileSync(
        path.join(process.cwd(), site.file),
        'utf-8'
      )
      // The marker is looked for anywhere in the file rather than on the call
      // itself: the two legitimate cases already explain themselves in a
      // comment block above the call, which is where a reviewer reads it.
      return !source.includes(OPT_OUT_MARKER)
    })

    expect(
      unstated.map((site) => `${site.file}:${site.line} ${site.method}`)
    ).toEqual([])
  })
})
