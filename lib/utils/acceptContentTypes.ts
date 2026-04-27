export type AcceptedContentType = {
  type: string
  parameters: Record<string, string>
  quality: number
  specificity: number
  index: number
}

const splitHeaderValue = (value: string, delimiter: ',' | ';') => {
  const items: string[] = []
  let current = ''
  let inQuotes = false
  let escaped = false

  for (const character of value) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }

    if (character === '\\' && inQuotes) {
      current += character
      escaped = true
      continue
    }

    if (character === '"') {
      inQuotes = !inQuotes
    }

    if (character === delimiter && !inQuotes) {
      items.push(current)
      current = ''
    } else {
      current += character
    }
  }

  items.push(current)
  return items
}

const unquote = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"')
  }

  return trimmed
}

const parseQuality = (value: string | undefined) => {
  if (value === undefined) return 1

  const quality = Number.parseFloat(value)
  if (!Number.isFinite(quality) || quality < 0 || quality > 1) return null

  return quality
}

const specificityFor = (type: string) => {
  const [, subtype] = type.split('/')
  if (type === '*/*') return 0
  if (subtype === '*') return 1
  return 2
}

export const parseAcceptContentTypes = (
  acceptHeaderValue: string
): AcceptedContentType[] => {
  return splitHeaderValue(acceptHeaderValue, ',')
    .map((item, index) => {
      const [rawType, ...rawParameters] = splitHeaderValue(item, ';')
      const type = rawType.trim().toLowerCase()
      if (!/^[^\s/;]+\/[^\s/;]+$/.test(type)) return null

      const parameters = rawParameters.reduce<Record<string, string>>(
        (params, parameter) => {
          const equalsIndex = parameter.indexOf('=')
          if (equalsIndex === -1) return params

          const name = parameter.slice(0, equalsIndex).trim().toLowerCase()
          const value = parameter.slice(equalsIndex + 1)
          if (!name) return params

          return {
            ...params,
            [name]: unquote(value)
          }
        },
        {}
      )
      const quality = parseQuality(parameters.q)
      if (quality === null || quality === 0) return null

      const { q: _quality, ...contentParameters } = parameters

      return {
        type,
        parameters: contentParameters,
        quality,
        specificity: specificityFor(type),
        index
      }
    })
    .filter((item): item is AcceptedContentType => item !== null)
    .sort((left, right) => {
      if (left.quality !== right.quality) return right.quality - left.quality
      if (left.specificity !== right.specificity) {
        return right.specificity - left.specificity
      }
      return left.index - right.index
    })
}

export const acceptContentTypes = (acceptHeaderValue: string) => {
  return parseAcceptContentTypes(acceptHeaderValue).map((item) => item.type)
}
