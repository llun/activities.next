import { parseImportProgress } from '@/lib/services/accountImport/progress'
import type {
  AccountImport,
  AccountImportOutcomeReport
} from '@/lib/types/domain/accountImport'

export const serializeAccountImport = (
  accountImport: AccountImport,
  report?: AccountImportOutcomeReport
) => ({
  id: accountImport.id,
  status: accountImport.status,
  kind: accountImport.kind,
  phase: accountImport.phase,
  progress: parseImportProgress(accountImport.progress),
  createdAt: new Date(accountImport.createdAt).toISOString(),
  startedAt: accountImport.startedAt
    ? new Date(accountImport.startedAt).toISOString()
    : null,
  finishedAt: accountImport.finishedAt
    ? new Date(accountImport.finishedAt).toISOString()
    : null,
  lastErrorCode: accountImport.lastErrorCode,
  // Only the single-import GET passes a report, and only once the import
  // is terminal; every other caller keeps the object without one.
  ...(report === undefined ? null : { report })
})
