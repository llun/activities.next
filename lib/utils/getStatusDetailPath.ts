import { Status } from '@/lib/types/domain/status'
import { buildStatusDetailPath } from '@/lib/utils/buildStatusDetailPath'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// Server twin of getStatusDetailPathClient (node crypto digest). Browser code
// must not import this file; see getStatusDetailPathSync.
export const getStatusDetailPath = (status: Status) =>
  buildStatusDetailPath(status, getHashFromString)
