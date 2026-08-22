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
// A required argument is the stronger guard, and where it fits it is what was
// used: `getProfileData`'s viewer is required, so the compiler rejects the
// omission and nothing below needs to check it. These two are the case it does
// not fit. Their unfiltered mode is legitimate rather than accidental, so a
// required discriminant would make both honest callers restate an intent the
// type still could not verify, and every one of the hundreds of existing calls
// across the suite would have to be rewritten to say it. So the rule is
// enforced here instead: every call must either state a visibility audience or
// carry an explicit opt-out marker, which is a line a reviewer can see.
//
// Everything below is read from the AST rather than matched with a regex. The
// object literal spans newlines and can nest; more importantly, several
// attempts to approximate this with names alone each turned out to have a
// false-pass hole, and every one of them is recorded at the code that closes
// it.
//
// Known limitation: resolution is per-file. A call reached through a module
// that re-exports one of these as its DEFAULT (`export default getProfileData`,
// imported elsewhere under any name) is invisible here, because identifying it
// needs cross-module resolution. A namespace import is fine — `m.getProfileData(…)`
// is a member expression and matches on the property name. Nothing in the repo
// re-exports these today; this is the boundary of the guard, not a claim that
// it cannot be stepped around by someone trying.

const OPT_OUT_MARKER = 'visibility-unfiltered'

const GUARDED_METHODS = new Set(['getActorStatuses', 'getAttachmentsForActor'])

const VISIBILITY_KEYS = new Set([
  'publicOnly',
  'visibleToActorId',
  'includeFollowersOnly'
])

// `getProfileData` is deliberately NOT checked here. Its viewer used to be an
// optional field a page could drop — the original bug — and this suite did
// briefly guard it, through a hardcoded page list and enough AST machinery to
// follow aliased imports and decoy spreads. That was the wrong tool: the
// viewer is now a REQUIRED parameter, so the compiler rejects an omission at
// every call site, including ones no scan of these directories would reach.
// See `ProfileDataOptions` in app/(timeline)/[actor]/getProfileData.ts.

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
      const local = specifier.local?.value
      if (!local) continue
      // Named imports carry the original on `imported` when aliased. A default
      // or namespace import has no such name; recording it as `default` at
      // least keeps the binding known rather than silently absent.
      if (specifier.type === 'ImportSpecifier') {
        bindings.set(local, {
          imported: specifier.imported?.value ?? local,
          source
        })
        continue
      }
      if (
        specifier.type === 'ImportDefaultSpecifier' ||
        specifier.type === 'ImportNamespaceSpecifier'
      ) {
        bindings.set(local, { imported: 'default', source })
      }
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

// The argument's properties, whether written inline or prepared under a name.
// Resolving the named form matters for ergonomics rather than safety: extracting
// options into a `const` for readability is the natural refactor, and rejecting
// it while accepting the spread of the identical object would push callers into
// a worse shape to satisfy a test.
const objectProperties = (
  expression: unknown,
  objects: Map<string, ObjectProperty[]>
): ObjectProperty[] => {
  const object = expression as
    { type?: string; value?: string; properties?: ObjectProperty[] } | undefined
  if (object?.type === 'ObjectExpression') return object.properties ?? []
  if (object?.type === 'Identifier' && object.value) {
    return objects.get(object.value) ?? []
  }
  return []
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
  let node = callee as
    | {
        type?: string
        value?: string
        base?: unknown
        expression?: unknown
        property?: { type?: string; value?: string }
      }
    | undefined

  // `database?.getActorStatuses(…)` wraps the member expression in an
  // OptionalChainingExpression, which the two shapes below do not match — so
  // the call was dropped before it was even recorded, invisible to every
  // assertion here. A nullable database or actor with defensive optional
  // chaining is ordinary code, not a contrived evasion.
  let unwrapped = 0
  while (node?.type === 'OptionalChainingExpression' && unwrapped < 4) {
    node = (node.base ?? node.expression) as typeof node
    unwrapped += 1
  }

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
  if (![...GUARDED_METHODS].some((name) => source.includes(name))) return []

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

    if (!GUARDED_METHODS.has(name)) return
    record(
      namesKey(
        objectProperties(args[0]?.expression, objects),
        VISIBILITY_KEYS,
        objects
      )
    )
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
      // itself: the legitimate cases already explain themselves in a comment
      // block above the call, which is where a reviewer reads it.
      return !source.includes(OPT_OUT_MARKER)
    })

    expect(
      unstated.map((site) => `${site.file}:${site.line} ${site.callee}`)
    ).toEqual([])
  })
})
