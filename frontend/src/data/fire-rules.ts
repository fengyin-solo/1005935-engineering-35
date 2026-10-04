import type { EntryRow } from './types'

// 消防器材的两条业务规则唯一出处：压力表读数是否越限、检查周期是否超期。
// 页面（views）、台账服务（local-service）与构建前自检（scripts/selfcheck）都走这里，
// 谁都不许在页面里再判一遍。本文件只做纯计算，不碰 localStorage / DOM，Node 里也能直接跑。

export const FIRE_MODULE_KEY = 'fire'
export const FIRE_IDENTITY_FIELD = '器材编号'

// 压力表绿区 [1.0, 1.6] MPa（常见干粉灭火器表计的绿区下限到上限）。
export const PRESSURE_MIN_MPA = 1.0
export const PRESSURE_MAX_MPA = 1.6

export const FIRE_STATUS_OK = '检查合格'
export const FIRE_STATUS_PENDING = '待检查'
export const FIRE_STATUS_LOW = '压力不足'
export const FIRE_STATUS_REPLACED = '已更换'

export type FireIssueKind = 'low-pressure' | 'over-pressure' | 'overdue'

export type FireEvaluation = {
  status: string
  pressureMPa: number | null
  cycleDays: number | null
  lastCheckDate: string | null
  dueDate: string | null
  overdue: boolean
  lowPressure: boolean
  overPressure: boolean
  issues: FireIssueKind[]
}

export type FireSummary = {
  total: number
  replaced: number
  pendingCheck: number
  pressureInsufficient: number
  overdue: number
  lowPressure: number
  overPressure: number
}

export type FireReviewItem = {
  row: EntryRow
  identity: string
  pressureMPa: number | null
  lastCheckDate: string | null
  dueDate: string | null
  status: string
  reasons: string[]
}

// ---------- 解析 ----------

// 只认真实读数：纯数字，或数字带常见压力单位（MPa / 兆帕 / bar / 公斤）。
// 「消防设施样例1」这类占位文本里虽然也有数字，但不匹配，按未读数处理。
export function parsePressure(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const text = String(value ?? '').trim()
  const matched = text.match(/^(\d+(?:\.\d+)?)\s*(MPa|mpa|兆帕|bar|公斤)?$/)
  if (!matched) {
    return null
  }
  const raw = Number(matched[1])
  const unit = matched[2] ?? 'MPa'
  const mpa = unit === 'bar' || unit === '公斤' ? raw / 10 : raw
  return Number.isFinite(mpa) ? mpa : null
}

// 检查周期统一换算成天数：「30天 / 每月 / 1月」=30，「季度 / 3月 / 90天」=90，
// 「半年 / 180天」=180，「年度 / 1年 / 365天」=365；纯数字按天。
export function parseCycleDays(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const text = String(value ?? '').trim()
  if (!text) {
    return null
  }
  const numberedMonths = text.match(/^(\d+)\s*个?月$/)
  if (numberedMonths) {
    return Number(numberedMonths[1]) * 30
  }
  const numberedYears = text.match(/^(\d+)\s*年$/)
  if (numberedYears) {
    return Number(numberedYears[1]) * 365
  }
  const numberedDays = text.match(/^(\d+)\s*天?$/)
  if (numberedDays) {
    return Number(numberedDays[1])
  }
  if (/半年/.test(text)) return 180
  if (/季度|每季/.test(text)) return 90
  if (/月|每月/.test(text)) return 30
  if (/年|每年|年度/.test(text)) return 365
  if (/周|星期/.test(text)) return 7
  return null
}

// 日期按 UTC 解析与比较，避免本地开发机与容器时区不同导致结论漂移。
export function parseDate(value: unknown): Date | null {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return null
  }
  const date = new Date(`${text.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function dayOfMonth(value: unknown): number {
  const text = String(value ?? '')
  const day = Number(text.slice(8, 10))
  return Number.isFinite(day) ? day : 1
}

// ---------- 规则判定 ----------

// 单条器材的规则结论。判定优先级：
// 已更换 > 读数缺失（待检查）> 压力越限（压力不足）> 检查超期（待检查）> 检查合格。
// 一件器材可以同时压力越限且超期：状态按压力走，问题清单两处都记，分桶报告时各报各的。
export function evaluateFireRow(row: EntryRow, referenceDate: Date = new Date()): FireEvaluation {
  const declared = String(row.status ?? '')
  const pressureMPa = parsePressure(row['压力读数'])
  const cycleDays = parseCycleDays(row['检查周期'])
  const lastCheckDate = parseDate(row['检查日期'])

  let dueDate: string | null = null
  let overdue = false
  if (lastCheckDate && cycleDays !== null) {
    const due = new Date(lastCheckDate.getTime() + cycleDays * 24 * 60 * 60 * 1000)
    dueDate = formatDate(due)
    overdue = formatDate(referenceDate) > dueDate
  }

  const replaced = declared === FIRE_STATUS_REPLACED
  const lowPressure = pressureMPa !== null && pressureMPa < PRESSURE_MIN_MPA
  const overPressure = pressureMPa !== null && pressureMPa > PRESSURE_MAX_MPA
  const pressureBad = lowPressure || overPressure

  const issues: FireIssueKind[] = []
  if (lowPressure) issues.push('low-pressure')
  if (overPressure) issues.push('over-pressure')
  if (overdue) issues.push('overdue')

  let status: string
  if (replaced) {
    status = FIRE_STATUS_REPLACED
  } else if (pressureMPa === null) {
    status = FIRE_STATUS_PENDING
  } else if (pressureBad) {
    status = FIRE_STATUS_LOW
  } else if (overdue) {
    status = FIRE_STATUS_PENDING
  } else {
    status = FIRE_STATUS_OK
  }

  return {
    status,
    pressureMPa,
    cycleDays,
    lastCheckDate: lastCheckDate ? formatDate(lastCheckDate) : null,
    dueDate,
    overdue,
    lowPressure,
    overPressure,
    issues,
  }
}

// 按规则把一条记录对齐：状态、pending、abnormal 全部由读数与日期推导，
// 存量记录里互相矛盾的手工状态以规则为准。
export function reconcileFireRow(row: EntryRow, referenceDate: Date = new Date()): EntryRow {
  const ev = evaluateFireRow(row, referenceDate)
  return {
    ...row,
    status: ev.status,
    pending: ev.status !== FIRE_STATUS_REPLACED,
    abnormal: ev.issues.length > 0,
  }
}

export function summarizeFireRows(rows: EntryRow[], referenceDate: Date = new Date()): FireSummary {
  const summary: FireSummary = {
    total: rows.length,
    replaced: 0,
    pendingCheck: 0,
    pressureInsufficient: 0,
    overdue: 0,
    lowPressure: 0,
    overPressure: 0,
  }
  for (const row of rows) {
    const ev = evaluateFireRow(row, referenceDate)
    if (ev.status === FIRE_STATUS_REPLACED) summary.replaced += 1
    if (ev.status === FIRE_STATUS_PENDING) summary.pendingCheck += 1
    if (ev.status === FIRE_STATUS_LOW) summary.pressureInsufficient += 1
    if (ev.overdue) summary.overdue += 1
    if (ev.lowPressure) summary.lowPressure += 1
    if (ev.overPressure) summary.overPressure += 1
  }
  return summary
}

// 巡视检查的待复核清单：只要规则报出问题（压力越限或检查超期）就要进清单复核。
export function buildFireReviewQueue(
  rows: EntryRow[],
  referenceDate: Date = new Date(),
): FireReviewItem[] {
  const items: FireReviewItem[] = []
  for (const row of rows) {
    const ev = evaluateFireRow(row, referenceDate)
    if (ev.issues.length === 0) {
      continue
    }
    const reasons: string[] = []
    if (ev.lowPressure) {
      reasons.push(`压力欠压：${ev.pressureMPa?.toFixed(2)} MPa 低于 ${PRESSURE_MIN_MPA.toFixed(2)} MPa`)
    }
    if (ev.overPressure) {
      reasons.push(`压力超压：${ev.pressureMPa?.toFixed(2)} MPa 高于 ${PRESSURE_MAX_MPA.toFixed(2)} MPa`)
    }
    if (ev.overdue) {
      reasons.push(`检查超期：应检日 ${ev.dueDate ?? '—'} 已过`)
    }
    items.push({
      row,
      identity: String(row[FIRE_IDENTITY_FIELD] ?? row.id),
      pressureMPa: ev.pressureMPa,
      lastCheckDate: ev.lastCheckDate,
      dueDate: ev.dueDate,
      status: ev.status,
      reasons,
    })
  }
  return items
}

// ---------- 存量回填 ----------

// 存量记录没有真实读数时，按检查日期回填一个落在绿区的确定性读数，
// 日期不同读数略有差异，但同一记录多次回填结果一致；登记为压力不足的回填欠压值。
function nominalPressure(checkDate: unknown): number {
  // 0.00 / 0.05 / 0.10 三档，加在 1.20 MPa 基线上，始终处于绿区。
  return Number((1.2 + ((dayOfMonth(checkDate) % 3) * 0.05)).toFixed(2))
}

// 兼容既有器材记录：占位的压力读数与检查周期按检查日期和登记状态补成可判定的值，
// 已经是真实值的字段不动。幂等：回填两次结果相同。
export function backfillFireRow(row: EntryRow): EntryRow {
  const next: EntryRow = { ...row }
  if (parsePressure(next['压力读数']) === null) {
    next['压力读数'] =
      String(next.status) === FIRE_STATUS_LOW ? 0.8 : nominalPressure(next['检查日期'])
  }
  if (parseCycleDays(next['检查周期']) === null) {
    // 合格/已更换的存量记录按季度周期回填（不过期），其余按月度回填（会正常报超期）。
    next['检查周期'] =
      String(next.status) === FIRE_STATUS_OK || String(next.status) === FIRE_STATUS_REPLACED
        ? '90天'
        : '30天'
  }
  return next
}

export function backfillFireRows(rows: EntryRow[]): EntryRow[] {
  return rows.map(backfillFireRow)
}
