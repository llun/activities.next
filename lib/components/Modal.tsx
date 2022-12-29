import { FC, ReactNode } from 'react'
import ReactModal from 'react-modal'

import styles from './Modal.module.scss'

interface Props {
  isOpen: boolean
  children: ReactNode
  onRequestClose: () => void
}
export const Modal: FC<Props> = ({ isOpen, children, onRequestClose }) => {
  return (
    <ReactModal
      overlayClassName={styles.modalOverlay}
      className={styles.modal}
      isOpen={isOpen}
      onRequestClose={onRequestClose}
    >
      {children}
    </ReactModal>
  )
}
