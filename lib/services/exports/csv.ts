const CSV_SPECIAL_CHARS = /[",\r\n]/

export const escapeCsvField = (
  field: string | boolean | null | undefined
): string => {
  if (field === null || field === undefined) {
    return ''
  }
  if (typeof field === 'boolean') {
    return field ? 'true' : 'false'
  }
  if (field === '') {
    return '""'
  }
  if (CSV_SPECIAL_CHARS.test(field)) {
    return `"${field.replaceAll('"', '""')}"`
  }
  return field
}

export const toCsvRow = (
  fields: (string | boolean | null | undefined)[]
): string => {
  return `${fields.map(escapeCsvField).join(',')}\n`
}

export const formatLanguages = (
  languages: string[] | null | undefined
): string | null => {
  if (!languages || languages.length === 0) {
    return null
  }
  return languages.join(', ')
}
