import { Status } from './models/status'

interface CreateStatusParams {
  message: string
  replyStatus?: Status
}
export const createStatus = async ({
  message,
  replyStatus
}: CreateStatusParams) => {
  const response = await fetch('/api/v1/accounts/outbox', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      replyStatus,
      message
    })
  })
  if (response.status !== 200) {
    // Create or throw an error here
    return
  }

  const json = await response.json()
  return json.status as Status
}

interface GetAppleSharedGalleryParams {
  albumToken: string
}
export const getAppleSharedGallery = async ({
  albumToken
}: GetAppleSharedGalleryParams) => {
  const response = await fetch(`/api/v1/medias/apple/${albumToken}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) {
    // Create or throw an error here
    return
  }

  return await response.json()
}
