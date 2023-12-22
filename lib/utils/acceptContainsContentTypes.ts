import { acceptContentTypes } from './acceptContentTypes'

export const acceptContainsContentTypes = (
  acceptHeaderValue: string,
  contentTypes: string[]
) => {
  const accepts = acceptContentTypes(acceptHeaderValue)
  return accepts.filter((item) => contentTypes.includes(item)).length > 0
}
