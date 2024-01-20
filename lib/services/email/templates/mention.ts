import { getConfig } from '@/lib/config'
import { ActorProfile } from '@/lib/models/actor'
import { StatusData } from '@/lib/models/status'

export const getSubject = (actor: ActorProfile) =>
  `@${actor.username} mentions you in ${getConfig().host}`

export const getTextContent = (status: StatusData) =>
  `
URL: ${status.url}
Message: ${status.text}
`.trim()

export const getHTMLContent = (status: StatusData) =>
  `
<p>${status.text}</p>
<p>At: ${status.url}</p>
`.trim()
