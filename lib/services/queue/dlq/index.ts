import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'

import { DatabaseDLQProvider } from './database'
import { QStashDLQProvider } from './qstash'
import { DLQProvider } from './types'

export * from './types'
export { DatabaseDLQProvider } from './database'
export { QStashDLQProvider } from './qstash'

export const getDLQProvider = memoize((): DLQProvider => {
  const config = getConfig()
  if (config.queue?.type === 'qstash') {
    return new QStashDLQProvider(config.queue)
  }
  return new DatabaseDLQProvider()
})
