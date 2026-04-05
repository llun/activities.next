import { getConfig } from '@/lib/config'

export const getSubject = () =>
  `Your fitness activity was imported in ${getConfig().host}`

export const getTextContent = () =>
  `
Your Strava fitness activity has been imported and is ready to view.
`.trim()

export const getHTMLContent = () =>
  `
<p>Your Strava fitness activity has been imported and is ready to view.</p>
`.trim()
