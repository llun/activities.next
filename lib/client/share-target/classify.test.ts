import { describe, expect, it } from 'vitest'

import {
  type ShareTargetLimits,
  classifySharedFiles,
  describeSharedFiles,
  describeSkippedFiles,
  getMediaAttachmentCap,
  hasSkippedFiles,
  isFitnessShareFile,
  isMediaShareFile,
  joinSharedText
} from './classify'

const limits: ShareTargetLimits = {
  maxMediaFileSize: 10 * 1024 * 1024,
  maxFitnessFileSize: 50 * 1024 * 1024,
  maxMediaAttachments: 4,
  isMediaUploadEnabled: true
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

  // The upload route requires a fitness extension, so a type alone (a bare
  // `text/xml`, or a FIT type on a name without one) is not a workout.
  it.each([
    ['download', 'application/vnd.ant.fit'],
    ['notes.xml', 'text/xml'],
    ['data.xml', 'application/xml']
  ])('rejects %s (%s) without a fitness extension', (name, type) => {
    expect(isFitnessShareFile(file(name, type))).toBe(false)
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

  // The share seed must not upload behind a server that takes no media.
  it('skips media when media uploads are off, keeping the workout', () => {
    const plan = classifySharedFiles(
      [file('a.jpg', 'image/jpeg'), file('run.fit', '')],
      { ...limits, isMediaUploadEnabled: false }
    )

    expect(plan.kind).toBe('composer')
    if (plan.kind !== 'composer') return
    expect(plan.media).toEqual([])
    expect(plan.fitnessFile?.name).toBe('run.fit')
    expect(plan.skipped.uploadsOff).toBe(1)
    expect(describeSkippedFiles(plan.skipped)).toBe(
      '1 shared file was skipped: 1 photo or video because this server takes no media uploads.'
    )
  })

  it('returns empty when nothing can be attached', () => {
    const plan = classifySharedFiles([file('a.heic', 'image/heic')], limits)

    expect(plan.kind).toBe('empty')
    expect(plan.skipped.unsupported).toBe(1)
  })
})

describe('describeSharedFiles', () => {
  it('counts photos, videos and the workout', () => {
    expect(
      describeSharedFiles(
        [
          file('a.jpg', 'image/jpeg'),
          file('b.jpg', 'image/jpeg'),
          file('c.mp4', 'video/mp4')
        ],
        file('run.fit', '')
      )
    ).toBe('2 photos, 1 video and 1 workout were shared')
    expect(describeSharedFiles([file('a.jpg', 'image/jpeg')])).toBe(
      '1 photo was shared'
    )
    expect(describeSharedFiles([], file('run.fit', ''))).toBe(
      '1 workout was shared'
    )
  })

  it('names a shared link or text, alone or with files', () => {
    expect(describeSharedFiles([], undefined, 'https://example.com/a')).toBe(
      'A link was shared'
    )
    expect(describeSharedFiles([], undefined, 'Great run today')).toBe(
      'Some text was shared'
    )
    expect(
      describeSharedFiles(
        [file('a.jpg', 'image/jpeg')],
        undefined,
        'https://example.com/a'
      )
    ).toBe('1 photo and a link were shared')
  })
})

describe('joinSharedText', () => {
  it('puts the title, text and link on their own lines', () => {
    expect(
      joinSharedText({
        title: 'Morning run',
        text: 'Felt good',
        url: 'https://example.com/r/1'
      })
    ).toBe('Morning run\nFelt good\nhttps://example.com/r/1')
  })

  // Browsers often send the page URL in both `text` and `url`.
  it('does not repeat a link or title the text already holds', () => {
    expect(
      joinSharedText({
        title: 'Example',
        text: 'Example https://example.com/a',
        url: 'https://example.com/a'
      })
    ).toBe('Example https://example.com/a')
  })

  it('keeps a bare link, and returns nothing for nothing', () => {
    expect(joinSharedText({ url: ' https://example.com/a ' })).toBe(
      'https://example.com/a'
    )
    expect(joinSharedText({})).toBe('')
  })
})

describe('describeSkippedFiles', () => {
  // The worker refused these before staging (StagedShare.skipped).
  it('names the files the worker could not keep', () => {
    expect(
      describeSkippedFiles({
        unsupported: 0,
        tooLarge: 0,
        overLimit: 0,
        uploadsOff: 0,
        notStaged: 2
      })
    ).toBe(
      '2 shared files were skipped: 2 files were past the share limit of 20 files and 250 MB.'
    )
  })

  it('returns null when nothing was skipped', () => {
    expect(
      describeSkippedFiles({
        unsupported: 0,
        tooLarge: 0,
        overLimit: 0,
        uploadsOff: 0,
        notStaged: 0
      })
    ).toBeNull()
  })

  it('names the count and the reason', () => {
    expect(
      describeSkippedFiles({
        unsupported: 1,
        tooLarge: 0,
        overLimit: 0,
        uploadsOff: 0,
        notStaged: 0
      })
    ).toBe(
      "1 shared file was skipped: 1 file has a type the composer can't attach."
    )

    expect(
      describeSkippedFiles({
        unsupported: 0,
        tooLarge: 2,
        overLimit: 1,
        uploadsOff: 0,
        notStaged: 0
      })
    ).toBe(
      '3 shared files were skipped: 2 files are over the size limit; 1 file was over the attachment limit.'
    )
  })
})
