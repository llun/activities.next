import { ContextEntity } from './base'
import { OrderedCollectionPage } from './orderedCollectionPage'

export interface OrderedCollection extends ContextEntity {
  id: string
  type: 'OrderedCollection'
  totalItems?: number
  first: string | OrderedCollectionPage
  last?: string
}

type X = {
  type: 'OrderedCollection'
  id: string
  first: {
    type: 'OrderedCollectionPage'
    id: 'https://epiktistes.com/actors/toddsundsted/outbox?page=1'
    next: 'https://epiktistes.com/actors/toddsundsted/outbox?page=2'
    orderedItems: [
      'https://epiktistes.com/activities/dYflAZhANx0',
      'https://epiktistes.com/activities/giS04n8d_ts',
      'https://epiktistes.com/activities/z7cWxlXfqi0',
      'https://epiktistes.com/activities/DT25xsTwMBw',
      'https://epiktistes.com/activities/ohbxLToQ9jk',
      'https://epiktistes.com/activities/qETYgpKaXPA',
      'https://epiktistes.com/activities/F57zbvTHqto',
      'https://epiktistes.com/activities/Sqh6ZurJ39Q',
      'https://epiktistes.com/activities/F6CYkz6oMaw',
      'https://epiktistes.com/activities/e-bYDrwPei4'
    ]
  }
}
