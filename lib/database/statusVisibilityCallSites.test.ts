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

// `getProfileData` is the other half of the rule, and the half the database
// methods cannot see. It resolves the audience itself and its own call to them
// therefore always looks correct — but its viewer arrives through an OPTIONAL
// field, so a page that drops `{ currentActor }` silently reverts to treating
// every visitor as logged out. That is the exact shape of the original bug at
// the one call site that matters, it compiles and lints clean, and no
// behavioural test covers those pages.
const PROFILE_DATA_FUNCTION = 'getProfileData'
const PROFILE_DATA_OPTIONS_INDEX = 3
const PROFILE_DATA_VIEWER_KEY = 'currentActor'

// A caller may pass a resolved audience in one piece rather than key by key
// (the profile page spreads `visibilityScope`), so a spread counts — but only
// when the thing being spread is named for what it is. Matching anything with
// "scope" in it was tried and is too weak: a `...maxIdScope` carrying only a
// pagination cursor satisfied it while stating no audience at all.
const AUDIENCE_IDENTIFIER = /visibilit|audience/i

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
  callee: string
  statesVisibility: boolean
}

// SWC reports byte offsets that continue across files parsed in one process, so
// derive the line from the file's own text rather than from `span.start`.
const lineOfOffset = (source: string, offset: number, base: number) => {
  const index = Math.max(0, offset - base)
  return source.slice(0, index).split('\n').length
}

type ObjectProperty = {
  type?: string
  // `{ currentActor: x }` carries the name on `key`; the shorthand
  // `{ currentActor }` is an `Identifier` property whose own `value` is the
  // name and which has no `key` at all. Reading only `key` silently treated
  // every shorthand as stating nothing.
  key?: { type?: string; value?: string }
  value?: string
  arguments?: { type?: string; value?: string }
}

const objectProperties = (expression: unknown): ObjectProperty[] => {
  const object = expression as
    { type?: string; properties?: ObjectProperty[] } | undefined
  return object?.type === 'ObjectExpression' ? (object.properties ?? []) : []
}

const namesKey = (properties: ObjectProperty[], keys: Set<string>) =>
  properties.some((property) => {
    if (property.type === 'SpreadElement') {
      return (
        property.arguments?.type === 'Identifier' &&
        AUDIENCE_IDENTIFIER.test(property.arguments.value ?? '')
      )
    }
    if (property.type === 'Identifier') return keys.has(property.value ?? '')
    return keys.has(property.key?.value ?? '')
  })

// The callee's name whether it is called as a method (`database.foo(…)`) or as
// a plain function (`foo(…)`, which is how `getProfileData` and any destructured
// database method would appear). Matching only member expressions left the
// destructured form invisible to the whole walk.
const calleeName = (callee: unknown): string | null => {
  const node = callee as
    | {
        type?: string
        value?: string
        property?: { type?: string; value?: string }
      }
    | undefined
  if (node?.type === 'Identifier') return node.value ?? null
  if (
    node?.type === 'MemberExpression' &&
    node.property?.type === 'Identifier'
  ) {
    return node.property.value ?? null
  }
  return null
}

// `lib/client.ts` exports its own `getActorStatuses` — the browser wrapper over
// `GET /api/v1/accounts/:id/statuses`, which is scoped server-side and takes no
// visibility arguments at all. It shares only a name with the database method,
// so a file that imports it is not a call site of the thing being guarded.
const CLIENT_MODULE = '@/lib/client'

const namesImportedFromClient = (source: string): Set<string> => {
  const imports = new Set<string>()
  const pattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${CLIENT_MODULE}['"]`,
    'g'
  )
  for (const match of source.matchAll(pattern)) {
    for (const binding of match[1].split(',')) {
      const name = binding
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (name) imports.add(name)
    }
  }
  return imports
}

const collectCallSites = (file: string): CallSite[] => {
  const source = fs.readFileSync(file, 'utf-8')
  const watched = [...GUARDED_METHODS, PROFILE_DATA_FUNCTION]
  if (!watched.some((name) => source.includes(name))) return []
  const clientImports = namesImportedFromClient(source)

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
      callee?: unknown
      arguments?: { expression?: unknown }[]
      span?: { start: number }
    }

    if (candidate.type === 'CallExpression') {
      const name = calleeName(candidate.callee)
      const args = candidate.arguments ?? []
      if (name && clientImports.has(name)) {
        Object.values(node as Record<string, unknown>).forEach(walk)
        return
      }
      const record = (statesVisibility: boolean) =>
        sites.push({
          file: path.relative(process.cwd(), file),
          line: lineOfOffset(source, candidate.span?.start ?? base, base),
          callee: name ?? '',
          statesVisibility
        })

      if (name && GUARDED_METHODS.has(name)) {
        record(namesKey(objectProperties(args[0]?.expression), VISIBILITY_KEYS))
      } else if (name === PROFILE_DATA_FUNCTION) {
        record(
          namesKey(
            objectProperties(args[PROFILE_DATA_OPTIONS_INDEX]?.expression),
            new Set([PROFILE_DATA_VIEWER_KEY])
          )
        )
      }
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
    // A refactor that renames these must not turn this suite into a vacuous
    // pass — nor may the AST walk silently stop matching a callee shape.
    expect(callSites.length).toBeGreaterThan(0)
    expect(new Set(callSites.map((site) => site.callee))).toEqual(
      new Set([...GUARDED_METHODS, PROFILE_DATA_FUNCTION])
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
      // itself: the legitimate cases already explain themselves in a comment
      // block above the call, which is where a reviewer reads it.
      return !source.includes(OPT_OUT_MARKER)
    })

    expect(
      unstated.map((site) => `${site.file}:${site.line} ${site.callee}`)
    ).toEqual([])
  })
})
