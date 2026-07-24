import {
  addAttachment,
  createDefaultState,
  resetExtension,
  setAttachments,
  setContentWarning,
  setContentWarningVisibility,
  setFitnessFile,
  statusExtensionReducer
} from './reducers'

describe('post-box reducers', () => {
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
      addAttachment({
        type: 'upload',
        id: 'media-id',
        mediaType: 'image/png',
        url: 'https://llun.test/media.png',
        width: 100,
        height: 100
      })
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
})
