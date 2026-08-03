# WebWings

基于 React、TypeScript、Vite 与 shadcn/ui 的 Manifest V3 浏览器扩展。当前提供本地收藏夹功能。

## 功能

- 一键读取并收藏当前标签页
- 多层嵌套目录
- 收藏与目录的新增、编辑、移动、删除
- 名称和网址搜索
- IndexedDB 本地持久化
- JSON 完整导出、校验与覆盖导入

## 本地开发

```bash
pnpm install
pnpm dev
```

## 构建并安装到 Chrome

```bash
pnpm build
```

打开 `chrome://extensions`，启用“开发者模式”，点击“加载已解压的扩展程序”，选择本项目的 `dist` 目录。

## 验证

```bash
pnpm test
pnpm build
```

导出的 JSON 使用 `webwings-bookmarks` 格式与版本号。导入会先校验项目类型、目录关联、循环嵌套、日期、重复 ID 和 URL 协议，通过后才会替换当前数据。
