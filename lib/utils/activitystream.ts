export const ACTIVITY_STREAM_URL = 'https://www.w3.org/ns/activitystreams'
export const ACTIVITY_STREAM_PUBLIC =
  'https://www.w3.org/ns/activitystreams#Public'
export const ACTIVITY_STREAM_PUBLIC_COMPACT = 'as:Public'

// FEP-7aa9 "featured collections" vocabulary namespace. Referenced as a context
// URL on outbound FeaturedCollection documents (and the actor's
// `featuredCollections` property) so peers can resolve the extension terms
// (`FeaturedCollection`, `FeaturedItem`, `featuredObject`, `featuredObjectType`).
// https://w3id.org/fep/7aa9
export const FEP_7AA9_CONTEXT_URL = 'https://w3id.org/fep/7aa9'
