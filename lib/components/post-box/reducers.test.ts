import {
  DEFAULT_STATE,
  addAttachment,
  setAttachments,
  setContentWarning,
  setContentWarningVisibility,
  setFitnessFile,
  statusExtensionReducer
} from './reducers'

describe('post-box reducers', () => {
  it('disables poll mode when fitness file is attached', () => {
    const stateWithPoll = {
      ...DEFAULT_STATE,
      poll: {
        ...DEFAULT_STATE.poll,
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
      DEFAULT_STATE,
      setContentWarning('Spoilers')
    )

    expect(nextState.contentWarning).toBe('Spoilers')
    expect(nextState.contentWarningVisible).toBe(true)
  })

  it('clears content warning when visibility is turned off', () => {
    const stateWithWarning = statusExtensionReducer(
      DEFAULT_STATE,
      setContentWarning('Spoilers')
    )

    const nextState = statusExtensionReducer(
      stateWithWarning,
      setContentWarningVisibility(false)
    )

    expect(nextState.contentWarning).toBe('')
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
        ...DEFAULT_STATE,
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
      ...DEFAULT_STATE,
      poll: {
        ...DEFAULT_STATE.poll,
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

  it('preserves state when managing an existing attachment list', () => {
    const stateWithAttachments = {
      ...DEFAULT_STATE,
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
    expect(nextState.fitnessFile).toBe(stateWithAttachments.fitnessFile)
  })

  it('clears poll and fitness state when adding an attachment', () => {
    const stateWithPoll = {
      ...DEFAULT_STATE,
      poll: {
        ...DEFAULT_STATE.poll,
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
})
