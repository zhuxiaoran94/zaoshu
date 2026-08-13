# Mock造数工具

面向测试人员的浏览器端测试数据工作台。内置 120+ 字段生成类型和用户、电商、金融、游戏、社区、物流、测试通用七类场景，无需上传任何数据即可生成多表关联测试数据。

## 功能

- 可视化字段配置、固定随机种子、唯一性和跨表外键
- 随机、真实分布、边界、异常、Pairwise 组合模式
- 异常数据注入与 `_mock_meta` 预期结果标记
- 数据质量检查、覆盖报告和业务状态链
- JSON、JSONL、CSV、TSV、XLSX、MySQL、PostgreSQL、SQLite 导出
- Postman 数据、TypeScript Fixture 和 Markdown 报告导出
- 可选本地自定义数据池，所有配置保存在浏览器

## 本地运行

```bash
npm install
npm run dev
```

## 验证

```bash
npm test
npm run build
```

## Cloudflare Pages

- 构建命令：`npm run build`
- 输出目录：`dist`
- Node.js：18 或更高版本

项目没有服务端接口，所有造数、检查与导出均在浏览器本地完成。
