import { FC } from 'react'
import cn from 'classnames'
import parse from 'html-react-parser'

import { Status } from '../../models/status'
import styles from './Post.module.scss'

interface Props {
  status: Status
}

export const Post: FC<Props> = ({ status }) => {
  return (
    <div className={cn('flex-fill', 'me-1', styles.post)}>
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
    </div>
  )
}
