<template>
  <section class="page" data-module="slag">
    <header class="page-head">
      <div>
        <h2>炉渣处理管理</h2>
        <p class="page-desc">维护炉渣处理记录，围绕处理编号、炉渣产量、热灼减率、外运单位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记炉渣处理记录</button>
        <button class="btn" type="button" @click="exportRows">导出炉渣处理清单</button>
      </div>
    </header>

    <p class="owner-hint">
      当前当班：{{ store.team }}。每条记录只认登记它的班组——运输车号、外运单位、热灼减率受控在本班手里，别班递上来的改动一律打回；已交付的记录整份只读。
    </p>

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
          <th>归属班组</th>
          <th>当前状态</th>
          <th>打回标记</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row['归属班组'] ?? '—' }}
            <span v-if="row['归属班组'] === store.team" class="tag own">本班</span>
            <span v-else class="tag other">别班</span>
          </td>
          <td>
            {{ row.status }}
            <span v-if="row.status === '已交付'" class="tag readonly">只读</span>
          </td>
          <td>
            <span v-if="row['最近打回']" class="tag rejected" :title="String(row['最近打回'])">曾被越权打回</span>
            <span v-else>—</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openEdit(row)">编辑</button>
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无炉渣处理数据，可先登记炉渣处理记录</td>
        </tr>
      </tbody>
    </table>

    <section class="audit-section">
      <h3>打回脚印（谁在什么时候想动哪一条，都可回查）</h3>
      <table v-if="auditRows.length" class="data-table">
        <thead>
          <tr>
            <th v-for="column in auditColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in auditRows" :key="String(entry.id)">
            <td v-for="column in auditColumns" :key="column">{{ entry[column] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state">暂无打回脚印</p>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条炉渣处理记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeModals">
      <div class="modal">
        <h3>登记炉渣处理记录</h3>
        <p class="modal-tip">归属班组记为当前当班：{{ store.team }}；处理编号全厂唯一，同一条记录不许登两遍。</p>
        <label v-for="field in createFields" :key="field" class="form-item">
          <span>{{ field }}</span>
          <input
            v-model="createForm[field]"
            :type="field === '外运日期' ? 'date' : 'text'"
            :placeholder="field === '处理编号' ? '如 SLAG-0004' : `填写${field}`"
          />
        </label>
        <p v-if="modalError" class="error-text">{{ modalError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitCreate">确认登记</button>
          <button class="btn" type="button" @click="closeModals">取消</button>
        </div>
      </div>
    </div>

    <div v-if="editing" class="modal-mask" @click.self="closeModals">
      <div class="modal">
        <h3>修改受控字段 · {{ editing['处理编号'] }}</h3>
        <p class="modal-tip">
          归属班组：{{ editing['归属班组'] }}；当前当班：{{ store.team }}。
          运输车号、外运单位、热灼减率只认归属班组修改，已交付的记录整份只读。
        </p>
        <label v-for="field in controlledFields" :key="field" class="form-item">
          <span>{{ field }}</span>
          <input v-model="editForm[field]" :placeholder="`填写${field}`" />
        </label>
        <p v-if="modalError" class="error-text">{{ modalError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitEdit">提交修改</button>
          <button class="btn" type="button" @click="closeModals">取消</button>
        </div>
      </div>
    </div>

    <div v-if="detail" class="modal-mask" @click.self="closeModals">
      <div class="modal">
        <h3>炉渣处理记录详情 · {{ detail['处理编号'] }}</h3>
        <p v-if="detail['最近打回']" class="reject-banner">最近打回：{{ detail['最近打回'] }}</p>
        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ detail[field] ?? '—' }}</dd>
          </template>
        </dl>
        <h4 class="audit-subhead">这条记录的打回脚印</h4>
        <table v-if="detailAudit.length" class="data-table">
          <thead>
            <tr>
              <th v-for="column in auditColumns" :key="column">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in detailAudit" :key="String(entry.id)">
              <td v-for="column in auditColumns" :key="column">{{ entry[column] ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-state">这条记录没有被打回过</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeModals">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  CONTROLLED_FIELDS,
  createSlagEntry,
  ensureSlagOwnership,
  listSlagAudit,
  runSlagAction,
  updateSlagControlled,
} from '@/api/slag-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('slag')
const store = useSessionStore()
const columns = ["处理编号", "炉渣产量", "热灼减率", "外运单位", "外运日期", "运输车号", "记录人员", "处理状态"]
const actions = ["安排外运", "确认交付", "标记异常"]
const statuses = ["待外运", "外运中", "已交付", "数据异常"]
const controlledFields = [...CONTROLLED_FIELDS]
const createFields = ["处理编号", "炉渣产量", "热灼减率", "外运单位", "外运日期", "运输车号", "记录人员"]
const detailFields = [...columns, "归属班组", "登记时间", "最近修改"]
const auditColumns = ["时间", "操作人", "操作班组", "目标记录", "动作", "卡点", "原因"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const modalError = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const creating = ref(false)
const createForm = ref<Record<string, string>>({})
const editing = ref<EntryRow | null>(null)
const editForm = ref<Record<string, string>>({})
const detailId = ref<number | null>(null)
const auditRows = ref<EntryRow[]>([])

const stats = computed(() => [
  { label: '待外运炉渣', value: rows.value.filter((row) => String(row.status) === '待外运').length },
  { label: '外运中炉渣', value: rows.value.filter((row) => String(row.status) === '外运中').length },
  { label: '当日外运量', value: rows.value.filter((row) => String(row['外运日期']) === today()).length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const detail = computed(() =>
  detailId.value === null ? null : rows.value.find((row) => Number(row.id) === detailId.value) ?? null,
)

const detailAudit = computed(() =>
  detailId.value === null ? [] : auditRows.value.filter((row) => Number(row['记录id']) === detailId.value),
)

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function session() {
  return { operator: store.operator, team: store.team, shiftLabel: store.shiftLabel }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  createForm.value = { 记录人员: store.operator }
  modalError.value = ''
  creating.value = true
}

function openEdit(row: EntryRow) {
  editing.value = row
  editForm.value = Object.fromEntries(controlledFields.map((field) => [field, String(row[field] ?? '')]))
  modalError.value = ''
}

function openDetail(row: EntryRow) {
  detailId.value = Number(row.id)
}

function closeModals() {
  creating.value = false
  editing.value = null
  detailId.value = null
  modalError.value = ''
}

function submitCreate() {
  const result = createSlagEntry(createForm.value, session())
  if (!result.ok) {
    reload()
    modalError.value = result.message
    return
  }
  closeModals()
  reload()
  noticeMessage.value = result.message
}

function submitEdit() {
  if (!editing.value) {
    return
  }
  const result = updateSlagControlled(Number(editing.value.id), editForm.value, session())
  if (!result.ok) {
    reload()
    modalError.value = result.message
    return
  }
  closeModals()
  reload()
  noticeMessage.value = result.message
}

function runAction(action: string, row: EntryRow) {
  const result = runSlagAction(Number(row.id), action, session())
  reload()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    ensureSlagOwnership()
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    auditRows.value = listSlagAudit()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '炉渣处理列表读取失败'
  }
}

onMounted(reload)
</script>
