import groupBy from 'lodash/groupBy'

import { Status } from '../status'

export const conversation = (statuses: Status[]) => {
  const conversations = groupBy(statuses, 'conversation')
  const orderedConversation = Object.keys(conversations)
    .map((conversationId) => {
      const group = conversations[conversationId].sort(
        (s1, s2) => s2.createdAt - s1.createdAt
      )
      const lastStatus = group[0]
      return {
        conversation: conversationId,
        timestamp: lastStatus.createdAt,
        statuses: group
      }
    })
    .sort((c1, c2) => c2.timestamp - c1.timestamp)

  return orderedConversation
}
