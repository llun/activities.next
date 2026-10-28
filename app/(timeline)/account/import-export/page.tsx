import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { ArchiveExportSection } from '@/app/(timeline)/account/import-export/ArchiveExportSection'
import { CsvDownloadsSection } from '@/app/(timeline)/account/import-export/CsvDownloadsSection'
import { ImportSection } from '@/app/(timeline)/account/import-export/ImportSection'
import { PageHeader } from '@/lib/components/page-header'
import { getAccountImportConfig } from '@/lib/config/accountImport'
import { getDatabase } from '@/lib/database'
import { ARCHIVE_LIST_LIMIT } from '@/lib/services/accountArchive/constants'
import { expireArchiveIfDue } from '@/lib/services/accountArchive/expiry'
import { getArchiveObjectStore } from '@/lib/services/accountArchive/objectStore'
import { reapStuckAccountArchive } from '@/lib/services/accountArchive/reaper'
import { toArchiveResponse } from '@/lib/services/accountArchive/serialize'
import { serializeAccountImport } from '@/lib/services/accountImport/serialize'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { BULK_IMPORT_FILE_SIZE_LIMIT } from '@/lib/services/imports/types'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Import and export'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) return redirect('/auth/signin')

  const accountId = actor.account.id
  const currentTime = Date.now()
  const store = getArchiveObjectStore()
  const [recentArchives, latestRequestedArchive, imports] = await Promise.all([
    database.getAccountArchivesForAccount({
      accountId,
      limit: ARCHIVE_LIST_LIMIT
    }),
    database.getLatestRequestedAccountArchive({ accountId }),
    database.listAccountImports({ actorId: actor.id, limit: 20 })
  ])
  const archivesById = new Map(
    recentArchives.map((archive) => [archive.id, archive])
  )
  if (latestRequestedArchive) {
    archivesById.set(latestRequestedArchive.id, latestRequestedArchive)
  }
  const initialArchives = await Promise.all(
    [...archivesById.values()].map(async (archive) => {
      const expired = await expireArchiveIfDue({ database, archive, store })
      return toArchiveResponse(
        await reapStuckAccountArchive({ database, archive: expired, store })
      )
    })
  )
  initialArchives.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  )
  const latestImport =
    imports.find(
      (accountImport) =>
        accountImport.accountId === accountId &&
        (accountImport.status === 'queued' ||
          accountImport.status === 'running')
    ) ?? imports.find((accountImport) => accountImport.accountId === accountId)
  const latestImportReport =
    latestImport &&
    (latestImport.status === 'done' ||
      latestImport.status === 'failed' ||
      latestImport.status === 'cancelled')
      ? await database.countAccountImportItemsByOutcome({
          importId: latestImport.id
        })
      : undefined

  const handle = `@${actor.username}@${actor.domain}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import and export"
        description="Download your archive, or bring posts and lists in from another server."
      />
      <ArchiveExportSection
        actorId={actor.id}
        currentTime={currentTime}
        initialArchives={initialArchives}
        exportAvailable={store !== null}
      />
      <CsvDownloadsSection actorId={actor.id} />
      <ImportSection
        actorId={actor.id}
        handle={handle}
        currentTime={currentTime}
        initialImport={
          latestImport
            ? serializeAccountImport(latestImport, latestImportReport)
            : null
        }
        maxImportBytes={getAccountImportConfig().maxFileSize}
        maxCsvBytes={BULK_IMPORT_FILE_SIZE_LIMIT}
      />
    </div>
  )
}

export default Page
