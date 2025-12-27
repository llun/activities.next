import * as jsonld from 'jsonld'

import { ACTIVITY_STREAM_CONTEXT, ACTIVITY_STREAM_URL } from './activitystream'
import { LITEPUB_CONTEXT, LITEPUB_URL } from './litepub'
import { W3ID_CONTEXT, W3ID_URL } from './w3id'

// JSON-LD document can be any valid JSON structure
type JsonLdDocument = Record<string, unknown> & {
  '@context'?: unknown
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const customJsonLD = jsonld as any
const nodeDocumentLoader = customJsonLD.documentLoaders.node()

export const compact = async (document: JsonLdDocument) => {
  const context = { '@context': document['@context'] }
  const compactedActivity = await jsonld.compact(document, context, {
    async documentLoader(url) {
      switch (url) {
        case ACTIVITY_STREAM_URL: {
          return {
            contextUrl: null,
            document: ACTIVITY_STREAM_CONTEXT,
            documentUrl: url
          }
        }
        case W3ID_URL: {
          return {
            contextUrl: null,
            document: W3ID_CONTEXT,
            documentUrl: url
          }
        }
        case LITEPUB_URL: {
          return {
            contextUrl: null,
            document: LITEPUB_CONTEXT,
            documentUrl: url
          }
        }
        default: {
          return nodeDocumentLoader(url)
        }
      }
    }
  })
  return compactedActivity as unknown
}
