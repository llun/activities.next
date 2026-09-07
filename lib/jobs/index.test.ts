import { execFileSync } from 'node:child_process'

import { JOBS } from '@/lib/jobs'
import * as jobNames from '@/lib/jobs/names'

describe('JOBS registry', () => {
  it('registers all known job names as own property getters returning functions', () => {
    const names = Object.values(jobNames)
    expect(names.length).toBeGreaterThan(0)

    for (const name of names) {
      expect(Object.prototype.hasOwnProperty.call(JOBS, name)).toBe(true)
      expect(typeof JOBS[name]).toBe('function')
    }
  })

  it('avoids TDZ when createNoteJob is the initial entry point in a fresh process', () => {
    expect(() => {
      execFileSync(
        process.execPath,
        ['-r', 'tsx/cjs', '-e', 'require("./lib/jobs/createNoteJob.ts")'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      )
    }).not.toThrow()
  })
})
