'use client'

import { useEffect } from 'react'
import ReactModal from 'react-modal'

export const Modal = () => {
  useEffect(() => {
    ReactModal.setAppElement('#__modal')
  })

  return <div id="__modal" />
}
