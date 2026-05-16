import { afterEach, beforeEach } from '@jest/globals'

import { resetTrustProxyIpHeadersConfigCacheForTests } from '@/lib/config/trustProxyIpHeaders'
import { resetContentSecurityPolicyCacheForTests } from '@/lib/utils/securityHeaders'

beforeEach(() => {
  resetTrustProxyIpHeadersConfigCacheForTests()
  resetContentSecurityPolicyCacheForTests()
})

afterEach(() => {
  resetTrustProxyIpHeadersConfigCacheForTests()
  resetContentSecurityPolicyCacheForTests()
})
