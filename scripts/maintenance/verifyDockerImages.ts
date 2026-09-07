#!/usr/bin/env -S node scripts/run.cjs
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'

export interface VerifyDockerImagesOptions {
  minimalImage: string
  fullImage: string
  build: boolean
  port?: number
  help?: boolean
}

export function parseArgs(args: string[]): VerifyDockerImagesOptions {
  let minimalImage = process.env.MINIMAL_IMAGE || 'activities:test-minimal'
  let fullImage = process.env.FULL_IMAGE || 'activities:test-full'
  let build = false
  let port: number | undefined
  let help = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--build') {
      build = true
    } else if (arg === '--skip-build') {
      build = false
    } else if (arg.startsWith('--minimal-image=')) {
      minimalImage = arg.slice('--minimal-image='.length)
    } else if (arg === '--minimal-image' && i + 1 < args.length) {
      minimalImage = args[++i]
    } else if (arg.startsWith('--full-image=')) {
      fullImage = arg.slice('--full-image='.length)
    } else if (arg === '--full-image' && i + 1 < args.length) {
      fullImage = args[++i]
    } else if (arg.startsWith('--port=')) {
      port = parseInt(arg.slice('--port='.length), 10)
    } else if (arg === '--port' && i + 1 < args.length) {
      port = parseInt(args[++i], 10)
    }
  }

  return {
    minimalImage,
    fullImage,
    build,
    port,
    help
  }
}

function runCommand(
  cmd: string,
  args: string[],
  options: { capture?: boolean } = {}
): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(cmd, args, {
    encoding: 'utf-8',
    stdio: options.capture ? ['pipe', 'pipe', 'pipe'] : 'inherit'
  })

  return {
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    status: res.status ?? 1
  }
}

function imageExists(tag: string): boolean {
  const res = runCommand('docker', ['image', 'inspect', tag], { capture: true })
  return res.status === 0
}

export function buildDockerImage(
  tag: string,
  buildArgs: Record<string, string> = {}
): void {
  const args = ['build', '-t', tag]
  for (const [key, value] of Object.entries(buildArgs)) {
    args.push('--build-arg', `${key}=${value}`)
  }
  args.push('.')

  console.log(`Building docker image "${tag}"...`)
  const res = runCommand('docker', args)
  if (res.status !== 0) {
    throw new Error(`Failed to build Docker image "${tag}"`)
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function verifyMinimalImage(
  imageTag: string,
  port: number
): Promise<void> {
  console.log(`\n=== Verifying Minimal Image: ${imageTag} ===`)

  // 1. Verify optional SDKs are absent from the minimal runtime
  console.log('1. Checking optional SDKs are absent from minimal runtime...')
  const absenceCheck = runCommand(
    'docker',
    [
      'run',
      '--rm',
      imageTag,
      'node',
      '-e',
      `
      const forbidden = ['@google-cloud/tasks', '@upstash/qstash', 'pg'];
      for (const pkg of forbidden) {
        try {
          require.resolve(pkg);
          console.error('FAILURE: ' + pkg + ' is present in minimal runtime!');
          process.exit(1);
        } catch (e) {
          // Expected to be absent
        }
      }
      console.log('PASS: Optional SDKs are absent from minimal runtime.');
    `
    ],
    { capture: true }
  )

  if (absenceCheck.status !== 0) {
    console.error(absenceCheck.stderr || absenceCheck.stdout)
    throw new Error(
      'Minimal image verification failed: optional SDKs are present in minimal runtime.'
    )
  }
  console.log('PASS: Optional SDKs absent from minimal runtime.')

  // 2. Exercise Sharp
  console.log('2. Exercising Sharp in minimal container...')
  const sharpCheck = runCommand(
    'docker',
    [
      'run',
      '--rm',
      imageTag,
      'node',
      '-e',
      `
      const sharp = require('sharp');
      sharp({
        create: {
          width: 32,
          height: 32,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 }
        }
      })
        .png()
        .toBuffer()
        .then(buffer => {
          if (!buffer || buffer.length === 0) {
            console.error('FAILURE: Sharp produced empty buffer');
            process.exit(1);
          }
          console.log('PASS: Sharp successfully rendered PNG buffer (' + buffer.length + ' bytes).');
        })
        .catch(err => {
          console.error('FAILURE: Sharp failed to execute:', err);
          process.exit(1);
        });
    `
    ],
    { capture: true }
  )

  if (sharpCheck.status !== 0) {
    console.error(sharpCheck.stderr || sharpCheck.stdout)
    throw new Error(
      'Minimal image verification failed: Sharp failed to execute.'
    )
  }
  console.log('PASS: Sharp successfully exercised.')

  // 3. Start minimal app with local SQLite & request /api/v2/instance
  console.log(
    `3. Starting minimal app with local SQLite on port ${port} and requesting /api/v2/instance...`
  )
  const containerName = `activities-verify-min-${crypto.randomBytes(4).toString('hex')}`

  try {
    const runRes = runCommand(
      'docker',
      [
        'run',
        '-d',
        '--name',
        containerName,
        '-p',
        `${port}:3000`,
        '-e',
        'ACTIVITIES_SECRET_PHASE=smoke-test-secret-phase-at-least-32-chars-long',
        '-e',
        `ACTIVITIES_HOST=localhost:${port}`,
        imageTag
      ],
      { capture: true }
    )

    if (runRes.status !== 0) {
      throw new Error(`Failed to start minimal container: ${runRes.stderr}`)
    }

    const url = `http://localhost:${port}/api/v2/instance`
    console.log(`Polling ${url} for readiness...`)

    let ready = false
    let lastError = ''
    const deadline = Date.now() + 30000 // 30s timeout

    while (Date.now() < deadline) {
      try {
        const resp = await fetch(url)
        if (resp.status === 200) {
          const body = (await resp.json()) as Record<string, unknown>
          if (body && body.domain && body.version && body.api_versions) {
            console.log(
              `PASS: /api/v2/instance returned 200 (version: ${body.version}, domain: ${body.domain})`
            )
            ready = true
            break
          }
        } else {
          lastError = `Status ${resp.status}`
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
      await sleep(1000)
    }

    if (!ready) {
      const logs = runCommand('docker', ['logs', containerName], {
        capture: true
      })
      console.error('Container logs on failure:\n', logs.stdout, logs.stderr)
      throw new Error(
        `Timed out waiting for minimal app /api/v2/instance readiness: ${lastError}`
      )
    }
  } finally {
    runCommand('docker', ['rm', '-f', containerName], { capture: true })
  }

  console.log('Minimal image verification passed successfully!')
}

export async function verifyFullImage(imageTag: string): Promise<void> {
  console.log(`\n=== Verifying Full Image: ${imageTag} ===`)

  // 1. Verify loading optional queue SDKs without contacting cloud services
  console.log(
    '1. Checking optional queue SDKs and PostgreSQL driver can be loaded in full runtime...'
  )
  const loadCheck = runCommand(
    'docker',
    [
      'run',
      '--rm',
      imageTag,
      'node',
      '-e',
      `
      const { CloudTasksClient } = require('@google-cloud/tasks');
      new CloudTasksClient({ fallback: true });
      new CloudTasksClient({ projectId: 'smoke-test-project' });
      console.log('PASS: CloudTasksClient initialized.');

      const { Client: QStashClient } = require('@upstash/qstash');
      new QStashClient({ token: 'smoke-test-token' });
      console.log('PASS: QStashClient initialized.');

      const { Client: PgClient } = require('pg');
      new PgClient();
      console.log('PASS: PgClient initialized.');
    `
    ],
    { capture: true }
  )

  if (loadCheck.status !== 0) {
    console.error(loadCheck.stderr || loadCheck.stdout)
    throw new Error(
      'Full image verification failed: unable to load optional queue SDKs or pg.'
    )
  }
  console.log('PASS: Optional queue SDKs and pg loaded successfully.')

  // 2. Verify using PostgreSQL locally without contacting cloud services
  console.log('2. Verifying full image can use PostgreSQL locally...')
  const suffix = crypto.randomBytes(4).toString('hex')
  const networkName = `activities-net-${suffix}`
  const pgContainerName = `activities-pg-${suffix}`

  try {
    // Create isolated docker network
    const netRes = runCommand('docker', ['network', 'create', networkName], {
      capture: true
    })
    if (netRes.status !== 0) {
      throw new Error(`Failed to create docker network: ${netRes.stderr}`)
    }

    // Start local postgres container
    const pgRes = runCommand(
      'docker',
      [
        'run',
        '-d',
        '--name',
        pgContainerName,
        '--network',
        networkName,
        '-e',
        'POSTGRES_USER=activities',
        '-e',
        'POSTGRES_PASSWORD=activities',
        '-e',
        'POSTGRES_DB=activities',
        'postgres:17'
      ],
      { capture: true }
    )

    if (pgRes.status !== 0) {
      throw new Error(`Failed to start postgres container: ${pgRes.stderr}`)
    }

    // Wait for postgres readiness
    let pgReady = false
    const pgDeadline = Date.now() + 30000
    while (Date.now() < pgDeadline) {
      const readyRes = runCommand(
        'docker',
        [
          'exec',
          pgContainerName,
          'pg_isready',
          '-U',
          'activities',
          '-d',
          'activities',
          '-q'
        ],
        { capture: true }
      )
      if (readyRes.status === 0) {
        pgReady = true
        break
      }
      await sleep(500)
    }

    if (!pgReady) {
      throw new Error('PostgreSQL container failed to become ready in 30s')
    }

    // Run query using pg in full container
    const pgQueryRes = runCommand(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        networkName,
        imageTag,
        'node',
        '-e',
        `
        const { Client } = require('pg');
        const client = new Client({
          host: '${pgContainerName}',
          port: 5432,
          user: 'activities',
          password: 'activities',
          database: 'activities'
        });

        client.connect()
          .then(() => client.query('SELECT 42 AS answer'))
          .then(res => {
            if (!res.rows[0] || res.rows[0].answer !== 42) {
              console.error('FAILURE: Unexpected query result:', res.rows);
              process.exit(1);
            }
            console.log('PASS: Local PostgreSQL query succeeded with result:', res.rows[0].answer);
            return client.end();
          })
          .catch(err => {
            console.error('FAILURE: PostgreSQL connection/query error:', err);
            process.exit(1);
          });
      `
      ],
      { capture: true }
    )

    if (pgQueryRes.status !== 0) {
      console.error(pgQueryRes.stderr || pgQueryRes.stdout)
      throw new Error(
        'Full image verification failed: local PostgreSQL query failed.'
      )
    }
    console.log('PASS: Local PostgreSQL query executed successfully.')
  } finally {
    runCommand('docker', ['rm', '-f', pgContainerName], { capture: true })
    runCommand('docker', ['network', 'rm', networkName], { capture: true })
  }

  console.log('Full image verification passed successfully!')
}

export async function main(
  argv: string[] = process.argv.slice(2)
): Promise<void> {
  const options = parseArgs(argv)

  if (options.help) {
    console.log(`
Usage: verifyDockerImages.ts [options]

Options:
  --minimal-image <tag>  Tag for minimal Docker image (default: activities:test-minimal)
  --full-image <tag>     Tag for full Docker image (default: activities:test-full)
  --build                Build images before verification
  --skip-build           Skip building images (use existing images)
  --port <port>          Port for minimal app smoke test (default: random 3100..3899)
  --help, -h             Show this help message
`)
    return
  }

  const shouldBuild =
    options.build ||
    !imageExists(options.minimalImage) ||
    !imageExists(options.fullImage)

  if (shouldBuild) {
    console.log('Building minimal and full Docker images...')
    buildDockerImage(options.minimalImage)
    buildDockerImage(options.fullImage, {
      WORKSPACES:
        'activities.next @activities/pg @activities/cloudtasks @activities/qstash'
    })
  }

  const port = options.port || Math.floor(Math.random() * 800) + 3100

  await verifyMinimalImage(options.minimalImage, port)
  await verifyFullImage(options.fullImage)

  console.log('\n=== All Docker Image Verifications Succeeded! ===\n')
}

if (
  process.argv[1]?.endsWith('verifyDockerImages.ts') ||
  process.argv[1]?.endsWith('verifyDockerImages.js')
) {
  main().catch((err) => {
    console.error('FATAL:', err)
    process.exit(1)
  })
}
