import { getConfig } from '@/lib/config'

export interface NodeInfoLink {
  rel: string
  href: string
}

export interface NodeInfoLinks {
  links: NodeInfoLink[]
}

export const getNodeInfoLinks = (): NodeInfoLinks => {
  const config = getConfig()
  return {
    links: [
      {
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
        href: `https://${config.host}/.well-known/nodeinfo/2.0`
      }
    ]
  }
}
