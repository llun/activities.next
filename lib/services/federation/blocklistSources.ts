import { z } from 'zod'

import {
  DEFAULT_DOMAIN_BLOCK_SEVERITY,
  normalizeDomain
} from '@/lib/services/federation/domainRules'
import {
  DomainBlockSeverity,
  ImportDomainBlockParams
} from '@/lib/types/database/operations'

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

type FetchLike = typeof fetch

const parseBoolean = (value: string | undefined): boolean =>
  value?.trim().toLowerCase() === 'true'

const parseSeverity = (value: string | undefined): DomainBlockSeverity => {
  const severity = value?.trim().toLowerCase()
  return severity === 'noop' || severity === 'silence' || severity === 'suspend'
    ? severity
    : DEFAULT_DOMAIN_BLOCK_SEVERITY
}

export const parseCsvLine = (line: string): string[] => {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]

    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      i++
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      fields.push(current)
      current = ''
      continue
    }

    current += char
  }

  fields.push(current)
  return fields
}

export const parseDomainBlockCsv = (
  csv: string,
  source: string
): ImportDomainBlockParams[] => {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line)
  const [headerLine, ...rows] = lines
  if (!headerLine) return []

  const headers = parseCsvLine(headerLine).map((field) =>
    field.trim().replace(/^#/, '')
  )
  const domainIndex = headers.indexOf('domain')
  if (domainIndex < 0) return []

  const getField = (fields: string[], name: string): string | undefined => {
    const index = headers.indexOf(name)
    return index >= 0 ? fields[index] : undefined
  }

  const blocks = new Map<string, ImportDomainBlockParams>()

  for (const row of rows) {
    const fields = parseCsvLine(row)
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

export const fetchKnownDomainBlocklist = async (
  sourceId: KnownDomainBlocklistSourceId,
  fetchImpl: FetchLike = fetch
): Promise<ImportDomainBlockParams[]> => {
  const source = KNOWN_DOMAIN_BLOCKLIST_SOURCES.find(
    (item) => item.id === sourceId
  )
  if (!source) throw new Error('Unknown domain blocklist source')

  const response = await fetchImpl(source.url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${source.name}`)
  }

  const csv = await response.text()
  return parseDomainBlockCsv(csv, source.id)
}
