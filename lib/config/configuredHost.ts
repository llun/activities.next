import { getConfig } from '@/lib/config'
import { getConfiguredHostFromValue } from '@/lib/config/host'

export const getConfiguredHost = () =>
  getConfiguredHostFromValue(getConfig().host)
