import { randomUUID } from 'node:crypto'

import type { Database } from '@/lib/database/types'
import { toArchiveLoggableError } from '@/lib/services/accountArchive/redact'
import {
  ACCOUNT_IMPORT_LEASE_GRACE_MS,
  ACCOUNT_IMPORT_SLICE_BUDGET_MS
} from '@/lib/services/accountImport/constants'
import { getAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import {
  type AccountArchiveKind,
  type AccountImportPhaseContext,
  inspectAccountArchive,
  runAlbumsNoopPhase,
  runCatalogPhase,
  runCollectionsNoopPhase,
  runFitnessNoopPhase,
  runGalleryNoopPhase,
  runGearsNoopPhase,
  runMastodonMediaPhase,
  runOwnArchiveMediaNoopPhase,
  runProfileNoopPhase,
  runSettingsNoopPhase,
  runStatusesPhase
} from '@/lib/services/accountImport/phases'
import {
  parseImportProgress,
  serializeImportProgress
} from '@/lib/services/accountImport/progress'
import { ZipArchiveError } from '@/lib/services/accountImport/zip/reader'
import { isActorModerationBlocked } from '@/lib/services/guards/accountState'
import type { AccountImport } from '@/lib/types/domain/accountImport'
import type { Actor } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

const PHASES = [
  'inspect',
  'catalog',
  'profile',
  'gears',
  'media',
  'statuses',
  'albums',
  'collections',
  'finish'
] as const

export type AccountImportPhase = (typeof PHASES)[number]

export const getAccountImportContinuationJobId = (
  importId: string,
  cursor: string | null
) => getHashFromString(`${importId}:continue:${cursor ?? ''}`)

class LostAccountImportLeaseError extends Error {}
class AccountImportCancelledError extends Error {}
class AccountImportActorUnavailableError extends Error {}

export const isAccountImportActorUnavailable = (actor: Actor | null) =>
  !actor ||
  !actor.account ||
  isActorModerationBlocked(actor) ||
  Boolean(actor.deletionStatus)

const isPhase = (value: string | null): value is AccountImportPhase =>
  PHASES.includes(value as AccountImportPhase)

const nextPhase = (phase: AccountImportPhase): AccountImportPhase =>
  PHASES[PHASES.indexOf(phase) + 1] ?? 'finish'

const failureCode = (error: unknown) =>
  error instanceof AccountImportActorUnavailableError
    ? 'actor_unavailable'
    : error instanceof ZipArchiveError
      ? `archive_${error.reason}`
      : 'import_failed'

export type AccountImportRunResult =
  | { type: 'continued'; phase: AccountImportPhase; cursor: string | null }
  | { type: 'busy' | 'done' | 'cancelled' | 'failed' }

/** Runs one leased, resumable slice. Queue publication is owned by the job. */
export const runAccountImport = async (
  database: Database,
  importId: string,
  {
    actorId,
    budgetMs = ACCOUNT_IMPORT_SLICE_BUDGET_MS,
    now = Date.now,
    runToken = randomUUID(),
    runsInline = false
  }: {
    actorId: string
    budgetMs?: number
    now?: () => number
    runToken?: string
    runsInline?: boolean
  }
): Promise<AccountImportRunResult> => {
  let accountImport = await database.getAccountImport({ id: importId, actorId })
  if (!accountImport) return { type: 'done' }
  const objectStore = getAccountImportObjectStore()
  if (
    accountImport.status === 'done' ||
    accountImport.status === 'failed' ||
    accountImport.status === 'cancelled'
  ) {
    if (objectStore) await objectStore.deleteUpload(accountImport)
    return { type: accountImport.status }
  }

  const sliceBudgetMs = Math.min(
    Math.max(0, budgetMs),
    ACCOUNT_IMPORT_SLICE_BUDGET_MS
  )
  const leaseMs = sliceBudgetMs + ACCOUNT_IMPORT_LEASE_GRACE_MS
  const claim = await database.claimAccountImportRun({
    id: importId,
    runToken,
    leaseMs
  })
  if (!claim.claimed) return { type: 'busy' }

  let leaseLost = false
  let renewError: unknown
  let heartbeat: NodeJS.Timeout | null = null
  const renewLeaseOnly = async () => {
    const renewed = await database.renewAccountImportRun({
      id: importId,
      runToken,
      leaseMs
    })
    if (!renewed) {
      leaseLost = true
      throw new LostAccountImportLeaseError()
    }
  }
  const renew = async () => {
    if (renewError !== undefined) throw renewError
    if (leaseLost) throw new LostAccountImportLeaseError()
    try {
      await renewLeaseOnly()
      const current = await database.getAccountImport({ id: importId, actorId })
      if (!current || current.status === 'cancelled') {
        throw new AccountImportCancelledError()
      }
      if (current.status !== 'running') throw new LostAccountImportLeaseError()
    } catch (error) {
      if (
        error instanceof LostAccountImportLeaseError ||
        error instanceof AccountImportCancelledError
      ) {
        throw error
      }
      renewError = error
      throw error
    }
  }

  try {
    accountImport = (await database.getAccountImport({
      id: importId,
      actorId
    })) as AccountImport
    if (accountImport.status === 'cancelled') {
      if (objectStore) {
        await renewLeaseOnly()
        await objectStore.deleteUpload(accountImport)
      }
      return { type: 'cancelled' }
    }
    if (accountImport.status !== 'running') return { type: 'done' }

    const actor = await database.getActorFromId({ id: accountImport.actorId })
    if (isAccountImportActorUnavailable(actor)) {
      throw new AccountImportActorUnavailableError('actor_unavailable')
    }
    if (!objectStore) throw new Error('import_storage_unavailable')

    const deadline = runsInline
      ? Number.POSITIVE_INFINITY
      : now() + sliceBudgetMs
    const context: AccountImportPhaseContext = {
      database,
      objectStore,
      accountImport,
      now,
      deadline,
      renew
    }
    heartbeat = setInterval(
      () => {
        void renew().catch((error: unknown) => {
          if (
            error instanceof LostAccountImportLeaseError ||
            error instanceof AccountImportCancelledError
          ) {
            return
          }
          logger.warn({
            message: 'Account import lease heartbeat failed',
            importId,
            err: toArchiveLoggableError(error)
          })
        })
      },
      Math.max(1_000, Math.floor(leaseMs / 3))
    )
    heartbeat.unref()

    let phase = isPhase(accountImport.phase) ? accountImport.phase : 'inspect'
    let cursor = accountImport.cursor
    let progress = parseImportProgress(accountImport.progress)

    for (;;) {
      context.accountImport = accountImport
      if (phase === 'inspect') {
        const inspected = await inspectAccountArchive(context)
        if (!inspected) {
          throw new ZipArchiveError('not_a_zip', 'unrecognised_archive')
        }
        progress = {
          ...progress,
          sourceActorId: inspected.sourceActorId,
          sourceFollowersUrl: inspected.sourceFollowersUrl
        }
        await renew()
        await database.updateAccountImport({
          id: importId,
          onlyIfStatus: ['running'],
          kind: inspected.kind,
          progress: serializeImportProgress(progress),
          phase: 'catalog',
          cursor: null
        })
        accountImport = {
          ...accountImport,
          kind: inspected.kind,
          phase: 'catalog',
          cursor: null,
          progress: serializeImportProgress(progress)
        }
        phase = 'catalog'
        cursor = null
        continue
      }

      let phaseResult: 'done' | 'budget' | 'cancelled'
      if (phase === 'catalog') {
        const result = await runCatalogPhase(context, progress)
        progress = result.progress
        phaseResult = result.result
        cursor = result.cursor
      } else if (phase === 'profile') {
        await runProfileNoopPhase()
        await runSettingsNoopPhase()
        phaseResult = 'done'
      } else if (phase === 'gears') {
        await runGearsNoopPhase()
        phaseResult = 'done'
      } else if (phase === 'media') {
        const mediaResult =
          (accountImport.kind as AccountArchiveKind) === 'mastodon'
            ? await runMastodonMediaPhase(context, progress, cursor)
            : {
                result: await runOwnArchiveMediaNoopPhase(),
                progress,
                cursor: null
              }
        await runGalleryNoopPhase()
        phaseResult = mediaResult.result
        cursor = mediaResult.cursor
      } else if (phase === 'statuses') {
        const result = await runStatusesPhase(context, progress, cursor)
        progress = result.progress
        phaseResult = result.result
        cursor = result.cursor
      } else if (phase === 'albums') {
        await runAlbumsNoopPhase()
        phaseResult = 'done'
      } else if (phase === 'collections') {
        await runCollectionsNoopPhase()
        await runFitnessNoopPhase()
        phaseResult = 'done'
      } else {
        await renew()
        await database.updateAccountImport({
          id: importId,
          onlyIfStatus: ['running'],
          status: 'done',
          finishedAt: now(),
          lastErrorCode: null,
          phase: 'finish',
          cursor: null
        })
        if (objectStore) {
          await renewLeaseOnly()
          await objectStore.deleteUpload(accountImport)
        }
        return { type: 'done' }
      }

      if (phaseResult === 'cancelled') {
        if (objectStore) {
          await renewLeaseOnly()
          await objectStore.deleteUpload(accountImport)
        }
        return { type: 'cancelled' }
      }
      if (phaseResult === 'budget') {
        await renew()
        await database.updateAccountImport({
          id: importId,
          onlyIfStatus: ['running'],
          progress: serializeImportProgress(progress),
          phase,
          cursor
        })
        return { type: 'continued', phase, cursor }
      }

      const next = nextPhase(phase)
      await renew()
      await database.updateAccountImport({
        id: importId,
        onlyIfStatus: ['running'],
        progress: serializeImportProgress(progress),
        phase: next,
        cursor: null
      })
      accountImport = {
        ...accountImport,
        progress: serializeImportProgress(progress),
        phase: next,
        cursor: null
      }
      phase = next
      cursor = null
      if (!runsInline && now() >= deadline) {
        return { type: 'continued', phase, cursor }
      }
    }
  } catch (error) {
    if (error instanceof LostAccountImportLeaseError) return { type: 'busy' }
    if (error instanceof AccountImportCancelledError) {
      if (objectStore) {
        await renewLeaseOnly()
        await objectStore.deleteUpload(accountImport).catch(() => undefined)
      }
      return { type: 'cancelled' }
    }
    logger.error({
      message: 'Account archive import failed',
      importId,
      err: toArchiveLoggableError(error)
    })
    try {
      await renew()
      await database.updateAccountImport({
        id: importId,
        onlyIfStatus: ['running'],
        status: 'failed',
        lastErrorCode: failureCode(error),
        finishedAt: now()
      })
      if (objectStore) {
        await renewLeaseOnly()
        await objectStore.deleteUpload(accountImport)
      }
    } catch (updateError) {
      if (
        !(updateError instanceof LostAccountImportLeaseError) &&
        !(updateError instanceof AccountImportCancelledError)
      ) {
        logger.error({
          message: 'Could not finish a failed account archive import',
          importId,
          err: toArchiveLoggableError(updateError)
        })
      }
    }
    return { type: 'failed' }
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    if (!leaseLost && renewError === undefined) {
      await database.releaseAccountImportRun({ id: importId, runToken })
    }
  }
}
