// lib/architect/copy.ts
import type { Lang } from "./contracts";

export const COPY = {
  zh: {
    hello:
      "你好，我是 Resume Architect。我会协助你检查简历的 Section 拆分结果，并在需要时记录结构调整意图。",

    /**
     * 软护栏文案（正常页面流程不应看到）
     * 仅用于：直接调用 API / 页面状态异常 / 回归 bug
     */
    softNoSections:
      "我这边暂时没有拿到 CV 的 sections（可能是页面状态尚未同步）。\n\n请确认你已在页面上点击 **Parse CV** 并能看到 Sections 列表，然后再打开 Architect Chat。",

    /**
     * Parse CV 成功后，Chat 的首条提示（seed）
     * 不要求用户输入任何文字
     */
    confirmSplit:
      "请检查页面 **Sections** 区域中的 CV 拆分结果（可点击 **Expand** 展开查看）。\n\n- 如果拆分满意，请点击 **Confirm CV Sections**。\n- 如果需要调整结构，请点击 **Adjust structure**。",

    /**
     * 当用户开始描述“我想改结构”时
     * 仅用于收集意图，不生成 schema
     */
    askRequirements:
      "好的。请描述你希望如何调整简历结构，例如：\n- 想新增 / 删除哪些 sections\n- 哪些 sections 需要合并或拆分\n- 希望的展示顺序（例如 Skills 放在 Experience 前）\n\n我会记录这些偏好；当你准备好应用调整时，请点击 **Adjust structure**。",

    unknown:
      "我没有完全理解你的意思。\n\n你可以：\n- 描述你希望如何调整 sections（我会记录）\n- 或直接使用页面上的 **Confirm CV Sections** / **Adjust structure** 按钮继续。",
  },

  en: {
    hello:
      "Hi — I’m Resume Architect. I’ll help you review the CV section split and capture structural change intent when needed.",

    /**
     * Soft guard only (should not appear in normal UI flow)
     */
    softNoSections:
      "I don’t have CV sections on my side yet (the UI state may not be synced).\n\nPlease make sure you’ve clicked **Parse CV** and can see the Sections list on the page, then reopen Architect Chat.",

    /**
     * Seed message shown right after Parse CV succeeds
     */
    confirmSplit:
      "Please review the CV split under **Sections** on the page (you can click **Expand** to inspect details).\n\n- If the split looks good, click **Confirm CV Sections**.\n- If you want to change the structure, click **Adjust structure**.",

    /**
     * Collect structure-change intent only
     */
    askRequirements:
      "Sure. Please describe how you want to adjust the CV structure, for example:\n- sections to add or remove\n- sections to merge or split\n- preferred order (e.g., Skills before Experience)\n\nI’ll capture these preferences; when you’re ready to apply them, click **Adjust structure**.",

    unknown:
      "I didn’t fully understand.\n\nYou can:\n- describe how you want to adjust the sections (I’ll take note), or\n- use **Confirm CV Sections** / **Adjust structure** on the page to proceed.",
  },
} as const;

/**
 * Translation helper
 */
export function t(
  lang: Lang,
  key: keyof typeof COPY.zh,
  ...args: any[]
) {
  const pack = lang === "zh" ? COPY.zh : COPY.en;
  const v = (pack as any)[key];
  return typeof v === "function" ? v(...args) : v;
}
