import {
  FIRE_IDENTITY_FIELD,
  FIRE_MODULE_KEY,
  backfillFireRows,
  reconcileFireRow,
} from './fire-rules'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pv-plant-ops:entries'

// 老版本缓存（压力读数、检查周期还是占位文本）升级后自动迁移一次。
function migrate(rows: Record<string, EntryRow[]>): {
  rows: Record<string, EntryRow[]>
  changed: boolean
} {
  const fireRows = rows[FIRE_MODULE_KEY]
  if (!fireRows) {
    return { rows, changed: false }
  }
  const filled = backfillFireRows(fireRows)
  const aligned = filled.map((row) => reconcileFireRow(row))
  const changed = JSON.stringify(aligned) !== JSON.stringify(fireRows)
    || JSON.stringify(filled) !== JSON.stringify(fireRows)
  if (!changed) {
    return { rows, changed: false }
  }
  return { rows: { ...rows, [FIRE_MODULE_KEY]: aligned }, changed: true }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return migrate(fallback).rows
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = migrate(fallback).rows
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    const { rows: migrated, changed } = migrate(merged)
    if (changed) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
    }
    return migrated
  } catch {
    const seeded = migrate(fallback).rows
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export type ImportResult = {
  added: number
  skipped: number
  total: number
}

// 按业务编号幂等导入同一批样例：已存在的编号跳过，不新增也不覆盖。
// identityField 缺省取消防器材的「器材编号」。重复导入一批，added 为 0，不会多出一份。
export function importRows(
  key: string,
  incoming: Omit<EntryRow, 'id'>[],
  identityField: string = FIRE_IDENTITY_FIELD,
): ImportResult {
  const current = listRows(key)
  const known = new Set(current.map((row) => String(row[identityField] ?? '')))
  let nextId = current.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  let added = 0
  const next = [...current]
  for (const row of incoming) {
    const identity = String(row[identityField] ?? '')
    if (!identity || known.has(identity)) {
      continue
    }
    nextId += 1
    known.add(identity)
    // EntryRow 的索引签名会让展开推断丢掉具名字段，这里整体断言回 EntryRow。
    const inserted = { ...clone(row), id: nextId } as EntryRow
    next.push(inserted)
    added += 1
  }
  saveRows(key, next)
  return { added, skipped: incoming.length - added, total: next.length }
}

export function storageKey(): string {
  return STORAGE_KEY
}
