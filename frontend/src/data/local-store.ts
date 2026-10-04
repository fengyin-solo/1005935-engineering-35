import { normalizeFireRows } from './fire-rules'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pv-plant-ops:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 消防器材的状态判定收口在共享规则里：任何来源的记录（示例、localStorage、导入批次）
// 读进来都先归一化，页面与构建自检拿到的结论永远一致。
function applyModuleRules(key: string, rows: EntryRow[]): EntryRow[] {
  return key === 'fire' ? normalizeFireRows(rows) : rows
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return Object.fromEntries(
      Object.entries(fallback).map(([key, rows]) => [key, applyModuleRules(key, rows)]),
    )
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = Object.fromEntries(
      Object.entries(fallback).map(([key, rows]) => [key, applyModuleRules(key, rows)]),
    )
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged: Record<string, EntryRow[]> = { ...fallback, ...parsed }
    const normalized = Object.fromEntries(
      Object.entries(merged).map(([key, rows]) => [key, applyModuleRules(key, rows ?? [])]),
    )
    return normalized
  } catch {
    const seeded = Object.fromEntries(
      Object.entries(fallback).map(([key, rows]) => [key, applyModuleRules(key, rows)]),
    )
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
  const next = { ...allRows(), [key]: applyModuleRules(key, rows) }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return listRows(key)
}

export function storageKey(): string {
  return STORAGE_KEY
}
