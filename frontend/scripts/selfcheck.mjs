#!/usr/bin/env node
// 构建前自检入口：用 vite 自带的 esbuild 把 TS 自检脚本（连同 src/data 共享规则）
// 打成临时 ESM 后运行，页面、本地台账与容器里跑的是同一份实现。
import { rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { builtinModules } from 'node:module'
import esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const entry = join(here, 'fire-selfcheck.ts')
const outfile = join(tmpdir(), `fire-selfcheck-${process.pid}.mjs`)

async function main() {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    // 自检脚本只用数据层纯函数；显式外置 node 内置模块，避免无谓打包。
    external: builtinModules,
    logLevel: 'warning',
  })
  await import(pathToFileURL(outfile).href)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(() => {
    try {
      rmSync(outfile, { force: true })
    } catch {
      // 临时文件清理失败不影响结论
    }
  })
