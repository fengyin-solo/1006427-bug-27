import { appendAudit, appendLegacy, listAudits, listLegacy } from '@/data/guard-store'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ShiftLegacyItem, SlagAuditEntry } from '@/data/types'

import { moduleMeta, runAction } from './local-service'

// 炉渣外运的归属卡口：所有炉渣记录的写操作都必须过这里，落到库里之前先问归属。
const KEY = 'slag'
const OWNER_FIELD = '归属班组'
const CREATED_AT_FIELD = '登记时间'
const CODE_FIELD = '处理编号'
const DELIVERED_STATUS = '已交付'
const LEGACY_SOURCE = '炉渣处理'

// 受控在本班手里的三项：别班递上来的改动一律打回，并点明卡在哪一项。
export const SLAG_CONTROLLED_FIELDS = ['运输车号', '外运单位', '热灼减率'] as const

// 老数据没有归属字段时的默认归属：历史记录按当时归属保留，缺的一律记到运行一班头上。
const HISTORIC_CREW = '运行一班'

export type SlagActor = {
  operator: string
  crew: string
}

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function ownerOf(row: EntryRow): string {
  return String(row[OWNER_FIELD] ?? '')
}

function codeOf(row: EntryRow): string {
  return String(row[CODE_FIELD] ?? row.id)
}

function slagRows(): EntryRow[] {
  const rows = listRows(KEY)
  if (!rows.some((row) => row[OWNER_FIELD] === undefined)) {
    return rows
  }
  // 迁移：历史记录缺归属的按当时归属保留（默认运行一班），已交付的依旧整份只读。
  const migrated = rows.map((row) =>
    row[OWNER_FIELD] === undefined
      ? {
          ...row,
          [OWNER_FIELD]: HISTORIC_CREW,
          [CREATED_AT_FIELD]: String(row['外运日期'] ?? ''),
        }
      : row,
  )
  saveRows(KEY, migrated)
  return migrated
}

function nextId(items: { id: number }[]): number {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
}

// 每次打回都落脚印 + 回写交接遗留清单，谁、什么时候、想动哪一条、卡在哪一项都可回查。
function reject(
  actor: SlagActor,
  row: EntryRow,
  action: string,
  fields: string[],
  blockedField: string,
  reason: string,
): ActionResult {
  const time = now()
  appendAudit({
    id: nextId(listAudits()),
    time,
    operator: actor.operator,
    crew: actor.crew,
    recordId: Number(row.id),
    recordCode: codeOf(row),
    action,
    fields,
    blockedField,
    reason,
  })
  appendLegacy({
    id: nextId(listLegacy()),
    time,
    source: LEGACY_SOURCE,
    recordCode: codeOf(row),
    crew: actor.crew,
    summary: reason,
  })
  return { ok: false, message: reason }
}

/** 登记炉渣处理记录：落笔即定归属，同一条处理编号不许登两遍。 */
export function registerSlagEntry(input: Record<string, string>, actor: SlagActor): ActionResult {
  const meta = moduleMeta(KEY)
  const code = (input[CODE_FIELD] ?? '').trim()
  if (!code) {
    return { ok: false, message: '处理编号不能为空' }
  }
  const rows = slagRows()
  const duplicated = rows.find((row) => String(row[CODE_FIELD]) === code)
  if (duplicated) {
    return reject(
      actor,
      duplicated,
      '登记',
      [CODE_FIELD],
      CODE_FIELD,
      `处理编号 ${code} 已登记过（归属「${ownerOf(duplicated)}」），同一条记录不许登两遍，卡在「${CODE_FIELD}」`,
    )
  }
  const row: EntryRow = {
    id: nextId(rows),
    status: meta.statuses[0],
    pending: true,
    abnormal: false,
    [CODE_FIELD]: code,
    炉渣产量: input['炉渣产量'] ?? '',
    热灼减率: input['热灼减率'] ?? '',
    外运单位: input['外运单位'] ?? '',
    外运日期: input['外运日期'] ?? '',
    运输车号: input['运输车号'] ?? '',
    记录人员: actor.operator,
    处理状态: meta.statuses[0],
    [OWNER_FIELD]: actor.crew,
    [CREATED_AT_FIELD]: now(),
  }
  saveRows(KEY, [...rows, row])
  return { ok: true, message: `${meta.entity} ${code} 已登记，归属「${actor.crew}」` }
}

/** 修改炉渣记录：已交付整份只读；别班动受控项算越权，一律打回并点明卡在哪一项。 */
export function updateSlagEntry(
  id: number,
  changes: Record<string, string>,
  actor: SlagActor,
): ActionResult {
  const rows = slagRows()
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的炉渣处理记录` }
  }
  const attempted = Object.keys(changes).filter(
    (field) => String(changes[field] ?? '') !== String(row[field] ?? ''),
  )
  if (attempted.length === 0) {
    return { ok: false, message: '没有需要保存的改动' }
  }
  const code = codeOf(row)
  if (String(row.status) === DELIVERED_STATUS) {
    return reject(
      actor,
      row,
      '修改',
      attempted,
      attempted[0],
      `记录 ${code} 已交付，整份只读，本班也不能再改，卡在「${attempted[0]}」`,
    )
  }
  const owner = ownerOf(row)
  if (owner !== actor.crew) {
    const controlled = attempted.filter((field) =>
      (SLAG_CONTROLLED_FIELDS as readonly string[]).includes(field),
    )
    const blocked = (controlled.length > 0 ? controlled : attempted).join('、')
    const suffix = controlled.length > 0 ? '（受控项，归本班管）' : ''
    return reject(
      actor,
      row,
      '修改',
      attempted,
      blocked,
      `记录 ${code} 归属「${owner}」，「${actor.crew}」递上来的改动算越权，卡在「${blocked}」${suffix}，一律打回`,
    )
  }
  const next = rows.map((item) => (Number(item.id) === id ? { ...item, ...changes } : item))
  saveRows(KEY, next)
  return { ok: true, message: `记录 ${code} 已更新（${attempted.join('、')}）` }
}

/** 状态流转也过归属卡口：已交付只读，别班无权流转。 */
export function runSlagAction(id: number, action: string, actor: SlagActor): ActionResult {
  const rows = slagRows()
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的炉渣处理记录` }
  }
  const code = codeOf(row)
  if (String(row.status) === DELIVERED_STATUS) {
    return reject(
      actor,
      row,
      action,
      [action],
      action,
      `记录 ${code} 已交付，整份只读，「${action}」被打回`,
    )
  }
  const owner = ownerOf(row)
  if (owner !== actor.crew) {
    return reject(
      actor,
      row,
      action,
      [action],
      action,
      `记录 ${code} 归属「${owner}」，「${actor.crew}」无权执行「${action}」，越权打回`,
    )
  }
  return runAction(KEY, id, action)
}

/** 打回脚印：按记录过滤，最新的在前，谁在什么时候想动哪一条都能回查。 */
export function listSlagAudits(recordId?: number): SlagAuditEntry[] {
  const all = listAudits()
  const matched = recordId === undefined ? all : all.filter((item) => item.recordId === recordId)
  return [...matched].sort((a, b) => b.id - a.id)
}

/** 有被打回脚印的记录 id：列表页与详情都靠它把那条标出来。 */
export function rejectedSlagIds(): Set<number> {
  return new Set(listAudits().map((item) => item.recordId))
}

/** 值班交接的遗留清单：归属判定每打回一条，这里就挂一条。 */
export function listShiftLegacy(): ShiftLegacyItem[] {
  return [...listLegacy()].sort((a, b) => b.id - a.id)
}
