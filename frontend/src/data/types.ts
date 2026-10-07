/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 炉渣归属判定的脚印：每次被打回都落一条，谁在什么时候想动哪一条、卡在哪一项都能回查。 */
export type SlagAuditEntry = {
  id: number
  time: string
  operator: string
  crew: string
  recordId: number
  recordCode: string
  action: string
  fields: string[]
  blockedField: string
  reason: string
}

/** 回写到值班交接的遗留清单：归属判定打回一条，交接班这边就挂一条遗留。 */
export type ShiftLegacyItem = {
  id: number
  time: string
  source: string
  recordCode: string
  crew: string
  summary: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
