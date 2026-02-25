export const getStravaArchiveImportBatchId = (archiveId: string) =>
  `strava-archive:${archiveId}`

export const getStravaArchiveSourceBatchId = (archiveId: string) =>
  `strava-archive-source:${archiveId}`
