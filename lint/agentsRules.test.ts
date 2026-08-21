import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Guards lint/agentsRules.mjs, the Oxlint JS plugin carrying the AGENTS.md
// conventions that used to be `no-restricted-syntax` selectors under ESLint.
// Oxlint's JS-plugin API is still alpha, so a routine oxlint bump could stop
// running these rules and silently un-enforce the conventions — `yarn lint`
// would stay green while nothing was checked. This runs the real binary over
// fixtures and asserts each rule fires exactly where it should, and nowhere
// else. It builds its own config rather than reading the repo's .oxlintrc.json
// so it keeps guarding the plugin however the real config evolves.
const OXLINT = path.join(process.cwd(), 'node_modules', '.bin', 'oxlint')
const PLUGIN = path.join(process.cwd(), 'lint', 'agentsRules.mjs')

interface Diagnostic {
  code: string
  filename: string
  labels: { span: { line: number } }[]
}

const lint = (files: Record<string, string>): string[] => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agents-rules-'))
  try {
    for (const [name, source] of Object.entries(files)) {
      const filePath = path.join(directory, name)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, source)
    }
    writeFileSync(
      path.join(directory, '.oxlintrc.json'),
      JSON.stringify({
        plugins: [],
        categories: { correctness: 'off' },
        jsPlugins: [PLUGIN],
        overrides: [
          {
            files: ['app/api/**/route.ts'],
            rules: {
              'agents/api-response-helpers': 'error',
              'agents/zod-safe-parse': 'error'
            }
          },
          {
            files: ['app/**/*.tsx', 'lib/components/**/*.tsx'],
            rules: {
              'agents/no-component-fetch': [
                'error',
                { allowFiles: ['app/legacy/Legacy.tsx'] }
              ]
            }
          }
        ]
      })
    )

    let stdout: string
    try {
      stdout = execFileSync(
        OXLINT,
        ['-c', '.oxlintrc.json', '--format', 'json', '.'],
        { cwd: directory, encoding: 'utf-8' }
      )
    } catch (error) {
      // oxlint exits 1 when it reports errors; the JSON is still on stdout.
      stdout = (error as { stdout?: string }).stdout ?? ''
    }

    const { diagnostics } = JSON.parse(stdout) as { diagnostics: Diagnostic[] }
    return diagnostics
      .map(
        (diagnostic) =>
          `${diagnostic.filename}:${diagnostic.labels[0]?.span.line} ${diagnostic.code}`
      )
      .sort()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('agents oxlint plugin', () => {
  it('flags Response.json, NextResponse.json and Zod parse in API routes only', () => {
    expect(
      lint({
        'app/api/x/route.ts': [
          "import { NextResponse } from 'next/server'",
          "import { z } from 'zod'",
          'export const GET = async () => {',
          '  const parsed = z.object({}).parse({})',
          "  JSON.parse('{}')",
          "  Date.parse('2026-01-01')",
          '  Response.json(parsed)',
          '  return NextResponse.json(parsed)',
          '}'
        ].join('\n'),
        'lib/services/other.ts': [
          "export const parsed = JSON.parse('{}')",
          'export const response = Response.json(parsed)'
        ].join('\n')
      })
    ).toEqual([
      'app/api/x/route.ts:4 agents(zod-safe-parse)',
      'app/api/x/route.ts:7 agents(api-response-helpers)',
      'app/api/x/route.ts:8 agents(api-response-helpers)'
    ])
  })

  it('flags fetch in components except allow-listed and test files', () => {
    expect(
      lint({
        'app/page.tsx': "export const P = () => { fetch('/x'); return null }",
        'app/legacy/Legacy.tsx':
          "export const L = () => { fetch('/x'); return null }",
        'app/page.test.tsx': "it('fetches', () => { fetch('/x') })",
        'lib/components/Widget.tsx':
          "export const W = () => { fetch('/x'); return null }"
      })
    ).toEqual([
      'app/page.tsx:1 agents(no-component-fetch)',
      'lib/components/Widget.tsx:1 agents(no-component-fetch)'
    ])
  })
})
