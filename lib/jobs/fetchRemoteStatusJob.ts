import { z } from 'zod'

import { fetchAndStoreRemoteStatus } from '@/lib/actions/fetchRemoteStatus'

import { createJobHandle } from './createJobHandle'
import { FETCH_REMOTE_STATUS_JOB_NAME } from './names'

const FetchRemoteStatusJobData = z.object({
  statusUrl: z.string()
})

export const fetchRemoteStatusJob = createJobHandle(
  FETCH_REMOTE_STATUS_JOB_NAME,
  async (database, message) => {
    const data = FetchRemoteStatusJobData.parse(message.data)
    await fetchAndStoreRemoteStatus(database, data.statusUrl)
  }
)
