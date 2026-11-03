/**
 * Shared time utilities — presets, range math, granularity, compare periods.
 * Weeks start Monday; all math in the host's local timezone (enterprise TZ).
 */

export const PRESETS = [
  { id: 'today', label: '今天', unit: 'day' },
  { id: 'yesterday', label: '昨天', unit: 'day' },
  { id: 'this_week', label: '本周', unit: 'week' },
  { id: 'last_week', label: '上周', unit: 'week' },
  { id: 'last_7_days', label: '最近 7 天', unit: 'week' },
  { id: 'this_month', label: '本月', unit: 'month' },
  { id: 'last_month', label: '上月', unit: 'month' },
  { id: 'last_30_days', label: '最近 30 天', unit: 'month' },
  { id: 'company_period', label: '上周五 → 本周四', unit: 'week' },
  { id: 'this_quarter', label: '本季度', unit: 'quarter' },
  { id: 'last_quarter', label: '上季度', unit: 'quarter' },
  { id: 'this_year', label: '今年', unit: 'year' },
  { id: 'last_year', label: '去年', unit: 'year' },
]

const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7)) // Monday
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1)
const startOfQuarter = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)

/** Monday of the natural week containing d. */
function mondayOf(d) {
  return addDays(d, -((d.getDay() + 6) % 7))
}

/**
 * 报工周期口径：上周五 → 本周四（含）。
 * 始终锚定「本周四」，因此在周五~周日也不会滑成「本周五 → 下周四」。
 */
function thisThursday(d) {
  return addDays(mondayOf(d), 3)
}

function presetRange(id, today = new Date()) {
  switch (id) {
    case 'company_period': { const end = thisThursday(today); return [addDays(end, -6), end] }
    case 'today': return [today, today]
    case 'yesterday': { const y = addDays(today, -1); return [y, y] }
    case 'this_week': return [startOfWeek(today), today]
    case 'last_week': { const s = addDays(startOfWeek(today), -7); return [s, addDays(s, 6)] }
    case 'last_7_days': return [addDays(today, -6), today]
    case 'this_month': return [startOfMonth(today), today]
    case 'last_month': { const s = new Date(today.getFullYear(), today.getMonth() - 1, 1); return [s, new Date(today.getFullYear(), today.getMonth(), 0)] }
    case 'last_30_days': return [addDays(today, -29), today]
    case 'this_quarter': return [startOfQuarter(today), today]
    case 'last_quarter': { const s = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 - 3, 1); return [s, new Date(s.getFullYear(), s.getMonth() + 3, 0)] }
    case 'this_year': return [new Date(today.getFullYear(), 0, 1), today]
    case 'last_year': return [new Date(today.getFullYear() - 1, 0, 1), new Date(today.getFullYear() - 1, 11, 31)]
    default: throw new Error(`unknown preset: ${id}`)
  }
}

export function defaultGranularity(days) {
  if (days <= 14) return 'day'
  if (days <= 90) return 'week'
  if (days <= 365) return 'month'
  return 'quarter'
}

/**
 * Resolve a range request into concrete dates + previous compare period.
 * Accepts {preset} or {start, end}; granularity defaults by span length.
 */
export function resolveRange({ preset, start, end, granularity, compare } = {}) {
  let s
  let e
  if (preset) {
    ;[s, e] = presetRange(preset)
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start ?? '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end ?? ''))) {
      const err = new Error('invalid range: require preset or start/end as YYYY-MM-DD')
      err.status = 400
      throw err
    }
    s = parse(start)
    e = parse(end)
    if (s > e) [s, e] = [e, s]
  }
  const days = Math.round((e - s) / 86_400_000) + 1
  const gran = ['day', 'week', 'month', 'quarter'].includes(granularity)
    ? granularity
    : defaultGranularity(days)
  // compare period: same length immediately before
  const prevEnd = addDays(s, -1)
  const prevStart = addDays(prevEnd, -(days - 1))
  return {
    preset: preset ?? null,
    startDate: fmt(s),
    endDate: fmt(e),
    days,
    granularity: gran,
    compare: !!compare,
    prevStartDate: fmt(prevStart),
    prevEndDate: fmt(prevEnd),
  }
}

/** Bucket an ISO date into a granular bucket label. */
export function bucketOf(isoDate, granularity) {
  const d = parse(isoDate.slice(0, 10))
  switch (granularity) {
    case 'day': return fmt(d)
    case 'week': return fmt(startOfWeek(d))
    case 'month': return isoDate.slice(0, 7)
    case 'quarter': return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
    default: return fmt(d)
  }
}
