#!/usr/bin/env -S node scripts/run.cjs
/**
 * Imports a remote status into the database using createNoteJob, which
 * persists the status, populates tags/mentions, links reply threads,
 * and fans out to timelines for local followers and recipients.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/importRemoteStatus.ts <statusUrl> [--dry-run]
 *
 * Examples:
 *   NODE_ENV=production node scripts/run.cjs scripts/maintenance/importRemoteStatus.ts https://mastodon.in.th/@lluu/117228726176772772
 *   NODE_ENV=production node scripts/run.cjs scripts/maintenance/importRemoteStatus.ts https://mastodon.in.th/users/lluu/statuses/117228726176772772 --dry-run
 */
import { loadEnvConfig } from '@next/env'

import { getNote } from '@/lib/activities'
import { BaseNote } from '@/lib/activities/note'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { StatusType } from '@/lib/types/domain/status'
import {
  extractActivityPubId,
  isSameActivityPubOrigin
} from '@/lib/utils/activitypub'
import { isHttpUrl } from '@/lib/utils/isHttpUrl'
import { getClientStatusId } from '@/lib/utils/publicId'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

export interface ImportRemoteStatusOptions {
  statusUrl: string
  dryRun?: boolean
}

export interface ImportRemoteStatusResult {
  statusId: string
  publicId: string
  actorId: string
  reply: string
  url: string
  createdAt: string
}

export const parseArgs = (args: string[]): ImportRemoteStatusOptions => {
  let statusUrl: string | undefined
  let dryRun = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--dry-run' || argument === '--dry-run=true') {
      dryRun = true
      continue
    }
    if (argument === '--dry-run=false') {
      dryRun = false
      continue
    }
    if (argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }
    if (!statusUrl) {
      statusUrl = argument
    } else {
      throw new Error(`Unexpected extra argument: ${argument}`)
    }
  }

  if (!statusUrl) {
    throw new Error('Missing required statusUrl argument')
  }

  return { statusUrl, dryRun }
}

export const importRemoteStatus = async (
  database: Database,
  options: ImportRemoteStatusOptions
): Promise<ImportRemoteStatusResult | null> => {
  const { statusUrl, dryRun = false } = options
  if (!isHttpUrl(statusUrl)) {
    throw new Error(`Status URL must be an http(s) URL: ${statusUrl}`)
  }

  const signingActor = await getFederationSigningActor(database).catch(
    () => undefined
  )
  const note = await getNote({ statusId: statusUrl, signingActor })

  if (!note) {
    throw new Error(`Failed to fetch remote status from ${statusUrl}`)
  }

  let objectNote: BaseNote = note
  if (
    typeof note === 'object' &&
    note !== null &&
    'type' in note &&
    (note as { type: string }).type === 'Create' &&
    'object' in note &&
    typeof (note as { object: unknown }).object === 'object' &&
    (note as { object: unknown }).object !== null
  ) {
    objectNote = (note as { object: BaseNote }).object
  }

  // The fetched document is a claim by whoever served statusUrl, and the
  // import below hands it to createNoteJob as verified by its author. That is
  // only true when the note names an id on the origin that served it, an
  // author on the note's own origin, and is not posing as one of our own.
  if (!isSameActivityPubOrigin(objectNote.id, statusUrl)) {
    throw new Error(
      `Refusing ${objectNote.id}: it is not on the origin of ${statusUrl}`
    )
  }
  // Gate the author id `extractActivityPubId` picks — the one createNoteJob
  // stores — not the raw value, which may still be an embedded actor object
  // or a multi-valued array after compaction.
  const author = extractActivityPubId(objectNote.attributedTo)
  if (!author || !isSameActivityPubOrigin(author, objectNote.id)) {
    throw new Error(
      `Refusing ${objectNote.id}: attributedTo ${author ?? '(none)'} is on another origin`
    )
  }
  if (await isLocalFederationDomain(database, objectNote.id)) {
    throw new Error(`Refusing ${objectNote.id}: it claims a local id`)
  }

  if (dryRun) {
    return {
      statusId: objectNote.id,
      publicId: '(dry-run)',
      actorId: author,
      reply: objectNote.inReplyTo || '',
      url: typeof objectNote.url === 'string' ? objectNote.url : objectNote.id,
      createdAt: objectNote.published
        ? new Date(objectNote.published).toISOString()
        : new Date().toISOString()
    }
  }

  await createNoteJob(database, {
    id: objectNote.id,
    name: CREATE_NOTE_JOB_NAME,
    data: objectNote,
    verifiedSenderActorId: author
  })

  const storedStatus = await database.getStatus({ statusId: objectNote.id })
  if (!storedStatus) {
    throw new Error(
      `Status ${objectNote.id} was not found in database after running createNoteJob`
    )
  }

  const reply =
    storedStatus.type === StatusType.enum.Note ? storedStatus.reply : ''
  const importedUrl =
    storedStatus.type === StatusType.enum.Note ? storedStatus.url : ''

  return {
    statusId: storedStatus.id,
    publicId: getClientStatusId(storedStatus),
    actorId: storedStatus.actorId,
    reply,
    url: importedUrl,
    createdAt: new Date(storedStatus.createdAt).toISOString()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const database = getDatabase()
  if (!database) {
    console.error('importRemoteStatus: Database is not available')
    process.exit(1)
  }

  console.log(`Fetching remote status from ${options.statusUrl}...`)
  if (options.dryRun) {
    console.log('Running in dry-run mode (no database writes)')
  }

  try {
    const result = await importRemoteStatus(database, options)
    if (result) {
      console.log('Successfully imported status:')
      console.log(`  ID:        ${result.statusId}`)
      console.log(`  Public ID: ${result.publicId}`)
      console.log(`  Actor:     ${result.actorId}`)
      console.log(`  Reply To:  ${result.reply || '(none)'}`)
      console.log(`  URL:       ${result.url}`)
      console.log(`  Created:   ${result.createdAt}`)
    }
  } catch (error) {
    console.error(
      'Import failed:',
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}

if (process.argv[1] && process.argv[1].endsWith('importRemoteStatus.ts')) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
