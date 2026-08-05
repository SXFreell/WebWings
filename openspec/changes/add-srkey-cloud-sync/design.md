## Context

参见 `proposal.md` 的动机以及四份能力规格。当前 WebWings 是一个 React/Vite Manifest V3 弹窗扩展：`src/App.tsx` 直接调用 `src/lib/bookmarks-db.ts`，节点仅保存在版本 1 的 IndexedDB `nodes` object store；写入后整库重新加载。节点使用客户端 ISO 时间和同级数字 `order`，删除会物理移除整棵子树。Manifest 目前只有 `tabs` 权限，没有后台 Service Worker、网络主机权限或设备身份。

云同步必须保持现有“打开即可使用”的本地体验，同时应对弹窗随时销毁、Manifest V3 后台可终止、设备离线、网络重试、同一 Key 多设备并发以及用户自托管任意 Server URL。服务端可作为冲突排序权威，因此不需要无中心协作算法。

## Goals / Non-Goals

**Goals:**

- 插件在未绑定服务时继续作为纯本地收藏夹工作；绑定后仍从本地数据库立即读写。
- 通过 `Server URL + srkey` 发现服务并注册可撤销设备身份，一个 Key 对应一个隔离数据空间。
- 以服务端事件序列、幂等操作和版本化快照实现多设备快速收敛和断线恢复。
- 在首次创建、覆盖或合并云端数据前，强制产出可验证的云端与本地安全备份。
- 把 Key 管理、连接绑定、首次协调、日常同步拆成可独立测试的协议与模块。
- 为现有 IndexedDB 数据提供无损升级路径，并保留现有 JSON v1 手动导入导出兼容性。

**Non-Goals:**

- 不实现传统账号、邮箱、密码、OAuth、团队成员或跨 Key 数据共享。
- 不实现端到端加密；部署方控制的同步服务可以读取收藏内容，传输依靠 TLS。
- 第一版不同时连接多个 Server/Key，也不自动在连接配置之间切换。
- 不同步 Chrome 原生书签、界面排序偏好或其他浏览器设置。
- 不使用标题或 URL 做语义去重，不承诺浏览器关闭或设备休眠期间的硬实时送达。
- 不在第一版引入 Kafka、Redis、完整 CRDT 或独立微服务集群。

## Decisions

### 1. 使用本地优先客户端和服务端权威事件序列

插件继续把 IndexedDB 作为界面的即时数据源。每次业务写入在一个本地事务中同时更新节点、增加本地修订号并写入 outbox；后台同步引擎异步上传。服务端在事务中验证操作、分配数据空间内单调递增的 `server_seq`、更新权威节点并追加事件。

WebSocket 只携带“最新序列已变化”的提示，客户端始终通过增量拉取接口取得权威事件。因此通知重复或丢失不会影响正确性，HTTP 重试也不会重复执行操作。

曾考虑整库快照同步，但任何两台设备同时写入都会导致最后上传者覆盖另一端。也曾考虑 CRDT，但目录移动、级联删除、排序和批量导入的 CRDT 成本远高于中心服务可提供的收益。

```text
UI ──本地事务──> IndexedDB(nodes + outbox + meta)
                        │
                        ▼
              Extension Service Worker
                   │ push / pull
                   ▼
             Sync API ──事务──> PostgreSQL
                   │                │
                   └── WebSocket <──┘
```

### 2. 保持扩展根项目并新增服务端和共享协议包

不移动现有扩展源码，避免无关目录重构。仓库增加 pnpm workspace：

- 根包：现有浏览器扩展。
- `server/`：Node.js/TypeScript 同步服务，使用 Fastify、PostgreSQL 和 WebSocket。
- `packages/sync-protocol/`：请求、响应、事件、操作和备份清单的版本化运行时 schema 与 TypeScript 类型。

共享包不得包含平台特定代码。服务端对所有外部输入执行运行时校验，插件也在写入 IndexedDB 前校验服务端响应。第一版 HTTP、WebSocket 和管理端点由同一服务进程承载；后续水平扩展时使用 PostgreSQL `LISTEN/NOTIFY` 作为无持久性唤醒提示，事件表仍是唯一权威来源。

### 3. Server URL 是入口，实例 ID 与 Key ID 才是连接身份

插件把用户输入规范化为 API 根地址，允许子路径，拒绝 URL 用户信息、查询参数和片段。生产地址仅接受 HTTPS；HTTP 只接受回环主机。连接步骤固定为：

1. 在用户手势内为精确 Origin 请求可选主机权限。
2. 匿名读取 `{baseUrl}/v1/info`。
3. 验证 `service`、`apiVersion`、`instanceId`、`minClientVersion` 和能力集合。
4. 验证成功后才向 `{baseUrl}/v1/bind/start` 提交 `srkey`。

本地活动连接主键为 `(instance_id, key_id)`。相同身份的新 URL 是地址迁移；不同实例或 Key 是新数据空间，必须走首次协调。若原 URL 突然返回不同实例 ID，立即停止发送凭证和 outbox。

Manifest 使用广泛但可选的 HTTPS host pattern，并在运行时只请求具体 Origin。另增加后台 Service Worker、`storage`、`downloads` 和 `alarms` 权限；`downloads` 用于确认安全备份真正完成，`alarms` 用于后台终止后的补拉兜底。最低 Chrome 版本设为 116，以使用扩展 Service Worker 的 WebSocket 生命周期改进。

### 4. srkey 是一次性设备登记秘密，不是长期请求令牌

Key 采用带角色前缀的 32 字节随机秘密，例如 `srk_admin_...` 和 `srk_sync_...`。数据库保存 `HMAC-SHA-256(SRKEY_PEPPER, raw_key)`、非敏感前缀和元数据，不保存可直接还原的完整 Key。高熵随机秘密不需要面向低熵密码的昂贵 KDF；服务端仍对绑定端点限速并统一失败响应。

绑定开始后签发受限的临时 bind token。只有协调成功时才创建正式设备会话，返回短期 opaque access token 和长期 opaque refresh token；数据库只保存 token 摘要。每次请求同时检查设备、Key 状态和 `token_version`，因此删除或轮换 Key 可以立即失效。插件绑定完成后清除原始 `srkey`。

曾考虑直接在每次请求中发送 `srkey`，但这会扩大日志、内存和网络暴露面，也无法单独撤销某台设备。也不采用无需服务端检查的长效 JWT，以保证 Key 删除和轮换可以立即生效。

### 5. 管理员 Key 兼具自己的 namespace 和受限管理 scope

服务端初始化时读取可选 `WEBWINGS_ADMIN_SRKEY`；未配置且数据库无管理员时生成一次并只在启动输出中显示完整值。管理员 Key 与普通 Key 一样拥有自己的 namespace，另带 `keys:manage` scope。管理 API 可读取 Key 前缀、标签、状态、设备数和数据量，但业务查询始终固定为当前管理员自己的 namespace，不能指定其他 namespace 读取收藏。

创建或轮换普通 Key 时完整值只返回一次。删除先撤销 Key、设备和 WebSocket，再将 namespace 标记为 `pending_delete`；默认 30 天后清理。保留期内恢复会生成新秘密但不恢复旧设备会话。插件不允许删除唯一管理员。

管理员失钥时，运维者通过维护命令生成新 Key 摘要，并在单个数据库事务中更新管理员 `secret_hash`、增加 `token_version`、撤销会话。内部 Key ID、管理员 namespace 和普通 Key 均保持不变。数据库可以查看管理员前缀和状态，但完整秘密不可恢复；这满足失钥后“修改恢复”而不把数据库备份变成可直接使用的远程凭据。

### 6. PostgreSQL 模型以 namespace 为隔离和事务边界

主要表及职责如下：

- `server_settings`：稳定 `instance_id`、协议版本和服务配置。
- `access_keys`：Key ID、namespace ID、摘要、前缀、角色、状态、token version、保留期。
- `namespaces`：当前 `sync_epoch`、`current_seq`、初始化状态。
- `devices` / `device_sessions`：设备元数据、token 摘要、过期和撤销状态。
- `bookmark_nodes`：权威节点、父关系、字段内容、位置值、字段版本、软删除信息。
- `sync_events`：namespace、epoch、seq、operation ID、设备、事件类型、payload。
- `operation_receipts`：包含成功和确定性拒绝结果的幂等回执。
- `snapshots`：namespace、epoch、seq、内容摘要和快照数据或对象存储引用。
- `bind_sessions`：候选设备、版本锁、云端快照、备份摘要、选择和状态。

所有业务唯一约束和外键均包含 `namespace_id`；服务层从认证上下文注入 namespace，不接受客户端自由指定。管理查询与业务查询使用不同 repository 接口，避免管理员 scope 意外绕过内容隔离。

### 7. 节点从客户端时间与整数 order 升级为服务端版本和位置值

节点保留稳定 UUID、类型、父 ID、标题、URL、favicon 和创建时间，并增加：

- `position_key`：可在相邻项之间生成的字典序位置值。
- `version`：节点整体确认版本。
- `field_versions`：各可变字段最后被服务端接受的序列。
- `deleted_at`、`delete_seq`、`delete_batch_id`：软删除信息。
- `recovery_reason`：父目录失效时进入恢复区域的原因。

客户端时间仅用于展示和审计，冲突先后只看 `server_seq`。两个节点位置值相同则用节点 ID 打破平局；服务端可发布不改变相对次序的 `positions_rebalanced` 事件。现有 `order` 在本地迁移时按 `(order, title, id)` 排序后转换为留有间隔的位置值。

### 8. 本地 IndexedDB 升级为 nodes、outbox、meta 和 binding stores

IndexedDB 升级事务保留所有现有节点并增加：

- `nodes`：同步字段和软删除标记；界面默认只读取活动节点。
- `outbox`：`op_id`、epoch、类型、字段补丁、基线版本、创建时间和发送状态。
- `meta`：本地修订号、server cursor、sync epoch、最后同步状态。
- `binding`：唯一活动连接和设备凭证。
- `bindSessions`：可恢复的首次协调 UI 状态和本地快照摘要。

`bookmarks-db.ts` 继续作为 UI 使用的数据入口，但所有修改改为领域操作，在一个事务中更新节点、修订号和 outbox。未绑定时只更新节点和本地修订号；绑定时通过完整快照协调，不为历史操作补造 outbox。远程事件应用也走单个事务，但不会再次产生 outbox。

Service Worker 负责网络、续期、WebSocket、补拉和重试；弹窗通过扩展消息订阅本地提交通知并刷新当前视图。所有持久同步状态都在 IndexedDB 中，后台全局变量只做可重建缓存。

### 9. 同步协议使用 push、pull、snapshot 和 realtime 四个通道

核心端点为：

- `GET /v1/info`：匿名服务发现。
- `POST /v1/bind/start`：验证 `srkey`，创建受限 bind session。
- `GET /v1/bind/{id}/cloud-snapshot`：获取固定序列的云端备份数据。
- `POST /v1/bind/{id}/backup-proof`：记录两侧摘要和客户端下载完成结果。
- `POST /v1/bind/{id}/complete`：按策略完成初始化并签发设备会话。
- `POST /v1/auth/refresh`、`POST /v1/auth/revoke`：设备会话管理。
- `POST /v1/sync/push`：批量提交操作并返回逐项回执。
- `GET /v1/sync/pull?after=&limit=`：按序分页读取事件。
- `GET /v1/sync/snapshot`：获取当前 epoch 权威快照。
- `GET /v1/realtime`：建立按当前 namespace 隔离的 WebSocket。
- `/v1/admin/keys`：管理员列表、创建、轮换、撤销、删除和恢复。

`push` 使用至少一次传输和恰好一次业务效果：`operation_receipts` 对 `(namespace_id, op_id)` 唯一。每批 `pull` 在本地原子应用后才推进 cursor。WebSocket payload 只包含 epoch 和最新 seq，不承载权威节点内容。

### 10. 首次绑定使用不可变双快照、下载证明和 compare-and-swap

`bind/start` 在服务端捕获 `cloud_seq`、`sync_epoch` 和不可变云端快照；插件在一个本地只读事务中捕获节点与 `local_revision`。插件生成 `webwings-sync-backup` v1 ZIP：

```text
manifest.json
cloud.json
local.json
```

清单包含实例 ID、Key 前缀、epoch、两侧版本、计数和 SHA-256；数据文件包含活动节点和仍在保留期的可恢复节点，但不含任何凭据。该格式独立于现有面向普通导入导出的 `webwings-bookmarks` v1，后者保持兼容。

插件通过下载 API 等待状态 `complete`，再把两个摘要作为 backup proof 记录到会话。`complete` 请求携带唯一 operation ID 并 compare-and-swap 检查实例、Key、cloud seq、epoch 和 local revision：

- 云端为空：用本地快照初始化；两侧为空则初始化空 namespace。
- 使用云端：本地原子安装云端快照，清理旧未绑定 outbox，再拉取快照后的事件。
- 使用本地：服务端原子替换权威状态、增加 epoch，并使其他设备必须重新快照。
- 合并：云端为基线；未知同步身份的本地树按现有安全导入语义重映射冲突 ID、保留结构并追加根节点，不按 URL/标题去重。

任一版本在备份后变化都使会话失效并要求重新导出。服务端保存 operation receipt，使断线重试不会重复初始化或导入。

### 11. 冲突以字段补丁和服务端接受顺序解决

普通更新只携带实际修改字段，避免整节点最后写入覆盖无关修改。服务端依次应用合法补丁：不同字段自然合并，同一字段以较大 server seq 为准。

结构操作另行验证：

- 移动在提交时验证父目录仍存在且不会产生循环；同一节点多次合法移动以最后接受者为准。
- `delete_tree` 在事务中计算当时后代并写入同一个 delete batch；迟到更新不得复活 tombstone。
- 新增节点到已删除父目录时保留节点，并放入 namespace 的逻辑 `lost+found` 恢复区域。
- 恢复操作创建明确事件，不通过普通 patch 清除 tombstone。
- 批量导入先完整校验，再作为一个幂等事务和批次事件提交。

对被拒绝的乐观操作，回执包含错误码和必要的权威实体版本；客户端在应用回执或随后事件时修正本地状态并保留可理解的非阻塞提示。

### 12. 快照和事件保留保证长期离线恢复

服务端定期或按事件数量创建 namespace 快照，并在确认快照可用后按保留策略清理旧事件。若设备 cursor 早于可拉取窗口，`pull` 返回 `snapshot_required` 和当前 epoch；插件先保存 outbox，安装快照，再只重放当前 epoch 中仍合法的操作。

节点 tombstone 和 Key 待删除数据默认保留 30 天。即使 tombstone 已清理，`update` 操作也不得隐式创建不存在的 ID；只有显式 `create` 可以创建新节点，因此长期离线更新不会复活已删除数据。

### 13. 实时连接以 WebSocket 为主，生命周期触发补拉为兜底

Service Worker 建立 WSS 连接，并在小于浏览器空闲窗口的间隔交换轻量心跳。无论 WebSocket 状态如何，下列事件都会触发 pull：后台启动、浏览器启动、弹窗打开、网络恢复、认证续期成功和周期 alarm。

第一版不使用静默 Web Push，避免额外通知权限和供应商配置。若后台因资源压力被终止，重启后从持久 cursor 恢复；浏览器关闭或设备休眠期间不声称实时，恢复后自动收敛。

### 14. 正常同步保持无感，持续异常才显示状态

UI 始终先渲染本地数据。正常同步不显示阻塞进度；短暂失败采用带抖动的指数退避。认证撤销、主机权限缺失、实例身份变化、epoch 失效或 outbox 长时间无法推进时，设置页和主界面显示低干扰状态入口。

首次绑定是例外：覆盖/合并属于不可逆风险，必须使用可恢复向导和显式选择。向导的每一步状态持久化，关闭弹窗不会造成半完成绑定。

### 15. 服务端按单体部署并预留水平扩展

第一版提供 Docker 镜像和 PostgreSQL migration，可通过 Docker Compose 启动服务与数据库；TLS 由反向代理终止。一个服务进程即可承载 API、清理任务和 WebSocket。多实例部署时使用 PostgreSQL advisory lock 保证 migration、快照和清理任务单实例执行，使用 `LISTEN/NOTIFY` 唤醒各实例上的 WebSocket 连接。

通知不是数据总线，进程崩溃后客户端仍按 cursor 补拉。服务器日志统一脱敏 Authorization、`srkey`、access/refresh token 和备份内容，并记录 namespace、device、operation ID、seq、耗时及错误码用于诊断。

## Risks / Trade-offs

- [用户自托管任意 URL 会扩大扩展网络权限面] → 使用 optional host permissions，只在用户手势中请求精确 Origin；先发现服务再发送 Key，并只允许 HTTPS 或本机 HTTP。
- [数据库和 `SRKEY_PEPPER` 任一丢失都会影响恢复] → 部署文档要求分别备份数据库和 pepper；pepper 不进入数据库和日志，轮换需要显式迁移工具。
- [管理员 Key 同时用于日常同步会扩大泄露影响] → 管理能力由服务端 scope 强制，文档建议管理员为日常设备创建普通 Key；管理员可随时轮换并撤销设备。
- [字段级最后接受者规则仍可能覆盖同字段并发意图] → 保存事件和软删除恢复窗口，界面不引入复杂冲突编辑器；个人收藏场景优先确定性和无感体验。
- [WebSocket 无法保证浏览器关闭或休眠时即时到达] → 明确实时只适用于运行且联网设备，并在所有生命周期入口按 cursor 补拉。
- [强制下载备份会增加首次绑定摩擦] → 使用单个 ZIP、持久向导和一次性下载确认；这是执行覆盖或合并前刻意保留的安全门槛。
- [大型目录级联删除、导入和快照可能产生大事件] → 服务端限制单批节点数和 payload，使用批次事件分页传输，但以一个逻辑 operation receipt 保持原子语义。
- [位置值长期插入会增长] → 服务端在阈值达到时重平衡并发布权威顺序事件，节点 ID 提供稳定兜底排序。
- [Key 删除后的延迟清理占用存储] → 默认 30 天且可配置，后台按 namespace 分批清理并输出可审计结果。
- [服务端能读取收藏内容] → 明确这是自托管信任边界；端到端加密需要重新设计冲突校验和管理能力，不在本变更内。

## Migration Plan

1. 增加 workspace、共享协议包和服务端骨架，建立数据库 migration、服务发现和健康检查；不改变现有扩展行为。
2. 实现 Key、namespace、设备会话和管理员维护命令，部署测试服务器并记录默认管理员 Key。
3. 将 IndexedDB 升级到同步 schema：迁移现有节点、生成位置值和本地修订号；保持未绑定模式及现有 JSON v1 导入导出可用。
4. 增加连接设置、动态 Origin 授权和持久 bind session；实现双快照 ZIP、下载确认和三种协调事务。
5. 将现有 CRUD、级联删除和导入接入本地事务/outbox，先以关闭网络上传的 shadow 模式验证本地行为无回归。
6. 实现 push、pull、operation receipt、快照和冲突规则，再接入 Service Worker、WebSocket 与生命周期补拉。
7. 增加管理员 Key 管理、删除保留期、恢复和轮换 UI；验证跨 Key API 与实时频道隔离。
8. 在两个以上浏览器配置中进行断网、并发、后台终止、epoch reset、超期 cursor 和服务实例变化测试，再默认开放同步入口。

回滚时可关闭插件同步功能并停止后台网络任务，IndexedDB 中的活动节点继续支持纯本地读取和导出；outbox、binding 和同步元数据保留以便恢复。服务端回滚只允许到仍能读取当前数据库 schema 的版本，数据库 migration 采用向前修复而不删除已同步数据。任何“使用本地”或合并前均已有强制双备份，可作为人工恢复来源。
