import { FC } from 'react'
import cn from 'classnames'
import parse from 'html-react-parser'
import formatDistanceToNow from 'date-fns/formatDistanceToNow'

import { Status } from '../../models/status'
import styles from './Post.module.scss'
import { Button } from '../Button'

interface Props {
  status: Status
}

export const Post: FC<Props> = ({ status }) => {
  return (
    <div key={status.id} className={cn('d-flex', styles.post)}>
      <div className={cn('flex-fill', 'me-1')}>
        {parse(status.text, {
          replace: (domNode: any) => {
            if (domNode.name === 'span') {
              if (domNode.attribs?.class === 'invisible')
                domNode.attribs.class = styles.invisible
              if (domNode.attribs?.class === 'ellipsis')
                domNode.attribs.class = styles.ellipsis
            }
            if (domNode.attribs && domNode.name === 'a') {
              domNode.attribs.target = '_blank'
              return domNode
            }

            return domNode
          }
        })}
        <div className={cn(styles.actions)}>
          <Button
            className={styles.action}
            variant="link"
            onClick={() => {
              console.log('Reply to')
            }}
          >
            <i className="bi bi-reply"></i>
          </Button>
          <Button
            className={styles.action}
            variant="link"
            onClick={() => {
              console.log('Repost')
            }}
          >
            <i className="bi bi-arrow-left-right"></i>
          </Button>
        </div>
      </div>
      <div className={cn('flex-shrink-0', styles.misc)}>
        {formatDistanceToNow(status.createdAt)}
      </div>
    </div>
  )
}
