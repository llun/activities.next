const stripQueryAndHash = (value: string): string =>
  value.replace(
    /([a-z][a-z0-9+.-]*:\/\/[^\s?#)]+|\/[^\s?#)]*)[?#][^\s)]*/gi,
    (match, resource: string) => {
      const coordinates = match.match(/:\d+:\d+$/)?.[0] ?? ''
      return `${resource}${coordinates}`
    }
  )

export const sanitiseClientErrorText = (value: string): string =>
  stripQueryAndHash(value)

export const sanitiseClientErrorStack = (value: string): string =>
  sanitiseClientErrorText(value)
    .split('\n')
    .map((line) => {
      const frame = line.match(/^(.*?)@(.+:\d+:\d+)$/)
      return frame ? `    at ${frame[1] || '<anonymous>'} (${frame[2]})` : line
    })
    .join('\n')
