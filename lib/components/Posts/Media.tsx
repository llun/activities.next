import cn from 'classnames'
import Image from 'next/image'
import { FC } from 'react'

import { Attachment } from '../../models/attachment'
import styles from './Media.module.scss'

interface Props {
  caption?: string
  attachment: Attachment
}

export const Media: FC<Props> = ({ caption, attachment }) => {
  const { mediaType, url, name, id, width, height } = attachment
  if (mediaType.startsWith('image')) {
    return (
      <Image
        key={id}
        className={styles.image}
        alt={caption ?? name ?? url}
        src={url}
        width={width}
        height={height}
      />
    )
  }

  if (mediaType.startsWith('video')) {
    return (
      <video className={styles.video} width={width} height={height}>
        <source src={url} type={mediaType} />
      </video>
    )
  }

  return null
}
