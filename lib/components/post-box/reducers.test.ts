import { PostBoxAttachment } from '@/lib/types/domain/attachment'

import {
  addAttachment,
  addPollChoice,
  createDefaultState,
  removeAttachment,
  removeFitnessFile,
  removePollChoice,
  resetExtension,
  setAttachments,
  setContentWarning,
  setContentWarningVisibility,
  setFitnessFile,
  setFitnessFileUploaded,
  setFitnessFileUploading,
  setPollDurationInSeconds,
  setPollType,
  setPollVisibility,
  setQuoteApprovalPolicy,
  setVisibility,
  statusExtensionReducer,
  updateAttachment
} from './reducers'

describe('post-box reducers', () => {
  const attachment = (id: string): PostBoxAttachment => ({
    type: 'upload',
    id,
    mediaType: 'image/png',
    url: `https://llun.test/${id}.png`,
    width: 100,
    height: 100
  })

  // The cap used to be a build-time constant of 10, which silently overrode a
  // higher admin-configured posts.maxMediaAttachments.
  it('caps attachments at the limit carried on the action', () => {
    const state = {
      ...createDefaultState(),
      attachments: Array.from({ length: 10 }, (_, index) =>
        attachment(`media-${index}`)
      )
    }

    expect(
      statusExtensionReducer(state, addAttachment(attachment('media-10'), 20))
        .attachments
    ).toHaveLength(11)
    expect(
      statusExtensionReducer(state, addAttachment(attachment('media-10'), 10))
        .attachments
    ).toHaveLength(10)
  })

  it('disables poll mode when fitness file is attached', () => {
    const stateWithPoll = {
      ...createDefaultState(),
      poll: {
        ...createDefaultState().poll,
        showing: true
      }
    }

    const file = {
      name: 'activity.fit',
      size: 2048,
      type: 'application/vnd.ant.fit'
    } as File

    const nextState = statusExtensionReducer(
      stateWithPoll,
      setFitnessFile(file)
    )

    expect(nextState.poll.showing).toBe(false)
    expect(nextState.fitnessFile?.file).toBe(file)
    expect(nextState.visibility).toBe('private')
  })

  it('shows content warning input when text is set', () => {
    const nextState = statusExtensionReducer(
      createDefaultState(),
      setContentWarning('Spoilers')
    )

    expect(nextState.contentWarning).toBe('Spoilers')
    expect(nextState.contentWarningVisible).toBe(true)
  })

  it('keeps content warning text when visibility is turned off', () => {
    const stateWithWarning = statusExtensionReducer(
      createDefaultState(),
      setContentWarning('Spoilers')
    )

    const nextState = statusExtensionReducer(
      stateWithWarning,
      setContentWarningVisibility(false)
    )

    expect(nextState.contentWarning).toBe('Spoilers')
    expect(nextState.contentWarningVisible).toBe(false)
  })

  it('preserves compatible composer state when attachments are updated', () => {
    const file = {
      name: 'activity.fit',
      size: 2048,
      type: 'application/vnd.ant.fit'
    } as File
    const stateWithFitnessFile = statusExtensionReducer(
      {
        ...createDefaultState(),
        contentWarning: 'Spoilers',
        contentWarningVisible: true
      },
      setFitnessFile(file)
    )

    const nextState = statusExtensionReducer(
      stateWithFitnessFile,
      setAttachments([])
    )

    expect(nextState.contentWarning).toBe('Spoilers')
    expect(nextState.contentWarningVisible).toBe(true)
    expect(nextState.fitnessFile).toBe(stateWithFitnessFile.fitnessFile)
  })

  it('clears poll and fitness state when entering attachment mode', () => {
    const stateWithPoll = {
      ...createDefaultState(),
      poll: {
        ...createDefaultState().poll,
        showing: true
      },
      fitnessFile: {
        file: {
          name: 'activity.fit',
          size: 2048,
          type: 'application/vnd.ant.fit'
        } as File,
        uploading: false,
        uploadedId: 'fitness-file-id'
      }
    }

    const nextState = statusExtensionReducer(
      stateWithPoll,
      setAttachments([
        {
          type: 'upload',
          id: 'media-id',
          mediaType: 'image/png',
          url: 'https://llun.test/media.png',
          width: 100,
          height: 100
        }
      ])
    )

    expect(nextState.attachments).toHaveLength(1)
    expect(nextState.poll.showing).toBe(false)
    expect(nextState.fitnessFile).toBeUndefined()
  })

  it('clears incompatible modes while managing an existing attachment list', () => {
    const stateWithAttachments = {
      ...createDefaultState(),
      attachments: [
        {
          type: 'upload' as const,
          id: 'media-1',
          mediaType: 'image/png',
          url: 'https://llun.test/media-1.png',
          width: 100,
          height: 100
        },
        {
          type: 'upload' as const,
          id: 'media-2',
          mediaType: 'image/png',
          url: 'https://llun.test/media-2.png',
          width: 100,
          height: 100
        }
      ],
      contentWarning: 'Spoilers',
      contentWarningVisible: true,
      fitnessFile: {
        file: {
          name: 'activity.fit',
          size: 2048,
          type: 'application/vnd.ant.fit'
        } as File,
        uploading: false
      }
    }

    const nextState = statusExtensionReducer(
      stateWithAttachments,
      setAttachments(stateWithAttachments.attachments.slice(0, 1))
    )

    expect(nextState.attachments).toHaveLength(1)
    expect(nextState.contentWarning).toBe('Spoilers')
    expect(nextState.contentWarningVisible).toBe(true)
    expect(nextState.fitnessFile).toBeUndefined()
  })

  it('clears poll and fitness state when adding an attachment', () => {
    const stateWithPoll = {
      ...createDefaultState(),
      poll: {
        ...createDefaultState().poll,
        showing: true
      },
      fitnessFile: {
        file: {
          name: 'activity.fit',
          size: 2048,
          type: 'application/vnd.ant.fit'
        } as File,
        uploading: false
      }
    }

    const nextState = statusExtensionReducer(
      stateWithPoll,
      addAttachment(
        {
          type: 'upload',
          id: 'media-id',
          mediaType: 'image/png',
          url: 'https://llun.test/media.png',
          width: 100,
          height: 100
        },
        20
      )
    )

    expect(nextState.attachments).toHaveLength(1)
    expect(nextState.poll.showing).toBe(false)
    expect(nextState.fitnessFile).toBeUndefined()
  })

  // The poll editor's choice inputs are uncontrolled and write straight into
  // the Choice objects, so a shared default array would carry one draft's
  // options into the next poll — and into every other composer on the page.
  it('starts each reset from fresh poll choice objects', () => {
    const state = createDefaultState()
    state.poll.choices[0].text = 'SECRET'

    const afterReset = statusExtensionReducer(state, resetExtension())

    expect(afterReset.poll.choices.map((choice) => choice.text)).toEqual([
      '',
      ''
    ])
    expect(afterReset.poll.choices[0]).not.toBe(state.poll.choices[0])
    expect(createDefaultState().poll.choices[0].text).toBe('')
  })

  describe('setPollVisibility', () => {
    const withBlobs = () => ({
      ...createDefaultState(),
      attachments: [
        {
          ...attachment('a'),
          url: 'blob:preview-a',
          posterUrl: 'blob:poster-a'
        },
        attachment('b')
      ]
    })

    beforeEach(() => {
      global.URL.revokeObjectURL = vi.fn()
    })

    it.each([true, false])(
      'drops the attachments and revokes their blob URLs when visible is %s',
      (visible) => {
        const next = statusExtensionReducer(
          withBlobs(),
          setPollVisibility(visible)
        )

        expect(next.attachments).toEqual([])
        expect(next.poll.showing).toBe(visible)
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-a')
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:poster-a')
      }
    )
  })

  describe('poll choices', () => {
    it('appends an empty choice with a key distinct from the existing ones', () => {
      const state = createDefaultState()

      const next = statusExtensionReducer(state, addPollChoice(4))

      expect(next.poll.choices).toHaveLength(3)
      expect(next.poll.choices[2].text).toBe('')
      expect(new Set(next.poll.choices.map((choice) => choice.key)).size).toBe(
        3
      )
    })

    it('stops adding choices at the instance limit', () => {
      let state = createDefaultState()
      state = statusExtensionReducer(state, addPollChoice(3))

      const next = statusExtensionReducer(state, addPollChoice(3))

      expect(next).toBe(state)
      expect(next.poll.choices).toHaveLength(3)
    })

    it('removes the choice at the given index', () => {
      let state = createDefaultState()
      state = statusExtensionReducer(state, addPollChoice(4))
      state.poll.choices.forEach((choice, index) => {
        choice.text = `option ${index}`
      })

      const next = statusExtensionReducer(state, removePollChoice(1))

      expect(next.poll.choices.map((choice) => choice.text)).toEqual([
        'option 0',
        'option 2'
      ])
    })

    it('keeps the minimum of two choices', () => {
      const state = createDefaultState()

      const next = statusExtensionReducer(state, removePollChoice(0))

      expect(next).toBe(state)
      expect(next.poll.choices).toHaveLength(2)
    })
  })

  describe('poll settings', () => {
    it('stores the poll duration without touching the other poll fields', () => {
      const state = createDefaultState()

      const next = statusExtensionReducer(state, setPollDurationInSeconds(300))

      expect(next.poll).toEqual({ ...state.poll, durationInSeconds: 300 })
    })

    it('stores whether the poll allows one or several answers', () => {
      const next = statusExtensionReducer(
        createDefaultState(),
        setPollType('anyOf')
      )

      expect(next.poll.pollType).toBe('anyOf')
    })

    it('resets the duration when a poll replaces existing attachments', () => {
      const state = {
        ...createDefaultState(),
        attachments: [attachment('a')],
        poll: { ...createDefaultState().poll, durationInSeconds: 300 as const }
      }

      const next = statusExtensionReducer(state, setPollVisibility(true))

      expect(next.poll.durationInSeconds).toBe(
        createDefaultState().poll.durationInSeconds
      )
    })

    it('keeps the chosen duration when a poll is toggled with no attachments', () => {
      const state = {
        ...createDefaultState(),
        poll: { ...createDefaultState().poll, durationInSeconds: 300 as const }
      }

      const next = statusExtensionReducer(state, setPollVisibility(true))

      expect(next.poll.durationInSeconds).toBe(300)
      expect(next.poll.showing).toBe(true)
    })
  })

  describe('attachment edits', () => {
    beforeEach(() => {
      global.URL.revokeObjectURL = vi.fn()
    })

    it('replaces only the attachment with the matching id', () => {
      const state = {
        ...createDefaultState(),
        attachments: [attachment('a'), attachment('b'), attachment('c')]
      }
      const edited = { ...attachment('b'), name: 'described' }

      const next = statusExtensionReducer(state, updateAttachment('b', edited))

      expect(next.attachments).toEqual([
        attachment('a'),
        edited,
        attachment('c')
      ])
    })

    it('ignores an update for an unknown id', () => {
      const state = {
        ...createDefaultState(),
        attachments: [attachment('a')]
      }

      expect(
        statusExtensionReducer(state, updateAttachment('zzz', attachment('x')))
      ).toBe(state)
    })

    it('removes an attachment and revokes its blob preview and poster', () => {
      const state = {
        ...createDefaultState(),
        attachments: [
          attachment('a'),
          {
            ...attachment('b'),
            url: 'blob:preview-b',
            posterUrl: 'blob:poster-b'
          }
        ]
      }

      const next = statusExtensionReducer(state, removeAttachment('b'))

      expect(next.attachments).toEqual([attachment('a')])
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-b')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:poster-b')
    })

    it('does not revoke remote URLs when removing an attachment', () => {
      const state = {
        ...createDefaultState(),
        attachments: [attachment('a')]
      }

      statusExtensionReducer(state, removeAttachment('a'))

      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    })

    it('ignores the removal of an unknown id', () => {
      const state = {
        ...createDefaultState(),
        attachments: [attachment('a')]
      }

      expect(statusExtensionReducer(state, removeAttachment('zzz'))).toBe(state)
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    })

    it('revokes blob previews of every attachment on reset', () => {
      const state = {
        ...createDefaultState(),
        attachments: [
          { ...attachment('a'), url: 'blob:preview-a' },
          { ...attachment('b'), posterUrl: 'blob:poster-b' },
          attachment('c')
        ]
      }

      const next = statusExtensionReducer(state, resetExtension())

      expect(next.attachments).toEqual([])
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-a')
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:poster-b')
    })
  })

  describe('composer settings', () => {
    it('stores the chosen visibility and quote policy', () => {
      let state = createDefaultState()

      state = statusExtensionReducer(state, setVisibility('direct'))
      state = statusExtensionReducer(state, setQuoteApprovalPolicy('nobody'))

      expect(state.visibility).toBe('direct')
      expect(state.quoteApprovalPolicy).toBe('nobody')
    })

    it('returns the same state for an unknown action', () => {
      const state = createDefaultState()

      expect(statusExtensionReducer(state, { type: 'bogus' } as never)).toBe(
        state
      )
    })
  })

  describe('fitness file', () => {
    const file = new File(['<gpx/>'], 'run.gpx', {
      type: 'application/gpx+xml'
    })

    it('attaches the file as not yet uploading and forces private visibility', () => {
      const next = statusExtensionReducer(
        createDefaultState(),
        setFitnessFile(file)
      )

      expect(next.fitnessFile).toEqual({ file, uploading: false })
      expect(next.visibility).toBe('private')
    })

    it('tracks upload progress and then the uploaded id', () => {
      let state = statusExtensionReducer(
        createDefaultState(),
        setFitnessFile(file)
      )

      state = statusExtensionReducer(state, setFitnessFileUploading(true))
      expect(state.fitnessFile).toEqual({ file, uploading: true })

      state = statusExtensionReducer(state, setFitnessFileUploaded('fit-1'))
      expect(state.fitnessFile).toEqual({
        file,
        uploading: false,
        uploadedId: 'fit-1'
      })
    })

    it('ignores upload updates when no fitness file is attached', () => {
      const state = createDefaultState()

      expect(statusExtensionReducer(state, setFitnessFileUploading(true))).toBe(
        state
      )
      expect(
        statusExtensionReducer(state, setFitnessFileUploaded('fit-1'))
      ).toBe(state)
    })

    it('removes the attached fitness file', () => {
      const attached = statusExtensionReducer(
        createDefaultState(),
        setFitnessFile(file)
      )

      const next = statusExtensionReducer(attached, removeFitnessFile())

      expect(next.fitnessFile).toBeUndefined()
    })

    it('drops the fitness file when a poll is started', () => {
      const attached = statusExtensionReducer(
        createDefaultState(),
        setFitnessFile(file)
      )

      const next = statusExtensionReducer(attached, setPollVisibility(true))

      expect(next.fitnessFile).toBeUndefined()
    })
  })
})
