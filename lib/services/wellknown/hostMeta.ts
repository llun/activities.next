import { getConfig } from '@/lib/config'

export const getHostMetaXML = (): string => {
  const config = getConfig()
  return `<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
  <Link rel="lrdd" template="https://${config.host}/.well-known/webfinger?resource={uri}"/>
</XRD>`
}
