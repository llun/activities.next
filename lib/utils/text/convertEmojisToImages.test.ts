import { Tag } from '../../models/tag'
import { convertEmojisToImages } from './convertEmojisToImages'

describe('#convertEmojisToImages', () => {
  it('converts all emojis inside text to image tags', () => {
    const time = Date.now()
    const tags: Tag[] = [
      {
        type: 'emoji',
        createdAt: time,
        value: 'https://llun.test/image1.png',
        name: ':image1:',
        id: '1',
        statusId: 'https://llun.test/users/user1/statuses/1',
        updatedAt: time
      },
      {
        createdAt: time,
        id: '2',
        value: 'https://llun.test/image2',
        updatedAt: time,
        type: 'emoji',
        name: ':image2:',
        statusId: 'https://llun.test/users/user1/statuses/1'
      }
    ]
    const text = '<p>Another test with custom emoji :image1: :image2:</p>'

    expect(convertEmojisToImages(text, tags)).toEqual(
      '<p>Another test with custom emoji <img class="emoji" src="https://llun.test/image1.png" alt=":image1:"></img> <img class="emoji" src="https://llun.test/image2" alt=":image2:"></img></p>'
    )
  })

  it('converts only emojis inside text', () => {
    const time = Date.now()
    const tags: Tag[] = [
      {
        id: '3',
        name: ':image3:',
        value: 'https://llun.test/image3',
        createdAt: time,
        updatedAt: time,
        type: 'emoji',
        statusId: 'https://llun.test/users/user1/statuses/2'
      },
      {
        createdAt: time,
        statusId: 'https://llun.test/users/user1/statuses/2',
        value: 'https://llun.test/users/user4',
        type: 'mention',
        updatedAt: time,
        name: '@user4@llun.test',
        id: '4'
      }
    ]
    const text =
      '<p><span class="h-card"><a href="https://llun.test/@user4" class="u-url mention">@<span>user4</span></a></span> Another test with custom emoji :image3:</p>'

    expect(convertEmojisToImages(text, tags)).toEqual(
      '<p><span class="h-card"><a href="https://llun.test/@user4" class="u-url mention">@<span>user4</span></a></span> Another test with custom emoji <img class="emoji" src="https://llun.test/image3" alt=":image3:"></img></p>'
    )
  })
})
