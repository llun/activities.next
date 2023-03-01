import contentType from 'content-type'

export const acceptContentTypes = (acceptHeaderValue: string) => {
  return acceptHeaderValue
    .split(',')
    .map((item) => item.trim())
    .map((item) => contentType.parse(item).type)
}

export const acceptContainsContentTypes = (
  acceptHeaderValue: string,
  contentTypes: string[]
) => {
  const accepts = acceptContentTypes(acceptHeaderValue)
  return accepts.filter((item) => contentTypes.includes(item)).length > 0
}
