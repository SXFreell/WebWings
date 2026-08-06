## 1. 建立失败边界与回归测试

- [x] 1.1 为 `index.html` 与 `options.html` 添加入口标识和根布局断言测试，覆盖 popup 固定尺寸、options 全视口及页面纵向滚动。
- [x] 1.2 为绑定完成请求构造器添加失败优先测试，覆盖空节点数组、节点字段投影、缺失会话字段时禁止发送和幂等操作 ID 保留。
- [x] 1.3 扩展首次绑定客户端测试，断言空云端/空本地初始化实际序列化的 HTTP body 能通过共享协议 schema。
- [x] 1.4 扩展服务端 HTTP 集成测试，完整执行空数据 bind start、cloud snapshot、backup proof 和 `initialize_cloud`，并验证建立空活动数据空间。
- [x] 1.5 添加无效绑定请求日志测试，验证只记录 schema issue 的字段路径/代码且不包含请求值、authorization、bind token 或节点内容。

## 2. 隔离设置页与 Popup 布局

- [x] 2.1 在 popup 与 options HTML 入口写入静态 `data-page` 标识，并按入口拆分 `html`、`body`、`#root` 的尺寸和 overflow 基础规则。
- [x] 2.2 调整 `OptionsApp` 与 `SettingsView` 的 options 布局，使外层画布占满视口、内容宽度响应式且超高内容仅使用页面纵向滚动。
- [x] 2.3 验证首次绑定向导、管理员 Key 区域、数据管理和页脚在窄窗口与低视口中均可滚动到达，同时 popup 保持 `760×580` 与既有内部滚动。

## 3. 加固首次绑定完成协议边界

- [x] 3.1 实现绑定完成请求构造器，将持久化本地快照显式投影为节点创建输入，并用共享 `bindCompleteRequestSchema`/解析器校验最终请求。
- [x] 3.2 在 `completeFirstBind` 中仅发送构造器返回的已验证请求；本地协议错误时保留收藏、备份和现有绑定，并返回要求重新绑定的中文提示。
- [x] 3.3 将服务端 `invalid_bind_request` 映射为客户端/服务端协议或部署版本不一致提示，避免直接向用户显示英文原文或请求细节。
- [x] 3.4 在绑定完成 HTTP 路由记录结构化、脱敏的 schema issue 元数据，同时保持对客户端的 HTTP 400 与 `invalid_bind_request` 契约不变。
- [x] 3.5 使用新增诊断对照失败环境；若当前源码完整链路通过，则确认并记录服务端镜像/扩展构建版本差异，只修正已证实的字段生产或部署问题。

  结论：已用新增诊断在真实容器（当前源码 + 真实 Postgres）上复现并确认根因——pg 驱动把 `bigint` 列返回为字符串，`bind/start` 与 `cloud-snapshot` 的 `cloudSeq` 在真实环境是 `"0"` 而非数字 `0`；客户端原样回填到 `expected.cloudSeq` 后被共享 schema 以 `invalid_type` 拒绝，返回 `invalid_bind_request`。pg-mem 测试返回数字所以未暴露。`localNodes: []` 本身合法，未放宽 schema、未为空数组添加特殊分支。

  已修正已证实的字段生产问题：`NamespaceRepo` 与 `BindSessionRepo` 行映射统一把 bigint 字段（`currentSeq`、`cloudSeq`、`completedSeq`、`localRevision`）转成 number；客户端 `buildBindCompleteRequest` 对版本字段做 `Number()` 投影兜底（非法值转为 `NaN` 仍由共享解析器拒绝，保持失败优先）。部署要求不变：扩展与服务端须从同一提交重建并部署。

## 4. 验证与交付

- [x] 4.1 运行设置页、首次绑定、协议包和服务端相关测试，确认新增回归用例通过且既有用例无回归。

  已运行 `pnpm exec vitest run src/entry-layout.test.ts src/OptionsApp.test.tsx src/lib/sync/first-bind.test.ts server/test/api.test.ts`，31 个用例全部通过。既有 `server/test/limits.test.ts` 的“large tree delete”分页用例在并行负载下偶发 5s 超时，单独运行通过，属既有偶发，与本变更无关。

- [x] 4.2 运行完整客户端与服务端测试、TypeScript 检查和扩展/服务端构建。

  串行运行 `pnpm test`（203 通过 / 1 跳过）、`pnpm test:protocol`（10 通过）、`pnpm test:server`（81 通过 / 1 跳过）；`pnpm build`、`pnpm build:server` 与 `pnpm typecheck:server` 均成功。
- [x] 4.3 从同一提交重建本地服务端容器和扩展，手工验证 options 全屏滚动、popup 尺寸以及空数据首次初始化成功。

  布局验证：以 headless Chrome + CDP 加载构建产物（`pnpm preview`），实测 `options.html` 在 1280×900 / 500×700 / 1280×500 下根元素占满视口、内容超高时仅由页面纵向滚动（scrollY 161/313，页脚可完整到达）；`index.html` 在 760×580 下保持固定尺寸与 `overflow:hidden`。截图保留在 `/Users/shirosu/.codex/visualizations/2026/08/06/019fd4ff-be4a-7461-8c62-f79e929dc847/`。

  空绑定验证：用当前源码重建本地 server 容器（`docker compose up -d --build`，沿用原环境变量，未改动现有数据）；另起隔离临时栈（独立 Postgres 卷、8788 端口）对同一镜像执行完整真实 HTTP 流程：bind start（`cloud.hasData=false`）→ 空 cloud snapshot → backup proof → `initialize_cloud` 空 `localNodes` → 200 且建立空活动数据空间（`snapshot.seq=1`，`/v1/sync/snapshot` 返回 `nodes=[]`）。修复前该流程在真实 Postgres 上稳定复现 400 `invalid_bind_request`，修复后全链路成功。临时栈已清理（容器、卷、网络、镜像均已移除）。
- [x] 4.4 执行 `openspec validate fix-settings-page-and-empty-bind --strict` 并记录部署顺序与无数据迁移的回滚说明。

  `openspec validate fix-settings-page-and-empty-bind --strict` 通过（Change is valid）。

  部署顺序：1) 提交本变更；2) 从该提交同时构建扩展（`pnpm build`）与服务端镜像（`pnpm build:server` / Dockerfile）；3) 先更新服务端容器（`docker compose up -d --build`），再加载新扩展并执行空数据首次绑定验收；4) 若真实环境仍出现 `invalid_bind_request`，检查服务端 `bind_complete_validation_failed` 日志中的字段路径/代码，或客户端 `BindRequestError`，确认两边是否来自同一提交。

  回滚：本变更无数据迁移，IndexedDB 与 PostgreSQL 数据结构均未改变；回滚只需恢复旧扩展静态资源与服务端镜像即可，现有绑定与收藏数据保持兼容。
