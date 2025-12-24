// web/lib/agent/contracts.ts

export type NextSuggestedAction =
  | {
      kind: "cta";
      id:
        | "upload_resume"
        | "parse_cv"
        | "upload_schema"
        | "provide_jd"
        | "generate_schema"
        | "confirm_sections"
        | "optimize_whole"
        | "switch_to_manual";
      label: string;
      payload?: Record<string, any>;
    }
  | { kind: "none" };

export type AgentContext = {
  has_resume?: boolean;
  has_schema?: boolean;
  has_jd?: boolean;
  sections_count?: number;
  cv_sections_confirmed?: boolean;
  schema_dirty?: boolean;

  proxy_to_architect?: boolean;
  route_hint?: "architect" | "rule" | "auto" | "architect_agent";
};

export type AgentResult = {
  assistant_message: string;
  next_suggested_action: NextSuggestedAction;
  agent_id_used?: string;
  /**
   * Optional error message if agent encountered an error but failed closed.
   * If set, agent returned fallback outputs instead of failing the request.
   */
  error?: string;
};
