<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>巡视检查管理</h2>
        <p class="page-desc">维护巡视记录，围绕巡视单号、巡视路线、巡视人员、巡视日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡视记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡视检查清单</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无巡视检查数据，可先登记巡视记录</td>
        </tr>
      </tbody>
    </table>

    <section class="review-block">
      <header class="review-head">
        <h3>待复核清单（消防器材）</h3>
        <span class="review-summary">
          待复核 {{ reviewItems.length }} 项 · 其中压力不足器材 {{ pressureInsufficientCount }} 件 · 检查超期 {{ overdueCount }} 件
        </span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>器材编号</th>
            <th>当前压力</th>
            <th>上次检查</th>
            <th>应检日期</th>
            <th>规则状态</th>
            <th>复核原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in reviewItems" :key="item.identity">
            <td>{{ item.identity }}</td>
            <td>{{ item.pressureMPa === null ? '无有效读数' : item.pressureMPa.toFixed(2) + ' MPa' }}</td>
            <td>{{ item.lastCheckDate ?? '—' }}</td>
            <td>{{ item.dueDate ?? '—' }}</td>
            <td>{{ item.status }}</td>
            <td>{{ item.reasons.join('；') }}</td>
          </tr>
          <tr v-if="!reviewItems.length">
            <td colspan="6" class="empty-state">暂无需要复核的消防器材</td>
          </tr>
        </tbody>
      </table>
      <p class="review-note">
        清单与压力不足件数由消防器材共享规则实时计算，与「消防设施」页面的压力不足器材数保持一致。
      </p>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡视检查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  fireReviewQueue,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["巡视单号", "巡视路线", "巡视人员", "巡视日期", "检查项数", "异常项数", "巡视时长", "巡视状态"]
const actions = ["开始巡视", "提交复核", "确认完成"]
const statuses = ["待巡视", "巡视中", "待复核", "已完成"]
const stats = [{"label": "今日巡视单", "value": 0}, {"label": "巡视中记录", "value": 0}, {"label": "发现异常项", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
// 消防器材的待复核清单直接取共享规则结论，不在巡视页重复判定。
const reviewItems = ref<ReturnType<typeof fireReviewQueue>>([])
const pressureInsufficientCount = computed(
  () => reviewItems.value.filter((item) => item.status === '压力不足').length,
)
const overdueCount = computed(
  () => new Set(reviewItems.value.filter((item) => item.reasons.some((reason) => reason.includes('超期'))).map((item) => item.identity)).size,
)
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
  errorMessage.value = '巡视记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reviewItems.value = fireReviewQueue()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡视检查列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.review-block {
  margin-top: 18px;
}
.review-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 12px 0 8px;
}
.review-head h3 {
  margin: 0;
  font-size: 15px;
}
.review-summary {
  font-size: 12px;
  color: var(--muted);
}
.review-note {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
