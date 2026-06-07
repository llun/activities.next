// Curated Unicode emoji dataset for the postbox picker. Kept as a small local
// dataset (rather than a heavy emoji-mart dependency) so the picker stays
// self-contained; it covers the common emoji grouped by the standard Unicode
// categories, with search keywords. Custom (instance) emoji come from the API
// and are presented as a separate "Custom" tab in the picker.

export interface SystemEmoji {
  char: string
  name: string
  keywords: string[]
}

export interface EmojiGroup {
  id: string
  name: string
  // A representative glyph used as the category tab icon.
  icon: string
  emojis: SystemEmoji[]
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'smileys',
    name: 'Smileys & Emotion',
    icon: '😀',
    emojis: [
      {
        char: '😀',
        name: 'grinning face',
        keywords: ['smile', 'happy', 'grin']
      },
      {
        char: '😃',
        name: 'grinning face with big eyes',
        keywords: ['happy', 'smile']
      },
      {
        char: '😄',
        name: 'grinning face with smiling eyes',
        keywords: ['happy', 'laugh']
      },
      { char: '😁', name: 'beaming face', keywords: ['grin', 'smile'] },
      {
        char: '😆',
        name: 'grinning squinting face',
        keywords: ['laugh', 'haha']
      },
      {
        char: '😅',
        name: 'grinning face with sweat',
        keywords: ['relief', 'laugh']
      },
      {
        char: '🤣',
        name: 'rolling on the floor laughing',
        keywords: ['rofl', 'lol']
      },
      {
        char: '😂',
        name: 'face with tears of joy',
        keywords: ['joy', 'lol', 'cry']
      },
      { char: '🙂', name: 'slightly smiling face', keywords: ['smile'] },
      { char: '🙃', name: 'upside-down face', keywords: ['silly', 'sarcasm'] },
      { char: '😉', name: 'winking face', keywords: ['wink', 'flirt'] },
      {
        char: '😊',
        name: 'smiling face with smiling eyes',
        keywords: ['blush', 'happy']
      },
      {
        char: '😇',
        name: 'smiling face with halo',
        keywords: ['angel', 'innocent']
      },
      {
        char: '🥰',
        name: 'smiling face with hearts',
        keywords: ['love', 'adore']
      },
      {
        char: '😍',
        name: 'smiling face with heart-eyes',
        keywords: ['love', 'crush']
      },
      { char: '😘', name: 'face blowing a kiss', keywords: ['kiss', 'love'] },
      { char: '😋', name: 'face savoring food', keywords: ['yum', 'tasty'] },
      {
        char: '😜',
        name: 'winking face with tongue',
        keywords: ['silly', 'tongue']
      },
      { char: '🤪', name: 'zany face', keywords: ['crazy', 'silly'] },
      { char: '🤗', name: 'hugging face', keywords: ['hug'] },
      { char: '🤔', name: 'thinking face', keywords: ['think', 'hmm'] },
      { char: '😐', name: 'neutral face', keywords: ['meh', 'neutral'] },
      {
        char: '😴',
        name: 'sleeping face',
        keywords: ['sleep', 'tired', 'zzz']
      },
      {
        char: '😎',
        name: 'smiling face with sunglasses',
        keywords: ['cool', 'sunglasses']
      },
      { char: '🥳', name: 'partying face', keywords: ['party', 'celebrate'] },
      {
        char: '😭',
        name: 'loudly crying face',
        keywords: ['cry', 'sad', 'tears']
      },
      {
        char: '😱',
        name: 'face screaming in fear',
        keywords: ['scream', 'shock']
      },
      { char: '😡', name: 'enraged face', keywords: ['angry', 'mad'] },
      { char: '🤯', name: 'exploding head', keywords: ['mind blown', 'shock'] },
      { char: '🥺', name: 'pleading face', keywords: ['puppy eyes', 'please'] }
    ]
  },
  {
    id: 'people',
    name: 'People & Body',
    icon: '👍',
    emojis: [
      { char: '👍', name: 'thumbs up', keywords: ['like', 'approve', 'yes'] },
      { char: '👎', name: 'thumbs down', keywords: ['dislike', 'no'] },
      { char: '👏', name: 'clapping hands', keywords: ['clap', 'applause'] },
      { char: '🙌', name: 'raising hands', keywords: ['celebrate', 'praise'] },
      {
        char: '🙏',
        name: 'folded hands',
        keywords: ['thanks', 'please', 'pray']
      },
      { char: '👋', name: 'waving hand', keywords: ['hello', 'hi', 'bye'] },
      { char: '🤝', name: 'handshake', keywords: ['deal', 'agree'] },
      { char: '✌️', name: 'victory hand', keywords: ['peace'] },
      { char: '🤞', name: 'crossed fingers', keywords: ['luck', 'hope'] },
      { char: '💪', name: 'flexed biceps', keywords: ['strong', 'muscle'] },
      { char: '🫶', name: 'heart hands', keywords: ['love', 'heart'] },
      { char: '👀', name: 'eyes', keywords: ['look', 'see', 'watch'] },
      { char: '🧠', name: 'brain', keywords: ['smart', 'think'] },
      { char: '👶', name: 'baby', keywords: ['child', 'infant'] },
      {
        char: '🧑‍💻',
        name: 'technologist',
        keywords: ['developer', 'coder', 'work']
      }
    ]
  },
  {
    id: 'nature',
    name: 'Animals & Nature',
    icon: '🐱',
    emojis: [
      { char: '🐶', name: 'dog face', keywords: ['dog', 'puppy', 'pet'] },
      { char: '🐱', name: 'cat face', keywords: ['cat', 'kitten', 'pet'] },
      { char: '🦊', name: 'fox', keywords: ['fox'] },
      { char: '🐻', name: 'bear', keywords: ['bear'] },
      { char: '🐼', name: 'panda', keywords: ['panda'] },
      { char: '🐨', name: 'koala', keywords: ['koala'] },
      { char: '🦁', name: 'lion', keywords: ['lion'] },
      { char: '🐮', name: 'cow face', keywords: ['cow'] },
      { char: '🐷', name: 'pig face', keywords: ['pig'] },
      { char: '🐸', name: 'frog', keywords: ['frog'] },
      { char: '🐵', name: 'monkey face', keywords: ['monkey'] },
      { char: '🦄', name: 'unicorn', keywords: ['unicorn', 'magic'] },
      { char: '🐝', name: 'honeybee', keywords: ['bee', 'bug'] },
      { char: '🦋', name: 'butterfly', keywords: ['butterfly'] },
      { char: '🌸', name: 'cherry blossom', keywords: ['flower', 'spring'] },
      { char: '🌹', name: 'rose', keywords: ['flower', 'love'] },
      { char: '🌳', name: 'deciduous tree', keywords: ['tree', 'nature'] },
      { char: '🌞', name: 'sun with face', keywords: ['sun', 'sunny'] },
      { char: '🌙', name: 'crescent moon', keywords: ['moon', 'night'] },
      { char: '⭐', name: 'star', keywords: ['star'] },
      { char: '🔥', name: 'fire', keywords: ['fire', 'lit', 'hot'] },
      { char: '🌈', name: 'rainbow', keywords: ['rainbow', 'pride'] }
    ]
  },
  {
    id: 'food',
    name: 'Food & Drink',
    icon: '🍕',
    emojis: [
      { char: '🍎', name: 'red apple', keywords: ['apple', 'fruit'] },
      { char: '🍌', name: 'banana', keywords: ['banana', 'fruit'] },
      { char: '🍓', name: 'strawberry', keywords: ['strawberry', 'fruit'] },
      { char: '🍉', name: 'watermelon', keywords: ['watermelon', 'fruit'] },
      { char: '🍕', name: 'pizza', keywords: ['pizza', 'food'] },
      { char: '🍔', name: 'hamburger', keywords: ['burger', 'food'] },
      { char: '🍟', name: 'french fries', keywords: ['fries', 'food'] },
      { char: '🌮', name: 'taco', keywords: ['taco', 'food'] },
      { char: '🍣', name: 'sushi', keywords: ['sushi', 'food'] },
      { char: '🍜', name: 'steaming bowl', keywords: ['noodles', 'ramen'] },
      { char: '🍰', name: 'shortcake', keywords: ['cake', 'dessert'] },
      { char: '🎂', name: 'birthday cake', keywords: ['cake', 'birthday'] },
      { char: '🍪', name: 'cookie', keywords: ['cookie', 'dessert'] },
      { char: '☕', name: 'hot beverage', keywords: ['coffee', 'tea'] },
      { char: '🍺', name: 'beer mug', keywords: ['beer', 'drink'] },
      { char: '🍷', name: 'wine glass', keywords: ['wine', 'drink'] }
    ]
  },
  {
    id: 'activities',
    name: 'Activities',
    icon: '⚽',
    emojis: [
      {
        char: '⚽',
        name: 'soccer ball',
        keywords: ['football', 'soccer', 'sport']
      },
      { char: '🏀', name: 'basketball', keywords: ['basketball', 'sport'] },
      {
        char: '🏈',
        name: 'american football',
        keywords: ['football', 'sport']
      },
      { char: '🎾', name: 'tennis', keywords: ['tennis', 'sport'] },
      { char: '🏃', name: 'person running', keywords: ['run', 'exercise'] },
      {
        char: '🚴',
        name: 'person biking',
        keywords: ['bike', 'cycle', 'exercise']
      },
      { char: '🏆', name: 'trophy', keywords: ['win', 'award', 'champion'] },
      { char: '🥇', name: 'first place medal', keywords: ['gold', 'win'] },
      {
        char: '🎉',
        name: 'party popper',
        keywords: ['party', 'celebrate', 'tada']
      },
      { char: '🎊', name: 'confetti ball', keywords: ['party', 'celebrate'] },
      { char: '🎮', name: 'video game', keywords: ['game', 'gaming'] },
      { char: '🎵', name: 'musical note', keywords: ['music', 'song'] },
      { char: '🎨', name: 'artist palette', keywords: ['art', 'paint'] }
    ]
  },
  {
    id: 'travel',
    name: 'Travel & Places',
    icon: '✈️',
    emojis: [
      { char: '🚗', name: 'car', keywords: ['car', 'drive'] },
      { char: '✈️', name: 'airplane', keywords: ['plane', 'flight', 'travel'] },
      { char: '🚀', name: 'rocket', keywords: ['rocket', 'launch', 'space'] },
      { char: '🚲', name: 'bicycle', keywords: ['bike', 'cycle'] },
      { char: '🏔️', name: 'snow-capped mountain', keywords: ['mountain'] },
      {
        char: '🏖️',
        name: 'beach with umbrella',
        keywords: ['beach', 'vacation']
      },
      {
        char: '🌍',
        name: 'globe showing Europe-Africa',
        keywords: ['earth', 'world']
      },
      { char: '🗺️', name: 'world map', keywords: ['map', 'travel'] },
      { char: '🏠', name: 'house', keywords: ['home', 'house'] },
      { char: '🏙️', name: 'cityscape', keywords: ['city'] }
    ]
  },
  {
    id: 'objects',
    name: 'Objects',
    icon: '💡',
    emojis: [
      { char: '💡', name: 'light bulb', keywords: ['idea', 'light'] },
      { char: '📱', name: 'mobile phone', keywords: ['phone', 'mobile'] },
      { char: '💻', name: 'laptop', keywords: ['computer', 'laptop'] },
      { char: '⌨️', name: 'keyboard', keywords: ['keyboard', 'type'] },
      { char: '📷', name: 'camera', keywords: ['camera', 'photo'] },
      { char: '🔔', name: 'bell', keywords: ['notification', 'alert'] },
      { char: '🔒', name: 'locked', keywords: ['lock', 'secure', 'private'] },
      { char: '🔑', name: 'key', keywords: ['key', 'password'] },
      { char: '📌', name: 'pushpin', keywords: ['pin', 'location'] },
      { char: '📎', name: 'paperclip', keywords: ['clip', 'attach'] },
      { char: '✏️', name: 'pencil', keywords: ['write', 'edit'] },
      { char: '📚', name: 'books', keywords: ['book', 'read'] },
      { char: '💰', name: 'money bag', keywords: ['money', 'cash'] },
      { char: '🎁', name: 'wrapped gift', keywords: ['gift', 'present'] }
    ]
  },
  {
    id: 'symbols',
    name: 'Symbols',
    icon: '❤️',
    emojis: [
      { char: '❤️', name: 'red heart', keywords: ['love', 'heart'] },
      { char: '🧡', name: 'orange heart', keywords: ['heart'] },
      { char: '💛', name: 'yellow heart', keywords: ['heart'] },
      { char: '💚', name: 'green heart', keywords: ['heart'] },
      { char: '💙', name: 'blue heart', keywords: ['heart'] },
      { char: '💜', name: 'purple heart', keywords: ['heart'] },
      { char: '🖤', name: 'black heart', keywords: ['heart'] },
      { char: '💔', name: 'broken heart', keywords: ['heartbreak', 'sad'] },
      { char: '✨', name: 'sparkles', keywords: ['shiny', 'magic', 'new'] },
      { char: '⭐', name: 'star', keywords: ['star', 'favorite'] },
      {
        char: '✅',
        name: 'check mark button',
        keywords: ['check', 'done', 'yes']
      },
      { char: '❌', name: 'cross mark', keywords: ['x', 'no', 'wrong'] },
      { char: '❓', name: 'question mark', keywords: ['question'] },
      {
        char: '❗',
        name: 'exclamation mark',
        keywords: ['important', 'warning']
      },
      { char: '💯', name: 'hundred points', keywords: ['100', 'perfect'] }
    ]
  }
]

let allSystemEmojis: SystemEmoji[] | null = null
export const getAllSystemEmojis = (): SystemEmoji[] => {
  if (!allSystemEmojis) {
    allSystemEmojis = EMOJI_GROUPS.flatMap((group) => group.emojis)
  }
  return allSystemEmojis
}

export const searchSystemEmojis = (query: string): SystemEmoji[] => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  return getAllSystemEmojis().filter(
    (emoji) =>
      emoji.name.includes(normalized) ||
      emoji.keywords.some((keyword) => keyword.includes(normalized))
  )
}
