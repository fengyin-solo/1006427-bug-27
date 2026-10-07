import { runAction } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 炉渣处理记录的归属闸口：登记、受控字段修改、状态流转全部从这里落库。
// 界面上藏按钮不算数，真正写到库里之前必须过这道闸，别班递上来的改动一律打回。

const SLAG_KEY = 'slag'
const AUDIT_KEY = 'slagAudit'
const SHIFT_KEY = 'shift'

// 受控在本班手里的三项：运输车号、外运单位、热灼减率。
export const CONTROLLED_FIELDS = ['运输车号', '外运单位', '热灼减率'] as const

// 已交付即终态：整份只读，本班也不能再改。
const FINAL_STATUS = '已交付'

// 历史记录迁移时的兜底归属：老数据没记班组，按当时的归属保留，统一记到默认班名下。
const DEFAULT_OWNER_TEAM = '运行一班'

export type SlagOperator = {
  operator: string
  team: string
  shiftLabel: string
}

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 历史数据迁移：老记录缺归属班组的补上、缺登记时间的补上；已交付的维持原状，只读由闸口保证。
export function ensureSlagOwnership(): void {
  const rows = listRows(SLAG_KEY)
  let changed = false
  const migrated = rows.map((row) => {
    const next = { ...row }
    if (!next['归属班组']) {
      next['归属班组'] = DEFAULT_OWNER_TEAM
      changed = true
    }
    if (!next['登记时间']) {
      next['登记时间'] = '—'
      changed = true
    }
    return next
  })
  if (changed) {
    saveRows(SLAG_KEY, migrated)
  }
}

type Rejection = {
  recordRef: string
  recordId?: number
  action: string
  stuckAt: string
  reason: string
}

// 每次被打回都要留脚印：谁在什么时候想动哪一条、卡在哪一项，并回写值班交接的遗留清单。
function writeRejection(rejection: Rejection, session: SlagOperator): void {
  const time = now()

  // 1) 落脚印，之后任何时候都能回查。
  const auditRows = listRows(AUDIT_KEY)
  const footprint: EntryRow = {
    id: nextId(auditRows),
    status: '已打回',
    pending: false,
    abnormal: true,
    时间: time,
    操作人: session.operator,
    操作班组: session.team,
    记录id: rejection.recordId ?? 0,
    目标记录: rejection.recordRef,
    动作: rejection.action,
    卡点: rejection.stuckAt,
    原因: rejection.reason,
  }
  saveRows(AUDIT_KEY, [...auditRows, footprint])

  // 2) 回写值班交接的遗留清单，归属判定的结果交班时要能接上。
  const shiftRows = listRows(SHIFT_KEY)
  const shiftId = nextId(shiftRows)
  const handover: EntryRow = {
    id: shiftId,
    status: '有遗留',
    pending: true,
    abnormal: false,
    交接编号: `SHIF-${String(shiftId).padStart(4, '0')}`,
    值班班组: session.team,
    班次: session.shiftLabel,
    交班人员: session.operator,
    接班人员: '—',
    交接事项: `炉渣处理记录 ${rejection.recordRef} 归属判定打回：${rejection.reason}（卡在${rejection.stuckAt}）`,
    交接时间: time,
    交接状态: '有遗留',
  }
  saveRows(SHIFT_KEY, [...shiftRows, handover])

  // 3) 在记录上落最近打回标记，列表页与详情里都标出来。
  if (rejection.recordId !== undefined) {
    const rows = listRows(SLAG_KEY)
    const index = rows.findIndex((row) => Number(row.id) === rejection.recordId)
    if (index >= 0) {
      const next = [...rows]
      next[index] = {
        ...next[index],
        最近打回: `${time} ${session.team}(${session.operator})「${rejection.action}」被打回，卡在${rejection.stuckAt}`,
      }
      saveRows(SLAG_KEY, next)
    }
  }
}

// 登记：同一条记录不许登两遍，处理编号唯一；归属班组记当前当班班组。
export function createSlagEntry(
  input: Record<string, string>,
  session: SlagOperator,
): ActionResult {
  ensureSlagOwnership()
  const code = (input['处理编号'] ?? '').trim()
  if (!code) {
    return { ok: false, message: '处理编号不能为空' }
  }
  const rows = listRows(SLAG_KEY)
  if (rows.some((row) => String(row['处理编号']) === code)) {
    const reason = `处理编号 ${code} 已登记过，同一条记录不许登两遍`
    writeRejection({ recordRef: code, action: '登记', stuckAt: '处理编号', reason }, session)
    return { ok: false, message: reason }
  }
  const entry: EntryRow = {
    id: nextId(rows),
    status: '待外运',
    pending: true,
    abnormal: false,
    处理编号: code,
    炉渣产量: (input['炉渣产量'] ?? '').trim(),
    热灼减率: (input['热灼减率'] ?? '').trim(),
    外运单位: (input['外运单位'] ?? '').trim(),
    外运日期: (input['外运日期'] ?? '').trim(),
    运输车号: (input['运输车号'] ?? '').trim(),
    记录人员: (input['记录人员'] ?? '').trim() || session.operator,
    处理状态: '待外运',
    归属班组: session.team,
    登记时间: now(),
  }
  saveRows(SLAG_KEY, [...rows, entry])
  return { ok: true, message: `炉渣处理记录 ${code} 已登记，归属${session.team}` }
}

// 修改受控字段：只认登记它的那个当班班组；已交付整份只读。打回时点明卡在哪一项。
export function updateSlagControlled(
  id: number,
  patch: Record<string, string>,
  session: SlagOperator,
): ActionResult {
  ensureSlagOwnership()
  const rows = listRows(SLAG_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的炉渣处理记录` }
  }
  const row = rows[index]
  const ref = String(row['处理编号'] ?? id)
  const diff = CONTROLLED_FIELDS.filter((field) => {
    const value = (patch[field] ?? '').trim()
    return value !== '' && value !== String(row[field] ?? '')
  })
  if (diff.length === 0) {
    return { ok: false, message: '运输车号、外运单位、热灼减率都没有实际改动，无需提交' }
  }
  if (String(row.status) === FINAL_STATUS) {
    const reason = `记录已交付，整份只读，${session.team}也不能再改`
    writeRejection(
      { recordRef: ref, recordId: id, action: '修改受控字段', stuckAt: diff.join('、'), reason },
      session,
    )
    return { ok: false, message: `${reason}（卡在${diff.join('、')}）` }
  }
  const owner = String(row['归属班组'] ?? '')
  if (owner !== session.team) {
    const reason = `记录归${owner}所有，${session.team}无权改动，越权修改一律打回`
    writeRejection(
      { recordRef: ref, recordId: id, action: '修改受控字段', stuckAt: diff.join('、'), reason },
      session,
    )
    return { ok: false, message: `${reason}（卡在${diff.join('、')}）` }
  }
  const next = [...rows]
  const updated = { ...row }
  for (const field of diff) {
    updated[field] = (patch[field] ?? '').trim()
  }
  updated['最近修改'] = `${now()} ${session.team}(${session.operator})`
  next[index] = updated
  saveRows(SLAG_KEY, next)
  return { ok: true, message: `炉渣处理记录 ${ref} 已更新：${diff.join('、')}` }
}

// 状态流转：同样过归属闸口——别班不能替本班安排外运、确认交付，已交付的任何动作都打回。
export function runSlagAction(id: number, action: string, session: SlagOperator): ActionResult {
  ensureSlagOwnership()
  const row = listRows(SLAG_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的炉渣处理记录` }
  }
  const ref = String(row['处理编号'] ?? id)
  if (String(row.status) === FINAL_STATUS) {
    const reason = `记录已交付，整份只读，「${action}」被打回`
    writeRejection({ recordRef: ref, recordId: id, action, stuckAt: action, reason }, session)
    return { ok: false, message: reason }
  }
  const owner = String(row['归属班组'] ?? '')
  if (owner !== session.team) {
    const reason = `记录归${owner}所有，${session.team}越权执行「${action}」，一律打回`
    writeRejection({ recordRef: ref, recordId: id, action, stuckAt: action, reason }, session)
    return { ok: false, message: reason }
  }
  return runAction(SLAG_KEY, id, action)
}

// 打回脚印回查：不传 recordId 返回全部，最新的在前。
export function listSlagAudit(recordId?: number): EntryRow[] {
  const rows = listRows(AUDIT_KEY)
  const matched =
    recordId === undefined ? rows : rows.filter((row) => Number(row['记录id']) === recordId)
  return [...matched].reverse()
}
