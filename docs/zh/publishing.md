# 发布 xiaodao-editor 到 npm

本文档描述将 `xiaodao-editor` 作为 npm 包发布的完整流程。

## 发布前检查清单

- [ ] `pnpm typecheck` 通过，无 TypeScript 错误
- [ ] `pnpm lint:check` 通过，无 ESLint 警告
- [ ] `pnpm build` 通过，`dist/` 产物生成完毕
- [ ] `package.json` 中的版本号已根据 [语义化版本](#版本管理) 更新
- [ ] 已登录 npm 账号且具有 `xiaodao-editor` 的发布权限
- [ ] 无未提交的本地改动（建议在干净的 git HEAD 上发布）

## 首次准备

### 1. 安装 Node.js / npm / pnpm

- Node.js ≥ 18
- npm ≥ 9（随 Node.js 一同安装）
- pnpm ≥ 10（本项目锁定 `packageManager: pnpm@10.29.2`）

```sh
corepack enable
corepack prepare pnpm@10.29.2 --activate
```

### 2. 登录 npm

```sh
npm login
```

按提示输入用户名、密码、邮箱以及 2FA 一次性密码（如果启用了双因素认证）。
登录成功后可通过 `npm whoami` 验证当前账号。

### 3. 检查包名是否可用

```sh
npm view xiaodao-editor version
```

- 报错 `E404` 说明该包名尚未被占用，可以直接发布
- 返回一个版本号说明包已存在，确认你是该包的 collaborator 或 owner

## 版本管理

严格遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)：

| 变更类型 | 说明 | 示例 |
|----------|------|------|
| `MAJOR` | 不兼容的破坏性 API 变更 | `0.1.1` → `1.0.0` |
| `MINOR` | 向下兼容的功能性新增 | `0.1.1` → `0.2.0` |
| `PATCH` | 向下兼容的问题修复 | `0.1.1` → `0.1.2` |

**升级版本号的命令（三选一）：**

```sh
# 仅修改 package.json，不生成 git tag
npm version patch --no-git-tag-version   # PATCH
npm version minor --no-git-tag-version   # MINOR
npm version major --no-git-tag-version   # MAJOR

# 或使用 pnpm
pnpm version patch
```

修改后将变更提交到 git：

```sh
git add package.json
git commit -m "release: v0.1.2"
git tag v0.1.2
git push origin main
git push origin v0.1.2
```

## 发布步骤

### 1. 安装依赖

```sh
pnpm install
```

### 2. 执行质量检查

```sh
pnpm typecheck
pnpm lint:check
```

### 3. 构建

`prepublishOnly` 脚本会在发布前自动执行，但建议提前手动验证：

```sh
pnpm build
```

成功后检查 `dist/` 目录至少包含以下文件：

```
dist/
├── block-editor.js        # ES module 入口
├── block-editor.umd.cjs   # CommonJS / UMD 入口
├── style.css              # 样式
└── index.d.ts             # TypeScript 类型入口
```

### 4. 预览发布内容

发布前确认打包进 tarball 的文件清单：

```sh
pnpm pack
# 或
npm pack --dry-run
```

检查输出中只包含 `package.json` 和 `dist/**/*`，不包含 `src/`、`playground/`、`docs/`、`.gitignore` 等无关文件。
`package.json` 的 `files` 字段已限定为 `["dist"]`，若发现多余文件需调整 `.npmignore`（如需要）。

### 5. 正式发布

```sh
pnpm publish
```

该命令会：
1. 自动执行 `prepublishOnly` → `pnpm build`
2. 按 `package.json` 的 `files` 字段将产物打包
3. 上传到 npm 官方 registry

> 如果你的 npm 账号启用了 2FA，命令会提示输入一次性密码。

**发布成功后**可通过以下命令验证：

```sh
npm view xiaodao-editor version   # 应返回你刚发布的版本号
```

## 发布失败的常见原因与解决

| 错误 | 原因 | 解决方式 |
|------|------|----------|
| `E401 Unauthorized` | 未登录或 session 过期 | `npm login` 重新登录 |
| `E402 Payment Required` | 发布 scope 私有包但无付费团队 | 用 `--access public` 或检查 `publishConfig` |
| `E403 Forbidden` | 当前账号无该包的写权限 | 让 owner 邀请你加入 collaborators |
| `EPERMYSCOPE` | 使用了不属于自己的 scope | 改用正确的包名或申请加入 scope |
| `E409 Conflict` | 该版本号已存在 | 升级版本号后重新发布 |
| `E500` / `ECONNRESET` | npm registry 服务端或网络问题 | 稍后重试，或检查 `npm config get registry` 是否指向官方源 |

## 包消费者使用方式

安装：

```sh
# 使用 npm
npm install xiaodao-editor

# 使用 pnpm
pnpm add xiaodao-editor

# 使用 yarn
yarn add xiaodao-editor
```

基本用法：

```ts
import { BlockEditor, BuiltinExtensions } from 'xiaodao-editor';
import 'xiaodao-editor/style.css';
```

`peerDependencies` 要求消费者项目安装 `vue@^3.4.0`。

## 相关文件速查

| 文件 | 作用 |
|------|------|
| `package.json` | `name` / `version` / `files` / `exports` / `publishConfig` / `prepublishOnly` |
| `vite.config.ts` | 库构建配置：lib entry、ES/UMD 双产物、`vue` external、`dts` 类型生成 |
| `tsconfig.json` | 类型检查（`build` 脚本先跑 `vue-tsc --noEmit`） |
| `src/index.ts` | 公共 API 入口，控制哪些符号被导出给消费者 |
| `dist/` | 构建产物目录（发布进包，不提交 git） |
