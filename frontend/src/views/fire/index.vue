<template>
  <section class="page" data-module="fire">
    <header class="page-head">
      <div>
        <h2>消防设施管理</h2>
        <p class="page-desc">维护消防器材，围绕器材编号、器材类型、布置位置、检查周期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记消防器材</button>
        <button class="btn" type="button" @click="importSamples">导入样例</button>
        <button class="btn" type="button" @click="exportRows">导出消防设施清单</button>
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

    <section v-if="findingRows.length" class="rule-alerts">
      <h3 class="rule-alerts-title">共享规则判定结论（与构建前自检同源）</h3>
      <ul class="rule-alert-list">
        <li v-for="item in findingRows" :key="`${item.id}-${item.issue.type}`" class="rule-alert-item">
          <strong>{{ item.code }}</strong>
          <span class="rule-tag" :class="`rule-tag-${item.issue.type}`">{{ item.issue.label }}</span>
          <span>{{ item.issue.detail }}</span>
        </li>
      </ul>
    </section>

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
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
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
          <td :colspan="columns.length + 2" class="empty-state">暂无消防设施数据，可先登记消防器材</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条消防设施记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getFireLedger,
  importFireSamples,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import type { FireFinding } from '@/data/fire-rules'

const meta = moduleMeta('fire')
const columns = ["器材编号", "器材类型", "布置位置", "检查周期", "压力读数", "检查人员", "检查日期", "器材状态"]
const actions = ["登记检查", "申请充装", "确认更换"]
const statuses = ["检查合格", "待检查", "压力不足", "已更换"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const stats = ref([
  { label: "在册消防器材", value: 0 },
  { label: "待检查器材", value: 0 },
  { label: "压力不足器材", value: 0 },
])
const findingRows = ref<{ id: number; code: string; issue: FireFinding }[]>([])
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '消防器材登记入口尚未接入审批流'
}

function importSamples() {
  errorMessage.value = ''
  const result = importFireSamples()
  noticeMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    // 统计与越限/超期结论统一来自本地数据层的共享规则，页面不再自己判一遍。
    const ledger = getFireLedger()
    stats.value = [
      { label: "在册消防器材", value: ledger.stats.total },
      { label: "待检查器材", value: ledger.stats.due },
      { label: "压力不足器材", value: ledger.stats.pressureFaulty },
    ]
    findingRows.value = ledger.findings.flatMap((item) =>
      item.issues.map((issue) => ({ id: item.id, code: item.code, issue })),
    )
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '消防设施列表读取失败'
  }
}

onMounted(reload)
</script>
