import { afterEach, beforeEach } from '@jest/globals'

import { resetRuntimeConfigFileCacheForTests } from '@/lib/config/runtimeConfigFile'
import { resetTrustProxyIpHeadersConfigCacheForTests } from '@/lib/config/trustProxyIpHeaders'
import { resetContentSecurityPolicyCacheForTests } from '@/lib/utils/securityHeaders'

beforeEach(() => {
  resetRuntimeConfigFileCacheForTests()
  resetTrustProxyIpHeadersConfigCacheForTests()
  resetContentSecurityPolicyCacheForTests()
})

afterEach(() => {
  resetRuntimeConfigFileCacheForTests()
  resetTrustProxyIpHeadersConfigCacheForTests()
  resetContentSecurityPolicyCacheForTests()
})
