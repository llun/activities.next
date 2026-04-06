#!/usr/bin/env -S node -r @swc-node/register
/**
 * Fixes attachment URLs that were saved with the wrong host (e.g. localhost:3000)
 * by replacing the host portion with the correct production host from config.
 *
 * Usage:
 *   NODE_ENV=production scripts/fixAttachmentUrls.ts [--dry-run] [--wrong-host localhost:3000]
 *
 * Options:
 *   --wrong-host    The bad host to replace (default: localhost:3000)
 *   --correct-host  Override the correct host (default: read from config)
 *   --dry-run       Print what would be changed without modifying anything
 */
import { loadEnvConfig } from '@next/env'
import knex from 'knex'
import { z } from 'zod'

import { getConfig } from '@/lib/config'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  wrongHost: z.string().default('localhost:3000'),
  correctHost: z.string().optional(),
  dryRun: z.boolean().default(false)
})

const USAGE = `Usage: NODE_ENV=production scripts/fixAttachmentUrls.ts \\
  [--wrong-host localhost:3000] \\
  [--correct-host llun.social] \\
  [--dry-run]`

const parseArgs = (args: string[]) => {
  let wrongHost = 'localhost:3000'
  let correctHost: string | undefined
  let dryRun = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)

    if (rawKey === 'dry-run') {
      dryRun = true
    } else if (rawKey === 'wrong-host' || rawKey === 'correct-host') {
      const nextValue = inlineValue ?? args[index + 1]
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error(`Missing value for --${rawKey}`)
      }
      if (inlineValue === undefined) {
        index += 1
      }
      if (rawKey === 'wrong-host') wrongHost = nextValue
      else correctHost = nextValue
    } else {
      throw new Error(`Unknown argument: --${rawKey}`)
    }
  }

  return CliArgs.parse({ wrongHost, correctHost, dryRun })
}

type AttachmentRow = {
  id: string
  url: string
}

async function fixAttachmentUrls(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  let input: z.infer<typeof CliArgs>
  try {
    input = parseArgs(args)
  } catch (error) {
    const nodeError = error as Error
    console.error(nodeError.message)
    console.error(USAGE)
    return 1
  }

  const config = getConfig()
  // Normalize correctHost: strip any scheme (e.g. "https://example.com" → "example.com")
  // and trailing slashes so URL construction is always consistent.
  const correctHost = (input.correctHost ?? config.host)
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
  console.log(`Wrong host:   ${input.wrongHost}`)
  console.log(`Correct host: ${correctHost}`)
  if (input.dryRun) {
    console.log('(dry-run mode — no changes will be made)')
  }

  const db = knex(config.database)

  const BATCH_SIZE = 100

  try {
    const wrongHttpUrl = `http://${input.wrongHost}/%`
    const wrongHttpsUrl = `https://${input.wrongHost}/%`

    let offset = 0
    let totalFound = 0
    let fixedCount = 0

    while (true) {
      const batch = await db<AttachmentRow>('attachments')
        .where('url', 'like', wrongHttpUrl)
        .orWhere('url', 'like', wrongHttpsUrl)
        .select('id', 'url')
        .limit(BATCH_SIZE)
        .offset(offset)

      if (batch.length === 0) break
      totalFound += batch.length

      for (const row of batch) {
        // Preserve the original protocol; only replace the host portion.
        const parsed = new URL(row.url)
        parsed.host = correctHost
        const newUrl = parsed.toString()

        console.log(`  ${row.id}`)
        console.log(`    before: ${row.url}`)
        console.log(`    after:  ${newUrl}`)

        if (!input.dryRun) {
          await db('attachments')
            .where('id', row.id)
            .update({ url: newUrl, updatedAt: new Date() })
          fixedCount += 1
        }
      }

      offset += BATCH_SIZE
    }

    if (totalFound === 0) {
      console.log('\nNo attachments found with the wrong host. Nothing to fix.')
      return 0
    }

    if (input.dryRun) {
      console.log(`\nDry-run complete. Would fix ${totalFound} attachment(s).`)
    } else {
      console.log(`\nFixed ${fixedCount} attachment(s).`)
    }

    return 0
  } finally {
    await db.destroy()
  }
}

if (require.main === module) {
  fixAttachmentUrls()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}
