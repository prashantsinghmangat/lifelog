import { describe, expect, it } from 'vitest'
import { forget, recall, remember } from './identity'

function fakeStorage(over: { broken?: boolean } = {}): Storage {
  const held = new Map<string, string>()
  return {
    get length() {
      return held.size
    },
    clear: () => held.clear(),
    key: (index: number) => [...held.keys()][index] ?? null,
    getItem: (key: string) => {
      if (over.broken === true) throw new Error('blocked')
      return held.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (over.broken === true) throw new Error('blocked')
      held.set(key, value)
    },
    removeItem: (key: string) => void held.delete(key),
  }
}

const ME = { id: 'user-1', email: 'you@example.com' }

describe('who this device belongs to', () => {
  it('remembers and recalls', () => {
    const storage = fakeStorage()
    remember(storage, ME)
    expect(recall(storage)).toEqual(ME)
  })

  it('knows nobody on a device that has never signed in', () => {
    expect(recall(fakeStorage())).toBeNull()
  })

  it('forgets on sign out, which must beat the offline path', () => {
    // Otherwise "sign out" would not sign anyone out until their token expired.
    const storage = fakeStorage()
    remember(storage, ME)
    forget(storage)
    expect(recall(storage)).toBeNull()
  })

  it('never throws when storage is unavailable', () => {
    // Private browsing, a full quota, a locked profile. None is worth a crash
    // on the path that decides whether the app renders at all.
    const broken = fakeStorage({ broken: true })
    expect(() => remember(broken, ME)).not.toThrow()
    expect(recall(broken)).toBeNull()
    expect(() => forget(broken)).not.toThrow()
  })

  it('ignores a stored value that is not an identity', () => {
    const storage = fakeStorage()
    storage.setItem('lifelog.who', '{"id":42}')
    expect(recall(storage)).toBeNull()

    storage.setItem('lifelog.who', 'not json at all')
    expect(recall(storage)).toBeNull()
  })

  it('ignores an identity with no id, which would key the log to nothing', () => {
    const storage = fakeStorage()
    storage.setItem('lifelog.who', JSON.stringify({ id: '', email: 'you@example.com' }))
    expect(recall(storage)).toBeNull()
  })
})
