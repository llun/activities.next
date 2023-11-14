import { getConfig } from '../../../../lib/config'

export const GET = async () => {
  const config = getConfig()

  return Response.json({
    links: [
      {
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
        href: `https://${config.host}/.well-known/nodeinfo/2.0`
      }
    ]
  })
}
