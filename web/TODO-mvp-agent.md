加 types：AgentMsg / Snapshot / ResumeQuality
加 resume analysis 函数
controller 增加 action：runResumeAnalysis
state 增加字段：resumeQuality
chat: 发消息时附带 snapshot
chat: 接收 AgentMsg + dispatch UI action
UI 分层：L0/L1/L2 展示逻辑
6 templates 先 hardcode（不接 LLM 也能跑通）