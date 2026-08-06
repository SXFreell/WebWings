## Why

独立设置页仍继承扩展弹窗的固定 `760×580` 尺寸与 `overflow: hidden`，导致浏览器标签页中无法全屏展示且内容可能无法滚动。与此同时，首次绑定在“空云端 + 空本地”场景提交“初始化云端”时，真实环境返回 `invalid bind request`，但当前分层单元测试无法暴露请求构造、HTTP 序列化或部署端协议校验之间的偏差。

## What Changes

- 隔离 popup 与 options 的页面级布局约束：popup 保持固定尺寸，options 使用完整浏览器视口并支持页面纵向滚动。
- 调整设置页内容容器，使其在窄屏和高内容量下保持可访问，同时不裁剪首次绑定向导、Key 管理和数据管理区域。
- 为绑定完成请求建立单一构造与校验边界，在发送前使用共享协议 schema 验证最终 JSON 形状，并把校验失败转换为可操作的中文错误。
- 服务端在继续返回不泄露实现和凭据的通用客户端错误时，记录脱敏的协议校验失败字段路径，便于定位真实请求与协议的差异。
- 增加“空云端 + 空本地 → 备份 → 凭证 → 初始化云端”的完整 HTTP 回归测试，并覆盖无效绑定请求不会修改本地或云端状态。

## Capabilities

### New Capabilities

- `extension-settings-page-layout`: 定义独立设置页与 popup 的页面级尺寸、响应式布局和滚动行为。
- `first-bind-completion-contract`: 定义首次绑定完成请求的客户端构造、协议校验、空数据初始化、错误呈现和安全诊断行为。

### Modified Capabilities

无。

## Impact

- 扩展入口与样式：`src/styles.css`、`src/options.tsx`、popup 入口、`src/OptionsApp.tsx` 和相关渲染测试。
- 首次绑定客户端：`src/lib/sync/first-bind.ts`、`src/lib/sync/client.ts`、共享协议导出及对应测试。
- 同步服务：`server/src/app.ts` 的绑定完成请求校验与日志，以及 API/集成测试。
- 不改变同步数据模型、备份安全前置条件、`srkey`/token 的保密规则或现有成功请求的协议语义。
