import { Buffer } from 'node:buffer'
import { z } from 'zod'

import {
  DEFAULT_DOMAIN_BLOCK_SEVERITY,
  normalizeDomain
} from '@/lib/services/federation/domainRules'
import {
  DomainBlockSeverity,
  ImportDomainBlockParams
} from '@/lib/types/database/operations'
import { RequestOptions, RequestResult, request } from '@/lib/utils/request'

export const KnownDomainBlocklistSourceId = z.enum(['oliphant-tier0'])
export type KnownDomainBlocklistSourceId = z.infer<
  typeof KnownDomainBlocklistSourceId
>

export const KNOWN_DOMAIN_BLOCKLIST_SOURCES = [
  {
    id: KnownDomainBlocklistSourceId.enum['oliphant-tier0'],
    name: 'Oliphant unified tier 0',
    url: 'https://codeberg.org/oliphant/blocklists/raw/branch/main/blocklists/_unified_tier0_blocklist.csv'
  }
] as const

export const KNOWN_DOMAIN_BLOCKLIST_TIMEOUT_MS = 30_000
export const KNOWN_DOMAIN_BLOCKLIST_MAX_BYTES = 10 * 1024 * 1024

type BlocklistRequest = (options: RequestOptions) => Promise<RequestResult>

const defaultBlocklistRequest: BlocklistRequest = async (options) => {
  const { statusCode, headers, body } = await request(options)
  return { statusCode, headers, body }
}

const parseBoolean = (value: string | undefined): boolean =>
  value?.trim().toLowerCase() === 'true'

const parseSeverity = (value: string | undefined): DomainBlockSeverity => {
  const severity = value?.trim().toLowerCase()
  return severity === 'noop' || severity === 'silence' || severity === 'suspend'
    ? severity
    : DEFAULT_DOMAIN_BLOCK_SEVERITY
}

export const parseCsvLine = (line: string): string[] => {
  return parseCsvRecords(line)[0] ?? []
}

export const parseCsvRecords = (csv: string): string[][] => {
  const records: string[][] = []
  let fields: string[] = []
  let field = ''
  let inQuotes = false

  const pushRecord = () => {
    fields.push(field)
    if (fields.some((value) => value.trim())) {
      records.push(fields)
    }
    fields = []
    field = ''
  }

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    const next = csv[i + 1]

    if (char === '"' && inQuotes && next === '"') {
      field += '"'
      i++
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      fields.push(field)
      field = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++
      pushRecord()
      continue
    }

    field += char
  }

  if (field || fields.length) {
    pushRecord()
  }

  return records
}

export const parseDomainBlockCsv = (
  csv: string,
  source: string
): ImportDomainBlockParams[] => {
  const [headerFields, ...rows] = parseCsvRecords(csv)
  if (!headerFields) return []

  const headers = headerFields.map((field) =>
    field.trim().toLowerCase().replace(/^#/, '')
  )
  const domainIndex = headers.indexOf('domain')
  if (domainIndex < 0) return []

  const getField = (fields: string[], name: string): string | undefined => {
    const index = headers.indexOf(name)
    return index >= 0 ? fields[index] : undefined
  }

  const blocks = new Map<string, ImportDomainBlockParams>()

  for (const fields of rows) {
    const domain = normalizeDomain(fields[domainIndex] ?? '')
    if (!domain) continue

    blocks.set(domain, {
      domain,
      severity: parseSeverity(getField(fields, 'severity')),
      rejectMedia: parseBoolean(getField(fields, 'reject_media')),
      rejectReports: parseBoolean(getField(fields, 'reject_reports')),
      publicComment: getField(fields, 'public_comment')?.trim() || null,
      privateComment: getField(fields, 'private_comment')?.trim() || null,
      obfuscate: parseBoolean(getField(fields, 'obfuscate')),
      source
    })
  }

  return [...blocks.values()]
}

export const downloadKnownDomainBlocklist = async (
  sourceId: KnownDomainBlocklistSourceId,
  requestImpl: BlocklistRequest = defaultBlocklistRequest
): Promise<ImportDomainBlockParams[]> => {
  const source = KNOWN_DOMAIN_BLOCKLIST_SOURCES.find(
    (item) => item.id === sourceId
  )
  if (!source) throw new Error('Unknown domain blocklist source')

  const response = await requestImpl({
    url: source.url,
    responseTimeout: KNOWN_DOMAIN_BLOCKLIST_TIMEOUT_MS,
    numberOfRetry: 0,
    maxResponseSize: KNOWN_DOMAIN_BLOCKLIST_MAX_BYTES
  })
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Failed to download ${source.name}`)
  }

  const contentLength = response.headers['content-length']
  const contentLengthValue = Array.isArray(contentLength)
    ? contentLength[0]
    : contentLength
  const expectedBytes = Number(contentLengthValue ?? 0)
  if (expectedBytes > KNOWN_DOMAIN_BLOCKLIST_MAX_BYTES) {
    throw new Error('Blocklist response too large')
  }

  const csv = response.body
  if (Buffer.byteLength(csv, 'utf8') > KNOWN_DOMAIN_BLOCKLIST_MAX_BYTES) {
    throw new Error('Blocklist response too large')
  }

  return parseDomainBlockCsv(csv, source.id)
}
