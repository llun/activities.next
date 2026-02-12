import {
  DEFAULT_STATE,
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
})
