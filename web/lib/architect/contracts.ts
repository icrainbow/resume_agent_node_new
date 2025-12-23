// lib/architect/contracts.ts

export type Lang = "zh" | "en";

export type ChatRole = "user" | "assistant";

/**
 * 你的 Graph 阶段机（可继续扩展）
 */
export type GraphStage =
  | "START"
  | "WAIT_PARSE" // 用户还没完成 Parse CV
  | "CONFIRM_SPLIT" // 询问用户拆分是否正确（旧逻辑保留）
  | "COLLECT_REQUIREMENTS" // 收集用户期望结构（旧逻辑保留）
  | "SHOW_SCHEMA_DRAFT" // 输出 schema 草案（旧逻辑保留）
  | "WAIT_REPARSE" // 等用户上传 schema 并重新 Parse（旧逻辑保留）
  | "DONE";

/**
 * 下一步推荐动作（给前端用，不是强制）
 */
export type NextSuggestedAction =
  | "NONE"
  | "CLICK_ADJUST"
  | "CLICK_CONFIRM"
  | "ASK_MORE";

export interface Message {
  role: ChatRole;
  content: string;
}

export interface Section {
  id: string;
  title: string;
  text: string;
  parentId?: string | null;
  isGroup?: boolean;

  // UI-side enrich (optional)
  constraints?: string;
  optimizedText?: string;
  optimizing?: boolean;
  error?: string;
}

/**
 * UI 侧传入 Graph 的“当前快照”
 * 注意：这里的 schema 指的是“CV section schema”（分组/顺序/标题层级等）
 */
export interface ArchitectSchema {
  job_id?: string;
  jd_text?: string;
  sections?: Section[];

  // Optional hints from Page.tsx
  resume_attached?: boolean;
  schema_attached?: boolean;

  // Optional: if you already keep schema_base or merged schema in UI snapshot
  schema_base?: any;
}

/**
 * 调整结构后可能返回的 split 结果（最小可用）
 * 你如果后端返回更多字段，可以继续扩展
 */
export interface AdjustedSplitResult {
  sections: Array<{
    id: string;
    title: string;
    text: string;
    parentId?: string | null;
    isGroup?: boolean;
  }>;
}

/**
 * =========================
 * Graph State (核心契约)
 * =========================
 *
 * 注意：
 * - 这份 GraphState 是你整个 LangGraph 的单一事实来源（SSOT）
 * - route.ts / page.tsx / ArchitectChat.tsx 都应该围绕它传递与展示
 */
export interface GraphState {
  /* ===== 原有字段（全部保留） ===== */
  lang: Lang;
  stage: GraphStage;

  // Conversation memory (assistant/user history, not including system)
  history: Message[];

  // Latest user message
  userMessage: string;

  // Snapshot from UI
  current: ArchitectSchema;

  // For split confirmation flow（旧逻辑，保留）
  lastSectionsSignature?: string;
  splitConfirmed?: boolean;

  // For schema drafting flow（旧逻辑，保留）
  requirementsText?: string;
  schemaDraftJson?: any;

  /* ===== MVP：结构调整所需字段 ===== */

  /**
   * 当前运行模式
   * - chat：只收集结构意图（不产生 schema，不 split）
   * - adjust_structure：生成 schema + split（会更新 current_schema）
   */
  action?: "chat" | "adjust_structure" | "reset";


  /**
   * 聊天中累计的“结构调整意图”
   * 统一用 string，避免 any/null 造成前后端分歧
   */
  pending_requirements?: string;

  /**
   * 是否存在尚未应用的结构变更
   * - true：应引导点击 Adjust
   * - false：无需生成 schema
   */
  schema_dirty?: boolean;

  /**
   * 给前端的下一步建议动作（UI 可以用，也可以忽略）
   */
  next_suggested_action?: NextSuggestedAction;

  /* ===== NEW：调试与可观测性（你要的 Debug Panel 第三栏） ===== */

  /**
   * 当前已合并、已生效的 schema（最终 SSOT）
   * 你要在 Debug Panel 的 third column 展示它
   */
  current_schema?: any;

  /**
   * 基准 schema（可选）
   * - 如果你支持“在 base 上 merge changes”
   * - 或者用于 diff 对比
   */
  schema_base?: any;

  /**
   * adjust_structure 时生成的候选 schema（可选）
   */
  schema_candidate?: any;

  /**
   * adjust_structure 后生成的新 sections（可选）
   * 你也可以直接把最终 sections 写回 current.sections，
   * 但为了 debug/审计，这里保留一个显式字段。
   */
  adjusted_sections?: AdjustedSplitResult | null;

  /**
   * 差异摘要 & 警告（可选，用于 UI debug/提示）
   */
  diff_summary?: string;
  warnings?: string[];

  // Allow pass-through fields for MVP persistence (job_id/raw_cv_text/etc.)
  [k: string]: any;

  
}

/**
 * =========================
 * API Contracts
 * =========================
 */

export interface ArchitectRequest {
  // currentSchema from UI (old client contract)
  currentSchema?: ArchitectSchema;

  // the new user message（旧接口）
  message?: string;

  // client-held state
  state?: GraphState;

  /* ===== 新增（MVP 可选） ===== */

  /**
   * 指定本次调用的动作类型
   * - chat
   * - adjust_structure
   */
  action?: "chat" | "adjust_structure" | "reset";


  /**
   * OpenAI-style messages（ArchitectChat.tsx 已在用）
   */
  messages?: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;

  /**
   * MVP：UI 快照的新字段名（route.ts 已支持 body.current）
   */
  current?: ArchitectSchema;

  /**
   * 作为图的可选输入（route.ts 已支持透传）
   */
  job_id?: string;
  raw_cv_text?: string;
  schema_base?: any;
  pending_requirements?: string;
  sections_outline?: any;
}

export interface ArchitectResponse {
  ok: boolean;

  // Single-source-of-truth assistant reply text
  message: string;

  // Optional: schema 结果（仅 adjust_structure 会返回；chat 模式应为空或 null）
  schema?: any;

  // Return updated state
  state: GraphState;

  /* ===== MVP / 扩展字段（向前兼容） ===== */

  // adjust_structure artifacts
  schema_candidate?: any;
  schema_merged?: any; // NEW: merged schema (if your graph returns it)
  current_schema?: any; // NEW: for Debug Panel third column
  schema_changed?: boolean;

  // split result (if adjust_structure returns new sections)
  sections?: any;

  diff_summary?: string;
  warnings?: string[];

  // chat accumulation
  pending_requirements?: string;
  schema_dirty?: boolean;
  next_suggested_action?: NextSuggestedAction;
}
