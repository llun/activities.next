import { getConfig } from '@/lib/config'
import { ActorProfile } from '@/lib/models/actor'
import { EditableStatus } from '@/lib/models/status'

export const getSubject = (actor: ActorProfile) =>
  `@${actor.username} mentions you in ${getConfig().host}`

export const getTextContent = (status: EditableStatus) =>
  `
URL: ${status.url}
Message: ${status.text}
`.trim()

export const getHTMLContent = (status: EditableStatus) =>
  `
<p>${status.text}</p>
<p>At: ${status.url}</p>
`.trim()
