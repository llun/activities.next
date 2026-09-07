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

  it('avoids TDZ when a job module that depends on queue is imported directly', async () => {
    const { createNoteJob } = await import('./createNoteJob')
    expect(createNoteJob).toBeDefined()
    expect(typeof createNoteJob).toBe('function')
  })
})
