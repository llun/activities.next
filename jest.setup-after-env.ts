import { afterEach, beforeEach } from '@jest/globals'

import { resetContentSecurityPolicyCacheForTests } from '@/lib/utils/securityHeaders'

beforeEach(() => {
  resetContentSecurityPolicyCacheForTests()
})

afterEach(() => {
  resetContentSecurityPolicyCacheForTests()
})
