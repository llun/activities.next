import { afterEach, beforeEach } from '@jest/globals'

import { resetTrustProxyIpHeadersConfigCacheForTests } from '@/lib/config/trustProxyIpHeaders'
// Direct sub-path import required: the barrel loads cors.ts which imports
// @/lib/config, interfering with per-test module mock isolation.
import { resetContentSecurityPolicyCacheForTests } from '@/lib/utils/http-headers/csp'

beforeEach(() => {
  resetTrustProxyIpHeadersConfigCacheForTests()
  resetContentSecurityPolicyCacheForTests()
})

afterEach(() => {
  resetTrustProxyIpHeadersConfigCacheForTests()
  resetContentSecurityPolicyCacheForTests()
})
