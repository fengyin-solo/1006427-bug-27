<template>
  <section class="page" data-module="slag">
    <header class="page-head">
      <div>
        <h2>炉渣处理管理</h2>
        <p class="page-desc">维护炉渣处理记录，围绕处理编号、炉渣产量、热灼减率、外运单位做登记、筛选与状态流转。</p>
        <p class="owner-note">
          每条记录只认落笔的当班班组：运输车号、外运单位、热灼减率受控在本班手里；已交付整份只读；同一条处理编号不许登两遍。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记炉渣处理记录</button>
        <button class="btn" type="button" @click="exportRows">导出炉渣处理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>打回标记</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="String(row.id)"
          class="clickable-row"
          :class="{ 'row-rejected': isRejected(row) }"
          @click="openDetail(row)"
        >
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="isRejected(row)" class="badge rejected">被打回</span>
            <span v-else>—</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click.stop="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无炉渣处理数据，可先登记炉渣处理记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条炉渣处理记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="audit-panel">
      <h3>打回脚印（谁在什么时候想动哪一条，都可回查）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>班组</th>
            <th>目标记录</th>
            <th>尝试动作</th>
            <th>卡在哪一项</th>
            <th>打回原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in audits" :key="item.id">
            <td>{{ item.time }}</td>
            <td>{{ item.operator }}</td>
            <td>{{ item.crew }}</td>
            <td>{{ item.recordCode }}</td>
            <td>{{ item.action }}</td>
            <td>{{ item.blockedField }}</td>
            <td>{{ item.reason }}</td>
          </tr>
          <tr v-if="!audits.length">
            <td colspan="7" class="empty-state">暂无被打回的改动</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="createOpen" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <header class="drawer-head">
          <h3>登记炉渣处理记录</h3>
          <button class="link" type="button" @click="closeCreate">关闭</button>
        </header>
        <p class="owner-note">
          落笔即定归属：归属班组「{{ session.crew }}」 · 记录人员「{{ session.operator }}」
        </p>
        <form class="form-list" @submit.prevent="submitCreate">
          <label v-for="field in createFields" :key="field">
            <span>{{ field }}</span>
            <input
              v-model="createForm[field]"
              :type="field === '外运日期' ? 'date' : 'text'"
              :placeholder="`请输入${field}`"
            />
          </label>
          <p v-if="createError" class="error-text">{{ createError }}</p>
          <div class="drawer-actions">
            <button class="btn primary" type="submit">提交登记</button>
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          </div>
        </form>
      </div>
    </div>

    <template v-if="detailRow">
      <div class="drawer-mask" @click.self="closeDetail"></div>
      <aside class="drawer">
        <header class="drawer-head">
          <h3>
            记录详情 · {{ detailRow['处理编号'] }}
            <span v-if="isRejected(detailRow)" class="badge rejected">被打回</span>
          </h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>

        <p v-if="isRejected(detailRow)" class="rejected-banner">
          这条记录有被打回的改动，明细见下方「本条打回脚印」。
        </p>
        <p class="owner-note">
          归属班组「{{ detailRow['归属班组'] }}」 · 当前班组「{{ session.crew }}」
          <template v-if="String(detailRow.status) === '已交付'"> · 已交付，整份只读，本班也不能再改</template>
          <template v-else-if="detailRow['归属班组'] !== session.crew"> · 别班递上来的改动算越权，一律打回</template>
        </p>

        <dl class="detail-list">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ detailRow[field] ?? '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
        </dl>

        <h4>修改记录</h4>
        <form class="form-list" @submit.prevent="submitEdit">
          <label v-for="field in editableFields" :key="field">
            <span>{{ field }}<em v-if="controlledFields.includes(field)" class="controlled-mark">受控</em></span>
            <input
              v-model="editForm[field]"
              :type="field === '外运日期' ? 'date' : 'text'"
              :placeholder="`请输入${field}`"
            />
          </label>
          <p v-if="editMessage" :class="editOk ? 'notice-text' : 'error-text'">{{ editMessage }}</p>
          <div class="drawer-actions">
            <button class="btn primary" type="submit">保存修改</button>
          </div>
        </form>

        <h4>本条打回脚印</h4>
        <div v-if="detailAudits.length">
          <p v-for="item in detailAudits" :key="item.id" class="audit-item">
            <strong>{{ item.time }}</strong> · {{ item.operator }}（{{ item.crew }}）试图「{{ item.action }}」，
            卡在「{{ item.blockedField }}」：{{ item.reason }}
          </p>
        </div>
        <p v-else class="owner-note">本条记录暂无被打回的改动</p>
      </aside>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  SLAG_CONTROLLED_FIELDS,
  listSlagAudits,
  registerSlagEntry,
  rejectedSlagIds,
  runSlagAction,
  updateSlagEntry,
  type SlagActor,
} from '@/api/slag-guard'
import type { EntryRow, SlagAuditEntry } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const meta = moduleMeta('slag')
const columns = ["处理编号", "炉渣产量", "热灼减率", "外运单位", "外运日期", "运输车号", "记录人员", "归属班组", "处理状态"]
const actions = ["安排外运", "确认交付", "标记异常"]
const statuses = ["待外运", "外运中", "已交付", "数据异常"]
const controlledFields: string[] = [...SLAG_CONTROLLED_FIELDS]
const editableFields = ["炉渣产量", "热灼减率", "外运单位", "外运日期", "运输车号"]
const createFields = ["处理编号", "炉渣产量", "热灼减率", "外运单位", "外运日期", "运输车号"]
const detailFields = ["处理编号", "炉渣产量", "热灼减率", "外运单位", "外运日期", "运输车号", "记录人员", "归属班组", "登记时间", "处理状态"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const audits = ref<SlagAuditEntry[]>([])
const rejectedIds = ref<Set<number>>(new Set())
const filterFields = columns.slice(0, 3)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const todayText = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  return [
    { label: '待外运炉渣', value: rows.value.filter((row) => String(row.status) === '待外运').length },
    { label: '外运中炉渣', value: rows.value.filter((row) => String(row.status) === '外运中').length },
    { label: '当日外运量', value: rows.value.filter((row) => String(row['外运日期'] ?? '') === todayText).length },
  ]
})

function actor(): SlagActor {
  return { operator: session.operator, crew: session.crew }
}

function isRejected(row: EntryRow): boolean {
  return rejectedIds.value.has(Number(row.id))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// 登记：同一条处理编号不许登两遍，落笔即定归属。
const createOpen = ref(false)
const createForm = ref<Record<string, string>>({})
const createError = ref('')

function openCreate() {
  createForm.value = Object.fromEntries(createFields.map((field) => [field, '']))
  createForm.value['处理编号'] = nextCode()
  createError.value = ''
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

function nextCode(): string {
  const max = rows.value.reduce((acc, row) => {
    const matched = /(\d+)$/.exec(String(row['处理编号'] ?? ''))
    return matched ? Math.max(acc, Number(matched[1])) : acc
  }, 0)
  return `SLAG-${String(max + 1).padStart(4, '0')}`
}

function submitCreate() {
  const result = registerSlagEntry(createForm.value, actor())
  if (!result.ok) {
    createError.value = result.message
    reload()
    return
  }
  createOpen.value = false
  noticeMessage.value = result.message
  reload()
}

// 详情与修改：别班递上来的改动、已交付的改动，提交后都会在数据层被打回并落脚印。
const detailRow = ref<EntryRow | null>(null)
const editForm = ref<Record<string, string>>({})
const editMessage = ref('')
const editOk = ref(false)

const detailAudits = computed(() =>
  detailRow.value ? audits.value.filter((item) => item.recordId === Number(detailRow.value?.id)) : [],
)

function openDetail(row: EntryRow) {
  detailRow.value = row
  editForm.value = Object.fromEntries(editableFields.map((field) => [field, String(row[field] ?? '')]))
  editMessage.value = ''
  editOk.value = false
}

function closeDetail() {
  detailRow.value = null
}

function submitEdit() {
  if (!detailRow.value) {
    return
  }
  const result = updateSlagEntry(Number(detailRow.value.id), editForm.value, actor())
  editOk.value = result.ok
  editMessage.value = result.message
  reload()
  if (result.ok) {
    const fresh = rows.value.find((row) => Number(row.id) === Number(detailRow.value?.id))
    if (fresh) {
      detailRow.value = fresh
    }
  }
}

function runAction(action: string, row: EntryRow) {
  const result = runSlagAction(Number(row.id), action, actor())
  reload()
  errorMessage.value = result.ok ? '' : result.message
  noticeMessage.value = result.ok ? result.message : ''
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    audits.value = listSlagAudits()
    rejectedIds.value = rejectedSlagIds()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '炉渣处理列表读取失败'
  }
}

onMounted(reload)
</script>
