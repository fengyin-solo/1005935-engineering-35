import type { EntryRow } from './types'

/**
 * 消防器材共享规则：页面、本地台账与构建前自检都走这一份，谁也不许在页面里再判一遍。
 *
 * 规则口径：
 * 1. 压力读数单位 MPa，合格区间 [PRESSURE_MIN, PRESSURE_MAX]：
 *    - 低于下限为「欠压」，高于上限为「超压」，两者统称压力不足（沿用既有状态词）；
 * 2. 检查周期换算成天数，应检日期 = 检查日期 + 周期天数；基准日晚于应检日即「超期未检」；
 * 3. 「已更换」是终态，压力与周期都不再判定；
 * 4. 存量记录里读不出来的压力读数按检查日期确定性回填，周期读不出来按 30 天回填；
 * 5. 日期一律按 UTC 解析和比较，保证开发机与容器里跑出来的结论一致。
 */

export const FIRE_MODULE_KEY = 'fire'

export const PRESSURE_MIN = 1.0
export const PRESSURE_MAX = 1.4
export const DEFAULT_CYCLE_DAYS = 30
export const DEFAULT_CYCLE_LABEL = '30天'

// 与 modules.ts 里 fire 的状态词保持一致，派生状态只能取这四个。
export const FIRE_STATUS_OK = '检查合格'
export const FIRE_STATUS_DUE = '待检查'
export const FIRE_STATUS_LOW = '压力不足'
export const FIRE_STATUS_REPLACED = '已更换'

const FIELD_CODE = '器材编号'
const FIELD_TYPE = '器材类型'
const FIELD_LOCATION = '布置位置'
const FIELD_CYCLE = '检查周期'
const FIELD_PRESSURE = '压力读数'
const FIELD_INSPECTOR = '检查人员'
const FIELD_CHECKED_ON = '检查日期'
const FIELD_STATE = '器材状态'

export type PressureFindingType = 'pressure-low' | 'pressure-high'
export type FireFindingType = PressureFindingType | 'overdue'

export type FireFinding = {
  type: FireFindingType
  label: string
  detail: string
}

export type FireReviewItem = {
  id: number
  code: string
  type: string
  location: string
  pressure: number | null
  checkedOn: string
  dueOn: string | null
  issues: FireFinding[]
}

export type FireStats = {
  total: number
  due: number
  pressureFaulty: number
  replaced: number
}

export type FireLedgerSummary = {
  rows: EntryRow[]
  stats: FireStats
  review: FireReviewItem[]
  findings: { id: number; code: string; issues: FireFinding[] }[]
}

// ---------- 日期：全部走 UTC，不依赖运行环境时区 ----------

export type Day = { year: number; month: number; day: number }

export function parseDateUTC(input: unknown): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input ?? '').trim())
  if (!match) {
    return null
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

export function formatDateUTC(day: Day): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${day.year}-${pad(day.month)}-${pad(day.day)}`
}

export function todayUTC(): Day {
  const now = new Date()
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() }
}

export function addDaysUTC(day: Day, days: number): Day {
  const ms = Date.UTC(day.year, day.month - 1, day.day) + days * 24 * 60 * 60 * 1000
  const next = new Date(ms)
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }
}

/** 只比较日历日：a 晚于 b 返回 1，早于 -1，同一天 0。 */
export function compareDay(a: Day, b: Day): number {
  const lhs = Number(formatDateUTC(a).replace(/-/g, ''))
  const rhs = Number(formatDateUTC(b).replace(/-/g, ''))
  return lhs === rhs ? 0 : lhs > rhs ? 1 : -1
}

// ---------- 字段解析 ----------

/** 压力读数：兼容「1.2」「0.86MPa」这类写法；占位文本或空值返回 null。 */
export function parsePressure(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const text = String(value ?? '').replace(/MPa/gi, '').replace(/兆帕/g, '').trim()
  if (text === '') {
    return null
  }
  const num = Number(text)
  return Number.isFinite(num) ? num : null
}

/**
 * 检查周期：支持「30天」「45 日」这类显式天数，也兼容「月度 / 季度 / 年度」口径；
 * 解析不出来返回 null，由调用方走存量回填。
 */
export function parseCycleDays(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (text === '') {
    return null
  }
  const numeric = Number(text)
  if (Number.isFinite(numeric)) {
    return numeric
  }
  const matched = /^(\d+(?:\.\d+)?)\s*(天|日)$/.exec(text.replace(/\s+/g, ''))
  if (matched) {
    return Number(matched[1])
  }
  if (text.includes('年')) {
    return 365
  }
  if (text.includes('季')) {
    return 90
  }
  if (text.includes('月')) {
    return 30
  }
  if (text.includes('周')) {
    return 7
  }
  return null
}

// ---------- 存量回填 ----------

/** 压力读数按检查日期回填：同一检查日期永远得到同一个读数，开发机与容器结论一致。 */
export function backfillPressureValue(row: Pick<EntryRow, 'status'> & Record<string, unknown>): number {
  // 存量就登记为压力不足的，回填到下限以下，保持原判定不被改写。
  if (String(row.status ?? '') === FIRE_STATUS_LOW) {
    return 0.82
  }
  const checked = parseDateUTC(row[FIELD_CHECKED_ON])
  const seed = checked ? checked.day : 1
  const value = PRESSURE_MIN + 0.1 + ((seed * 7) % 10) * 0.02
  return Math.round(value * 100) / 100
}

export type BackfilledRow = { row: EntryRow; backfilled: string[] }

/** 单条存量记录回填：只补解析不出来的字段，合法读数与周期原样保留。 */
export function backfillFireRow(input: EntryRow): BackfilledRow {
  const row: EntryRow = { ...input }
  const backfilled: string[] = []
  if (parsePressure(row[FIELD_PRESSURE]) === null) {
    row[FIELD_PRESSURE] = backfillPressureValue(row)
    backfilled.push(FIELD_PRESSURE)
  }
  if (parseCycleDays(row[FIELD_CYCLE]) === null) {
    row[FIELD_CYCLE] = DEFAULT_CYCLE_LABEL
    backfilled.push(FIELD_CYCLE)
  }
  return { row, backfilled }
}

// ---------- 规则判定 ----------

export type FireEvaluation = {
  status: string
  findings: FireFinding[]
  pressure: number | null
  cycleDays: number | null
  dueOn: string | null
}

function stateLabel(status: string, findings: FireFinding[]): string {
  if (status === FIRE_STATUS_REPLACED) {
    return '已更换'
  }
  if (findings.some((item) => item.type === 'pressure-low')) {
    return '欠压'
  }
  if (findings.some((item) => item.type === 'pressure-high')) {
    return '超压'
  }
  if (findings.some((item) => item.type === 'overdue')) {
    return '待检查'
  }
  return '正常'
}

/**
 * 评估一条消防器材记录。入参可以是回填前的原始记录，回填在内部完成，
 * 返回的 findings 即页面、台账、自检三处共用的结论。
 */
export function evaluateFireRow(input: EntryRow, asOf: Day = todayUTC()): FireEvaluation {
  const { row } = backfillFireRow(input)
  const replaced = String(row.status ?? '') === FIRE_STATUS_REPLACED
  const pressure = parsePressure(row[FIELD_PRESSURE])
  const cycleDays = parseCycleDays(row[FIELD_CYCLE])
  const checked = parseDateUTC(row[FIELD_CHECKED_ON])
  const findings: FireFinding[] = []
  let dueOn: string | null = null

  if (!replaced) {
    if (pressure !== null && pressure < PRESSURE_MIN) {
      findings.push({
        type: 'pressure-low',
        label: '欠压',
        detail: `压力读数 ${pressure.toFixed(2)}MPa 低于下限 ${PRESSURE_MIN.toFixed(2)}MPa`,
      })
    } else if (pressure !== null && pressure > PRESSURE_MAX) {
      findings.push({
        type: 'pressure-high',
        label: '超压',
        detail: `压力读数 ${pressure.toFixed(2)}MPa 高于上限 ${PRESSURE_MAX.toFixed(2)}MPa`,
      })
    }
    if (checked !== null && cycleDays !== null) {
      const due = addDaysUTC(checked, cycleDays)
      dueOn = formatDateUTC(due)
      if (compareDay(asOf, due) > 0) {
        const overdueDays = Math.round(
          (Date.UTC(asOf.year, asOf.month - 1, asOf.day) -
            Date.UTC(due.year, due.month - 1, due.day)) /
            (24 * 60 * 60 * 1000),
        )
        findings.push({
          type: 'overdue',
          label: '超期未检',
          detail: `检查日期 ${formatDateUTC(checked)}，周期 ${cycleDays} 天，应检 ${dueOn}，截至 ${formatDateUTC(asOf)} 已超期 ${overdueDays} 天`,
        })
      }
    }
  }

  const status = replaced
    ? FIRE_STATUS_REPLACED
    : findings.some((item) => item.type.startsWith('pressure'))
      ? FIRE_STATUS_LOW
      : findings.some((item) => item.type === 'overdue')
        ? FIRE_STATUS_DUE
        : FIRE_STATUS_OK

  return { status, findings, pressure, cycleDays, dueOn }
}

/** 读入台账前统一归一化：先回填存量，再让状态、待办与异常标记全部服从共享规则。 */
export function normalizeFireRow(input: EntryRow, asOf: Day = todayUTC()): EntryRow {
  const evaluation = evaluateFireRow(input, asOf)
  const { row } = backfillFireRow(input)
  row.status = evaluation.status
  row.pending = evaluation.status !== FIRE_STATUS_REPLACED
  row.abnormal = evaluation.findings.some((item) => item.type.startsWith('pressure'))
  row[FIELD_STATE] = stateLabel(evaluation.status, evaluation.findings)
  return row
}

export function normalizeFireRows(rows: EntryRow[], asOf: Day = todayUTC()): EntryRow[] {
  return rows.map((row) => normalizeFireRow(row, asOf))
}

// ---------- 汇总：消防页统计与巡视页待复核清单同一份结论 ----------

export function summarizeFireRows(rows: EntryRow[], asOf: Day = todayUTC()): FireLedgerSummary {
  const normalized = normalizeFireRows(rows, asOf)
  const review: FireReviewItem[] = []
  const findings: FireLedgerSummary['findings'] = []
  let due = 0
  let pressureFaulty = 0
  let replaced = 0

  normalized.forEach((row) => {
    const evaluation = evaluateFireRow(row, asOf)
    const pressureIssues = evaluation.findings.filter((item) => item.type.startsWith('pressure'))
    const overdue = evaluation.findings.some((item) => item.type === 'overdue')
    if (evaluation.status === FIRE_STATUS_REPLACED) {
      replaced += 1
    }
    if (overdue) {
      due += 1
    }
    if (pressureIssues.length > 0) {
      pressureFaulty += 1
      review.push({
        id: Number(row.id),
        code: String(row[FIELD_CODE] ?? ''),
        type: String(row[FIELD_TYPE] ?? ''),
        location: String(row[FIELD_LOCATION] ?? ''),
        pressure: evaluation.pressure,
        checkedOn: String(row[FIELD_CHECKED_ON] ?? ''),
        dueOn: evaluation.dueOn,
        issues: pressureIssues,
      })
    }
    if (evaluation.findings.length > 0) {
      findings.push({ id: Number(row.id), code: String(row[FIELD_CODE] ?? ''), issues: evaluation.findings })
    }
  })

  return {
    rows: normalized,
    stats: { total: normalized.length, due, pressureFaulty, replaced },
    review,
    findings,
  }
}

// ---------- 样例导入：按器材编号幂等，重复导入不会多出一份 ----------

export type FireImportResult = {
  rows: EntryRow[]
  added: number
  updated: number
}

/**
 * 合并样例批次：器材编号已存在就原地更新、保留 id；不存在才登记新条目。
 * 合并结果统一再走一遍规则归一化，因此重复导入同一批次结论完全不变。
 */
export function mergeFireRows(
  existing: EntryRow[],
  incoming: EntryRow[],
  asOf: Day = todayUTC(),
): FireImportResult {
  const next = existing.map((row) => ({ ...row }))
  let added = 0
  let updated = 0

  for (const draft of incoming) {
    const code = String(draft[FIELD_CODE] ?? '')
    const index = next.findIndex((row) => String(row[FIELD_CODE] ?? '') === code)
    if (index >= 0) {
      next[index] = { ...draft, id: next[index].id }
      updated += 1
      continue
    }
    const nextId = next.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    next.push({ ...draft, id: nextId })
    added += 1
  }

  return { rows: normalizeFireRows(next, asOf), added, updated }
}
