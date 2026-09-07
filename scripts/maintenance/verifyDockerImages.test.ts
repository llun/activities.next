import { describe, expect, it } from 'vitest'

import { parseArgs } from './verifyDockerImages'

describe('verifyDockerImages parseArgs', () => {
  it('returns default options when no args are provided', () => {
    const opts = parseArgs([])
    expect(opts).toEqual({
      minimalImage: 'activities:test-minimal',
      fullImage: 'activities:test-full',
      build: false,
      port: undefined,
      help: false
    })
  })

  it('respects environment variables for default image tags', () => {
    const originalMin = process.env.MINIMAL_IMAGE
    const originalFull = process.env.FULL_IMAGE
    try {
      process.env.MINIMAL_IMAGE = 'custom:min'
      process.env.FULL_IMAGE = 'custom:full'
      const opts = parseArgs([])
      expect(opts.minimalImage).toBe('custom:min')
      expect(opts.fullImage).toBe('custom:full')
    } finally {
      process.env.MINIMAL_IMAGE = originalMin
      process.env.FULL_IMAGE = originalFull
    }
  })

  it('parses --minimal-image and --full-image flags with spaces', () => {
    const opts = parseArgs([
      '--minimal-image',
      'my-image:min',
      '--full-image',
      'my-image:full'
    ])
    expect(opts.minimalImage).toBe('my-image:min')
    expect(opts.fullImage).toBe('my-image:full')
  })

  it('parses --minimal-image and --full-image flags with equals', () => {
    const opts = parseArgs([
      '--minimal-image=my-image:min',
      '--full-image=my-image:full'
    ])
    expect(opts.minimalImage).toBe('my-image:min')
    expect(opts.fullImage).toBe('my-image:full')
  })

  it('parses --build and --skip-build flags', () => {
    expect(parseArgs(['--build']).build).toBe(true)
    expect(parseArgs(['--skip-build']).build).toBe(false)
  })

  it('parses --port flag', () => {
    expect(parseArgs(['--port', '3500']).port).toBe(3500)
    expect(parseArgs(['--port=3600']).port).toBe(3600)
  })

  it('parses help flags', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
  })
})
