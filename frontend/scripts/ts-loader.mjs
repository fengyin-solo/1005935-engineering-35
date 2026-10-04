// Node ESM 加载钩子：让自检脚本能直接 import src 下的 .ts 源码。
// 复用 typescript（devDependencies 已有）转译，不引入 ts-node / tsx 等新依赖；
// 支持相对路径省略扩展名与 '@/' 别名，页面、台账、自检因此可以 import 同一份源码。
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url))

function resolveTsFile(pathname) {
  const candidates = [pathname, `${pathname}.ts`, `${pathname}.tsx`, `${pathname}/index.ts`, `${pathname}/index.tsx`]
  return candidates.find((candidate) => /\.(ts|tsx)$/.test(candidate) && existsSync(candidate))
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const resolved = resolveTsFile(new URL(specifier.slice(2), pathToFileURL(SRC_ROOT)).pathname)
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true }
    }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/.test(specifier)) {
    const base = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd()
    const resolved = resolveTsFile(new URL(specifier, pathToFileURL(base)).pathname)
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = readFileSync(fileURLToPath(url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        isolatedModules: true,
        esModuleInterop: true,
      },
      fileName: fileURLToPath(url),
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
