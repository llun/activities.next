import { FC } from 'react'

import { deleteStatus, repostStatus } from '../../client'
import { StatusType } from '../../models/status'
import { Button } from '../Button'
import { PostProps } from './Post'
import styles from './Post.module.scss'

export const Actions: FC<PostProps> = ({
  status,
  showDeleteAction = false,
  showActions = false,
  onReply,
  onPostDeleted,
  onPostReposted
}) => {
  if (!showActions) return null
  // TODO: Return different actions for announce
  if (status.type === StatusType.Announce) return null
  return (
    <div>
      <Button
        className={styles.action}
        variant="link"
        onClick={() => onReply?.(status)}
      >
        <i className="bi bi-reply"></i>
      </Button>
      <Button
        className={styles.action}
        variant="link"
        onClick={async () => {
          await repostStatus({ statusId: status.id })
          onPostReposted?.(status)
        }}
      >
        <i className="bi bi bi-repeat"></i>
      </Button>
      {showDeleteAction && (
        <Button
          className={styles.action}
          variant="link"
          onClick={async () => {
            const deleteConfirmation = window.confirm(
              `Confirm delete status! ${
                status.text.length
                  ? `${status.text.slice(0, 20)}...`
                  : status.id
              }`
            )
            if (!deleteConfirmation) return
            await deleteStatus({ statusId: status.id })
            onPostDeleted?.(status)
          }}
        >
          <i className="bi bi-trash3"></i>
        </Button>
      )}
    </div>
  )
}
