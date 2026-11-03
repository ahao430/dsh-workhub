# WorkHub · 钉钉 × 云效 个人工作智能台

把钉钉与云效的工作数据聚合到本地，用确定性统计看清工作全貌，用 AI 总结回溯每件事的来源。

> 钉钉和云效记录工作，WorkHub 帮你看清工作如何发生、如何推进，以及下一步该做什么。

这是一个 **DeepSeek Harness（DSH）双端插件**：Host 侧负责数据采集、存储、分析与 Agent 工具；Client 侧以 React 面板形式嵌入 DSH Web UI。数据全部保存在本机 SQLite，不需要部署任何后端服务。

## 特性

**双数据源（11 个同步源）**

| 数据源 | 能力 |
| --- | --- |
| 钉钉（DWS CLI） | 待办、日志/日报、AI 听记、会话注册表、聊天消息（按需）、考勤打卡 |
| 云效（OpenAPI） | 项目空间、代码仓库、流水线、需求/任务、Commit、报工工时、排期节点 |

**核心能力**

- **工作驾驶舱**：时间范围（含「上周五 → 本周四」报工周期）、粒度自动分级、上期对比、项目投入分布、活动趋势（tooltip 展示当日提交的需求号）、AI 洞察卡
- **工作日历**：月/周视图，卡片优先展示打卡时段与报工时长、当日提交最多的需求号；点选日期查看每日总结、云效排期节点、聚合后的事件时间线（原始明细可展开）
- **项目分析**：手动项目（关键词/群绑定）与云效项目空间自动归集，展示报工工时、提交数、需求状态分布、跨系统关联工作项
- **聊天洞察**：会话选择与按需采集、发言统计、会话小结（话题分组 / 行动项 / 未决问题）、AI 话题聚类
- **工作效能**：周×小时热力图、时段分布、协作对象 Top 榜单
- **智能报告**：规则版周报/日报即时生成（工作概况 / 逐日概览 / 代码推进 / 排期节点 / 沟通协作 / 产出 / 风险 / 下周计划），支持导出 Markdown 与删除
- **快捷执行**：云效流水线运行（二次确认 + 操作审计日志）
- **Agent 工具**：14 个 `workhub_*` 工具，全部只读或带确认；AI 洞察与总结强制携带来源证据

## 安装

需要先安装并登录 DWS CLI（`dws auth login`）。

```bash
# 在工作区克隆本仓库后，把插件安装进当前 DSH profile
# 安装动作由 DSH 的 plugin_manager 完成（见下文「安装到 DSH」）
```

本仓库是 **工作区目录形式的 DSH bundle**（`package.json` 中 `dsh.bundle.patch` + `dsh.client`），安装方式：

1. 在 DSH 中调用 `plugin_manager` 的 `install_bundle`，`target` 指向本目录绝对路径；
2. 安装后插件行 id 为 `workhub`，用 `set_plugin` 启用；
3. 刷新 DSH Web 页面，左侧边栏出现 WorkHub 图标。

## 配置云效

1. 云效控制台 → 个人设置 → 个人访问令牌 → 创建 PAT（建议权限：用户信息、项目、需求/任务、代码管理、报工；工作流可选）；
2. 打开 WorkHub「数据管理」→ 阿里云云效卡片；
3. 填入 API Base URL（中心站 `https://openapi-rdc.aliyuncs.com`，或你的 Region 专属域名）、组织 ID（可留空自动获取）、PAT；
4. 保存后 Token 写入**系统钥匙串**（macOS Keychain），SQLite 只保存 `credentialRef`，代码与日志均不落明文。

若 PAT 在某处泄露，请在云效侧轮换：生成新 Token 后在卡片里覆盖保存即可。

## 数据与隐私

- 所有数据仅存本地：`$DSH_PROFILE_DIR/workhub/data.db`（无 `DSH_PROFILE_DIR` 时回退 `~/.dsh/workhub/data.db`），SQLite `node:sqlite`。
- 聊天原文按需采集、按保留策略清理；总结与分析结论均以 `sourceReferences` 记录来源。
- 不复制 DWS 内部 Token；云效 PAT 只存系统钥匙串。
- 仓库内 `tests/fixtures/` 为脱敏示例数据，不含任何真实组织信息。

## 目录结构

```
dsh-workhub/
├── index.js                  # Host 入口：webServer 路由 / Agent 工具 / 定时同步
├── client.js                 # Client 入口：面板、页面、设计系统
├── lib/
│   ├── dws-executor.js       # 唯一 spawn 出口（超时/并发/输出上限/JSON 容错）
│   ├── dws-client.js         # 钉钉命令封装（argv 白名单）
│   ├── collector/            # 钉钉 & 云效采集器、同步管理
│   ├── yunxiao/client.js     # 云效 OpenAPI 客户端（node:https + PAT）
│   ├── storage/db.js         # SQLite schema、迁移、聚合查询
│   ├── security/credential-store.js  # 钥匙串凭证存储
│   ├── time.js               # 时间预设/粒度/对比区间
│   ├── watchdog.js           # 规则引擎（逾期、沉寂项目等）
│   ├── api.js                # 同源 HTTP API（只读 + 受控写）
│   └── tools.js              # Agent 工具注册
├── locale/                   # 插件展示元数据
└── tests/render-check.mjs    # 客户端渲染冒烟测试
```

## 开发

```bash
node --check client.js                  # 语法检查
node tests/render-check.mjs             # 渲染冒烟测试（8 个页面 + 数据子组件）
```

设计约定：

- 客户端只用 DSH 主题 token（`--dsw-alias-*`）做背景/边框/正文，强调色使用插件自有高对比色板（保证浅色/深色主题都清晰）；
- 所有钉钉调用集中经过 `DwsExecutor`，参数由白名单生成，禁止拼接 shell 字符串；
- 统计指标一律由 SQL 聚合产生，LLM 只做解释，且结论必须带来源。

## 路线图

- [ ] 考勤/工时交叉分析视图
- [ ] 云效应用交付（需追加 PAT 权限）
- [ ] 面板内直连模型的 AI 总结（当前为规则版 + Agent 精修）
- [ ] 团队视图与多用户部署

## License

MIT
