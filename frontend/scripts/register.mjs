// 自检子进程入口：node --import ./scripts/register.mjs <脚本>
// 与 selfcheck.mjs 内部的 register 指向同一个 TS 加载器，保证主进程与子进程解析一致。
import { register } from 'node:module'

register(new URL('./ts-loader.mjs', import.meta.url))

