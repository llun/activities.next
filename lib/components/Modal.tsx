import cn from 'classnames'
import { FC, PropsWithChildren } from 'react'
import ReactModal from 'react-modal'

import styles from './Modal.module.scss'

interface Props {
  className?: string
  isOpen: boolean
  onRequestClose: () => void
}
export const Modal: FC<PropsWithChildren<Props>> = ({
  className,
  isOpen,
  children,
  onRequestClose
}) => {
  return (
    <ReactModal
      overlayClassName={styles.modalOverlay}
      bodyOpenClassName={styles.modalBodyOpen}
      className={cn(className, { [styles.modal]: !className })}
      isOpen={isOpen}
      onRequestClose={onRequestClose}
    >
      {children}
    </ReactModal>
  )
}
