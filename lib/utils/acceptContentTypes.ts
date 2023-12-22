import contentType from 'content-type'

export const acceptContentTypes = (acceptHeaderValue: string) => {
  return acceptHeaderValue
    .split(',')
    .map((item) => item.trim())
    .map((item) => contentType.parse(item).type)
}
