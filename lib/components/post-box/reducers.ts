import { Reducer } from 'react'

import { PostBoxAttachment } from '../../models/attachment'
import { MAX_ATTACHMENTS } from '../../services/medias/constants'
import { MastodonVisibility } from '../../utils/getVisibility'
import { Choice, DEFAULT_DURATION, Duration } from './poll-choices'

interface StatusExtension {
  attachments: PostBoxAttachment[]
  poll: {
    showing: boolean
    choices: Choice[]
    durationInSeconds: Duration
    pollType: 'oneOf' | 'anyOf'
  }
  visibility: MastodonVisibility
}

export const resetExtension = () => ({ type: 'resetExtension' as const })
type ActionReset = ReturnType<typeof resetExtension>

export const setAttachments = (attachments: PostBoxAttachment[]) => ({
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

export const addAttachment = (attachment: PostBoxAttachment) => ({
  type: 'addAttachment' as const,
  attachment
})
type ActionAddAttachment = ReturnType<typeof addAttachment>

export const updateAttachment = (
  id: string,
  attachment: PostBoxAttachment
) => ({
  type: 'updateAttachment' as const,
  id,
  attachment
})
type ActionUpdateAttachment = ReturnType<typeof updateAttachment>

export const removeAttachment = (id: string) => ({
  type: 'removeAttachment' as const,
  id
})
type ActionRemoveAttachment = ReturnType<typeof removeAttachment>

export const setPollDurationInSeconds = (seconds: Duration) => ({
  type: 'setPollDurationInSeconds' as const,
  seconds
})
type ActionSetPollDurationInSeconds = ReturnType<
  typeof setPollDurationInSeconds
>

export const setPollType = (pollType: 'oneOf' | 'anyOf') => ({
  type: 'setPollType' as const,
  pollType
})
type ActionSetPollType = ReturnType<typeof setPollType>

export const setVisibility = (visibility: MastodonVisibility) => ({
  type: 'setVisibility' as const,
  visibility
})
type ActionSetVisibility = ReturnType<typeof setVisibility>

type Actions =
  | ActionReset
  | ActionSetAttachments
  | ActionSetPollVisibility
  | ActionAddPollChoice
  | ActionRemovePollChoice
  | ActionSetPollDurationInSeconds
  | ActionSetPollType
  | ActionAddAttachment
  | ActionUpdateAttachment
  | ActionRemoveAttachment
  | ActionSetVisibility

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
    durationInSeconds: DEFAULT_DURATION,
    pollType: 'oneOf'
  },
  visibility: 'public'
}

export const statusExtensionReducer: Reducer<StatusExtension, Actions> = (
  state,
  action
) => {
  switch (action.type) {
    case 'resetExtension': {
      state.attachments.forEach((attachment) => {
        if (attachment.url.startsWith('blob:')) {
          URL.revokeObjectURL(attachment.url)
        }
      })
      // Reset everything including visibility to default state after posting
      return DEFAULT_STATE
    }
    case 'setAttachments': {
      // Preserve visibility when loading attachments (e.g., when editing)
      return {
        ...DEFAULT_STATE,
        attachments: action.attachments,
        visibility: state.visibility
      }
    }
    case 'setPollVisibility': {
      if (action.visible) {
        state.attachments.forEach((attachment) => {
          if (attachment.url.startsWith('blob:')) {
            URL.revokeObjectURL(attachment.url)
          }
        })
      }
      const duration = state.attachments.length
        ? DEFAULT_DURATION
        : state.poll.durationInSeconds
      // Preserve visibility when toggling poll mode
      return {
        attachments: [],
        poll: {
          ...state.poll,
          showing: action.visible,
          durationInSeconds: duration
        },
        visibility: state.visibility
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
    case 'setPollType': {
      return {
        ...state,
        poll: {
          ...state.poll,
          pollType: action.pollType
        }
      }
    }
    case 'addAttachment': {
      if (state.attachments.length >= MAX_ATTACHMENTS) return state
      return {
        ...state,
        attachments: [...state.attachments, action.attachment]
      }
    }
    case 'updateAttachment': {
      const index = state.attachments.findIndex((item) => item.id === action.id)
      if (index === -1) return state
      return {
        ...state,
        attachments: [
          ...state.attachments.slice(0, index),
          action.attachment,
          ...state.attachments.slice(index + 1)
        ]
      }
    }
    case 'removeAttachment': {
      const index = state.attachments.findIndex((item) => item.id === action.id)
      if (index === -1) return state
      const attachment = state.attachments[index]
      if (attachment.url.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.url)
      }
      return {
        ...state,
        attachments: [
          ...state.attachments.slice(0, index),
          ...state.attachments.slice(index + 1)
        ]
      }
    }
    case 'setVisibility': {
      return {
        ...state,
        visibility: action.visibility
      }
    }
    default:
      return state
  }
}
