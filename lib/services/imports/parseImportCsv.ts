import { parse } from 'csv-parse/sync'

import {
  BULK_IMPORT_ROWS_LIMIT,
  BulkImportRowData,
  BulkImportType
} from './types'

const EXPECTED_HEADERS_BY_TYPE: Record<BulkImportType, readonly string[]> = {
  following: [
    'Account address',
    'Show boosts',
    'Notify on new posts',
    'Languages'
  ],
  blocking: ['Account address'],
  muting: ['Account address', 'Hide notifications'],
  domain_blocking: ['#domain'],
  bookmarks: ['#uri'],
  lists: ['List name', 'Account address']
}

const DEFAULT_HEADERS: Record<BulkImportType, readonly string[]> = {
  following: ['Account address'],
  blocking: ['Account address'],
  muting: ['Account address'],
  domain_blocking: ['#domain'],
  bookmarks: ['#uri'],
  lists: ['List name', 'Account address']
}

const KNOWN_FIRST_HEADERS: readonly string[] = [
  'Account address',
  '#domain',
  '#uri',
  'List name'
]

const FALSE_BOOLEAN_VALUES = new Set(['false', 'f', '0', 'off'])

const convertBoolean = (val: string | undefined): boolean | null => {
  if (val === undefined || val === null) return null
  const trimmed = val.trim()
  if (!trimmed) return null
  return !FALSE_BOOLEAN_VALUES.has(trimmed.toLowerCase())
}

const convertLanguages = (val: string | undefined): string[] | null => {
  if (val === undefined || val === null) return null
  const trimmed = val.trim()
  if (!trimmed) return null
  const langs = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return langs.length > 0 ? langs : null
}

export const parseImportCsv = ({
  type,
  text
}: {
  type: BulkImportType
  text: string
}): { ok: true; rows: BulkImportRowData[] } | { ok: false; error: string } => {
  const sanitizedText = text.replace(/^\uFEFF/, '')
  if (!sanitizedText.trim()) {
    return { ok: false, error: 'This file is empty' }
  }

  let rawRows: string[][]
  try {
    rawRows = parse(sanitizedText, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true
    }) as string[][]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Invalid CSV file: ${message}` }
  }

  const nonEmptyRows = rawRows.filter((row) =>
    row.some((cell) => cell.trim().length > 0)
  )
  if (nonEmptyRows.length === 0) {
    return { ok: false, error: 'This file is empty' }
  }

  const firstCell = nonEmptyRows[0][0]?.trim()
  const hasHeaderRow =
    firstCell !== undefined && KNOWN_FIRST_HEADERS.includes(firstCell)

  const headers = hasHeaderRow
    ? nonEmptyRows[0].map((h) => (h ?? '').trim())
    : DEFAULT_HEADERS[type]

  const dataRows = hasHeaderRow ? nonEmptyRows.slice(1) : nonEmptyRows

  const isCompatible = DEFAULT_HEADERS[type].every((h) => headers.includes(h))
  if (!isCompatible) {
    return {
      ok: false,
      error: 'This file does not match the selected import type'
    }
  }

  if (dataRows.length > BULK_IMPORT_ROWS_LIMIT) {
    return {
      ok: false,
      error: `You can import up to ${BULK_IMPORT_ROWS_LIMIT} rows at a time`
    }
  }

  const expectedHeaders = EXPECTED_HEADERS_BY_TYPE[type]
  const headerIndices: { header: string; index: number }[] = []
  for (const expectedHeader of expectedHeaders) {
    const index = headers.indexOf(expectedHeader)
    if (index !== -1) {
      headerIndices.push({ header: expectedHeader, index })
    }
  }

  const rows: BulkImportRowData[] = []
  for (const dataRow of dataRows) {
    const rowData: BulkImportRowData = {}
    for (const { header, index } of headerIndices) {
      const rawVal = dataRow[index]
      switch (header) {
        case 'Account address': {
          rowData.acct = (rawVal ?? '').trim().replace(/^@/, '')
          break
        }
        case 'Show boosts': {
          rowData.show_reblogs = convertBoolean(rawVal)
          break
        }
        case 'Notify on new posts': {
          rowData.notify = convertBoolean(rawVal)
          break
        }
        case 'Hide notifications': {
          rowData.hide_notifications = convertBoolean(rawVal)
          break
        }
        case 'Languages': {
          rowData.languages = convertLanguages(rawVal)
          break
        }
        case '#domain': {
          rowData.domain = (rawVal ?? '').trim().toLowerCase()
          break
        }
        case '#uri': {
          rowData.uri = (rawVal ?? '').trim()
          break
        }
        case 'List name': {
          rowData.list_name = (rawVal ?? '').trim()
          break
        }
      }
    }
    rows.push(rowData)
  }

  return { ok: true, rows }
}
