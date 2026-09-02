import { useCallback, useEffect, useRef, useState } from 'react'

// The Web Speech API is not in lib.dom on every TypeScript version, and the
// vendor-prefixed constructor never is. Declaring only what is used keeps this
// free of `any` and free of a global type collision.
type Alternative = { transcript: string }
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<Alternative>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}
type RecognitionCtor = new () => Recognition

function constructor(): RecognitionCtor | null {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/**
 * Dictation into the quick-add box. `supported` is false on iOS Safari and in
 * anything without the API, and the caller hides the button rather than
 * offering something that cannot work.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recogniser = useRef<Recognition | null>(null)
  const sink = useRef(onText)

  const supported = constructor() !== null

  useEffect(() => {
    sink.current = onText
  }, [onText])

  useEffect(() => {
    return () => {
      recogniser.current?.abort()
      recogniser.current = null
    }
  }, [])

  const stop = useCallback(() => {
    recogniser.current?.stop()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = constructor()
    if (!Ctor) return

    recogniser.current?.abort()
    const recogniser_ = new Ctor()
    recogniser.current = recogniser_

    recogniser_.lang = navigator.language || 'en-IN'
    recogniser_.continuous = false
    // Interim results let the text appear while speaking instead of after.
    recogniser_.interimResults = true

    recogniser_.onresult = (event) => {
      let text = ''
      for (let i = 0; i < event.results.length; i++) {
        const best = event.results[i]?.[0]
        if (best) text += best.transcript
      }
      sink.current(text.trim())
    }

    recogniser_.onerror = (event) => {
      setError(
        event.error === 'not-allowed'
          ? 'Microphone blocked. Allow it in the address bar.'
          : event.error === 'no-speech'
            ? 'Did not catch that.'
            : 'Dictation failed.',
      )
      setListening(false)
    }

    recogniser_.onend = () => setListening(false)

    setError(null)
    setListening(true)
    recogniser_.start()
  }, [])

  return { supported, listening, error, start, stop }
}
