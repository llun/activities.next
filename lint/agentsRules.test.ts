import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Guards lint/agentsRules.mjs, the Oxlint JS plugin carrying the AGENTS.md
// conventions that used to be `no-restricted-syntax` selectors under ESLint.
// Oxlint's JS-plugin API is still alpha, so a routine oxlint bump could stop
// running these rules and silently un-enforce the conventions — `yarn lint`
// would stay green while nothing was checked. This runs the real binary over
// fixtures and asserts each rule fires exactly where it should, and nowhere
// else.
//
// Two kinds of test live here, and the split is deliberate:
//
//   `lint()` builds its OWN config, so the rules keep being guarded however
//   the repo's .oxlintrc.json evolves. It proves what a rule DECIDES.
//
//   `lintWithRepoConfig()` runs the repo's real configs — relocated, with only
//   the plugin path rewritten — over fixtures. It proves the rules are WIRED
//   to the paths they are supposed to cover, which a rule cannot prove about
//   itself: an override naming a driver that has since moved reports nothing
//   at all, and reports it silently.
const OXLINT = path.join(process.cwd(), 'node_modules', '.bin', 'oxlint')
const PLUGIN = path.join(process.cwd(), 'lint', 'agentsRules.mjs')
const MAIN_CONFIG = path.join(process.cwd(), '.oxlintrc.json')
const SCRIPTS_CONFIG = path.join(process.cwd(), '.oxlintrc.scripts.json')

// The local storage drivers `agents/no-storage-path-builder` is scoped to.
const DRIVER_FILES = [
  'lib/services/medias/localFile.ts',
  'lib/services/fitness-files/localFile.ts'
]

interface Diagnostic {
  code: string
  filename: string
  labels: { span: { line: number } }[]
}

const runOxlint = (
  directory: string,
  configPath: string,
  target: string
): string[] => {
  let stdout: string
  try {
    // `--threads=1`: every case here lints a handful of tiny fixtures, where
    // oxlint's default fan-out buys nothing, and this runs inside a parallel
    // Vitest suite — a subprocess taking a core per CPU on each of several
    // workers oversubscribes the machine and destabilises timing-sensitive
    // tests elsewhere in the run.
    stdout = execFileSync(
      OXLINT,
      ['-c', configPath, '--format', 'json', '--threads=1', target],
      { cwd: directory, encoding: 'utf-8' }
    )
  } catch (error) {
    // oxlint exits 1 when it reports errors; the JSON is still on stdout.
    stdout = (error as { stdout?: string }).stdout ?? ''
  }

  // When every file in the target is ignored, oxlint prints `No files found to
  // lint.` and THEN an empty, perfectly valid report — so the JSON is there to
  // be parsed, and parsing it is the mistake. Nothing here should ever lint an
  // empty tree; a run that did would report no offenders for the wrong reason,
  // which is the failure that made the raw-text guard these rules replaced
  // worse than nothing. Refuse the run rather than skipping to the first `{`.
  if (!stdout.trimStart().startsWith('{')) {
    throw new Error(`oxlint produced no report for ${target}: ${stdout.trim()}`)
  }

  const { diagnostics } = JSON.parse(stdout) as { diagnostics: Diagnostic[] }
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.filename}:${diagnostic.labels[0]?.span.line} ${diagnostic.code}`
    )
    .sort()
}

const withFixtures = <T>(
  files: Record<string, string>,
  run: (directory: string) => T
): T => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agents-rules-'))
  try {
    for (const [name, source] of Object.entries(files)) {
      const filePath = path.join(directory, name)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, source)
    }
    return run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const lint = (files: Record<string, string>): string[] =>
  withFixtures(files, (directory) => {
    writeFileSync(
      path.join(directory, '.oxlintrc.json'),
      JSON.stringify({
        plugins: [],
        categories: { correctness: 'off' },
        jsPlugins: [PLUGIN],
        rules: { 'agents/no-resolved-path-prefix-check': 'error' },
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
          },
          {
            files: DRIVER_FILES,
            rules: { 'agents/no-storage-path-builder': 'error' }
          }
        ]
      })
    )
    return runOxlint(directory, '.oxlintrc.json', '.')
  })

// Runs one of the REPO's configs over fixtures. Only the `jsPlugins` entry is
// rewritten, to an absolute path — everything else, including the override
// globs and `ignorePatterns`, is the file as committed, and oxlint resolves
// both relative to the config, which is why relocating the config is what
// makes the real globs apply to the fixture tree. The replacement is asserted
// rather than assumed: a config that no longer names the plugin would
// otherwise fail to load and take the whole test with it, which is loud, but a
// silently unreplaced path is not.
const lintWithRepoConfig = (
  configPath: string,
  target: string,
  files: Record<string, string>
): string[] =>
  withFixtures(files, (directory) => {
    const source = readFileSync(configPath, 'utf-8')
    const relocated = source.replace(
      '"./lint/agentsRules.mjs"',
      JSON.stringify(PLUGIN)
    )
    expect(relocated).not.toEqual(source)
    writeFileSync(path.join(directory, '.oxlintrc.json'), relocated)
    // Only this plugin's diagnostics matter here; the real config turns on
    // eighty-odd other rules that have nothing to say about wiring.
    return runOxlint(directory, '.oxlintrc.json', target).filter((diagnostic) =>
      diagnostic.includes(' agents(')
    )
  })

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

  it('anchors allowFiles at the repo root instead of matching any path suffix', () => {
    // The allow-list is the frozen set of legacy fetch() callers and may only
    // ever shrink. Matching with `endsWith` on the absolute path would also
    // exempt a different file whose path merely *ends with* an allow-listed
    // entry — here `lib/components/app/legacy/Legacy.tsx` ends with the
    // allow-listed `app/legacy/Legacy.tsx` — quietly widening the list.
    expect(
      lint({
        'app/legacy/Legacy.tsx':
          "export const L = () => { fetch('/x'); return null }",
        'lib/components/app/legacy/Legacy.tsx':
          "export const N = () => { fetch('/x'); return null }"
      })
    ).toEqual([
      'lib/components/app/legacy/Legacy.tsx:1 agents(no-component-fetch)'
    ])
  })

  // Every spelling below defeated a version of the raw-text scan this rule
  // replaced: a renamed import and a destructured `const { resolve } = path`
  // beat alias tracking, `path['resolve']` beat a substring ban, and
  // `prettier --write` — step 1 of the commit gate — beat a single-line regex
  // by wrapping the call. An AST rule resolves the callee through scope, so
  // they are all the same node to it and formatting is invisible.
  //
  // The list is also the list AGENTS.md claims is caught, and every entry is
  // asserted here rather than taken on trust: emptying `PLATFORM_NAMESPACES`
  // or stubbing `isRequireOfPathModule` used to leave this file green.
  it('flags every spelling of a path builder in a local storage driver', () => {
    const driver = [
      "import path from 'path'",
      "import { resolve as pathResolve } from 'node:path'",
      '',
      'const { join } = path',
      "const requiredPath = require('node:path')",
      '',
      'export class Driver {',
      "  private _config = { path: './uploads' }",
      '',
      '  plain(filePath: string) {',
      '    return path.resolve(this._config.path, filePath)',
      '  }',
      '',
      '  computed(filePath: string) {',
      "    return path['resolve'](this._config.path, filePath)",
      '  }',
      '',
      '  renamed(filePath: string) {',
      '    return pathResolve(this._config.path, filePath)',
      '  }',
      '',
      '  destructured(filePath: string) {',
      '    return join(this._config.path, filePath)',
      '  }',
      '',
      '  optional(filePath: string) {',
      '    return path?.resolve(this._config.path, filePath)',
      '  }',
      '',
      '  // An optional chain in a VALUE position, which oxlint wraps in a',
      '  // ChainExpression — invisible until the predicates unwrapped it, while',
      '  // the inline call above was always caught.',
      '  aliasedOptional(filePath: string) {',
      '    const build = path?.resolve',
      '    return build(this._config.path, filePath)',
      '  }',
      '',
      '  // A rename chain. Each hop costs one unit of MAX_ALIAS_DEPTH; while a',
      '  // hop cost two, this exact shape went unflagged.',
      '  chainedRename(filePath: string) {',
      '    const p = path',
      '    const build = p.resolve',
      '    const resolvePath = build',
      '    return resolvePath(this._config.path, filePath)',
      '  }',
      '',
      '  // A non-null assertion is the other wrapper node that does not change',
      '  // a value, and it lands on the OBJECT rather than around the member.',
      '  nonNull(filePath: string) {',
      '    return path!.resolve(this._config.path, filePath)',
      '  }',
      '',
      '  platform(filePath: string) {',
      '    return path.posix.join(this._config.path, filePath)',
      '  }',
      '',
      '  viaRequire(filePath: string) {',
      '    return requiredPath.resolve(this._config.path, filePath)',
      '  }',
      '',
      '  wrapped(filePath: string) {',
      '    return path.resolve(',
      '      this._config.path,',
      '      filePath',
      '    )',
      '  }',
      '',
      '  // Both drivers still make these: they READ a path rather than build',
      '  // one, and neither Array#join nor Promise.resolve is a path call at',
      '  // all.',
      '  reads(fullPath: string) {',
      '    return [path.extname(fullPath), path.dirname(fullPath)].join(fullPath)',
      '  }',
      '',
      '  settles() {',
      '    return Promise.resolve(null)',
      '  }',
      '}'
    ].join('\n')

    expect(
      lint({
        'lib/services/medias/localFile.ts': driver,
        'lib/services/fitness-files/localFile.ts': driver,
        // The rule is scoped to the drivers: everything else builds paths freely.
        'lib/services/medias/S3StorageFile.ts': driver,
        'lib/services/medias/localFile.test.ts': driver
      })
    ).toEqual([
      'lib/services/fitness-files/localFile.ts:11 agents(no-storage-path-builder)',
      'lib/services/fitness-files/localFile.ts:15 agents(no-storage-path-builder)',
      'lib/services/fitness-files/localFile.ts:19 agents(no-storage-path-builder)',
      'lib/services/fitness-files/localFile.ts:23 agents(no-storage-path-builder)',
      'lib/services/fitness-files/localFile.ts:27 agents(no-storage-path-builder)',
      'lib/services/fitness-files/localFile.ts:35 agents(no-storage-path-builder)',
      'lib/services/fitness-files/localFile.ts:44 agents(no-storage-path-builder)',
      'lib/services/fitness-files/localFile.ts:50 agents(no-storage-path-builder)',
      'lib/services/fitness-files/localFile.ts:54 agents(no-storage-path-builder)',
      'lib/services/fitness-files/localFile.ts:58 agents(no-storage-path-builder)',
      'lib/services/fitness-files/localFile.ts:62 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:11 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:15 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:19 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:23 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:27 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:35 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:44 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:50 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:54 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:58 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:62 agents(no-storage-path-builder)'
    ])
  })

  // The residual the text scan named and could not reach. An extracted root
  // carries the identical missing-separator bug as the inline spelling, and
  // telling it apart from a same-shaped name that means something else needs
  // the declaration, not the text.
  it('flags a startsWith against a resolved path, inline or extracted', () => {
    expect(
      lint({
        'lib/services/medias/containment.ts': [
          "import path from 'path'",
          '',
          'export const inline = (base: string, fullPath: string) =>',
          '  fullPath.startsWith(path.resolve(base))',
          '',
          'export const extracted = (base: string, fullPath: string) => {',
          '  const root = path.resolve(base)',
          '  return fullPath.startsWith(root)',
          '}',
          '',
          '// Both halves again through an optional chain, which oxlint wraps in',
          '// a ChainExpression the predicates have to look through.',
          'export const optionalInline = (base: string, fullPath: string) =>',
          '  fullPath.startsWith(path?.resolve(base))',
          '',
          'export const optionalExtracted = (base: string, fullPath: string) => {',
          '  const root = path?.resolve(base)',
          '  return fullPath.startsWith(root)',
          '}',
          '',
          '// The shape an extracted-variable heuristic reported in',
          '// scripts/backup/productionArchive.ts: a name that reads like a',
          '// resolved path, bound to a string.',
          'export const nameReuse = (entry: string) => {',
          "  const resolvedArchivePath = 'database.'",
          '  return entry.startsWith(resolvedArchivePath)',
          '}',
          '',
          '// The idiom resolveStorageFilePath implements — the root plus a',
          '// separator — which the rule must leave alone.',
          'export const contained = (base: string, fullPath: string) => {',
          '  const root = path.resolve(base)',
          '  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`',
          '  return fullPath === root || fullPath.startsWith(prefix)',
          '}',
          '',
          'export const literal = (relativePath: string) =>',
          "  relativePath.startsWith('..')"
        ].join('\n')
      })
    ).toEqual([
      'lib/services/medias/containment.ts:14 agents(no-resolved-path-prefix-check)',
      'lib/services/medias/containment.ts:18 agents(no-resolved-path-prefix-check)',
      'lib/services/medias/containment.ts:4 agents(no-resolved-path-prefix-check)',
      'lib/services/medias/containment.ts:8 agents(no-resolved-path-prefix-check)'
    ])
  })
})

describe('repo lint configuration', () => {
  const buildsAPath = [
    "import path from 'path'",
    'export const build = (root: string, filePath: string) =>',
    '  path.resolve(root, filePath)'
  ].join('\n')

  const comparesAgainstARoot = [
    "import path from 'path'",
    'export const contains = (base: string, fullPath: string) =>',
    '  fullPath.startsWith(path.resolve(base))'
  ].join('\n')

  it('scopes the path builder rule at local storage drivers that exist', () => {
    // An override naming a driver that has since moved matches nothing and
    // says nothing, so the paths are checked against the working tree too.
    for (const driver of DRIVER_FILES) {
      expect(existsSync(path.join(process.cwd(), driver))).toBe(true)
    }

    expect(
      lintWithRepoConfig(MAIN_CONFIG, '.', {
        [DRIVER_FILES[0]]: buildsAPath,
        [DRIVER_FILES[1]]: buildsAPath,
        // The list is exact rather than a `*/localFile.ts` glob, so a driver
        // that moves fails the assertion above instead of being covered by
        // accident.
        'lib/services/link-previews/localFile.ts': buildsAPath
      })
    ).toEqual([
      'lib/services/fitness-files/localFile.ts:3 agents(no-storage-path-builder)',
      'lib/services/medias/localFile.ts:3 agents(no-storage-path-builder)'
    ])
  })

  it('covers scripts/ with the second lint pass the main config cannot reach', () => {
    const fixture = {
      'scripts/maintenance/cleanupMediaStorage.ts': comparesAgainstARoot,
      // Linted by the main config, and carrying the same offence, so the
      // scripts file's absence below reads as "ignored" rather than as a run
      // that found nothing to look at.
      'lib/services/medias/containment.ts': comparesAgainstARoot
    }

    // `scripts/**` is in the main config's ignorePatterns, and that tree is
    // where the one real instance of this bug was found and fixed. Losing it
    // would narrow coverage to close a hole, which is what the second pass is
    // for.
    expect(lintWithRepoConfig(MAIN_CONFIG, '.', fixture)).toEqual([
      'lib/services/medias/containment.ts:3 agents(no-resolved-path-prefix-check)'
    ])
    expect(lintWithRepoConfig(SCRIPTS_CONFIG, 'scripts', fixture)).toEqual([
      'scripts/maintenance/cleanupMediaStorage.ts:3 agents(no-resolved-path-prefix-check)'
    ])
  })

  it('fails a lint run that matched no files rather than reporting none', () => {
    // The failure that made the deleted text scan worse than nothing was a
    // guard reporting no offenders because it had looked at nothing. Here that
    // would be a target every ignore pattern excludes, so `runOxlint` refuses
    // an empty run instead of returning an empty list — asserted, because a
    // guard nothing exercises is a guard nobody knows is broken.
    expect(() =>
      lintWithRepoConfig(SCRIPTS_CONFIG, 'scripts', {
        'scripts/README.md': '# not a file oxlint lints\n'
      })
    ).toThrow(/produced no report for scripts/)
  })

  it('runs the scripts lint pass from yarn lint', () => {
    const { scripts } = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
    ) as { scripts: Record<string, string> }
    expect(scripts.lint).toContain('-c .oxlintrc.scripts.json scripts')
  })
})
