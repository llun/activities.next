import { describe, expect, it } from 'vitest'

import {
  type ShareTargetLimits,
  classifySharedFiles,
  describeSkippedFiles,
  getMediaAttachmentCap,
  hasSkippedFiles,
  isFitnessShareFile,
  isMediaShareFile
} from './classify'

const limits: ShareTargetLimits = {
  maxMediaFileSize: 10 * 1024 * 1024,
  maxFitnessFileSize: 50 * 1024 * 1024,
  maxMediaAttachments: 4
}

const file = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type })

describe('isFitnessShareFile', () => {
  it.each(['run.fit', 'route.gpx', 'ride.tcx', 'RUN.FIT'])(
    'recognises %s by extension',
    (name) => {
      expect(isFitnessShareFile(file(name, 'application/octet-stream'))).toBe(
        true
      )
    }
  )

  it('recognises a fitness MIME type without a known extension', () => {
    expect(
      isFitnessShareFile(file('download', 'application/vnd.ant.fit'))
    ).toBe(true)
  })

  it('rejects a photo', () => {
    expect(isFitnessShareFile(file('photo.jpg', 'image/jpeg'))).toBe(false)
  })
})

describe('isMediaShareFile', () => {
  it('accepts the composer image and video types', () => {
    expect(isMediaShareFile(file('a.jpg', 'image/jpeg'))).toBe(true)
    expect(isMediaShareFile(file('a.mp4', 'video/mp4'))).toBe(true)
  })

  it('rejects HEIC, which the composer cannot attach', () => {
    expect(isMediaShareFile(file('a.heic', 'image/heic'))).toBe(false)
  })
})

describe('getMediaAttachmentCap', () => {
  it('leaves the route map slot when a workout is attached', () => {
    expect(getMediaAttachmentCap(4, true)).toBe(3)
    expect(getMediaAttachmentCap(4, false)).toBe(4)
  })

  it('never goes below zero', () => {
    expect(getMediaAttachmentCap(1, true)).toBe(0)
    expect(getMediaAttachmentCap(0, false)).toBe(0)
  })
})

describe('classifySharedFiles', () => {
  it('sends media to the composer', () => {
    const plan = classifySharedFiles(
      [file('a.jpg', 'image/jpeg'), file('b.png', 'image/png')],
      limits
    )

    expect(plan.kind).toBe('composer')
    if (plan.kind !== 'composer') return
    expect(plan.media.map((f) => f.name)).toEqual(['a.jpg', 'b.png'])
    expect(plan.fitnessFile).toBeUndefined()
    expect(hasSkippedFiles(plan.skipped)).toBe(false)
  })

  it('sends one workout to the composer', () => {
    const plan = classifySharedFiles(
      [file('run.fit', 'application/vnd.ant.fit')],
      limits
    )

    expect(plan.kind).toBe('composer')
    if (plan.kind !== 'composer') return
    expect(plan.fitnessFile?.name).toBe('run.fit')
    expect(plan.media).toEqual([])
  })

  it('sends one workout plus media to the composer, capped at one slot less', () => {
    const plan = classifySharedFiles(
      [
        file('run.fit', 'application/vnd.ant.fit'),
        file('a.jpg', 'image/jpeg'),
        file('b.jpg', 'image/jpeg'),
        file('c.jpg', 'image/jpeg'),
        file('d.jpg', 'image/jpeg')
      ],
      limits
    )

    expect(plan.kind).toBe('composer')
    if (plan.kind !== 'composer') return
    expect(plan.fitnessFile?.name).toBe('run.fit')
    expect(plan.media.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(plan.skipped.overLimit).toBe(1)
  })

  it('sends two or more workouts to the batch import and reports the photos', () => {
    const plan = classifySharedFiles(
      [
        file('run.fit', 'application/vnd.ant.fit'),
        file('ride.gpx', 'application/gpx+xml'),
        file('a.jpg', 'image/jpeg')
      ],
      limits
    )

    expect(plan.kind).toBe('import')
    if (plan.kind !== 'import') return
    expect(plan.fitnessFiles.map((f) => f.name)).toEqual([
      'run.fit',
      'ride.gpx'
    ])
    expect(plan.skippedMedia).toBe(1)
  })

  it('skips unsupported types and counts them', () => {
    const plan = classifySharedFiles(
      [file('a.heic', 'image/heic'), file('b.jpg', 'image/jpeg')],
      limits
    )

    expect(plan.kind).toBe('composer')
    if (plan.kind !== 'composer') return
    expect(plan.media.map((f) => f.name)).toEqual(['b.jpg'])
    expect(plan.skipped.unsupported).toBe(1)
  })

  it('skips files over the media and fitness size limits', () => {
    const plan = classifySharedFiles(
      [
        file('big.jpg', 'image/jpeg', limits.maxMediaFileSize + 1),
        file(
          'big.fit',
          'application/vnd.ant.fit',
          limits.maxFitnessFileSize + 1
        )
      ],
      limits
    )

    expect(plan.kind).toBe('empty')
    expect(plan.skipped.tooLarge).toBe(2)
  })

  it('returns empty when nothing can be attached', () => {
    const plan = classifySharedFiles([file('a.heic', 'image/heic')], limits)

    expect(plan.kind).toBe('empty')
    expect(plan.skipped.unsupported).toBe(1)
  })
})

describe('describeSkippedFiles', () => {
  it('returns null when nothing was skipped', () => {
    expect(
      describeSkippedFiles({ unsupported: 0, tooLarge: 0, overLimit: 0 })
    ).toBeNull()
  })

  it('names the count and the reason', () => {
    expect(
      describeSkippedFiles({ unsupported: 1, tooLarge: 0, overLimit: 0 })
    ).toBe(
      "1 shared file was skipped: 1 file has a type the composer can't attach."
    )

    expect(
      describeSkippedFiles({ unsupported: 0, tooLarge: 2, overLimit: 1 })
    ).toBe(
      '3 shared files were skipped: 2 files are over the size limit; 1 file was over the attachment limit.'
    )
  })
})
