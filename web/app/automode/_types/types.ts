// web/app/automode/_types/types.ts

export type Section = {
    id: string;
    title: string;
    text: string;
  
    // grouping
    parentId?: string | null;
    isGroup?: boolean;
  
    constraints: string;
    optimizedText: string;
    optimizing?: boolean;
    error?: string;
  };
  
  export type OptimizeApiResp = {
    ok: boolean;
    error?: string | null;
    job_id?: string;
    sections?: Array<{
      id: string;
      title?: string;
      text?: string;
      optimized_text: string;
      warnings?: string[];
    }>;
  };
  
  export type PdfApiResp = {
    ok: boolean;
    error?: string | null;
    id?: string;
    url?: string;
  };
  
  export type ExportArtifact = {
    kind: "pdf" | "docx" | "md";
    filename: string;
    url: string;
  };

  export type ExportResp = {
    ok: boolean;
    error?: string | null;
    // Legacy fields (backward compatibility)
    pdf_url?: string;
    docx_url?: string;
    // New structured artifacts (Phase 4)
    artifacts?: ExportArtifact[];
    // Dev-only debugging (Phase 4)
    debug?: {
      job_id?: string;
      sections_count?: number;
      elapsed_ms?: number;
      worker_status?: number;
    };
  };
  
  export type ParseResp = {
    ok: boolean;
    error?: string | null;
    raw_text?: string;
    jd_text?: string;
    sections?: Array<{
      id: string;
      title: string;
      text: string;
      parentId?: string | null;
      isGroup?: boolean;
    }>;
  };
  
  export type DebugEntry = {
    ts: string;
    label: string;
    url: string;
    method: string;
    ms: number;
    status: number;
    ok: boolean;
    reqMeta?: any;
    resTextPreview?: string;
    resJson?: any;
    error?: string;
  };
  