// @vitest-size medium
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('activities.next Node.js 26 workflow and image pins', () => {
  it('builds Dockerfile from node:26-alpine', () => {
    const dockerfile = readFileSync('Dockerfile', 'utf8')

    expect(dockerfile).toMatch(/^FROM node:26-alpine AS base$/m)
    expect(dockerfile).not.toContain('node:24')
  })

  it.each([
    {
      description: 'ci.yml',
      path: '.github/workflows/ci.yml',
      expectedCount: 7
    },
    {
      description: 'version-bump.yml',
      path: '.github/workflows/version-bump.yml',
      expectedCount: 1
    }
  ])(
    'pins every setup-node step in $description to Node 26',
    ({ path, expectedCount }) => {
      const workflow = readFileSync(path, 'utf8')
      const setupBlocks = Array.from(
        workflow.matchAll(
          /uses:[ \t]*actions\/setup-node@v\d+\n(?:[ \t]+with:\n(?:[ \t]{10,}.+\n)+)/g
        )
      ).map((match) => match[0])

      expect(setupBlocks).toHaveLength(expectedCount)
      for (const block of setupBlocks) {
        expect(block).toMatch(/^[ \t]+node-version:[ \t]*26$/m)
      }
      expect(workflow).not.toMatch(/node-version:\s*24\b/)
      expect(workflow).not.toContain('Use Node.js 24')
    }
  )

  it('documents Node.js 26 in AGENTS.md without stale Node.js 24 pins', () => {
    const agentsDoc = readFileSync('AGENTS.md', 'utf8')

    expect(agentsDoc).toContain('Node.js 26')
    expect(agentsDoc).not.toContain('Node.js 24')
  })
})
