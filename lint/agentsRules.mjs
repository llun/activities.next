import { relative } from 'node:path'

// Oxlint JS plugin carrying the AGENTS.md conventions that used to be
// `no-restricted-syntax` selectors in eslint.config.mjs. Oxlint implements no
// `no-restricted-syntax` rule, but its JS-plugin API is ESLint-v9-compatible:
// selector visitor keys, `context.report`, `context.options`, and inline
// disable comments all behave the same.
//
// The API is still alpha, so lint/agentsRules.test.ts runs oxlint against
// fixtures and asserts every rule fires where it should. Without that guard an
// oxlint upgrade could stop loading this plugin and leave `yarn lint` green
// while the conventions went unchecked.

/**
 * Builds a rule that reports every node matching one of the given selectors —
 * the shape `no-restricted-syntax` provided.
 *
 * @param {string} description
 * @param {{ selector: string, message: string }[]} entries
 */
const restrictedSyntax = (description, entries) => ({
  meta: { type: 'problem', docs: { description } },
  create(context) {
    const visitors = {}
    for (const { selector, message } of entries) {
      visitors[selector] = (node) => context.report({ node, message })
    }
    return visitors
  }
})

// ---------------------------------------------------------------------------
// A stored path is confined to the storage root (AGENTS.md → A stored path is
// confined to the storage root).
//
// These two rules replace `lib/services/medias/storagePathCallSites.test.ts`,
// a raw-text scan that five review rounds each found a new hole in: alias
// tracking fell to a destructured rename, to a nested call in the argument
// list, and to `prettier --write` wrapping a call across lines; a substring ban
// fell to `path['resolve']`; and an extracted-variable heuristic reported an
// unrelated `const resolvedArchivePath = 'database.'` in
// `scripts/backup/productionArchive.ts`. Every one of those needs to know what
// a NAME refers to, which is scope resolution rather than pattern matching —
// so they are decided here, on the AST, where renamed imports, computed member
// access and formatting are invisible by construction.
// ---------------------------------------------------------------------------

const PATH_MODULES = new Set([
  'path',
  'node:path',
  'path/posix',
  'path/win32',
  'node:path/posix',
  'node:path/win32'
])

// The two `path` functions that BUILD a path out of parts. `extname`,
// `dirname`, `basename` and `relative` READ one, which is why both drivers
// still call them.
const PATH_BUILDERS = new Set(['resolve', 'join'])

const PLATFORM_NAMESPACES = new Set(['posix', 'win32'])

// How many alias hops are followed — `const p = path`, `const r = p.resolve`,
// and three more. ONE unit per hop, in every predicate below; a helper that
// delegates within the same hop passes `depth` through rather than adding to
// it, so the number here means what it says. A cap rather than a visited set:
// a chain is a declaration chain, so it cannot cycle, and this only bounds how
// patient the rule is.
const MAX_ALIAS_DEPTH = 5

/**
 * The property name a member expression reads, or null when it is computed
 * from something that cannot be read statically. `path.resolve`,
 * `path['resolve']` and `` path[`resolve`] `` all answer 'resolve'; `path[key]`
 * answers null.
 *
 * @param {{ type: string, property?: any, computed?: boolean }} node
 */
const staticPropertyName = (node) => {
  if (node.type !== 'MemberExpression') return null
  const { property, computed } = node
  if (!computed) return property.type === 'Identifier' ? property.name : null
  if (property.type === 'Literal') {
    return typeof property.value === 'string' ? property.value : null
  }
  if (
    property.type === 'TemplateLiteral' &&
    property.expressions.length === 0 &&
    property.quasis.length === 1
  ) {
    return property.quasis[0].value.cooked
  }
  return null
}

/** The key an object-pattern or object-literal property names, or null. */
const propertyKeyName = (property) => {
  const { key, computed } = property
  if (!key) return null
  if (!computed) {
    if (key.type === 'Identifier') return key.name
    return key.type === 'Literal' && typeof key.value === 'string'
      ? key.value
      : null
  }
  return key.type === 'Literal' && typeof key.value === 'string'
    ? key.value
    : null
}

/** The name an import specifier pulls out of its module. */
const importedName = (specifier) => {
  const { imported } = specifier
  if (!imported) return null
  if (imported.type === 'Identifier') return imported.name
  return imported.type === 'Literal' && typeof imported.value === 'string'
    ? imported.value
    : null
}

/**
 * The variable an identifier refers to AT ITS OWN POSITION, so a parameter or a
 * local named `path` shadowing the import resolves to the shadow rather than to
 * the module. Only a variable with exactly one definition is answered: a name
 * bound twice cannot be reasoned about from a single declaration.
 */
const resolveIdentifierDefinition = (sourceCode, identifier) => {
  const name = identifier.name
  for (
    let scope = sourceCode.getScope(identifier);
    scope;
    scope = scope.upper
  ) {
    const variable =
      scope.set?.get(name) ??
      scope.variables?.find((candidate) => candidate.name === name)
    if (variable) {
      return variable.defs?.length === 1 ? variable.defs[0] : null
    }
  }
  return null
}

const isRequireOfPathModule = (node) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'Identifier' &&
  node.callee.name === 'require' &&
  node.arguments.length === 1 &&
  node.arguments[0].type === 'Literal' &&
  PATH_MODULES.has(node.arguments[0].value)

// Node types that wrap an expression without changing the value it evaluates
// to: an optional chain, and TypeScript's assertions, which are erased at
// runtime. All of them carry the wrapped expression as `.expression`.
const TRANSPARENT_WRAPPERS = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression'
])

/**
 * The expression inside any stack of those wrappers.
 *
 * Every predicate below switches on the node type, so a wrapper ends the walk —
 * and seeing through an alias is the whole job of these rules. This is a loop
 * over a set rather than a check at one site because the wrappers nest and
 * arrive in DIFFERENT positions: oxlint wraps the OUTERMOST node of an optional
 * chain, so `path?.resolve` is a `ChainExpression` around the member, while
 * `path!.resolve` is a plain member whose OBJECT is the wrapper and
 * `path.resolve(base) as string` wraps the CALL.
 *
 * An inline `path?.resolve(x)` was never affected, because there the chain
 * wraps the call and the rule reads its `callee` — which is what hid the whole
 * class. What was invisible is a wrapper in a VALUE position:
 * `const r = path?.resolve`, `path!.resolve(base, x)`,
 * `full.startsWith(path.resolve(base) as string)`. Each of the three was found
 * separately, by a different review round, which is why this now bans the
 * category instead of the spellings that turned up.
 */
const unwrapWrappers = (node) => {
  let current = node
  while (TRANSPARENT_WRAPPERS.has(current.type)) {
    current = current.expression
  }
  return current
}

/**
 * Whether an expression evaluates to the `path` module itself — the default or
 * namespace import, a `require('path')`, an alias of either, or one of the
 * module's `posix` / `win32` sub-namespaces.
 */
const isPathModuleExpression = (rawNode, sourceCode, depth = 0) => {
  if (depth > MAX_ALIAS_DEPTH) return false
  const node = unwrapWrappers(rawNode)
  if (node.type === 'MemberExpression') {
    const property = staticPropertyName(node)
    return (
      property !== null &&
      PLATFORM_NAMESPACES.has(property) &&
      isPathModuleExpression(node.object, sourceCode, depth + 1)
    )
  }
  if (node.type === 'CallExpression') return isRequireOfPathModule(node)
  if (node.type !== 'Identifier') return false

  const definition = resolveIdentifierDefinition(sourceCode, node)
  if (!definition) return false
  if (definition.type === 'ImportBinding') {
    return (
      PATH_MODULES.has(definition.parent?.source?.value) &&
      (definition.node.type === 'ImportDefaultSpecifier' ||
        definition.node.type === 'ImportNamespaceSpecifier')
    )
  }
  return (
    definition.type === 'Variable' &&
    Boolean(definition.node.init) &&
    isPathModuleExpression(definition.node.init, sourceCode, depth + 1)
  )
}

/** The object-pattern property that binds `binding`, or null. */
const patternPropertyFor = (pattern, binding) =>
  pattern.properties?.find((property) => {
    if (property.type !== 'Property') return false
    const value =
      property.value.type === 'AssignmentPattern'
        ? property.value.left
        : property.value
    return value.type === 'Identifier' && value.name === binding.name
  }) ?? null

/**
 * Whether a binding IS `path.resolve` / `path.join` — reached through
 * `import { resolve }`, `import { resolve as pathResolve }`,
 * `const { resolve } = path`, `const resolve = path.resolve`, or an alias of
 * one of those.
 */
const isPathBuilderDefinition = (definition, sourceCode, depth) => {
  if (depth > MAX_ALIAS_DEPTH) return false
  if (definition.type === 'ImportBinding') {
    if (definition.node.type !== 'ImportSpecifier') return false
    const imported = importedName(definition.node)
    return (
      imported !== null &&
      PATH_BUILDERS.has(imported) &&
      PATH_MODULES.has(definition.parent?.source?.value)
    )
  }
  if (definition.type !== 'Variable') return false

  const declarator = definition.node
  if (!declarator.init) return false
  if (declarator.id.type === 'ObjectPattern') {
    const property = patternPropertyFor(declarator.id, definition.name)
    if (!property) return false
    const key = propertyKeyName(property)
    return (
      key !== null &&
      PATH_BUILDERS.has(key) &&
      isPathModuleExpression(declarator.init, sourceCode, depth)
    )
  }
  // `depth` is passed through, not incremented: `isPathBuilderExpression`
  // already spent a unit on the identifier-to-definition edge, and charging a
  // second one here made every rename cost TWO units of a budget documented as
  // counting renames — so a three-step chain fell off a cap of five, one step
  // past this rule's own worked example, while the sibling rule's
  // `isBuiltPathExpression` (which recurses into itself) tolerated four.
  return isPathBuilderExpression(declarator.init, sourceCode, depth)
}

/** Whether an expression evaluates to the `path.resolve` / `path.join` function. */
const isPathBuilderExpression = (rawNode, sourceCode, depth = 0) => {
  if (depth > MAX_ALIAS_DEPTH) return false
  const node = unwrapWrappers(rawNode)
  if (node.type === 'MemberExpression') {
    const property = staticPropertyName(node)
    return (
      property !== null &&
      PATH_BUILDERS.has(property) &&
      isPathModuleExpression(node.object, sourceCode, depth + 1)
    )
  }
  if (node.type !== 'Identifier') return false
  const definition = resolveIdentifierDefinition(sourceCode, node)
  return (
    definition !== null &&
    isPathBuilderDefinition(definition, sourceCode, depth + 1)
  )
}

/** Whether a call node is a `path.resolve` / `path.join` call, however spelled. */
const isPathBuilderCall = (rawNode, sourceCode) => {
  const node = unwrapWrappers(rawNode)
  return (
    node.type === 'CallExpression' &&
    isPathBuilderExpression(node.callee, sourceCode)
  )
}

/**
 * Whether an expression IS a built path — the call written inline, or an
 * identifier declared from one. The second half is the residual the text scan
 * could not reach: `const root = path.resolve(base)` followed by
 * `full.startsWith(root)` carries the identical missing-separator bug, and
 * telling it apart from an unrelated name needs the declaration.
 *
 * A binding initialised from anything else answers false, which is what keeps
 * the CORRECT idiom quiet: `resolveStorageFilePath` compares against a prefix
 * built by a conditional that appends `path.sep`, and `productionArchive.ts`
 * has a `const resolvedArchivePath = 'database.'` whose name suggests a
 * resolved path and whose initialiser is a string.
 */
const isBuiltPathExpression = (rawNode, sourceCode, depth = 0) => {
  if (depth > MAX_ALIAS_DEPTH) return false
  const node = unwrapWrappers(rawNode)
  if (node.type === 'CallExpression') return isPathBuilderCall(node, sourceCode)
  if (node.type !== 'Identifier') return false
  const definition = resolveIdentifierDefinition(sourceCode, node)
  return (
    definition?.type === 'Variable' &&
    Boolean(definition.node.init) &&
    definition.node.id.type === 'Identifier' &&
    isBuiltPathExpression(definition.node.init, sourceCode, depth + 1)
  )
}

export default {
  meta: { name: 'agents' },
  rules: {
    'api-response-helpers': restrictedSyntax(
      'API routes answer through apiResponse/apiErrorResponse (AGENTS.md → API Response Guidelines)',
      [
        {
          selector:
            "CallExpression[callee.object.name='Response'][callee.property.name='json']",
          message:
            'Use apiResponse/apiErrorResponse from @/lib/utils/response in API routes, not Response.json() (AGENTS.md → API Response Guidelines).'
        },
        {
          selector:
            "CallExpression[callee.object.name='NextResponse'][callee.property.name='json']",
          message:
            'Use apiResponse/apiErrorResponse from @/lib/utils/response in API routes, not NextResponse.json() (AGENTS.md → API Response Guidelines).'
        }
      ]
    ),

    'zod-safe-parse': restrictedSyntax(
      'API routes validate with safeParse, never .parse() (AGENTS.md → Zod Validation in API Routes)',
      [
        {
          selector:
            "CallExpression[callee.property.name='parse'][callee.object.name!='JSON'][callee.object.name!='Date']",
          message:
            'Use safeParse, never .parse(), for Zod validation in API routes — .parse() throws and surfaces as a 500 (AGENTS.md → Zod Validation in API Routes). If this is not a Zod schema, add an oxlint-disable-next-line comment saying so.'
        }
      ]
    ),

    'no-storage-path-builder': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Local storage drivers build paths through resolveStorageFilePath/assertStorageFilePath (AGENTS.md → A stored path is confined to the storage root)'
        }
      },
      create(context) {
        const { sourceCode } = context
        return {
          CallExpression(node) {
            if (!isPathBuilderCall(node, sourceCode)) return
            context.report({
              node,
              message:
                'Build a storage path with resolveStorageFilePath/assertStorageFilePath from @/lib/services/medias/storagePath, never path.resolve/path.join — a stored path is data, and resolving one walks straight out of the storage root given `../` or an absolute path (AGENTS.md → A stored path is confined to the storage root).'
            })
          }
        }
      }
    },

    'no-resolved-path-prefix-check': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'A containment check compares against a resolved root with a separator boundary, not with startsWith (AGENTS.md → A stored path is confined to the storage root)'
        }
      },
      create(context) {
        const { sourceCode } = context
        return {
          CallExpression(node) {
            if (staticPropertyName(node.callee) !== 'startsWith') return
            const [argument] = node.arguments
            if (!argument || !isBuiltPathExpression(argument, sourceCode)) {
              return
            }
            context.report({
              node,
              message:
                'Comparing against a resolved path with startsWith has no separator boundary, so a sibling directory whose name the root prefixes passes it — root `/srv/uploads` accepts `/srv/uploads-backup/x`. Use resolveStorageFilePath/assertStorageFilePath from @/lib/services/medias/storagePath (AGENTS.md → A stored path is confined to the storage root).'
            })
          }
        }
      }
    },

    'no-component-fetch': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Components call named functions in lib/client.ts, never fetch() directly (AGENTS.md → Client-Side API Calls)'
        },
        schema: [
          {
            type: 'object',
            properties: {
              allowFiles: { type: 'array', items: { type: 'string' } }
            },
            additionalProperties: false
          }
        ]
      },
      create(context) {
        const { filename } = context
        // Tests drive components through mocked fetch on purpose.
        if (/\.test\.tsx?$/.test(filename)) return {}
        // The FROZEN legacy-offender list from .oxlintrc.json: migrate these to
        // lib/client.ts when touched and remove them there. Never add a file.
        //
        // Matched against the repo-relative path, not with `endsWith` on the
        // absolute one: ESLint's `ignores` globs were root-anchored, and a
        // suffix match would also exempt a *different* file that merely ends
        // with one of these names (say a future
        // `lib/components/admin/MediaManagement.tsx`), quietly widening a list
        // that is only ever supposed to shrink.
        const allowFiles = context.options[0]?.allowFiles ?? []
        const relativePath = relative(context.cwd, filename)
        if (allowFiles.includes(relativePath)) return {}

        return {
          "CallExpression[callee.name='fetch']"(node) {
            context.report({
              node,
              message:
                'Do not call fetch() directly in components — add a named function to lib/client.ts and import it (AGENTS.md → Client-Side API Calls).'
            })
          }
        }
      }
    }
  }
}
