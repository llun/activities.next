import { TagData } from '../models/tag'

export const convertEmojisToImages = (text: string, tags: TagData[]) =>
  tags
    .filter((tag) => tag.type === 'emoji')
    .reduce(
      (replaceText, tag) =>
        replaceText.replaceAll(
          tag.name,
          `<img class="emoji" src="${tag.value}" alt="${tag.name}"></img>`
        ),
      text
    )
