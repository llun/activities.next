import { Image } from './image'

export interface Emoji {
  type: 'Emoji'
  name: string
  updated: string
  icon: Image
}
