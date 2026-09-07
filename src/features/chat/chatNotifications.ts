// The "you got a message" chime. Synthesised rather than shipped as an audio
// file so there is no asset to load, cache or 404 — and it stays crisp at any
// volume.
const muteStorageKey = 'arnold:chat-sound-muted'

type AudioContextConstructor = typeof AudioContext

let sharedAudioContext: AudioContext | null = null

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') {
    return null
  }

  const candidate = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext

  return candidate ?? null
}

// Browsers refuse to start audio before the user has interacted with the page,
// so the context is created on the first click and reused from then on.
export function primeChatChime() {
  const AudioContextCtor = resolveAudioContextConstructor()

  if (!AudioContextCtor) {
    return
  }

  try {
    if (!sharedAudioContext) {
      sharedAudioContext = new AudioContextCtor()
    }

    if (sharedAudioContext.state === 'suspended') {
      void sharedAudioContext.resume()
    }
  } catch {
    // Audio is a nicety; never let it break the page.
  }
}

export function isChatSoundMuted() {
  try {
    return window.localStorage.getItem(muteStorageKey) === 'true'
  } catch {
    return false
  }
}

export function setChatSoundMuted(muted: boolean) {
  try {
    window.localStorage.setItem(muteStorageKey, muted ? 'true' : 'false')
  } catch {
    // Browser storage is optional.
  }
}

export function playChatChime() {
  if (isChatSoundMuted()) {
    return
  }

  primeChatChime()

  const context = sharedAudioContext

  if (!context || context.state !== 'running') {
    return
  }

  try {
    // Two short rising tones — reads as a notification, not an alarm.
    const startAt = context.currentTime
    const tones = [
      { frequency: 880, offset: 0 },
      { frequency: 1174.66, offset: 0.11 },
    ]

    for (const tone of tones) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const toneStart = startAt + tone.offset

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(tone.frequency, toneStart)

      // Ramped envelope, otherwise the abrupt start and stop click audibly.
      gain.gain.setValueAtTime(0.0001, toneStart)
      gain.gain.exponentialRampToValueAtTime(0.16, toneStart + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.13)

      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(toneStart)
      oscillator.stop(toneStart + 0.15)
    }
  } catch {
    // Ignore audio failures.
  }
}

// --- incoming call ringing -------------------------------------------------
// A ring is not a chime: it has to repeat until answered, and it has to be
// stoppable from anywhere, so the interval handle lives at module scope.
let ringtoneIntervalId: number | null = null

function playRingBurst() {
  primeChatChime()

  const context = sharedAudioContext

  if (!context || context.state !== 'running') {
    return
  }

  try {
    const startAt = context.currentTime

    // Two paired warbles, like a desk phone.
    for (const offset of [0, 0.42]) {
      for (const tone of [{ frequency: 660, at: 0 }, { frequency: 520, at: 0.18 }]) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        const toneStart = startAt + offset + tone.at

        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(tone.frequency, toneStart)
        gain.gain.setValueAtTime(0.0001, toneStart)
        gain.gain.exponentialRampToValueAtTime(0.2, toneStart + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.17)

        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(toneStart)
        oscillator.stop(toneStart + 0.19)
      }
    }
  } catch {
    // Ignore audio failures.
  }
}

export function startChatRingtone() {
  if (ringtoneIntervalId !== null || isChatSoundMuted()) {
    return
  }

  playRingBurst()
  ringtoneIntervalId = window.setInterval(playRingBurst, 2400)
}

export function stopChatRingtone() {
  if (ringtoneIntervalId === null) {
    return
  }

  window.clearInterval(ringtoneIntervalId)
  ringtoneIntervalId = null
}
