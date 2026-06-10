import { acceptContentTypes } from './acceptContentTypes'

export const acceptContainsContentTypes = (
  acceptHeaderValue: string,
  contentTypes: string[]
) => {
  const accepts = acceptContentTypes(acceptHeaderValue)
  return accepts.some((item) => contentTypes.includes(item))
}
