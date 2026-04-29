import { Database } from '@/lib/database/types'
import { Status, StatusType } from '@/lib/types/domain/status'

interface ResolveStatusFromPathParams {
  database: Pick<
    Database,
    'getActorFromUsername' | 'getStatus' | 'getStatusFromUrlHash'
  >
  actorParam: string
  statusParam: string
}

interface ResolveStatusFromPathResult {
  status: Status | null
  statusId: string
  fullStatusId: string
  isStatusHash: boolean
}

const decodeParam = (param: string) => {
  try {
    return decodeURIComponent(param)
  } catch {
    return param
  }
}

const getStatusOwnerActorId = (status: Status) =>
  status.type === StatusType.enum.Announce
    ? status.originalStatus.actorId
    : status.actorId

export const resolveStatusFromPath = async ({
  database,
  actorParam,
  statusParam
}: ResolveStatusFromPathParams): Promise<ResolveStatusFromPathResult | null> => {
  const decodedActor = decodeURIComponent(actorParam)
  const decodedStatusParam = decodeParam(statusParam)

  const parts = decodedActor.split('@').slice(1)
  if (parts.length !== 2) {
    return null
  }

  const [username, domain] = parts
  const actorFromPath = await database.getActorFromUsername({
    username,
    domain
  })
  const actorIdFromPath = actorFromPath?.id
  const isStatusHash = /^[a-f0-9]{64}$/i.test(decodedStatusParam)

  const protocol = domain.startsWith('localhost') ? 'http' : 'https'
  const isFullStatusUrl = /^https?:\/\//.test(decodedStatusParam)
  const fullStatusId = isFullStatusUrl
    ? decodedStatusParam
    : `${protocol}://${domain}/users/${username}/statuses/${decodedStatusParam}`

  let status: Status | null = null
  let statusId = ''

  if (isStatusHash) {
    status = await database.getStatusFromUrlHash({
      urlHash: decodedStatusParam,
      actorId: actorIdFromPath
    })

    if (!status && actorIdFromPath) {
      const unscopedStatus = await database.getStatusFromUrlHash({
        urlHash: decodedStatusParam
      })

      if (
        unscopedStatus &&
        getStatusOwnerActorId(unscopedStatus) === actorIdFromPath
      ) {
        status = unscopedStatus
      }
    }

    statusId = status?.id ?? ''
  }

  if (!status) {
    status = await database.getStatus({
      statusId: fullStatusId,
      withReplies: false
    })
    statusId = status?.id ?? ''
  }

  if (!status && !isFullStatusUrl) {
    status = await database.getStatus({
      statusId: decodedStatusParam,
      withReplies: false
    })
    statusId = status?.id ?? ''
  }

  return {
    status,
    statusId,
    fullStatusId,
    isStatusHash
  }
}
