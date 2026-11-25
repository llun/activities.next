import { JOBS } from '@/lib/jobs'

import { type JobRegistryLoader, defaultJobHandle } from './base'

// For a runner a script starts under tsx/cjs, where base.ts's lazy
// `import('@/lib/jobs')` cannot resolve the `@/` alias. Importing this loads
// every job up front, so only scripts import it; the app keeps the lazy loader.
export const loadStaticJobRegistry: JobRegistryLoader = async () => JOBS

export const createStaticJobHandle = (queueName: string) =>
  defaultJobHandle(queueName, loadStaticJobRegistry)
