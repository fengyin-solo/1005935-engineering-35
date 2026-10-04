// 构建前自检：把样例数据喂给 src/data 里的共享规则，越限的压力读数与超期的器材各报各的。
// 页面、台账、本自检共用同一份 src/data/fire-rules.ts，结论不会再因运行环境不同而漂移：
// 日期按 UTC 解析，基准日固定，本地开发机与容器里跑出的结果完全一致。
// 任何一项失败都以非零码退出，npm 的 prebuild 钩子保证「构建过了才允许上线」。
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { readFileSync, writeFileSync, rmSync } = require('node:fs')
const { resolve } = require('node:path')

// ---- 极简 TS 加载器（复用 devDependencies 里已有的 typescript，不新增依赖）----
register(pathToFileURL(resolve('scripts/ts-loader.mjs')).href)

const {
  PRESSURE_MAX_MPA,
  PRESSURE_MIN_MPA,
  backfillFireRow,
  buildFireReviewQueue,
  evaluateFireRow,
  summarizeFireRows,
} = await import('../src/data/fire-rules.ts')
const { SEED_ROWS, FIRE_SAMPLE_BATCH } = await import('../src/data/seed.ts')

const REFERENCE = new Date('2026-10-04T00:00:00Z')
const failures = []
let passed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

function reportBucket(title, items) {
  console.log(`  ${title}：${items.length} 条`)
  for (const item of items) {
    console.log(`    · ${item.identity || item['器材编号'] || `#${item.id}`}`)
  }
  return items.length
}

// ---- 一、规则判定：喂样例数据，越限与超期各报各的 ----
console.log('\n[1/4] 规则判定（基准日 2026-10-04）')
const seededRows = SEED_ROWS.fire
const evaluations = seededRows.map((row) => ({ row, ev: evaluateFireRow(row, REFERENCE) }))

// 存量三条：FIRE-0001 合格、FIRE-0002 超期待检查、FIRE-0003 欠压且超期
const findRow = (code) => evaluations.find(({ row }) => row['器材编号'] === code)
check('FIRE-0001 判定为检查合格', findRow('FIRE-0001').ev.status === '检查合格')
check('FIRE-0002 判定为待检查（检查超期）', findRow('FIRE-0002').ev.status === '待检查' && findRow('FIRE-0002').ev.overdue)
check('FIRE-0003 判定为压力不足（欠压）', findRow('FIRE-0003').ev.status === '压力不足' && findRow('FIRE-0003').ev.lowPressure)
check('FIRE-0003 同时计入超期桶', findRow('FIRE-0003').ev.overdue)

const seedQueue = buildFireReviewQueue(seededRows, REFERENCE)
const pressureBadSeeds = seedQueue.filter((item) => item.status === '压力不足')
const overdueSeeds = seedQueue.filter((item) => item.reasons.some((reason) => reason.includes('超期')))
console.log('  —— 存量样例分桶 ——')
const seedPressureCount = reportBucket(
  `压力越限（<${PRESSURE_MIN_MPA.toFixed(1)}MPa 或 >${PRESSURE_MAX_MPA.toFixed(1)}MPa）`,
  pressureBadSeeds,
)
const seedOverdueCount = reportBucket('检查超期', overdueSeeds)
check('存量样例报出压力越限 1 件', seedPressureCount === 1, `实际 ${seedPressureCount}`)
check('存量样例报出检查超期 2 件', seedOverdueCount === 2, `实际 ${seedOverdueCount}`)

// 导入批次四类情形：S01 合格、S02 欠压+超期、S03 超压、S04 超期
const batchEval = (code) => evaluateFireRow(FIRE_SAMPLE_BATCH.find((row) => row['器材编号'] === code), REFERENCE)
check('FIRE-S01 检查合格', batchEval('FIRE-S01').status === '检查合格')
check('FIRE-S02 欠压（0.60MPa）', batchEval('FIRE-S02').lowPressure && batchEval('FIRE-S02').status === '压力不足')
check('FIRE-S02 同时超期', batchEval('FIRE-S02').overdue)
check('FIRE-S03 超压（2.00MPa）', batchEval('FIRE-S03').overPressure && batchEval('FIRE-S03').status === '压力不足')
check('FIRE-S03 不超期', !batchEval('FIRE-S03').overdue)
check('FIRE-S04 检查超期（压力正常）', batchEval('FIRE-S04').overdue && batchEval('FIRE-S04').status === '待检查' && !batchEval('FIRE-S04').lowPressure)

const batchQueue = buildFireReviewQueue(FIRE_SAMPLE_BATCH, REFERENCE)
console.log('  —— 导入批次分桶（越限与超期各报各的）——')
const batchPressure = reportBucket('压力越限', batchQueue.filter((item) => item.status === '压力不足'))
const batchOverdue = reportBucket('检查超期', batchQueue.filter((item) => item.reasons.some((reason) => reason.includes('超期'))))
check('导入批次报出压力越限 2 件（欠压1 + 超压1）', batchPressure === 2, `实际 ${batchPressure}`)
check('导入批次报出检查超期 2 件', batchOverdue === 2, `实际 ${batchOverdue}`)

// ---- 二、存量兼容：占位读数按检查日期回填，幂等 ----
console.log('\n[2/4] 存量记录回填')
const legacyRow = {
  id: 99,
  status: '检查合格',
  pending: true,
  abnormal: false,
  '器材编号': 'FIRE-OLD',
  '器材类型': '消防设施样例1',
  '布置位置': '消防设施样例1',
  '检查周期': '消防设施样例1',
  '压力读数': '消防设施样例1',
  '检查人员': '消防设施样例1',
  '检查日期': '2026-09-01',
  '器材状态': '消防设施样例1',
}
const filled = backfillFireRow(legacyRow)
const filledAgain = backfillFireRow(filled)
check('占位压力读数被回填为真实读数', evaluateFireRow(filled, REFERENCE).pressureMPa !== null)
check('回填读数落在绿区 1.0–1.6 MPa', (() => {
  const p = evaluateFireRow(filled, REFERENCE).pressureMPa
  return p !== null && p >= PRESSURE_MIN_MPA && p <= PRESSURE_MAX_MPA
})())
check('占位检查周期被回填为可解析天数', evaluateFireRow(filled, REFERENCE).cycleDays !== null)
check('回填幂等：再回填一次结果不变', JSON.stringify(filledAgain) === JSON.stringify(filled))
check('登记为压力不足的存量读数回填欠压值', backfillFireRow({
  ...legacyRow,
  status: '压力不足',
  '压力读数': '占位',
})['压力读数'] === 0.8)

// ---- 三、存量种子一致性：登记状态与规则结论必须一致，否则拦构建 ----
console.log('\n[3/4] 种子数据一致性')
const seedSummary = summarizeFireRows(seededRows, REFERENCE)
const mismatched = seededRows.filter((row) => {
  const { ev } = evaluations.find((item) => item.row === row)
  return ev.status !== row.status
})
check('存量种子每条登记状态都与规则结论一致', mismatched.length === 0,
  mismatched.map((row) => `${row['器材编号']}:${row.status}`).join(', '))
check('存量种子压力不足器材 1 件', seedSummary.pressureInsufficient === 1, `实际 ${seedSummary.pressureInsufficient}`)
check('存量种子超期器材 2 件', seedSummary.overdue === 2, `实际 ${seedSummary.overdue}`)

// ---- 四、导入幂等：同一批样例重复导入不会多出一份 ----
console.log('\n[4/4] 样例导入幂等性（隔离的 localStorage 替身）')
const probe = resolve('node_modules/.selfcheck-probe.mjs')
try {
  rmSync(probe, { force: true })
  writeFileSync(
    probe,
    `
globalThis.window = undefined
const { allRows, importRows } = await import(${JSON.stringify(pathToFileURL(resolve('src/data/local-store.ts')).href)})
const { FIRE_SAMPLE_BATCH } = await import(${JSON.stringify(pathToFileURL(resolve('src/data/seed.ts')).href)})
const before = allRows().fire.length
const first = importRows('fire', FIRE_SAMPLE_BATCH)
const middle = allRows().fire.length
const second = importRows('fire', FIRE_SAMPLE_BATCH)
const after = allRows().fire.length
console.log(JSON.stringify({ before, firstAdded: first.added, firstSkipped: first.skipped, middle, secondAdded: second.added, secondSkipped: second.skipped, after }))
`,
  )
  const { execFileSync } = require('node:child_process')
  const output = execFileSync(process.execPath, ['--import', pathToFileURL(resolve('scripts/register.mjs')).href, probe], {
    encoding: 'utf8',
    cwd: resolve('.'),
  }).trim()
  const result = JSON.parse(output.split('\n').at(-1))
  console.log(`  首次导入：新增 ${result.firstAdded}，跳过 ${result.firstSkipped}（${result.before} → ${result.middle}）`)
  console.log(`  再次导入：新增 ${result.secondAdded}，跳过 ${result.secondSkipped}（${result.middle} → ${result.after}）`)
  check('首次导入新增 4 条', result.firstAdded === 4, `实际 ${result.firstAdded}`)
  check('再次导入新增 0 条（同一批不重复）', result.secondAdded === 0, `实际 ${result.secondAdded}`)
  check('再次导入 4 条全部按器材编号跳过', result.secondSkipped === 4, `实际 ${result.secondSkipped}`)
  check('台账总数两次导入后只增加 4', result.after - result.before === 4, `实际增加 ${result.after - result.before}`)
} finally {
  rmSync(probe, { force: true })
}

// ---- 汇总 ----
console.log('\n————————————————————————————')
console.log(`自检通过 ${passed} 项，失败 ${failures.length} 项`)
if (failures.length > 0) {
  console.log('构建已阻断：请先修复上述消防器材规则/数据问题再上线。')
  process.exitCode = 1
} else {
  console.log('消防器材规则自检通过，允许继续构建。')
}
