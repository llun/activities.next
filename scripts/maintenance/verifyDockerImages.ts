#!/usr/bin/env -S node scripts/run.cjs
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { WebSocket } from 'ws'

export interface VerifyDockerImagesOptions {
  minimalImage: string
  fullImage: string
  build: boolean
  /** Verify only one of the two images; undefined verifies both. */
  only?: 'minimal' | 'full'
  port?: number
  help?: boolean
}

export function parseArgs(args: string[]): VerifyDockerImagesOptions {
  let minimalImage = process.env.MINIMAL_IMAGE || 'activities:test-minimal'
  let fullImage = process.env.FULL_IMAGE || 'activities:test-full'
  let build = false
  let only: 'minimal' | 'full' | undefined
  let port: number | undefined
  let help = false

  const parseOnly = (value: string): 'minimal' | 'full' => {
    if (value !== 'minimal' && value !== 'full') {
      throw new Error(`--only must be "minimal" or "full", got "${value}"`)
    }
    return value
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--build') {
      build = true
    } else if (arg === '--skip-build') {
      build = false
    } else if (arg.startsWith('--only=')) {
      only = parseOnly(arg.slice('--only='.length))
    } else if (arg === '--only' && i + 1 < args.length) {
      only = parseOnly(args[++i])
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
    only,
    port,
    help
  }
}

function runCommand(
  cmd: string,
  args: string[],
  options: { capture?: boolean; input?: string } = {}
): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(cmd, args, {
    encoding: 'utf-8',
    input: options.input,
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

export interface PdsSmokeConfig {
  servedDomain: string
  pdsHostname: string
  envValue: string
}

export function buildPdsSmokeConfig(port: number): PdsSmokeConfig {
  const servedDomain = `localhost:${port}`
  const pdsHostname = `pds.localhost:${port}`
  return {
    servedDomain,
    pdsHostname,
    envValue: JSON.stringify({
      [servedDomain]: {
        enabled: true,
        hostname: pdsHostname,
        allowEmails: [],
        allowActors: [],
        relays: []
      }
    })
  }
}

async function waitForInstanceEndpoint(
  port: number,
  containerName: string,
  label: string
): Promise<void> {
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
      `Timed out waiting for ${label} /api/v2/instance readiness: ${lastError}`
    )
  }
}

async function verifyNormalPage(port: number, label: string): Promise<void> {
  const url = `http://localhost:${port}/`
  const resp = await fetch(url)
  const contentType = resp.headers.get('content-type') || ''
  if (resp.status !== 200 || !contentType.includes('text/html')) {
    throw new Error(
      `${label} normal page check failed: GET / returned ${resp.status} (${contentType})`
    )
  }
  console.log(`PASS: ${label} GET / returned 200 (${contentType})`)
}

async function verifySubscribeReposOpenAndClose(
  port: number,
  hostHeader: string
): Promise<void> {
  const url = `ws://localhost:${port}/xrpc/com.atproto.sync.subscribeRepos`
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Host: hostHeader } })
    let opened = false
    let settled = false

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (err) {
        ws.terminate()
        reject(err)
      } else {
        resolve()
      }
    }

    const timeout = setTimeout(() => {
      finish(
        new Error(
          `Timed out waiting for subscribeRepos WebSocket (${hostHeader}) to open and close`
        )
      )
    }, 5000)

    ws.once('open', () => {
      opened = true
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'smoke-test')
        }
      }, 200)
    })

    ws.once('close', (code) => {
      if (!opened) {
        finish(
          new Error(`subscribeRepos WebSocket closed before open (${code})`)
        )
        return
      }
      if (code !== 1000) {
        finish(
          new Error(
            `subscribeRepos WebSocket closed with unexpected code ${code}`
          )
        )
        return
      }
      finish()
    })

    ws.once('unexpected-response', (_req, res) => {
      res.resume()
      finish(
        new Error(
          `subscribeRepos WebSocket rejected with HTTP ${res.statusCode} for PDS host ${hostHeader}`
        )
      )
    })

    ws.once('error', (err) => {
      finish(err instanceof Error ? err : new Error(String(err)))
    })
  })
  console.log(
    `PASS: subscribeRepos WebSocket opened and closed cleanly for Host ${hostHeader}.`
  )
}

async function verifySubscribeReposRejected404(
  port: number,
  hostHeader: string
): Promise<void> {
  const url = `ws://localhost:${port}/xrpc/com.atproto.sync.subscribeRepos`
  const statusCode = await new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Host: hostHeader } })
    let settled = false

    const finish = (result: number | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (result instanceof Error) {
        ws.terminate()
        reject(result)
      } else {
        resolve(result)
      }
    }

    const timeout = setTimeout(() => {
      finish(
        new Error(
          `Timed out waiting for 404 handshake rejection on non-PDS Host ${hostHeader}`
        )
      )
    }, 5000)

    ws.once('open', () => {
      ws.close()
      finish(
        new Error(
          `subscribeRepos WebSocket unexpectedly opened for non-PDS Host ${hostHeader}`
        )
      )
    })

    ws.once('unexpected-response', (_req, res) => {
      res.resume()
      finish(res.statusCode ?? 0)
    })

    ws.once('error', (err) => {
      finish(err instanceof Error ? err : new Error(String(err)))
    })
  })

  if (statusCode !== 404) {
    throw new Error(
      `Expected HTTP 404 for subscribeRepos on non-PDS Host ${hostHeader}, got ${statusCode}`
    )
  }
  console.log(
    `PASS: subscribeRepos WebSocket rejected non-PDS Host ${hostHeader} with HTTP 404.`
  )
}

async function verifyPdsServerContainer({
  imageTag,
  label,
  port,
  env = {},
  network
}: {
  imageTag: string
  label: string
  port: number
  env?: Record<string, string>
  network?: string
}): Promise<void> {
  const pdsConfig = buildPdsSmokeConfig(port)
  const containerName = `activities-verify-pds-${crypto.randomBytes(4).toString('hex')}`

  const dockerArgs = [
    'run',
    '-d',
    '--name',
    containerName,
    '-p',
    `${port}:3000`
  ]
  if (network) {
    dockerArgs.push('--network', network)
  }

  const allEnv: Record<string, string> = {
    ACTIVITIES_SECRET_PHASE: 'smoke-test-secret-phase-at-least-32-chars-long',
    ACTIVITIES_HOST: pdsConfig.servedDomain,
    ACTIVITIES_BLUESKY_PDS: pdsConfig.envValue,
    ...env
  }
  for (const [key, value] of Object.entries(allEnv)) {
    dockerArgs.push('-e', `${key}=${value}`)
  }

  dockerArgs.push(imageTag, 'node', 'pds-server.js')

  try {
    const runRes = runCommand('docker', dockerArgs, { capture: true })
    if (runRes.status !== 0) {
      throw new Error(
        `Failed to start ${label} pds-server container: ${runRes.stderr}`
      )
    }

    await waitForInstanceEndpoint(port, containerName, `${label} pds-server`)
    await verifyNormalPage(port, `${label} pds-server`)
    await verifySubscribeReposOpenAndClose(port, pdsConfig.pdsHostname)
    await verifySubscribeReposRejected404(port, pdsConfig.servedDomain)
  } catch (err) {
    const logs = runCommand('docker', ['logs', containerName], {
      capture: true
    })
    if (logs.stdout || logs.stderr) {
      console.error(
        `${label} pds-server container logs:\n`,
        logs.stdout,
        logs.stderr
      )
    }
    throw err
  } finally {
    runCommand('docker', ['rm', '-f', containerName], { capture: true })
  }
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
      const forbidden = [
        '@google-cloud/tasks',
        '@upstash/qstash',
        'pg',
        'resend',
        '@aws-sdk/client-ses'
      ];
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

    await waitForInstanceEndpoint(port, containerName, 'minimal app')
  } finally {
    runCommand('docker', ['rm', '-f', containerName], { capture: true })
  }

  // 4. Start minimal app with node pds-server.js & verify HTTP + subscribeRepos WebSocket
  console.log(
    `4. Starting minimal app with node pds-server.js on port ${port} (SQLite) and verifying HTTP + subscribeRepos WebSocket...`
  )
  await verifyPdsServerContainer({
    imageTag,
    label: 'minimal',
    port
  })

  console.log('Minimal image verification passed successfully!')
}

export async function verifyFullImage(
  imageTag: string,
  port: number = Math.floor(Math.random() * 800) + 3100
): Promise<void> {
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

      const nodemailer = require('nodemailer');
      console.log('PASS: nodemailer loaded.');

      const { Resend } = require('resend');
      new Resend('smoke-test-token');
      console.log('PASS: Resend initialized.');

      const { SESClient } = require('@aws-sdk/client-ses');
      new SESClient({ region: 'eu-west-1' });
      console.log('PASS: SESClient initialized.');
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

    // Run query using pg in full container with connection retries
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
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        async function testConnection() {
          const deadline = Date.now() + 30000;
          let lastErr = null;

          while (Date.now() < deadline) {
            const client = new Client({
              host: '${pgContainerName}',
              port: 5432,
              user: 'activities',
              password: 'activities',
              database: 'activities',
              connectionTimeoutMillis: 2000
            });

            try {
              await client.connect();
              const res = await client.query('SELECT 42 AS answer');
              if (!res.rows[0] || res.rows[0].answer !== 42) {
                console.error('FAILURE: Unexpected query result:', res.rows);
                await client.end();
                process.exit(1);
              }
              console.log('PASS: Local PostgreSQL query succeeded with result:', res.rows[0].answer);
              await client.end();
              return;
            } catch (err) {
              lastErr = err;
              try { await client.end(); } catch (_) {}
              await sleep(1000);
            }
          }

          console.error('FAILURE: PostgreSQL connection/query error timed out after 30s:', lastErr);
          process.exit(1);
        }

        testConnection();
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

    // 3. Load schema and start full image with node pds-server.js against PostgreSQL
    console.log(
      `3. Loading PostgreSQL schema and starting full app with node pds-server.js on port ${port}...`
    )
    const schemaSql = fs.readFileSync(
      path.join(process.cwd(), 'migrations', 'schema.sql'),
      'utf-8'
    )
    const loadSchemaRes = runCommand(
      'docker',
      [
        'exec',
        '-i',
        pgContainerName,
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'activities',
        '-d',
        'activities'
      ],
      { capture: true, input: schemaSql }
    )
    if (loadSchemaRes.status !== 0) {
      console.error(loadSchemaRes.stderr || loadSchemaRes.stdout)
      throw new Error(
        'Full image verification failed: unable to load PostgreSQL schema.'
      )
    }

    await verifyPdsServerContainer({
      imageTag,
      label: 'full',
      port,
      network: networkName,
      env: {
        ACTIVITIES_DATABASE_CLIENT: 'pg',
        ACTIVITIES_DATABASE_PG_HOST: pgContainerName,
        ACTIVITIES_DATABASE_PG_PORT: '5432',
        ACTIVITIES_DATABASE_PG_USER: 'activities',
        ACTIVITIES_DATABASE_PG_PASSWORD: 'activities',
        ACTIVITIES_DATABASE_PG_DATABASE: 'activities'
      }
    })
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
  --only <minimal|full>  Verify only one of the two images (default: both)
  --port <port>          Port for app smoke tests (default: random 3100..3899)
  --help, -h             Show this help message
`)
    return
  }

  const only = options.only ?? 'both'
  // Only the image(s) this run will verify must exist.
  const shouldBuild =
    options.build ||
    (only !== 'full' && !imageExists(options.minimalImage)) ||
    (only !== 'minimal' && !imageExists(options.fullImage))

  if (shouldBuild) {
    console.log('Building Docker images...')
    if (only !== 'full') {
      buildDockerImage(options.minimalImage)
    }
    if (only !== 'minimal') {
      buildDockerImage(options.fullImage, {
        WORKSPACES:
          'activities.next @activities/nodemailer @activities/resend @activities/ses @activities/pg @activities/cloudtasks @activities/qstash'
      })
    }
  }

  const port = options.port || Math.floor(Math.random() * 800) + 3100

  if (only !== 'full') {
    await verifyMinimalImage(options.minimalImage, port)
  }
  if (only !== 'minimal') {
    await verifyFullImage(options.fullImage, port)
  }

  if (only === 'both') {
    console.log('\n=== All Docker Image Verifications Succeeded! ===\n')
  } else {
    const variant = only === 'minimal' ? 'Minimal' : 'Full'
    console.log(`\n=== ${variant} Docker Image Verification Succeeded! ===\n`)
  }
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
