import {
  DEFAULT_STATE,
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
})
