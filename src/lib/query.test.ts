import { describe, expect, it } from 'vitest'
import { answer, parseQuestion, periodOf, phrase, summarise } from './query'
import type { Entry, Kind } from '../types'

// Saturday, 5 September 2026.
const NOW = new Date(2026, 8, 5, 12, 0, 0)

let seq = 0
function entry(over: Partial<Entry> & { occurred_on: string }): Entry {
  seq += 1
  return {
    id: `id-${seq}`,
    kind: 'expense' as Kind,
    occurred_at: null,
    title: 'something',
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-01T10:00:00+05:30',
    ...over,
  }
}

const LOG: Entry[] = [
  entry({ occurred_on: '2026-09-05', title: 'gym', kind: 'time', duration_minutes: 60 }),
  entry({ occurred_on: '2026-09-03', title: 'gym', kind: 'time', duration_minutes: 45 }),
  entry({ occurred_on: '2026-09-03', title: 'gym again', kind: 'time', duration_minutes: 30 }),
  entry({ occurred_on: '2026-08-28', title: 'gym', kind: 'time', duration_minutes: 60 }),
  entry({ occurred_on: '2026-09-04', title: 'deepak kiran store', amount_paise: 24000 }),
  entry({ occurred_on: '2026-09-01', title: 'deepak kiran store', amount_paise: 16000 }),
  entry({ occurred_on: '2026-08-15', title: 'deepak kiran store', amount_paise: 30000 }),
  entry({ occurred_on: '2026-09-02', title: 'lunch swiggy', amount_paise: 35000, category: 'food' }),
  entry({ occurred_on: '2026-08-20', title: 'dinner swiggy', amount_paise: 45000, category: 'food' }),
]

const ask = (text: string) => parseQuestion(text, NOW)

describe('recognising a question', () => {
  it('needs the ? prefix, so ordinary entries are never mistaken for questions', () => {
    expect(ask('gym')).toBeNull()
    expect(ask('350 lunch swiggy')).toBeNull()
    expect(ask('? gym')).not.toBeNull()
  })

  it('strips question scaffolding down to the subject', () => {
    expect(ask('? how many days did i go to gym')?.terms).toEqual(['gym'])
    expect(ask('? how much have i spent on swiggy')?.terms).toEqual(['swiggy'])
  })

  it('keeps a multi-word subject intact', () => {
    expect(ask('? how many days deepak kiran store')?.terms).toEqual([
      'deepak',
      'kiran',
      'store',
    ])
  })

  it('reads which number is wanted', () => {
    expect(ask('? how many days gym')?.measure).toBe('days')
    expect(ask('? how many times swiggy')?.measure).toBe('times')
    expect(ask('? how much on swiggy')?.measure).toBe('money')
    expect(ask('? hours worked this week')?.measure).toBe('hours')
    expect(ask('? gym')?.measure).toBeNull()
  })
})

describe('periods', () => {
  const period = (text: string) => periodOf(text, NOW).range

  it('reads this and last month', () => {
    expect(period('gym this month')).toMatchObject({ from: '2026-09-01', to: '2026-09-05' })
    expect(period('gym last month')).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('reads rolling windows', () => {
    expect(period('gym last 7 days')).toMatchObject({ from: '2026-08-30', to: '2026-09-05' })
    expect(period('gym today')).toMatchObject({ from: '2026-09-05', to: '2026-09-05' })
    expect(period('gym yesterday')).toMatchObject({ from: '2026-09-04', to: '2026-09-04' })
  })

  it('reads a bare month name, choosing the one already begun', () => {
    expect(period('gym august')).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
    // December has not happened in 2026 yet, so it means last December.
    expect(period('gym december')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('removes the period from the text so it cannot become a search term', () => {
    expect(periodOf('gym last month', NOW).rest.trim()).toBe('gym')
    expect(ask('? swiggy last month')?.terms).toEqual(['swiggy'])
  })

  it('is null when no period is named', () => {
    expect(period('gym')).toBeNull()
  })

  it('reads a weekday, resolving backwards like the parser does', () => {
    // NOW is Saturday 5 September, so "last saturday" is the 5th itself.
    expect(period('what did i do last saturday')).toMatchObject({
      from: '2026-09-05',
      to: '2026-09-05',
    })
    expect(period('what did i do friday')).toMatchObject({
      from: '2026-09-04',
      to: '2026-09-04',
    })
  })

  it('reads a written date', () => {
    // The parser resolves a bare "14 nov" within the current year, and the
    // question grammar follows it rather than inventing its own rule.
    expect(period('dinner 14 nov')).toMatchObject({ from: '2026-11-14', to: '2026-11-14' })
    expect(period('books 20 august')).toMatchObject({ from: '2026-08-20', to: '2026-08-20' })
  })

  it('reads "N days ago"', () => {
    expect(period('what happened 3 days ago')).toMatchObject({
      from: '2026-09-02',
      to: '2026-09-02',
    })
  })

  it('widens "around" into a window, because memory is not exact', () => {
    expect(period('what was i working on around 20 august')).toMatchObject({
      from: '2026-08-17',
      to: '2026-08-23',
    })
  })

  it('removes a date from the text so it cannot become a search term', () => {
    expect(ask('? what did i do last saturday')?.terms).toEqual([])
    expect(ask('? swiggy around 20 august')?.terms).toEqual(['swiggy'])
  })

  it('leaves a bare month as the whole month, not a single day', () => {
    expect(period('gym august')).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
  })
})

describe('counting', () => {
  const of = (text: string) =>
    summarise(LOG, ask(text) ?? { terms: [], range: null, measure: null }, NOW)

  it('counts distinct days, not entries', () => {
    // Four gym entries, but two of them fall on the same day.
    const summary = of('? how many days gym')
    expect(summary.entries).toBe(4)
    expect(summary.days).toBe(3)
  })

  it('requires every term to match', () => {
    expect(of('? deepak kiran store').entries).toBe(3)
    // "kiran" alone still matches the same rows; a term that is nowhere does not.
    expect(of('? deepak bakery').entries).toBe(0)
  })

  it('totals money and time', () => {
    expect(of('? deepak kiran store').paise).toBe(70000)
    expect(of('? gym').minutes).toBe(195)
  })

  it('respects the period', () => {
    expect(of('? gym this month').days).toBe(2)
    expect(of('? deepak kiran store this month').paise).toBe(40000)
    expect(of('? deepak kiran store last month').paise).toBe(30000)
  })

  it('matches the category as well as the title', () => {
    expect(of('? food').entries).toBe(2)
  })

  it('reports the most recent matching day', () => {
    expect(of('? gym').last).toBe('2026-09-05')
  })

  it('finds nothing gracefully', () => {
    expect(of('? unicorn').entries).toBe(0)
  })
})

describe('when something happens next', () => {
  const BIRTHDAYS: Entry[] = [
    // Logged for 13 February, which is seven months in the past right now.
    entry({
      occurred_on: '2026-02-13',
      title: 'deepak birthday',
      kind: 'event',
      data: { rrule: 'FREQ=YEARLY' },
    }),
    entry({
      occurred_on: '2026-11-14',
      title: 'riya birthday',
      kind: 'event',
      data: { rrule: 'FREQ=YEARLY' },
    }),
    entry({ occurred_on: '2026-09-20', title: 'dentist', kind: 'event' }),
    entry({ occurred_on: '2026-07-01', title: 'old standup', kind: 'event' }),
  ]

  const say = (text: string) => {
    const question = ask(text)
    if (question === null) return 'not a question'
    return phrase(summarise(BIRTHDAYS, question, NOW), question, NOW)
  }

  it('answers "when is X birthday" with a date, not a tally', () => {
    // The bug: "when" was treated as a search term and matched nothing.
    const answer = say('? when is deepak birthday')
    expect(answer).toContain('13 February')
    expect(answer).not.toContain('entries')
  })

  it('rolls a past anniversary forward to the next one', () => {
    // February 2026 has gone, so the answer is February 2027 and says the year.
    expect(say('? when is deepak birthday')).toContain('2027')
  })

  it('keeps this year when the date has not passed', () => {
    const answer = say('? when is riya birthday')
    expect(answer).toContain('14 November')
    expect(answer).not.toContain('2027')
  })

  it('says how far away it is', () => {
    expect(say('? when is riya birthday')).toMatch(/in \d+ days/)
  })

  it('leads with the date even when the question forgot to ask "when"', () => {
    expect(say('? deepak birthday')).toContain('February')
  })

  it('names the weekday, which is what a birthday is actually planned around', () => {
    expect(say('? when is riya birthday')).toContain('Saturday')
  })

  it('does not resurrect a one-off event that has passed', () => {
    expect(say('? when is old standup')).toBe('nothing upcoming')
  })

  it('uses a future one-off as it stands', () => {
    expect(say('? when is dentist')).toContain('20 September')
  })

  it('picks the soonest when several match', () => {
    // Both birthdays match "birthday"; November comes before next February.
    expect(say('? when is birthday')).toContain('November')
  })

  it('still counts when asked to count', () => {
    expect(say('? how many times birthday')).toContain('2 times')
  })
})

describe('the parts an answer is laid out from', () => {
  const of = (text: string) => {
    const question = parseQuestion(text, NOW)
    if (question === null) throw new Error('not a question')
    return answer(summarise(LOG, question, NOW), question, NOW)
  }

  it('names what was asked about, so the number is not floating free', () => {
    expect(of('? how much on swiggy last month').caption).toBe('swiggy · last month')
    expect(of('? how many days gym').caption).toBe('gym')
    // No subject, so the period is the whole of what was asked about.
    expect(of('? what did i do yesterday').caption).toBe('yesterday')
  })

  it('leads with the measure and keeps the rest beside it', () => {
    const said = of('? how many days gym')
    expect(said.lead).toBe('3 days')
    expect(said.extras).toEqual(['3h 15m', 'last today'])
  })

  it('carries every match, so the card decides how many to show', () => {
    expect(of('? gym').rows).toHaveLength(4)
    expect(of('? unicorn').rows).toEqual([])
  })

  it('orders the past most recent first', () => {
    expect(of('? gym').rows.map((row) => row.occurred_on)).toEqual([
      '2026-09-05',
      '2026-09-03',
      '2026-09-03',
      '2026-08-28',
    ])
  })

  it('flags a single day, which is what makes rows show a clock not a date', () => {
    expect(of('? what did i do yesterday').oneDay).toBe(true)
    expect(of('? gym this month').oneDay).toBe(false)
    expect(of('? gym').oneDay).toBe(false)
  })

  it('says the same thing as the sentence, because the sentence is built from it', () => {
    for (const text of ['? how many days gym', '? how much deepak kiran store', '? unicorn']) {
      const question = parseQuestion(text, NOW)
      if (question === null) throw new Error('not a question')
      const summary = summarise(LOG, question, NOW)
      const said = answer(summary, question, NOW)
      expect([said.lead, ...said.extras].join(' · ')).toBe(phrase(summary, question, NOW))
    }
  })
})

describe('phrasing', () => {
  const say = (text: string) => {
    const question = ask(text)
    if (question === null) return 'not a question'
    return phrase(summarise(LOG, question, NOW), question, NOW)
  }

  it('leads with what was asked for', () => {
    expect(say('? how many days gym')).toContain('3 days')
    expect(say('? how much deepak kiran store')).toContain('₹700')
    expect(say('? how many times gym')).toContain('4 times')
  })

  it('adds the other facts that happen to be true', () => {
    expect(say('? how many days gym')).toContain('3h 15m')
  })

  it('says when it last happened', () => {
    expect(say('? gym')).toContain('last today')
    expect(say('? deepak kiran store')).toContain('last yesterday')
  })

  it('answers an unrecognised question with counts rather than an apology', () => {
    expect(say('? gym')).toContain('4 entries')
    expect(say('? gym')).toContain('3 days')
  })

  it('says so when there is nothing', () => {
    expect(say('? unicorn')).toBe('nothing found')
  })

  it('pluralises properly', () => {
    expect(say('? how many days swiggy this month')).toContain('1 day')
    expect(say('? how many days swiggy this month')).not.toContain('1 days')
  })
})
