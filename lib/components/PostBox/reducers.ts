import { Reducer } from 'react'

import {
  AppleGalleryAttachment,
  PostBoxAttachment
} from '../../models/attachment'
import { Choice, DEFAULT_DURATION, Duration } from './PollChoices'

interface StatusExtension {
  attachments: PostBoxAttachment[]
  poll: {
    showing: boolean
    choices: Choice[]
    durationInSeconds: Duration
  }
}

export const resetExtension = () => ({ type: 'resetExtension' as const })
type ActionReset = ReturnType<typeof resetExtension>

export const setAttachments = (attachments: AppleGalleryAttachment[]) => ({
  type: 'setAttachments' as const,
  attachments
})
type ActionSetAttachments = ReturnType<typeof setAttachments>

export const setPollVisibility = (visible: boolean) => ({
  type: 'setPollVisibility' as const,
  visible
})
type ActionSetPollVisibility = ReturnType<typeof setPollVisibility>

export const addPollChoice = {
  type: 'addPollChoice' as const
}
type ActionAddPollChoice = typeof addPollChoice

export const removePollChoice = (index: number) => ({
  type: 'removePollChoice' as const,
  index
})
type ActionRemovePollChoice = ReturnType<typeof removePollChoice>

export const setPollDurationInSeconds = (seconds: Duration) => ({
  type: 'setPollDurationInSeconds' as const,
  seconds
})
type ActionSetPollDurationInSeconds = ReturnType<
  typeof setPollDurationInSeconds
>

type Actions =
  | ActionReset
  | ActionSetAttachments
  | ActionSetPollVisibility
  | ActionAddPollChoice
  | ActionRemovePollChoice
  | ActionSetPollDurationInSeconds

const key = () => Math.round(Math.random() * 1000)

export const DEFAULT_CHOICES = [
  { key: key(), text: '' },
  { key: key(), text: '' }
]

export const DEFAULT_STATE: StatusExtension = {
  attachments: [],
  poll: {
    showing: false,
    choices: DEFAULT_CHOICES,
    durationInSeconds: DEFAULT_DURATION
  }
}

export const statusExtensionReducer: Reducer<StatusExtension, Actions> = (
  state,
  action
) => {
  switch (action.type) {
    case 'resetExtension': {
      return DEFAULT_STATE
    }
    case 'setAttachments': {
      return {
        ...DEFAULT_STATE,
        attachments: action.attachments
      }
    }
    case 'setPollVisibility': {
      const duration = state.attachments.length
        ? DEFAULT_DURATION
        : state.poll.durationInSeconds
      return {
        attachments: [],
        poll: {
          ...state.poll,
          showing: action.visible,
          durationInSeconds: duration
        }
      }
    }
    case 'addPollChoice': {
      if (state.poll.choices.length > 4) return state
      return {
        ...state,
        poll: {
          ...state.poll,
          choices: [...state.poll.choices, { key: key(), text: '' }]
        }
      }
    }
    case 'removePollChoice': {
      if (state.poll.choices.length < 3) return state
      const index = action.index
      const choices = state.poll.choices
      return {
        ...state,
        poll: {
          ...state.poll,
          choices: [...choices.slice(0, index), ...choices.slice(index + 1)]
        }
      }
    }
    case 'setPollDurationInSeconds': {
      return {
        ...state,
        poll: {
          ...state.poll,
          durationInSeconds: action.seconds
        }
      }
    }
    default:
      return state
  }
}
