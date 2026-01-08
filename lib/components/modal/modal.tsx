import { FC, PropsWithChildren } from 'react'
import ReactModal from 'react-modal'

import { cn } from '@/lib/utils'

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
      overlayClassName="fixed inset-0 bg-background/75"
      bodyOpenClassName="overflow-hidden"
      className={cn(
        className,
        !className &&
          'absolute inset-10 rounded-sm outline-none flex justify-center items-center bg-background border border-border [&_img]:max-h-full [&_img]:max-w-full [&_img]:object-contain'
      )}
      isOpen={isOpen}
      onRequestClose={onRequestClose}
    >
      {children}
    </ReactModal>
  )
}
