import type { ShiftLegacyItem, SlagAuditEntry } from './types'

// 归属判定的脚印与交接遗留清单：和台账数据一样落在 localStorage，刷新、重开都还在。
const AUDIT_STORAGE_KEY = 'waste-to-energy-plant:slag-audits'
const LEGACY_STORAGE_KEY = 'waste-to-energy-plant:shift-legacy'

function readList<T>(key: string): T[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as T[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeList<T>(key: string, items: T[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(items))
  }
}

let auditCache: SlagAuditEntry[] | null = null
let legacyCache: ShiftLegacyItem[] | null = null

export function listAudits(): SlagAuditEntry[] {
  if (auditCache === null) {
    auditCache = readList<SlagAuditEntry>(AUDIT_STORAGE_KEY)
  }
  return auditCache
}

export function appendAudit(entry: SlagAuditEntry): void {
  const next = [...listAudits(), entry]
  auditCache = next
  writeList(AUDIT_STORAGE_KEY, next)
}

export function listLegacy(): ShiftLegacyItem[] {
  if (legacyCache === null) {
    legacyCache = readList<ShiftLegacyItem>(LEGACY_STORAGE_KEY)
  }
  return legacyCache
}

export function appendLegacy(item: ShiftLegacyItem): void {
  const next = [...listLegacy(), item]
  legacyCache = next
  writeList(LEGACY_STORAGE_KEY, next)
}
