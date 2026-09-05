import { describe, expect, it } from 'vitest'

import { dynamicImport } from './dynamicImport'

describe('dynamicImport', () => {
  it('imports an existing module specifier dynamically', async () => {
    const nodePath =
      await dynamicImport<typeof import('node:path')>('node:path')
    expect(nodePath).toBeDefined()
    expect(typeof nodePath.join).toBe('function')
  })

  it('rejects when module does not exist', async () => {
    await expect(dynamicImport('non-existent-module-xyz-123')).rejects.toThrow()
  })
})
