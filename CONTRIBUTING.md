# 参与贡献

感谢帮助改进 Mock造数工具。项目面向公开使用，但所有改动必须保持“纯前端、本地处理、可复现、可验证”四条边界。

## 开始开发

1. 从 `main` 创建功能分支。
2. 运行 `npm ci` 安装锁定版本依赖。
3. 使用 `npm run dev` 本地开发。
4. 提交前运行 `npm test` 和 `npm run build`。
5. 通过 Pull Request 合并，不直接修改主分支。

## 必须遵守

- 不得加入上传用户 Schema、数据池、生成结果或浏览器历史的遥测与接口。
- 不得提交 Token、Cookie、账号、真实业务数据或其他凭据。
- 不得使用 `eval`、`Function` 或执行导入的 JavaScript、TypeScript、SQL、YAML 标签。
- 不得绕过配置大小、表数、字段数、行数、公式或本地 `$ref` 深度限制。
- 不得静默放宽 CSP、Service Worker 同源限制或 CSV/XLSX 公式注入防护。
- 新增解析器、生成规则和安全边界必须提供测试；用户可见功能必须同步文档。

## 合并闸门

GitHub Actions 会安装锁定依赖、运行全部测试、执行 TypeScript 与生产构建、检查 Cloudflare/PWA 产物、首屏体积预算和严重依赖漏洞。依赖变更还会单独检查新增的高危漏洞。

仓库管理员应在 GitHub Branch protection 中要求 `Quality Gate` 检查与 CODEOWNERS 审核后才允许合并，并禁止强制推送到 `main`。仓库内文件不能代替这项平台设置。

