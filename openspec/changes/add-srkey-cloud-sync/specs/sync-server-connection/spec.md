## Purpose

定义插件使用用户提供的 Server URL 与 `srkey` 安全发现、授权和绑定同步服务的行为，并防止地址变化、错误服务或权限拒绝造成数据和凭据泄露。

## ADDED Requirements

### Requirement: 连接必须同时提供 Server URL 和 srkey
插件 SHALL 要求用户同时提供 Server URL 与 `srkey` 才能建立云端连接。第一版 SHALL 只维护一个活动连接，且连接完成前不得替换已有活动连接。

#### Scenario: 缺少连接字段
- **WHEN** 用户未填写 Server URL 或 `srkey` 并尝试连接
- **THEN** 插件阻止连接请求
- **AND** 保持本地数据和已有连接不变

#### Scenario: 已有活动连接时连接新目标
- **WHEN** 用户提供与当前活动连接不同的服务实例或 Key
- **THEN** 插件将其作为候选连接启动新的首次绑定流程
- **AND** 仅在新连接完成协调后替换原活动连接

### Requirement: 插件必须规范化并限制 Server URL
插件 MUST 将 Server URL 解析为不含用户信息、查询参数和片段的 API 根地址，并保留合法子路径。生产连接 MUST 使用 HTTPS；仅 `localhost`、`127.0.0.1` 和 `[::1]` 的开发连接可以使用 HTTP。

#### Scenario: 输入带末尾斜杠的 HTTPS 地址
- **WHEN** 用户输入一个带末尾斜杠的合法 HTTPS API 根地址
- **THEN** 插件保存等价的规范化地址
- **AND** 后续 HTTP 与 WebSocket 端点均从该根地址派生

#### Scenario: 输入包含凭据或查询参数的地址
- **WHEN** Server URL 包含用户名、密码、查询参数或片段
- **THEN** 插件拒绝该地址
- **AND** 不发送 `srkey` 或本地数据

#### Scenario: 输入非本机 HTTP 地址
- **WHEN** 用户输入指向非回环地址的 HTTP Server URL
- **THEN** 插件拒绝连接并要求使用 HTTPS

### Requirement: 插件必须按目标 Origin 请求最小主机权限
插件 MUST 在用户主动连接时为规范化 Server URL 的精确 Origin 请求运行时主机权限。插件不得在权限授予前联系目标服务，也不得因单个连接而获得其他 Origin 的运行时访问权。

#### Scenario: 用户授予目标 Origin 权限
- **WHEN** 用户点击连接并批准目标 Origin 的主机权限
- **THEN** 插件继续执行服务发现
- **AND** 不申请其他未使用 Origin 的访问权

#### Scenario: 用户拒绝主机权限
- **WHEN** 用户拒绝目标 Origin 的权限请求
- **THEN** 插件停止连接流程并显示可理解的说明
- **AND** 不发送 `srkey`、备份或收藏数据

#### Scenario: 已绑定连接的权限被撤销
- **WHEN** 浏览器撤销当前 Server URL 的主机权限
- **THEN** 插件暂停上传、拉取和实时连接
- **AND** 保留本地数据与 outbox
- **AND** 在用户恢复权限后自动补拉和重试

### Requirement: 插件必须先发现并验证服务再提交 srkey
插件 MUST 先匿名调用 Server URL 下的服务发现端点，验证服务标识、API 兼容性、稳定实例 ID 和最低客户端版本。仅验证成功后，插件才可向绑定端点提交 `srkey`。

#### Scenario: 连接兼容的 WebWings 服务
- **WHEN** 发现端点返回受支持的服务标识、API 版本、实例 ID 和客户端版本范围
- **THEN** 插件允许继续提交 `srkey` 进行绑定

#### Scenario: 地址不是 WebWings 同步服务
- **WHEN** 发现端点缺少服务标识、返回无效实例 ID 或返回不可解析内容
- **THEN** 插件停止连接并报告服务不兼容
- **AND** 不向该地址发送 `srkey`

#### Scenario: 客户端版本过旧
- **WHEN** 服务端声明的最低客户端版本高于当前插件版本
- **THEN** 插件拒绝绑定并提示更新插件
- **AND** 保持本地数据不变

### Requirement: 活动连接身份必须由服务实例和内部 Key 共同确定
系统 MUST 使用服务发现返回的稳定实例 ID 与绑定返回的内部 Key ID 共同标识活动连接。Server URL SHALL 仅表示网络入口，不得单独决定数据空间身份。

#### Scenario: 同一服务迁移到新 URL
- **WHEN** 用户提供新 URL 和 Key 且服务返回原实例 ID 与原 Key ID
- **THEN** 插件将其识别为同一连接的地址迁移
- **AND** 在验证同步 epoch 后继续使用原本地数据和游标

#### Scenario: 原 URL 返回不同实例 ID
- **WHEN** 当前 Server URL 的发现端点返回与已绑定记录不同的实例 ID
- **THEN** 插件立即暂停同步并标记服务身份变化
- **AND** 不向该服务上传 outbox 或发送设备续期凭证

#### Scenario: 同一服务器切换 Key
- **WHEN** 用户在同一实例上提供返回不同 Key ID 的 `srkey`
- **THEN** 插件将其视为新的独立数据空间
- **AND** 启动完整的首次绑定协调流程

### Requirement: 插件不得持久化原始 srkey
绑定成功后，插件 MUST 仅保存规范化 Server URL、Origin、实例 ID、Key ID、Key 前缀、角色、设备 ID、设备续期凭证、同步 epoch 和服务端游标。原始 `srkey` MUST 从表单、内存中的长期状态和持久化存储中移除。

#### Scenario: 绑定完成后重新打开设置页
- **WHEN** 用户完成绑定后重新打开连接设置
- **THEN** 插件显示 Server URL、Key 前缀、角色和连接状态
- **AND** 不显示或恢复完整 `srkey`

### Requirement: 连接错误不得破坏本地状态
DNS、TLS、超时、服务不兼容、Key 无效、Key 撤销和设备凭证失效等连接错误 MUST 保留本地收藏、同步游标和未确认 outbox。只有明确完成首次绑定协调后，插件才可改变活动连接的数据映射。

#### Scenario: 服务端暂时不可达
- **WHEN** 连接测试或已绑定同步因网络错误失败
- **THEN** 插件保留全部本地数据和待发送操作
- **AND** 提供重试能力而不要求重新导入数据

#### Scenario: Key 已被撤销
- **WHEN** 服务端拒绝已绑定设备并表明 Key 已被撤销
- **THEN** 插件停止自动重试认证
- **AND** 保留本地数据
- **AND** 要求用户重新提供 Server URL 和有效 Key

### Requirement: 管理员绑定必须显示 Key 管理能力
服务端 SHALL 在绑定结果中返回当前 Key 的角色和能力。插件仅在已验证的管理员能力存在时显示 Key 管理入口，普通 Key 不得调用管理 API。

#### Scenario: 使用管理员 Key 连接
- **WHEN** 有效管理员 Key 完成连接和首次绑定
- **THEN** 插件显示 Key 管理入口
- **AND** 管理请求固定发送到当前已验证 Server URL

#### Scenario: 使用普通 Key 连接
- **WHEN** 普通 Key 完成连接和首次绑定
- **THEN** 插件不显示 Key 管理入口
- **AND** 服务端拒绝其管理 API 请求

