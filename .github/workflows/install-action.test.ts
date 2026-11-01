// @vitest-size large
// Spawns the action's script with child_process, which the medium guard blocks.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ACTION = readFileSync(
  join(import.meta.dirname, '..', 'actions', 'install', 'action.yml'),
  'utf8'
)

// Extract the `run: |` body of the composite action's bash step and strip the
// block's indentation, so the text can be executed exactly as GitHub would:
// `bash --noprofile --norc -eo pipefail {0}`.
function extractRunBody(): string {
  const match = ACTION.match(
    /- shell: bash\n\s+run: \|\n((?:[ \t]+[^\n]*\n?)+)/
  )
  if (!match)
    throw new Error('Could not find the bash step run block in action.yml')
  const lines = match[1].split('\n').filter((line) => line.trim() !== '')
  const indent = Math.min(
    ...lines.map((line) => line.match(/^ */)?.[0].length ?? 0)
  )
  return lines.map((line) => line.slice(indent)).join('\n') + '\n'
}

type AttemptSpec = { output: string[]; exit: number }

// Write a fake `yarn` that counts invocations in a counter file and, on the
// n-th attempt, prints the n-th spec's output and exits with its code. Attempts
// beyond the specs repeat the last one.
function fakeYarnScript(specs: AttemptSpec[]): string {
  const print = (spec: AttemptSpec) =>
    spec.output.length > 0
      ? `printf '%s\n' ${spec.output.map((line) => `'${line}'`).join(' ')}`
      : ':'
  const lines = [
    '#!/usr/bin/env bash',
    'n=$(cat "$FAKE_YARN_COUNT_FILE" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$FAKE_YARN_COUNT_FILE"'
  ]
  specs.forEach((spec, i) => {
    lines.push(`${i === 0 ? 'if' : 'elif'} [ "$n" -eq ${i + 1} ]; then`)
    lines.push(print(spec))
    lines.push(`exit ${spec.exit}`)
  })
  lines.push('else')
  lines.push(print(specs[specs.length - 1]))
  lines.push('exit ' + specs[specs.length - 1].exit)
  lines.push('fi')
  return lines.join('\n') + '\n'
}

function runInstallStep(specs: AttemptSpec[]): {
  status: number | null
  attempts: number
} {
  const dir = mkdtempSync(join(tmpdir(), 'install-action-test-'))
  try {
    const scriptPath = join(dir, 'step.sh')
    const countFile = join(dir, 'attempts')
    writeFileSync(scriptPath, extractRunBody())
    writeFileSync(join(dir, 'yarn'), fakeYarnScript(specs), { mode: 0o755 })
    const result = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath],
      {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          INSTALL_RETRY_BACKOFF_SECONDS: '0',
          FAKE_YARN_COUNT_FILE: countFile
        },
        encoding: 'utf8'
      }
    )
    const attempts = parseInt(readFileSync(countFile, 'utf8').trim(), 10)
    return { status: result.status, attempts }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const transportError: AttemptSpec = {
  output: ['➤ YN0001: │ RequestError: read ECONNRESET'],
  exit: 1
}

describe('install composite action retry loop', () => {
  it('retries a YN0001 ECONNRESET transport error and succeeds on attempt 2', () => {
    const { status, attempts } = runInstallStep([
      transportError,
      { output: [], exit: 0 }
    ])
    expect(status).toBe(0)
    expect(attempts).toBe(2)
  })

  it('retries a YN0001 ECANCELED transport error and succeeds on attempt 2', () => {
    const { status, attempts } = runInstallStep([
      { output: ['➤ YN0001: │ RequestError: write ECANCELED'], exit: 1 },
      { output: [], exit: 0 }
    ])
    expect(status).toBe(0)
    expect(attempts).toBe(2)
  })

  it('retries a transport error up to 3 attempts, then fails', () => {
    const { status, attempts } = runInstallStep([transportError])
    expect(status).not.toBe(0)
    expect(attempts).toBe(3)
  })

  it('does not retry YN0028 (lockfile would change)', () => {
    const { status, attempts } = runInstallStep([
      {
        output: [
          '➤ YN0028: │ The lockfile would have been modified by this install, which is explicitly forbidden.'
        ],
        exit: 1
      }
    ])
    expect(status).not.toBe(0)
    expect(attempts).toBe(1)
  })

  it('does not retry an unrelated error', () => {
    const { status, attempts } = runInstallStep([
      { output: ['➤ YN0009: │ build failed'], exit: 1 }
    ])
    expect(status).not.toBe(0)
    expect(attempts).toBe(1)
  })

  it('keeps the failing exit code of yarn', () => {
    const { status, attempts } = runInstallStep([
      { output: ['➤ YN0009: │ build failed'], exit: 7 }
    ])
    expect(status).toBe(7)
    expect(attempts).toBe(1)
  })
})
