import * as jsonld from 'jsonld'

import { CONTEXT } from './models/activitystream.context'

const customJsonLD = jsonld as any
const nodeDocumentLoader = customJsonLD.documentLoaders.node()

export const compact = async (document: any) => {
  const context = {
    '@context': 'https://www.w3.org/ns/activitystreams'
  }
  const compactedActivity = await jsonld.compact(document, context, {
    async documentLoader(url) {
      if (url === 'https://www.w3.org/ns/activitystreams') {
        return {
          contextUrl: null, // this is for a context via a link header
          document: CONTEXT, // this is the actual document that was loaded
          documentUrl: url // this is the actual context URL after redirects
        }
      }
      return nodeDocumentLoader(url)
    }
  })
  return compactedActivity as unknown
}
