'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  KnownDomainBlocklistSourceId,
  downloadKnownDomainBlocklist
} from '@/lib/services/federation/blocklistSources'
import {
  DEFAULT_DOMAIN_BLOCK_SEVERITY,
  normalizeDomain
} from '@/lib/services/federation/domainRules'
import { DomainBlockSeverity } from '@/lib/types/database/operations'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import { logger } from '@/lib/utils/logger'

const ADMIN_FEDERATION_PATH = '/admin/federation'

const getAdminDatabase = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) redirect('/')

  return database
}

const redirectWithStatus = (status: string): never => {
  revalidatePath(ADMIN_FEDERATION_PATH)
  redirect(`${ADMIN_FEDERATION_PATH}?status=${encodeURIComponent(status)}`)
}

const getText = (formData: FormData, key: string): string =>
  String(formData.get(key) ?? '').trim()

const getCheckbox = (formData: FormData, key: string): boolean =>
  formData.get(key) === 'on'

const getSeverity = (value: string): DomainBlockSeverity =>
  value === 'noop' || value === 'silence' || value === 'suspend'
    ? value
    : DEFAULT_DOMAIN_BLOCK_SEVERITY

export async function createDomainBlockAction(formData: FormData) {
  const database = await getAdminDatabase()
  const domain = normalizeDomain(getText(formData, 'domain'))
  const normalizedDomain = domain ?? redirectWithStatus('invalid-block-domain')

  await database.createDomainBlock({
    domain: normalizedDomain,
    severity: getSeverity(getText(formData, 'severity')),
    rejectMedia: getCheckbox(formData, 'rejectMedia'),
    rejectReports: getCheckbox(formData, 'rejectReports'),
    privateComment: getText(formData, 'privateComment') || null,
    publicComment: getText(formData, 'publicComment') || null,
    obfuscate: getCheckbox(formData, 'obfuscate'),
    source: null
  })

  redirectWithStatus('block-saved')
}

export async function deleteDomainBlockAction(formData: FormData) {
  const database = await getAdminDatabase()
  const id = getText(formData, 'id')
  if (id) await database.deleteDomainBlock(id)

  redirectWithStatus('block-deleted')
}

export async function createDomainAllowAction(formData: FormData) {
  const database = await getAdminDatabase()
  const domain = normalizeDomain(getText(formData, 'domain'))
  const normalizedDomain = domain ?? redirectWithStatus('invalid-allow-domain')

  await database.createDomainAllow({ domain: normalizedDomain })

  redirectWithStatus('allow-saved')
}

export async function deleteDomainAllowAction(formData: FormData) {
  const database = await getAdminDatabase()
  const id = getText(formData, 'id')
  if (id) await database.deleteDomainAllow(id)

  redirectWithStatus('allow-deleted')
}

export async function importKnownDomainBlocklistAction(formData: FormData) {
  const database = await getAdminDatabase()
  const source = KnownDomainBlocklistSourceId.safeParse(
    getText(formData, 'source')
  )
  const sourceId = source.success
    ? source.data
    : redirectWithStatus('invalid-source')

  let created = 0
  let updated = 0
  let skipped = 0
  try {
    const blocks = await downloadKnownDomainBlocklist(sourceId)
    const result = await database.importDomainBlocks({ blocks })
    created = result.created
    updated = result.updated
    skipped = result.skipped
  } catch (error) {
    logger.error({
      message: 'Failed to import known domain blocklist',
      sourceId,
      error
    })
    redirectWithStatus('import-failed')
  }

  redirectWithStatus(`imported-${created}-${updated}-${skipped}`)
}
