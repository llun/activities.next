#!/usr/bin/env -S node -r @swc-node/register
/**
 * Imports a Strava archive ZIP locally without a queue worker.
 *
 * Usage:
 *   NODE_ENV=production scripts/importStravaArchive.ts \
 *     --archive-path /path/to/export.zip \
 *     --actor-id https://yourdomain.com/users/username \
 *     [--visibility public|unlisted|private|direct]
 *
 * Set NODE_ENV=production to load .env.production; omit for dev env files.
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'
import { getDatabase } from '@/lib/database'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])

const CliArgs = z.object({
  archivePath: z.string().min(1),
  actorId: z.string().min(1),
  visibility: Visibility.default('private')
})

const USAGE = `Usage: NODE_ENV=production scripts/importStravaArchive.ts \\
  --archive-path /path/to/export.zip \\
  --actor-id https://yourdomain.com/users/username \\
  [--visibility public|unlisted|private|direct]`

const parseArgs = (args: string[]) => {
  const parsedArgs: Record<string, string> = {}

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)
    const nextValue = inlineValue ?? args[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for --${rawKey}`)
    }

    if (inlineValue === undefined) {
      index += 1
    }

    parsedArgs[rawKey] = nextValue
  }

  return CliArgs.parse({
    archivePath: parsedArgs['archive-path'],
    actorId: parsedArgs['actor-id'],
    visibility: parsedArgs['visibility']
  })
}

async function importStravaArchive(args = process.argv.slice(2)) {
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

  const database = getDatabase()
  if (!database) {
    console.error('Error: Database is not available. Check your env configuration.')
    return 1
  }

  const actor = await database.getActorFromId({ id: input.actorId })
  if (!actor) {
    console.error(`Error: Actor not found: ${input.actorId}`)
    return 1
  }

  console.log(`Actor resolved: ${actor.username}@${actor.domain}`)

  return 0
}

if (require.main === module) {
  importStravaArchive()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}
