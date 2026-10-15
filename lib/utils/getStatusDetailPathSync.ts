import { Status } from '@/lib/types/domain/status'
import { buildStatusDetailPath } from '@/lib/utils/buildStatusDetailPath'
import { getHashFromStringSync } from '@/lib/utils/getHashFromStringClient'

// Browser-safe sync twin of getStatusDetailPath: same output, pure-JS sha256.
export const getStatusDetailPathSync = (status: Status) =>
  buildStatusDetailPath(status, getHashFromStringSync)
