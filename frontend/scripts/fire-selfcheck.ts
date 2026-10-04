/**
 * 消防器材台账构建前自检：把示例数据喂给 src/data 下的共享规则，
 * 越限压力（欠压/超压）与超期未检各报各的，并校验规则口径只有一份。
 *
 * 用法：
 *   node scripts/selfcheck.mjs                # 基准日取 UTC 今天
 *   node scripts/selfcheck.mjs 2026-10-04     # 指定基准日（UTC）
 *
 * 退出码非 0 时构建中止，不允许上线。
 */
import {
  PRESSURE_MIN,
  PRESSURE_MAX,
  backfillFireRow,
  backfillPressureValue,
  evaluateFireRow,
  mergeFireRows,
  parseCycleDays,
  parseDateUTC,
  parsePressure,
  summarizeFireRows,
  type Day,
  type FireFinding,
} from '../src/data/fire-rules'
import type { EntryRow } from '../src/data/types'
import { FIRE_SAMPLE_BATCH, SEED_ROWS } from '../src/data/seed'

const failures: string[] = []

function fail(message: string): void {
  failures.push(message)
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    fail(message)
  }
}

const asOf: Day = (() => {
  const arg = process.argv[2]
  if (!arg) {
    const now = new Date()
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() }
  }
  const parsed = parseDateUTC(arg)
  if (!parsed) {
    fail(`基准日 ${arg} 不是 YYYY-MM-DD 格式`)
    return { year: 2026, month: 10, day: 4 }
  }
  return parsed
})()

const seed: EntryRow[] = SEED_ROWS.fire
assert(seed.length === 6, `示例消防器材应为 6 条，实际 ${seed.length} 条`)

// 1) 每条记录的状态必须与共享规则推导一致：页面没有自己的第二套口径可漏。
for (const row of seed) {
  const result = evaluateFireRow(row, asOf)
  if (String(row.status) !== result.status) {
    fail(`${String(row['器材编号'])} 示例状态「${String(row.status)}」与规则推导「${result.status}」不一致`)
  }
}

// 2) 存量回填：占位压力读数按检查日期回填，必须确定、合法且保持原判定；周期缺省补 30 天。
for (const row of seed) {
  const { row: filled, backfilled } = backfillFireRow(row)
  const pressure = parsePressure(filled['压力读数'])
  const cycle = parseCycleDays(filled['检查周期'])
  assert(pressure !== null, `${String(row['器材编号'])} 压力读数回填后仍无法解析`)
  assert(cycle !== null, `${String(row['器材编号'])} 检查周期回填后仍无法解析`)
  const again = backfillFireRow(filled).row
  assert(JSON.stringify(again) === JSON.stringify(filled), `${String(row['器材编号'])} 存量回填不幂等`)
  if (backfilled.includes('压力读数')) {
    assert(
      pressure !== null && pressure >= 0.5 && pressure <= 2.0,
      `${String(row['器材编号'])} 回填压力 ${String(pressure)} 超出合理范围`,
    )
  }
}
assert(backfillPressureValue(seed[0]) === backfillPressureValue(seed[0]), '压力回填不是确定性函数')

// 3) 规则边界单测：阈值两侧、周期换算、终态豁免。
const baseRow: EntryRow = {
  id: 901,
  status: '检查合格',
  pending: true,
  abnormal: false,
  器材编号: 'TEST-001',
  器材类型: '测试器材',
  布置位置: '测试点',
  检查周期: '30天',
  压力读数: '1.20',
  检查人员: '自检',
  检查日期: '2026-09-01',
  器材状态: '正常',
}
assert(evaluateFireRow({ ...baseRow, 压力读数: PRESSURE_MIN.toFixed(2) }, asOf).findings.filter((f) => f.type.startsWith('pressure')).length === 0, '压力等于下限被误判为越限')
assert(evaluateFireRow({ ...baseRow, 压力读数: PRESSURE_MAX.toFixed(2) }, asOf).findings.filter((f) => f.type.startsWith('pressure')).length === 0, '压力等于上限被误判为越限')
assert(evaluateFireRow({ ...baseRow, 压力读数: '0.99' }, asOf).findings.some((f) => f.type === 'pressure-low'), '低于下限未判定欠压')
assert(evaluateFireRow({ ...baseRow, 压力读数: '1.41' }, asOf).findings.some((f) => f.type === 'pressure-high'), '高于上限未判定超压')
assert(parseCycleDays('月度') === 30 && parseCycleDays('季度') === 90 && parseCycleDays('年度') === 365, '周期文字换算错误')
assert(evaluateFireRow({ ...baseRow, 检查日期: '2026-08-01' }, asOf).findings.some((f) => f.type === 'overdue'), '2026-08-01 + 30 天在基准日后应判超期')
assert(!evaluateFireRow({ ...baseRow, 检查日期: '2026-10-01' }, asOf).findings.some((f) => f.type === 'overdue'), '2026-10-01 + 30 天在基准日前不应超期')
assert(
  evaluateFireRow({ ...baseRow, status: '已更换', 检查日期: '2025-01-01', 压力读数: '0.5' }, asOf).findings.length === 0,
  '已更换器材未豁免压力与周期判定',
)

// 4) 汇总：越限与超期各报各的；巡视待复核数 == 压力不足器材数。
const summary = summarizeFireRows(seed, asOf)
const low = summary.findings
  .flatMap((item) => item.issues.map((issue) => ({ code: item.code, issue })))
  .filter((item) => item.issue.type === 'pressure-low')
const high = summary.findings
  .flatMap((item) => item.issues.map((issue) => ({ code: item.code, issue })))
  .filter((item) => item.issue.type === 'pressure-high')
const overdue = summary.findings
  .flatMap((item) => item.issues.map((issue) => ({ code: item.code, issue })))
  .filter((item) => item.issue.type === 'overdue')

assert(
  summary.review.length === summary.stats.pressureFaulty,
  `巡视待复核清单 ${summary.review.length} 条与压力不足器材 ${summary.stats.pressureFaulty} 条不一致`,
)
assert(low.some((item) => item.code === 'FIRE-0003'), 'FIRE-0003 应判欠压')
assert(high.some((item) => item.code === 'FIRE-0004'), 'FIRE-0004 应判超压')
assert(overdue.some((item) => item.code === 'FIRE-0002'), 'FIRE-0002 应判超期未检')
assert(!overdue.some((item) => item.code === 'FIRE-0001'), 'FIRE-0001 周期 90 天，不应超期')

// 5) 样例批次幂等：连续导入两遍，条数不多、编号不重。
const once = mergeFireRows(seed, FIRE_SAMPLE_BATCH, asOf)
const twice = mergeFireRows(once.rows, FIRE_SAMPLE_BATCH, asOf)
assert(once.added === FIRE_SAMPLE_BATCH.length, `首次导入应新增 ${FIRE_SAMPLE_BATCH.length} 条，实际 ${once.added}`)
assert(twice.added === 0, `重复导入又新增了 ${twice.added} 条`)
assert(twice.rows.length === once.rows.length, `重复导入后条数 ${twice.rows.length} 与 ${once.rows.length} 不一致`)
const codes = twice.rows.map((row) => String(row['器材编号']))
assert(new Set(codes).size === codes.length, '台账里出现了重复器材编号')
const summaryAfterImport = summarizeFireRows(twice.rows, asOf)
assert(
  summaryAfterImport.review.length === summaryAfterImport.stats.pressureFaulty,
  '导入样例后巡视待复核数与压力不足器材数不一致',
)

// ---------- 报告 ----------

const asOfText = `${asOf.year}-${String(asOf.month).padStart(2, '0')}-${String(asOf.day).padStart(2, '0')}`
console.log('消防器材台账构建前自检')
console.log(`基准日(UTC)：${asOfText}　合格压力区间：[${PRESSURE_MIN}, ${PRESSURE_MAX}] MPa`)
console.log('')

const printGroup = (title: string, items: { code: string; issue: FireFinding }[]) => {
  console.log(`${title}：${items.length} 条`)
  for (const item of items) {
    console.log(`  - [${item.issue.label}] ${item.code} ${item.issue.detail}`)
  }
  console.log('')
}

printGroup('压力越限 · 欠压（pressure-low）', low)
printGroup('压力越限 · 超压（pressure-high）', high)
printGroup('检查周期 · 超期未检（overdue）', overdue)

console.log('台账汇总（示例数据）：')
console.log(`  在册消防器材：${summary.stats.total}`)
console.log(`  超期待检查：${summary.stats.due}`)
console.log(`  压力不足器材（欠压+超压）：${summary.stats.pressureFaulty}`)
console.log(`  已更换：${summary.stats.replaced}`)
console.log(`  巡视检查待复核清单：${summary.review.length} 条（与压力不足器材一致）`)
console.log('')
console.log(`样例批次导入：首次新增 ${once.added} / 更新 ${once.updated}，再次导入新增 ${twice.added} / 更新 ${twice.updated}（应为 0 新增）`)
console.log('')

if (failures.length > 0) {
  console.error(`自检未通过：${failures.length} 项，构建中止，不允许上线。`)
  for (const message of failures) {
    console.error(`  ✗ ${message}`)
  }
  process.exitCode = 1
} else {
  console.log('自检通过：规则口径唯一、回填幂等、两处压力不足器材数一致，可以构建上线。')
}
