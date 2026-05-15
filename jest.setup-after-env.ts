import { afterEach, beforeEach } from '@jest/globals'

import { resetRuntimeConfigFileCacheForTests } from '@/lib/config/runtimeConfigFile'
import { resetContentSecurityPolicyCacheForTests } from '@/lib/utils/securityHeaders'

beforeEach(() => {
  resetRuntimeConfigFileCacheForTests()
  resetContentSecurityPolicyCacheForTests()
})

afterEach(() => {
  resetRuntimeConfigFileCacheForTests()
  resetContentSecurityPolicyCacheForTests()
})
