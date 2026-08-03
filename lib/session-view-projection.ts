import { normalizeToolCalls } from "./normalize";
import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
} from "./types";
import type { ProjectedSessionEffect } from "./session-protocol";
import type { SessionEffectDelivery } from "./session-transport-client";
import type { SessionViewPromptClassification, SessionViewSnapshot } from "./session-view-transport";

export type SessionPromptClassification = SessionViewPromptClassification | "compaction" | null;

export type ProjectedSessionView = Readonly<{
  running: boolean;
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
  phase: "waiting_model" | "running_command" | "running_tools" | null;
  activeTools: ReadonlyArray<{ id: string; name: string }>;
  queue: Readonly<{ steering: readonly string[]; followUp: readonly string[] }>;
  retry: Readonly<{ attempt: number; maxAttempts: number; errorMessage?: string }> | null;
  compaction: Readonly<{
    active: boolean;
    reason: string;
    aborted?: boolean;
    errorMessage?: string;
    tokensBefore?: number;
    estimatedTokensAfter?: number;
  }> | null;
  dialog: ExtensionUiRequest | null;
  customUi: ExtensionUiRequest | null;
  statuses: readonly ExtensionStatusItem[];
  widgets: readonly ExtensionWidgetItem[];
  title: string | null;
}>;

export type SessionProjectedEffect =
  | Readonly<{ type: "message_completed"; message: AgentMessage; streamEpoch: string; sequence: number }>
  | Readonly<{ type: "notice"; level: "info" | "warning" | "error"; message: string; streamEpoch: string; sequence: number }>
  | Readonly<{ type: "editor_inserted"; text: string; streamEpoch: string; sequence: number }>;

function projectDraft(snapshot: SessionViewSnapshot): Partial<AssistantMessage> | null {
  const draft = snapshot.transport.state.draft;
  if (!draft) return null;
  const content: AssistantContentBlock[] = [];
  for (const block of [...draft.blocks].sort((a, b) => a.contentIndex - b.contentIndex)) {
    if (block.type === "text") content.push({ type: "text", text: block.text });
    else if (block.type === "thinking") content.push({ type: "thinking", thinking: block.thinking });
    else if (block.toolCall) {
      const normalized = normalizeToolCalls({
        ...draft.metadata,
        role: "assistant",
        content: [block.toolCall],
      } as AgentMessage) as AssistantMessage;
      const tool = normalized.content.find((candidate) => candidate.type === "toolCall");
      if (tool) content.push(tool);
    }
  }
  return {
    ...draft.metadata,
    role: "assistant",
    content,
    ...(draft.terminalReason ? { stopReason: draft.terminalReason } : {}),
  };
}

function projectDialog(snapshot: SessionViewSnapshot): ExtensionUiRequest | null {
  const dialog = snapshot.transport.state.dialogs.at(-1);
  return dialog ? ({ type: "extension_ui_request", ...dialog } as ExtensionUiRequest) : null;
}

function projectCustom(snapshot: SessionViewSnapshot): ExtensionUiRequest | null {
  const custom = snapshot.transport.state.customUis.at(-1);
  return custom ? { type: "extension_ui_request", id: custom.id, method: "custom", lines: [...custom.lines] } : null;
}

/** Pure adaptation from committed projected state into the existing hook view model. */
export function projectSessionView(
  snapshot: SessionViewSnapshot,
  promptClassification: SessionPromptClassification,
): ProjectedSessionView {
  const state = snapshot.transport.state;
  const draft = projectDraft(snapshot);
  const running = state.active || snapshot.localPromptPending;
  const tools = state.activeTools.map((tool) => ({ id: tool.toolCallId, name: tool.toolName }));
  let phase: ProjectedSessionView["phase"] = null;
  if (running) {
    if (tools.length > 0) phase = "running_tools";
    else if (promptClassification === "slash_command" && !state.active && !draft) phase = "running_command";
    else phase = "waiting_model";
  }
  return Object.freeze({
    running,
    isStreaming: running && draft !== null,
    streamingMessage: draft,
    phase,
    activeTools: Object.freeze(tools),
    queue: Object.freeze({ steering: Object.freeze([...state.queue.steering]), followUp: Object.freeze([...state.queue.followUp]) }),
    retry: state.retry ? Object.freeze({ ...state.retry }) : null,
    compaction: state.compaction ? Object.freeze({ ...state.compaction }) : null,
    dialog: projectDialog(snapshot),
    customUi: projectCustom(snapshot),
    statuses: Object.freeze(state.statuses.map((status) => Object.freeze({ ...status }))),
    widgets: Object.freeze(state.widgets.map((widget) => Object.freeze({ ...widget, lines: Object.freeze([...widget.lines]) }))) as unknown as readonly ExtensionWidgetItem[],
    title: state.title,
  });
}

/** Pure, non-journaling effect adaptation. Visibility and run lineage are caller gates. */
export function projectSessionEffect(delivery: SessionEffectDelivery): SessionProjectedEffect {
  const common = { streamEpoch: delivery.streamEpoch, sequence: delivery.sequence };
  const effect: ProjectedSessionEffect = delivery.effect;
  switch (effect.type) {
    case "message_completed":
      return Object.freeze({ type: "message_completed", message: normalizeToolCalls(effect.message), ...common });
    case "notice":
      return Object.freeze({ type: "notice", level: effect.level, message: effect.message, ...common });
    case "editor_inserted":
      return Object.freeze({ type: "editor_inserted", text: effect.text, ...common });
  }
}

export function isEffectCurrent(
  snapshot: SessionViewSnapshot,
  delivery: SessionEffectDelivery,
): boolean {
  return snapshot.transport.streamEpoch === delivery.streamEpoch
    && delivery.sequence <= snapshot.transport.cursor;
}
