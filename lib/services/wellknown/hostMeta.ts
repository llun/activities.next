import { getBaseURL } from '@/lib/config'
import { escapeHtml } from '@/lib/utils/text/escapeHtml'

// `baseURL` defaults to the configured host, but the route passes the origin
// of the (trusted) host the request arrived on: a server discovered on a
// second domain must point WebFinger at that domain, not the primary one.
// Built with the configured scheme, like every other advertised URL.
//
// Escaped because the URL parser keeps `"`, `'` and `&` in a hostname, and a
// wildcard `ACTIVITIES_TRUSTED_HOSTS` rule matches such a host, so a request
// host could otherwise break out of the attribute. (The escapes `escapeHtml`
// emits are all valid XML.)
export const getHostMetaXML = (baseURL: string = getBaseURL()): string => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
  <Link rel="lrdd" template="${escapeHtml(baseURL)}/.well-known/webfinger?resource={uri}"/>
</XRD>`
}
