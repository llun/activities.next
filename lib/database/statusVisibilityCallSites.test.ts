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
// instead: every call must either state a visibility audience or carry an
// explicit opt-out marker, which is a line a reviewer can see.
//
// Everything below is read from the AST rather than matched with a regex. The
// object literal spans newlines and can nest; more importantly, three separate
// attempts to approximate this with names alone each turned out to have a
// false-pass hole, and every one of them is recorded at the code that closes
// it.

const OPT_OUT_MARKER = 'visibility-unfiltered'

const GUARDED_METHODS = new Set(['getActorStatuses', 'getAttachmentsForActor'])

const VISIBILITY_KEYS = new Set([
  'publicOnly',
  'visibleToActorId',
  'includeFollowersOnly'
])

// `getProfileData` is the other half of the rule, and the half the database
// methods cannot see. It resolves the audience itself, so its own calls to them
// always look correct — but its viewer arrives through an OPTIONAL field, so a
// page that drops `{ currentActor }` silently reverts to treating every visitor
// as logged out. That is the exact shape of the original bug at the call sites
// that matter, it compiles and lints clean, and no behavioural test covers
// those pages.
const PROFILE_DATA_FUNCTION = 'getProfileData'
const PROFILE_DATA_OPTIONS_INDEX = 3
const PROFILE_DATA_VIEWER_KEY = 'currentActor'

// The pages that must pass a viewer. Listed rather than merely counted so that
// a call site disappearing from the walk fails loudly: a renamed binding used
// to vanish from the collected set entirely, which the per-name canary below
// could not see because its siblings still matched. A new entry here is a
// deliberate review step, not a chore.
const PROFILE_DATA_CALL_SITES = [
  'app/(timeline)/[actor]/followers/page.tsx',
  'app/(timeline)/[actor]/following/page.tsx',
  'app/(timeline)/[actor]/page.tsx'
]

// `lib/client.ts` exports its own `getActorStatuses` — the browser wrapper over
// `GET /api/v1/accounts/:id/statuses`, which is scoped server-side and takes no
// visibility arguments at all. It shares only a name with the database method.
const CLIENT_MODULE = '@/lib/client'

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

type ImportBinding = { imported: string; source: string }

// SWC reports byte offsets that continue across files parsed in one process, so
// derive the line from the file's own text rather than from `span.start`.
const lineOfOffset = (source: string, offset: number, base: number) => {
  const index = Math.max(0, offset - base)
  return source.slice(0, index).split('\n').length
}

const walkNodes = (
  node: unknown,
  visit: (node: Record<string, unknown>) => void
): void => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((child) => walkNodes(child, visit))
    return
  }
  visit(node as Record<string, unknown>)
  Object.values(node as Record<string, unknown>).forEach((child) =>
    walkNodes(child, visit)
  )
}

// local binding name -> what it actually is. Read from the AST so an aliased
// import (`import { getProfileData as fetchProfile }`) resolves to the real
// name: under literal matching such a call vanished from the walk completely,
// and a page could drop its viewer with every assertion still green.
const collectImportBindings = (module: unknown): Map<string, ImportBinding> => {
  const bindings = new Map<string, ImportBinding>()
  walkNodes(module, (node) => {
    if (node.type !== 'ImportDeclaration') return
    const source = (node.source as { value?: string } | undefined)?.value ?? ''
    const specifiers = (node.specifiers ?? []) as {
      type?: string
      local?: { value?: string }
      imported?: { value?: string }
    }[]
    for (const specifier of specifiers) {
      if (specifier.type !== 'ImportSpecifier') continue
      const local = specifier.local?.value
      if (!local) continue
      bindings.set(local, {
        imported: specifier.imported?.value ?? local,
        source
      })
    }
  })
  return bindings
}

// Local `const x = { … }` object literals, so a spread can be resolved to what
// it actually carries instead of trusted for being named plausibly. Name-based
// heuristics were tried twice and defeated twice — first by `...maxIdScope`
// (a pagination cursor matching a "scope" pattern), then by a decoy named for
// an audience while containing no viewer at all.
const collectObjectLiterals = (
  module: unknown
): Map<string, ObjectProperty[]> => {
  const objects = new Map<string, ObjectProperty[]>()
  walkNodes(module, (node) => {
    if (node.type !== 'VariableDeclarator') return
    const id = node.id as { type?: string; value?: string } | undefined
    const init = node.init as
      { type?: string; properties?: ObjectProperty[] } | undefined
    if (id?.type !== 'Identifier' || !id.value) return
    if (init?.type !== 'ObjectExpression') return
    objects.set(id.value, init.properties ?? [])
  })
  return objects
}

const objectProperties = (expression: unknown): ObjectProperty[] => {
  const object = expression as
    { type?: string; properties?: ObjectProperty[] } | undefined
  return object?.type === 'ObjectExpression' ? (object.properties ?? []) : []
}

const namesKey = (
  properties: ObjectProperty[],
  keys: Set<string>,
  objects: Map<string, ObjectProperty[]>,
  depth = 0
): boolean =>
  properties.some((property) => {
    if (property.type === 'SpreadElement') {
      // Resolve the spread to the literal it was declared from and look inside.
      // An unresolvable spread states nothing — failing closed here is the
      // point: the caller can always name the keys instead.
      const name = property.arguments?.value
      if (property.arguments?.type !== 'Identifier' || !name) return false
      if (depth > 2) return false
      const spread = objects.get(name)
      return spread ? namesKey(spread, keys, objects, depth + 1) : false
    }
    if (property.type === 'Identifier') return keys.has(property.value ?? '')
    return keys.has(property.key?.value ?? '')
  })

// The callee's name whether it is called as a method (`database.foo(…)`) or as
// a plain function (`foo(…)`, which is how `getProfileData` and any destructured
// database method appear). Matching only member expressions left the
// destructured form invisible to the whole walk.
//
// `bare` distinguishes the two, and it is load-bearing rather than
// informational: the client-module exclusion must apply to `foo(…)` and never
// to `database.foo(…)`. Keying that on the name alone let a file that imports
// the browser wrapper silently exempt its own real database calls.
const calleeName = (
  callee: unknown
): { name: string; bare: boolean } | null => {
  const node = callee as
    | {
        type?: string
        value?: string
        property?: { type?: string; value?: string }
      }
    | undefined
  if (node?.type === 'Identifier') {
    return node.value ? { name: node.value, bare: true } : null
  }
  if (
    node?.type === 'MemberExpression' &&
    node.property?.type === 'Identifier'
  ) {
    return node.property.value
      ? { name: node.property.value, bare: false }
      : null
  }
  return null
}

const collectCallSites = (file: string): CallSite[] => {
  const source = fs.readFileSync(file, 'utf-8')
  const watched = [...GUARDED_METHODS, PROFILE_DATA_FUNCTION]
  if (!watched.some((name) => source.includes(name))) return []

  const module = parseSync(source, {
    syntax: 'typescript',
    tsx: file.endsWith('.tsx'),
    target: 'es2022'
  })
  const base = (module as { span: { start: number } }).span.start
  const imports = collectImportBindings(module)
  const objects = collectObjectLiterals(module)
  const sites: CallSite[] = []

  walkNodes(module, (node) => {
    if (node.type !== 'CallExpression') return
    const callee = calleeName(node.callee)
    if (!callee) return

    // A bare call resolves through the file's imports, so an alias is followed
    // and the same-named browser wrapper is excluded. A member expression is
    // always a call on the database object, whatever the imports say.
    const binding = callee.bare ? imports.get(callee.name) : undefined
    if (binding?.source === CLIENT_MODULE) return
    const name = binding?.imported ?? callee.name

    const args = (node.arguments ?? []) as { expression?: unknown }[]
    const record = (statesVisibility: boolean) =>
      sites.push({
        file: path.relative(process.cwd(), file),
        line: lineOfOffset(
          source,
          (node.span as { start: number } | undefined)?.start ?? base,
          base
        ),
        callee: name,
        statesVisibility
      })

    if (GUARDED_METHODS.has(name)) {
      record(
        namesKey(
          objectProperties(args[0]?.expression),
          VISIBILITY_KEYS,
          objects
        )
      )
      return
    }
    if (name === PROFILE_DATA_FUNCTION) {
      record(
        namesKey(
          objectProperties(args[PROFILE_DATA_OPTIONS_INDEX]?.expression),
          new Set([PROFILE_DATA_VIEWER_KEY]),
          objects
        )
      )
    }
  })

  return sites
}

describe('status and attachment visibility call sites', () => {
  const files = SCANNED_ROOTS.flatMap(collectSourceFiles)
  const callSites = files.flatMap(collectCallSites)

  it('finds the call sites it is meant to guard', () => {
    // A rename must not turn this suite into a vacuous pass, nor may the AST
    // walk silently stop matching a callee shape.
    expect(callSites.length).toBeGreaterThan(0)
    expect(new Set(callSites.map((site) => site.callee))).toEqual(
      new Set([...GUARDED_METHODS, PROFILE_DATA_FUNCTION])
    )
  })

  // The check above dedupes by name, so it stays green while SOME calls to a
  // name go unseen. These are the pages the fix is carried into, so they are
  // named individually.
  it('sees every page that reads a profile', () => {
    const seen = callSites
      .filter((site) => site.callee === PROFILE_DATA_FUNCTION)
      .map((site) => site.file)

    expect([...new Set(seen)].sort()).toEqual(
      [...PROFILE_DATA_CALL_SITES].sort()
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
