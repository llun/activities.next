#!/usr/bin/env -S node scripts/run.cjs
/**
 * Links an actor's already-stored fitness files to a `kind: 'device'` gear row.
 *
 * Recording devices became gear after most people's activities were already
 * imported. Those rows still carry the `deviceName`/`deviceManufacturer` the
 * file was recorded with — the import has always stored them — but nothing
 * points at a device row, so the gear page shows no Devices card and the post
 * chip still renders a manufacturer link. Re-importing is not an option (it
 * would duplicate the posts), so this closes the gap: it groups the actor's
 * history by device identity, resolves each group to one row, and stamps the
 * link on every file in it.
 *
 * Dry run by default. Nothing is written unless `--apply` is given.
 *
 * Idempotent by construction: only files with a NULL `deviceGearId` are
 * selected, and `resolveDeviceGear` finds the existing row rather than creating
 * a second one, so a second run reports nothing left to do.
 *
 * IMPORTANT: run this with the PRODUCTION database env configured. `@next/env`
 * loads `.env.local` above `.env.production` even under NODE_ENV=production, so
 * a stray local file points this at SQLite and it reports nothing to do — the
 * banner it prints first is there to catch exactly that.
 *
 * Usage:
 *   NODE_ENV=production scripts/fitness/backfillFitnessDevices.ts \
 *     --actor-id https://<host>/users/<username> \
 *     [--apply]
 */
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { getDeviceGearKey } from '@/lib/services/fitness-gears/deviceIdentity'
import { resolveDeviceGear } from '@/lib/services/fitness-gears/resolveDeviceGear'

import { printDatabaseBanner } from './describeConnection'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const CliArgs = z.object({
  actorId: z.string().min(1),
  apply: z.boolean().default(false)
})

const USAGE = `Usage: NODE_ENV=production scripts/fitness/backfillFitnessDevices.ts \\
  --actor-id https://<host>/users/<username> \\
  [--apply]`

const ACTOR_SCAN_PAGE_SIZE = 200

const parseBooleanFlagValue = (value?: string) => {
  if (value === undefined || value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid boolean value: ${value}. Use true or false.`)
}

export const parseArgs = (args: string[]) => {
  const parsed: Record<string, string | boolean> = {}

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [rawKey, inlineValue] = argument.slice(2).split('=', 2)

    if (rawKey === 'apply') {
      const nextValue = args[index + 1]
      if (inlineValue !== undefined) {
        parsed[rawKey] = parseBooleanFlagValue(inlineValue)
        continue
      }
      if (nextValue && !nextValue.startsWith('--')) {
        parsed[rawKey] = parseBooleanFlagValue(nextValue)
        index += 1
        continue
      }
      parsed[rawKey] = true
      continue
    }

    const nextValue = inlineValue ?? args[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for --${rawKey}`)
    }
    if (inlineValue === undefined) index += 1
    parsed[rawKey] = nextValue
  }

  return CliArgs.parse({
    actorId: parsed['actor-id'],
    apply: parsed['apply'] ?? false
  })
}

/** The subset of a fitness file this backfill reads. */
export interface BackfillableFitnessFile {
  id: string
  deviceName?: string | null
  deviceManufacturer?: string | null
  deviceGearId?: string | null
}

export interface DeviceBackfillGroup {
  deviceKey: string
  /** The first spelling seen for this key — what the created row is named from. */
  deviceName: string | null
  deviceManufacturer: string | null
  fileIds: string[]
}

/**
 * Groups an actor's files by device identity, dropping the ones there is
 * nothing to do for.
 *
 * Pure so the interesting decision — which files collapse onto one device — is
 * testable without a database. Grouping matters: an actor with 5,000 rides on
 * one head unit resolves the device ONCE instead of 5,000 times.
 *
 * Two exclusions, both deliberate. A file that already carries a
 * `deviceGearId` is skipped, which is what makes a re-run cheap and keeps a
 * manual correction intact. A file whose device fields yield no key gets no row
 * at all — most GPX files name no device, and a raw FIT code nothing recognises
 * is not an identity worth a page.
 */
export const planDeviceBackfill = (
  files: BackfillableFitnessFile[]
): DeviceBackfillGroup[] => {
  const groups = new Map<string, DeviceBackfillGroup>()

  for (const file of files) {
    if (file.deviceGearId) continue

    const deviceKey = getDeviceGearKey(file.deviceName, file.deviceManufacturer)
    if (!deviceKey) continue

    const existing = groups.get(deviceKey)
    if (existing) {
      existing.fileIds.push(file.id)
      continue
    }

    groups.set(deviceKey, {
      deviceKey,
      deviceName: file.deviceName ?? null,
      deviceManufacturer: file.deviceManufacturer ?? null,
      fileIds: [file.id]
    })
  }

  return [...groups.values()]
}

async function backfillFitnessDevicesScript(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  let input: z.infer<typeof CliArgs>
  try {
    input = parseArgs(args)
  } catch (error) {
    console.error((error as Error).message)
    console.error(USAGE)
    return 1
  }

  printDatabaseBanner()

  const database = getDatabase()
  if (!database) {
    console.error('Error: Database is not available')
    return 1
  }

  try {
    const actor = await database.getActorFromId({ id: input.actorId })
    if (!actor) {
      console.error(`Error: Actor not found: ${input.actorId}`)
      return 1
    }

    // Read the whole history first, then group: the same head unit appears on
    // pages that are hundreds of activities apart, and grouping per page would
    // resolve it once per page instead of once overall.
    const files: BackfillableFitnessFile[] = []
    let offset = 0
    for (;;) {
      const page = await database.getFitnessFilesByActor({
        actorId: actor.id,
        limit: ACTOR_SCAN_PAGE_SIZE,
        offset
      })
      if (page.length === 0) break
      files.push(...page)
      if (page.length < ACTOR_SCAN_PAGE_SIZE) break
      offset += ACTOR_SCAN_PAGE_SIZE
    }

    const groups = planDeviceBackfill(files)
    console.log(
      `Scanned ${files.length} file(s); ${groups.length} device(s) to link.`
    )

    const totals = { linked: 0, failed: 0 }

    for (const group of groups) {
      const label = group.deviceName ?? group.deviceManufacturer ?? '(unnamed)'
      if (!input.apply) {
        console.log(
          `  [dry run] ${label} (${group.deviceKey}) — ${group.fileIds.length} file(s)`
        )
        continue
      }

      const device = await resolveDeviceGear({
        database,
        actorId: actor.id,
        deviceName: group.deviceName,
        deviceManufacturer: group.deviceManufacturer
      })
      if (!device) {
        console.error(
          `  ! Failed to resolve device ${label} (${group.deviceKey}); skipping ${group.fileIds.length} file(s)`
        )
        totals.failed += group.fileIds.length
        continue
      }

      for (const fileId of group.fileIds) {
        try {
          await database.updateFitnessFileActivityData(fileId, {
            deviceGearId: device.id
          })
          totals.linked += 1
        } catch (error) {
          console.error(`  ! Failed to link ${fileId}: ${String(error)}`)
          totals.failed += 1
        }
      }
      console.log(`  ${label} → ${device.id} (${group.fileIds.length} file(s))`)
    }

    if (!input.apply) {
      console.log('\nDry run — nothing written. Re-run with --apply.')
      return 0
    }

    console.log(`\nDone: ${totals.linked} linked, ${totals.failed} error(s).`)
    return totals.failed > 0 ? 1 : 0
  } finally {
    await database.destroy()
  }
}

if (require.main === module) {
  backfillFitnessDevicesScript()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Script failed:', error)
      process.exit(1)
    })
}

export { backfillFitnessDevicesScript }
