import type { AssistantContentBlock, AssistantMessage, ThinkingContent, ToolCallContent } from "./types";

interface DisplayOptions {
  isStreaming?: boolean;
}

interface AssistantBlockKeyOptions extends DisplayOptions {
  sessionId?: string;
  entryId?: string;
  messageTimestamp?: number;
  originalIndex: number;
}

interface AssistantBlockItem {
  block: AssistantContentBlock;
  originalIndex: number;
}

export function isEmptyThinkingBlock(block: AssistantContentBlock, options: DisplayOptions = {}): block is ThinkingContent {
  return block.type === "thinking" && !block.deferred && !options.isStreaming && block.thinking.trim() === "";
}

function getDisplayableAssistantBlockItems(
  message: AssistantMessage,
  options: DisplayOptions = {},
): AssistantBlockItem[] {
  return (message.content ?? [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => !isEmptyThinkingBlock(block, options));
}

export function getDisplayableAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): AssistantContentBlock[] {
  return getDisplayableAssistantBlockItems(message, options).map(({ block }) => block);
}

export function buildAssistantBlockKey(
  blockType: AssistantContentBlock["type"],
  options: AssistantBlockKeyOptions,
): string {
  if (
    blockType === "text"
    && !options.isStreaming
    && typeof options.messageTimestamp === "number"
    && Number.isFinite(options.messageTimestamp)
  ) {
    return `completed-text:${options.messageTimestamp}:${options.originalIndex}`;
  }

  return [
    blockType,
    options.sessionId ?? "session",
    options.entryId ?? "stream",
    options.originalIndex,
  ].join(":");
}

function isFinalAnswerBlock(block: AssistantContentBlock): boolean {
  return block.type === "text" || block.type === "image";
}

export function splitFinalAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): {
  answerBlocks: AssistantContentBlock[];
  answerBlockIndices: number[];
  processBlocks: AssistantContentBlock[];
  processBlockIndices: number[];
} {
  const items = getDisplayableAssistantBlockItems(message, options);
  const lastProcessIndex = items.findLastIndex(({ block }) => !isFinalAnswerBlock(block));
  const processItems = lastProcessIndex === -1 ? [] : items.slice(0, lastProcessIndex + 1);
  const answerItems = items.slice(lastProcessIndex + 1);

  return {
    answerBlocks: answerItems.map(({ block }) => block),
    answerBlockIndices: answerItems.map(({ originalIndex }) => originalIndex),
    processBlocks: processItems.map(({ block }) => block),
    processBlockIndices: processItems.map(({ originalIndex }) => originalIndex),
  };
}

export function countToolCallBlocks(blocks: AssistantContentBlock[]): number {
  return blocks.filter((block): block is ToolCallContent => block.type === "toolCall").length;
}
