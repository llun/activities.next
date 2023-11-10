import { FC, PropsWithChildren } from 'react'
import ReactModal from 'react-modal'

import styles from './Modal.module.scss'

interface Props {
  isOpen: boolean
  onRequestClose: () => void
}
export const Modal: FC<PropsWithChildren<Props>> = ({
  isOpen,
  children,
  onRequestClose
}) => {
  return (
    <ReactModal
      overlayClassName={styles.modalOverlay}
      bodyOpenClassName={styles.modalBodyOpen}
      className={styles.modal}
      isOpen={isOpen}
      onRequestClose={onRequestClose}
    >
      {children}
    </ReactModal>
  )
}
