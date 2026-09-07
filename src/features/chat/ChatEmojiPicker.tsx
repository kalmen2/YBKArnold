// A small emoji keyboard. Berry ships emoji-picker-react; we keep the same
// affordance without pulling a dependency in for a grid of buttons.
import { useMemo, useState } from 'react'
import { Box, Stack, Tab, Tabs } from '@mui/material'

const emojiGroups: { id: string; label: string; emojis: string[] }[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😅', '😂', '🙂', '😉', '😊', '😍',
      '😘', '😎', '🤩', '🤔', '🤨', '😐', '😑', '🙄', '😴', '😪',
      '😮', '😯', '😢', '😭', '😤', '😡', '🤯', '😳', '🥳', '🤗',
      '🤝', '🙏', '👏', '👍', '👎', '👌', '✌️', '🤞', '💪', '🫡',
    ],
  },
  {
    id: 'work',
    label: 'Shop',
    emojis: [
      '🔨', '🪚', '🪛', '🔧', '🧰', '📏', '📐', '🪵', '🚪', '🪑',
      '🏗️', '🏭', '📦', '🚚', '🚛', '🧾', '📋', '📆', '⏰', '⏳',
      '✅', '❌', '⚠️', '🚧', '🔥', '💡', '🔍', '📸', '🖨️', '💰',
    ],
  },
  {
    id: 'hearts',
    label: 'Signals',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💯', '⭐', '🌟',
      '🎉', '🎊', '🚀', '⚡', '☀️', '🌧️', '❄️', '☕', '🍕', '🍔',
    ],
  },
]

export function ChatEmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [activeTab, setActiveTab] = useState(0)
  const activeGroup = useMemo(() => emojiGroups[activeTab] ?? emojiGroups[0], [activeTab])

  return (
    <Box sx={{ width: 296 }}>
      <Tabs
        value={activeTab}
        onChange={(_event, value) => setActiveTab(Number(value))}
        variant="fullWidth"
        sx={{ minHeight: 38, '& .MuiTab-root': { minHeight: 38, fontSize: 12 } }}
      >
        {emojiGroups.map((group) => (
          <Tab key={group.id} label={group.label} />
        ))}
      </Tabs>

      <Stack
        direction="row"
        flexWrap="wrap"
        sx={{ p: 1, maxHeight: 220, overflowY: 'auto' }}
      >
        {activeGroup.emojis.map((emoji) => (
          <Box
            key={emoji}
            component="button"
            type="button"
            aria-label={`Insert ${emoji}`}
            onClick={() => onSelect(emoji)}
            sx={{
              width: 36,
              height: 36,
              fontSize: 20,
              lineHeight: 1,
              border: 0,
              borderRadius: '6px',
              cursor: 'pointer',
              background: 'transparent',
              '&:hover': { backgroundColor: 'action.hover' },
            }}
          >
            {emoji}
          </Box>
        ))}
      </Stack>
    </Box>
  )
}
