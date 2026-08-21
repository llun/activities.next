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
        const allowFiles = context.options[0]?.allowFiles ?? []
        if (allowFiles.some((allowed) => filename.endsWith(allowed))) return {}

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
