import { createAgentSessionFromServices, createAgentSessionServices, getAgentDir, initTheme, SessionManager, Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { randomUUID } from "crypto";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { invalidateModelsCache } from "./models-cache";
import { cacheSessionPath, invalidateSessionListCache } from "./session-reader";
import { cloneSessionBranch } from "./session-clone";
import {
  invalidateHostedImplementationCapability,
  registerHostedImplementationCapability,
  type HostedImplementationLaunchRequest,
  type HostedImplementationLifecycle,
} from "./hosted-implementation-session";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "./pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "./types";
import {
  getProjectedSessionHub,
  installProjectedSessionHubCapability,
  type ProjectedInputCommitOutcome,
  type ProjectedSessionEventHub,
  type ProjectedSessionHubReader,
} from "./session-event-hub";
import type { AcceptedNativeLifecycleInput } from "./session-projector";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type PendingCustomUiSetup = {
  finish: (value: unknown) => void;
  destroyed: boolean;
};

type NativeCausalClaim = {
  startOutcome: "pending" | "committed";
  terminalReserved: boolean;
  terminalOutcome: "pending" | "committed" | null;
  terminalFanoutComplete: boolean;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

export type EnsuredSessionTransportTarget = Readonly<{
  sessionId: string;
  sessionFile: string;
  cwd: string;
}>;

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];
export const RPC_SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

// Extensions require a complete Theme, while the web UI applies its own styling.
class PlainTextTheme extends Theme {
  constructor() {
    super(
      { thinkingXhigh: "" } as ConstructorParameters<typeof Theme>[0],
      {} as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
  }

  override fg(...[, text]: Parameters<Theme["fg"]>): string { return text; }
  override bg(...[, text]: Parameters<Theme["bg"]>): string { return text; }
  override bold(text: string): string { return text; }
  override italic(text: string): string { return text; }
  override underline(text: string): string { return text; }
  override inverse(text: string): string { return text; }
  override strikethrough(text: string): string { return text; }
  override getFgAnsi(): string { return ""; }
  override getBgAnsi(): string { return ""; }
  override getThinkingBorderColor(): (text: string) => string {
    return (text) => text;
  }
  override getBashModeBorderColor(): (text: string) => string { return (text) => text; }
}

const PLAIN_TEXT_THEME = new PlainTextTheme();
const CUSTOM_UI_KEYBINDINGS = new TuiKeybindingsManager(TUI_KEYBINDINGS);

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private pendingCustomUiSetups = new Map<string, PendingCustomUiSetup>();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private promptRunningCount = 0;
  private compactionRunningCount = 0;
  private nativeAgentTurnCount = 0;
  private reservedNativeTerminalCount = 0;
  private standaloneNativeCompactionCount = 0;
  private reservedStandaloneCompactionTerminalCount = 0;
  private nativeCausalClaims: NativeCausalClaim[] = [];
  private standaloneCompactionCausalClaims: NativeCausalClaim[] = [];
  private eventFanoutDepth = 0;
  private deferredSettlementRequested = false;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private forceEmptySystemPrompt = false;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallbacks = new Set<() => void>();
  private hostedKickoffState: "none" | "scheduled" | "dispatched" | "cancelled" | "failed" = "none";
  private hostedKickoffLifecycle: HostedImplementationLifecycle | null = null;
  private nativeDisposed = false;
  private _alive = true;
  private ensuredSessionTransportTarget: EnsuredSessionTransportTarget | null = null;
  private readonly projectedHub: ProjectedSessionEventHub;

  constructor(
    public readonly inner: AgentSessionLike,
    private readonly idleTimeoutMs = RPC_SESSION_IDLE_TIMEOUT_MS,
  ) {
    // This wrapper-owned capability must exist before start() subscribes to Pi
    // and before the wrapper can be published in the global registry.
    this.projectedHub = installProjectedSessionHubCapability(this, {
      initialQueue: {
        steering: inner.getSteeringMessages(),
        followUp: inner.getFollowUpMessages(),
      },
    });
  }

  getProjectedEventHub(): ProjectedSessionHubReader | null {
    return getProjectedSessionHub(this);
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  /**
   * Admit the exact newly ensured native owner to session-ticket bootstrap
   * before its header has been persisted. The immutable identity is captured
   * only by the server route that created this wrapper; callers still have to
   * prove that this exact live wrapper remains the registry owner.
   */
  enableEnsuredSessionTransport(): void {
    const manager = this.inner.sessionManager;
    const sessionId = this.sessionId;
    const managerSessionId = manager.getSessionId();
    const sessionFile = normalizedExistingSessionPath(manager.getSessionFile() ?? "");
    const cwd = normalizedExistingSessionPath(manager.getCwd());
    const exposedSessionFile = this.sessionFile
      ? normalizedExistingSessionPath(this.sessionFile)
      : null;
    if (!this._alive || !sessionId || managerSessionId !== sessionId
      || !sessionFile || !cwd
      || (this.sessionFile && exposedSessionFile !== sessionFile)) {
      throw new Error("rpc_ensured_session_identity_unavailable");
    }
    this.ensuredSessionTransportTarget = Object.freeze({ sessionId, sessionFile, cwd });
  }

  hasEnsuredSessionTransportTarget(): boolean {
    return this.ensuredSessionTransportTarget !== null;
  }

  getEnsuredSessionTransportTarget(): EnsuredSessionTransportTarget | null {
    const target = this.ensuredSessionTransportTarget;
    if (!target || !this._alive) return null;
    try {
      const manager = this.inner.sessionManager;
      const exposedSessionFile = this.sessionFile
        ? normalizedExistingSessionPath(this.sessionFile)
        : null;
      if (this.sessionId !== target.sessionId
        || manager.getSessionId() !== target.sessionId
        || normalizedExistingSessionPath(manager.getSessionFile() ?? "") !== target.sessionFile
        || normalizedExistingSessionPath(manager.getCwd()) !== target.cwd
        || (this.sessionFile && exposedSessionFile !== target.sessionFile)) return null;
      return target;
    } catch {
      return null;
    }
  }

  isRunning(): boolean {
    return this._alive && (
      this.promptRunningCount > 0
      || this.compactionRunningCount > 0
      || this.inner.isStreaming
      || this.inner.isCompacting
    );
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      // One outer barrier covers canonical capture, projected publication,
      // stable exact-raw fanout, receipt resolution, and causal release.
      this.beginEventFanout();
      try {
        const prepared = this.projectedHub.prepareNativeInput(event);
        const lifecycle = prepared?.lifecycle ?? null;
        if (lifecycle?.kind === "agent_end") invalidateSessionListCache();

        // Pending starts are causal claims before raw fanout so a nested terminal
        // can reserve them. They become committed activity only if their exact
        // projected start frame commits.
        const startClaim = this.prepareCausalStart(lifecycle);
        const terminalClaim = this.reserveCausalTerminal(lifecycle);
        const receipt = prepared ? this.projectedHub.acceptPreparedNativeInput(prepared) : null;

        // Capture/projection rejection never suppresses the exact original raw
        // object or lets one hostile observer suppress another.
        this.fanoutLegacyEvent(event);
        if (terminalClaim) terminalClaim.terminalFanoutComplete = true;

        const observeOutcome = (outcome: ProjectedInputCommitOutcome) => {
          if (!this._alive) return;
          if (startClaim) this.resolveCausalStart(lifecycle, startClaim, outcome);
          if (terminalClaim) this.resolveCausalTerminal(lifecycle, terminalClaim, outcome);
        };
        if (receipt) receipt.whenResolved(observeOutcome);
        else observeOutcome("rejected");
        this.publishRunningState();
      } finally {
        this.endEventFanout();
      }
    });
    this.resetIdleTimer();
    this.publishRunningState();
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force;
    this.applyForcedEmptySystemPrompt();
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((err) => {
      const errorClass = err instanceof Error && /^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/.test(err.name)
        ? err.name
        : "Error";
      console.error(`[pi-web] extension_binding stage=failed errorClass=${errorClass}`);
    });
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: "rpc",
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () => this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "notify",
            notifyType: "warning",
            message: "Extension requested shutdown, but shutdown is not supported in pi-web.",
          } as ExtensionUiRequest as AgentEvent),
          onError: (error) => this.emit({
            type: "extension_error",
            extensionPath: error.extensionPath,
            event: error.event,
            error: error.error,
          }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      this.applyForcedEmptySystemPrompt();
      console.log("[pi-web] extension_binding stage=dispatched outcome=ok");
    })().catch((err) => {
      this.extensionBindingError = err;
      throw err;
    });

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (this.extensionBindingPromise) await this.extensionBindingPromise;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands";
  }

  private publishRunningState(): void {
    publishRunningSessionState(this.sessionId, this.isRunning());
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      this.publishRunningState();
    }
  }

  private claimPromptRun(): void {
    this.promptRunningCount += 1;
    this.projectedHub.accept({ type: "wrapper_activity_started", activity: "prompt" });
    this.publishRunningState();
  }

  private releasePromptRun(settle = true): void {
    if (this.promptRunningCount === 0) return;
    this.promptRunningCount -= 1;
    this.publishRunningState();
    if (settle) this.settleProjectedActivityIfIdle();
  }

  private claimCompactionRun(): void {
    this.compactionRunningCount += 1;
    this.projectedHub.accept({ type: "wrapper_activity_started", activity: "compaction" });
    this.publishRunningState();
  }

  private releaseCompactionRun(settle = true): void {
    if (this.compactionRunningCount === 0) return;
    this.compactionRunningCount -= 1;
    this.publishRunningState();
    if (settle) this.settleProjectedActivityIfIdle();
  }

  private causalClaimsFor(lifecycle: AcceptedNativeLifecycleInput | null): NativeCausalClaim[] | null {
    if (lifecycle?.kind === "agent_start" || lifecycle?.kind === "agent_settled") return this.nativeCausalClaims;
    if (lifecycle?.kind === "manual_compaction_start" || lifecycle?.kind === "manual_compaction_end") return this.standaloneCompactionCausalClaims;
    return null;
  }

  private syncCausalClaimCounts(): void {
    this.nativeAgentTurnCount = this.nativeCausalClaims.filter((claim) => !claim.terminalReserved).length;
    this.reservedNativeTerminalCount = this.nativeCausalClaims.filter((claim) => claim.terminalReserved).length;
    this.standaloneNativeCompactionCount = this.standaloneCompactionCausalClaims.filter((claim) => !claim.terminalReserved).length;
    this.reservedStandaloneCompactionTerminalCount = this.standaloneCompactionCausalClaims.filter((claim) => claim.terminalReserved).length;
  }

  private prepareCausalStart(lifecycle: AcceptedNativeLifecycleInput | null): NativeCausalClaim | null {
    if (lifecycle?.kind !== "agent_start" && lifecycle?.kind !== "manual_compaction_start") return null;
    const claims = this.causalClaimsFor(lifecycle);
    if (!claims || claims.length >= Number.MAX_SAFE_INTEGER) return null;
    const claim: NativeCausalClaim = {
      startOutcome: "pending",
      terminalReserved: false,
      terminalOutcome: null,
      terminalFanoutComplete: false,
    };
    claims.push(claim);
    this.syncCausalClaimCounts();
    return claim;
  }

  private reserveCausalTerminal(lifecycle: AcceptedNativeLifecycleInput | null): NativeCausalClaim | null {
    if (lifecycle?.kind !== "agent_settled" && lifecycle?.kind !== "manual_compaction_end") return null;
    const claim = this.causalClaimsFor(lifecycle)?.find((candidate) => !candidate.terminalReserved) ?? null;
    if (!claim) return null;
    claim.terminalReserved = true;
    claim.terminalOutcome = "pending";
    claim.terminalFanoutComplete = false;
    this.syncCausalClaimCounts();
    return claim;
  }

  private removeCausalClaim(lifecycle: AcceptedNativeLifecycleInput | null, claim: NativeCausalClaim): void {
    const claims = this.causalClaimsFor(lifecycle);
    const index = claims?.indexOf(claim) ?? -1;
    if (claims && index >= 0) claims.splice(index, 1);
    this.syncCausalClaimCounts();
  }

  private completeCommittedCausalClaim(lifecycle: AcceptedNativeLifecycleInput | null, claim: NativeCausalClaim): void {
    if (claim.startOutcome !== "committed" || claim.terminalOutcome !== "committed" || !claim.terminalFanoutComplete) return;
    this.removeCausalClaim(lifecycle, claim);
    this.settleProjectedActivityIfIdle();
  }

  private resolveCausalStart(
    lifecycle: AcceptedNativeLifecycleInput | null,
    claim: NativeCausalClaim,
    outcome: ProjectedInputCommitOutcome,
  ): void {
    if (outcome === "rejected") {
      this.removeCausalClaim(lifecycle, claim);
      return;
    }
    claim.startOutcome = "committed";
    this.completeCommittedCausalClaim(lifecycle, claim);
  }

  private resolveCausalTerminal(
    lifecycle: AcceptedNativeLifecycleInput | null,
    claim: NativeCausalClaim,
    outcome: ProjectedInputCommitOutcome,
  ): void {
    if (outcome === "rejected") {
      claim.terminalReserved = false;
      claim.terminalOutcome = null;
      claim.terminalFanoutComplete = false;
      this.syncCausalClaimCounts();
      return;
    }
    claim.terminalOutcome = "committed";
    this.completeCommittedCausalClaim(lifecycle, claim);
  }

  private projectedActivityIsIdle(): boolean {
    return this.promptRunningCount === 0
      && this.compactionRunningCount === 0
      && this.nativeAgentTurnCount === 0
      && this.reservedNativeTerminalCount === 0
      && this.standaloneNativeCompactionCount === 0
      && this.reservedStandaloneCompactionTerminalCount === 0
      && this.projectedHub.getState().active;
  }

  private settleProjectedActivityIfIdle(): void {
    if (!this.projectedActivityIsIdle()) return;
    if (this.eventFanoutDepth > 0) {
      this.deferredSettlementRequested = true;
      return;
    }
    this.projectedHub.accept({ type: "wrapper_settled" });
  }

  private beginEventFanout(): void {
    if (this.eventFanoutDepth < Number.MAX_SAFE_INTEGER) this.eventFanoutDepth += 1;
  }

  private endEventFanout(): void {
    if (this.eventFanoutDepth > 0) this.eventFanoutDepth -= 1;
    if (this.eventFanoutDepth !== 0 || !this.deferredSettlementRequested) return;
    this.deferredSettlementRequested = false;
    this.settleProjectedActivityIfIdle();
  }

  private applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";
    }
  }

  private fanoutLegacyEvent(event: AgentEvent): void {
    // Every observer registered at fanout start sees this exact raw object once.
    // Listener mutation affects only later events, and listener failure cannot
    // suppress another observer or terminal wrapper cleanup.
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch { /* legacy listener failures are isolated */ }
    }
  }

  private emit(event: AgentEvent): void {
    // Projection is authoritative and subscriber-independent. The barrier also
    // covers wrapper-generated public events so a nested last-claim release
    // cannot overtake the event that caused it.
    this.beginEventFanout();
    try {
      this.projectedHub.accept(event);
      this.fanoutLegacyEvent(event);
    } finally {
      this.endEventFanout();
    }
  }

  private resetIdleTimer(): void {
    if (!this._alive) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this._alive) return;
      if (this.isRunning()) {
        this.resetIdleTimer();
        return;
      }
      this.destroy();
    }, this.idleTimeoutMs);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallbacks.add(cb);
  }

  private callLifecycle(callback: () => void): void {
    try { callback(); } catch { /* lifecycle diagnostics must not affect the target */ }
  }

  private beginPrompt(
    message: string,
    promptImages?: Array<{ type: "image"; data: string; mimeType: string }>,
    streamingBehavior?: "steer" | "followUp",
    lifecycle?: HostedImplementationLifecycle,
    publicErrorMessage?: string,
  ): void {
    const promptPromise = this.inner.prompt(message, {
      ...(promptImages?.length ? { images: promptImages } : {}),
      ...(streamingBehavior ? { streamingBehavior } : {}),
      source: "rpc",
    });
    if (lifecycle) this.callLifecycle(lifecycle.kickoffDispatched);

    promptPromise.then(() => {
      if (!streamingBehavior) this.emit({ type: "prompt_done" });
      this.releasePromptRun();
      this.resetIdleTimer();
      if (lifecycle) this.callLifecycle(lifecycle.targetSettled);
    }, (error) => {
      invalidateSessionListCache();
      this.emit({
        type: "prompt_error",
        errorMessage: publicErrorMessage ?? (error instanceof Error ? error.message : String(error)),
      });
      if (!streamingBehavior) this.emit({ type: "prompt_done" });
      this.releasePromptRun();
      this.resetIdleTimer();
      if (lifecycle) this.callLifecycle(() => lifecycle.targetFailed(error));
    });
  }

  /**
   * Claim and schedule the hosted kickoff without returning a target-owned
   * promise to the source launcher. Extension binding and prompt preflight run
   * in this wrapper-owned background task.
   */
  startHostedPrompt(message: string, lifecycle: HostedImplementationLifecycle): boolean {
    if (!this._alive || this.hostedKickoffState !== "none") return false;
    this.hostedKickoffState = "scheduled";
    this.hostedKickoffLifecycle = lifecycle;
    this.callLifecycle(lifecycle.ownershipAccepted);
    this.claimPromptRun();
    this.callLifecycle(lifecycle.kickoffScheduled);

    void (async () => {
      try {
        await this.waitForExtensionsBound();
        // Target Stop or owner cleanup may have cancelled the wrapper-owned
        // kickoff while extension binding was unresolved. There is no await
        // between this check, marking dispatch, and invoking native prompt.
        if (!this._alive || this.hostedKickoffState !== "scheduled") return;
        this.hostedKickoffState = "dispatched";
        this.hostedKickoffLifecycle = null;
        this.beginPrompt(message, undefined, undefined, lifecycle, "Hosted target prompt failed");
      } catch (error) {
        if (this.hostedKickoffState === "cancelled") return;
        this.hostedKickoffState = "failed";
        this.hostedKickoffLifecycle = null;
        invalidateSessionListCache();
        this.emit({ type: "prompt_error", errorMessage: "Hosted target prompt failed" });
        this.emit({ type: "prompt_done" });
        this.releasePromptRun();
        this.resetIdleTimer();
        this.callLifecycle(() => lifecycle.targetFailed(error));
      }
    })();
    return true;
  }

  private cancelHostedKickoffBeforeDispatch(settle = true): boolean {
    if (this.hostedKickoffState !== "scheduled") return false;
    this.hostedKickoffState = "cancelled";
    const lifecycle = this.hostedKickoffLifecycle;
    this.hostedKickoffLifecycle = null;
    invalidateSessionListCache();
    this.emit({ type: "prompt_done" });
    this.releasePromptRun(settle);
    this.resetIdleTimer();
    if (lifecycle) {
      const error = new Error("Hosted target kickoff was stopped before dispatch");
      error.name = "AbortError";
      this.callLifecycle(() => lifecycle.targetFailed(error));
    }
    return true;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    if (type === "prompt") {
      // Claim each accepted prompt before extension binding can await. Clone is
      // synchronous, and per-invocation accounting prevents one overlapping
      // prompt from exposing an idle window while another is still pending.
      this.claimPromptRun();
      try {
        await this.waitForExtensionsBound();
      } catch (error) {
        this.releasePromptRun();
        throw error;
      }
    } else if (this.shouldWaitForExtensions(type)) {
      await this.waitForExtensionsBound();
    }

    switch (type) {
      case "prompt": {
        // Fire and forget — events come via subscribe.
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        try {
          this.beginPrompt(command.message as string, promptImages, streamingBehavior);
        } catch (error) {
          this.releasePromptRun();
          throw error;
        }
        return null;
      }

      case "abort":
        this.cancelHostedKickoffBeforeDispatch();
        await this.withFinalRunningNotification(() => this.inner.abort());
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunningCount > 0,
          isCompacting: this.compactionRunningCount > 0 || this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const model = this.inner.modelRuntime.getModel(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        invalidateModelsCache();
        invalidateSessionListCache();
        return { id: model.id, provider: model.provider };
      }

      case "clone": {
        if (this.isRunning()) return { created: false, reason: "busy" };

        const activeLeafId = typeof command.activeLeafId === "string" ? command.activeLeafId : null;
        const sessionManager = this.inner.sessionManager;
        const liveLeafId = sessionManager.getLeafId();
        if (!activeLeafId || !liveLeafId || !sessionManager.isPersisted()) {
          return { created: false, reason: "nothing_to_clone" };
        }
        if (activeLeafId !== liveLeafId) {
          return { created: false, reason: "stale_leaf" };
        }

        const sourceSessionFile = this.inner.sessionFile ?? sessionManager.getSessionFile();
        if (!sourceSessionFile) return { created: false, reason: "missing_source" };

        const result = cloneSessionBranch({
          sourceSessionFile,
          sourceSessionDir: sessionManager.getSessionDir(),
          sourceSessionId: this.inner.sessionId,
          activeLeafId,
        });
        if (result.status !== "created") {
          return { created: false, reason: result.status };
        }

        cacheSessionPath(result.newSessionId, result.newSessionFile);
        invalidateSessionListCache();
        return { created: true, newSessionId: result.newSessionId };
      }

      case "fork": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        invalidateSessionListCache();
        this.destroy();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        invalidateSessionListCache();
        return null;
      }

      case "compact": {
        // Claim compaction before invoking the native async method: its public
        // isCompacting flag may not flip until after an initial await.
        this.claimCompactionRun();
        try {
          return await this.inner.compact(command.customInstructions as string | undefined);
        } finally {
          this.releaseCompactionRun();
          this.resetIdleTimer();
          invalidateSessionListCache();
        }
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        invalidateSessionListCache();
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight.
        return this.inner.clearQueue();
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "set_tools": {
        const toolNames = command.toolNames as string[];
        this.setForceEmptySystemPrompt(toolNames.length === 0);
        this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames));
        this.applyForcedEmptySystemPrompt();
        return null;
      }

      case "reload": {
        await this.waitForExtensionsBound();
        this.clearProjectedExtensionState();
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        await this.inner.reload();
        if (typeof this.inner.bindExtensions !== "function") {
          this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
        }
        this.applyForcedEmptySystemPrompt();
        return { success: true };
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "extension_ui_response": {
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    // Owner deletion or process cleanup must not let an unresolved extension
    // binding dispatch its hosted kickoff against a disposed native session.
    this.cancelHostedKickoffBeforeDispatch(false);
    this._alive = false;
    this.deferredSettlementRequested = false;
    this.nativeCausalClaims = [];
    this.standaloneCompactionCausalClaims = [];
    this.syncCausalClaimCounts();
    for (const setup of Array.from(this.pendingCustomUiSetups.values())) {
      setup.destroyed = true;
      setup.finish(undefined);
    }
    this.pendingCustomUiSetups.clear();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.listeners = [];
    this.projectedHub.close();
    if (!this.nativeDisposed) {
      this.nativeDisposed = true;
      try { this.inner.dispose(); } catch { /* disposal is best effort and idempotent here */ }
    }
    for (const callback of this.onDestroyCallbacks) {
      try { callback(); } catch { /* cleanup listeners are isolated */ }
    }
    this.onDestroyCallbacks.clear();
    publishRunningSessionState(this.sessionId, false);
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  private clearProjectedExtensionState(): void {
    for (const key of this.extensionStatuses.keys()) {
      this.projectedHub.accept({ type: "extension_status_cleared", key });
    }
    for (const key of this.extensionWidgets.keys()) {
      this.projectedHub.accept({ type: "extension_widget_cleared", key });
    }
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return 92;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return 92;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(40, Math.min(140, Math.round(width)))
      : 92;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [`Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const event = {
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    } as ExtensionUiRequest as AgentEvent;
    this.pendingUiRequests.set(id, event);
    this.emit(event);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    try {
      custom.component.dispose?.();
    } catch {
      // Ignore dispose errors from extension UI components.
    }
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } as ExtensionUiRequest as AgentEvent);
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(
    factory: unknown,
    options?: unknown,
  ): Promise<T> {
    if (typeof factory !== "function" || !this._alive) return Promise.resolve(undefined as T);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve) => {
      let completed = false;
      const tui = {
        requestRender: () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
      };
      const finish = (value: T) => {
        if (completed) return;
        completed = true;
        this.pendingCustomUiSetups.delete(id);
        resolve(value);
      };
      const setup: PendingCustomUiSetup = {
        finish: (value) => finish(value as T),
        destroyed: false,
      };
      this.pendingCustomUiSetups.set(id, setup);
      const done = (value: T) => {
        if (this.activeCustomUis.has(id)) this.closeCustomUi(id, value);
        else finish(value);
      };

      Promise.resolve()
        .then(() => factory(tui, PLAIN_TEXT_THEME, CUSTOM_UI_KEYBINDINGS, done))
        .then((component) => {
          this.pendingCustomUiSetups.delete(id);
          if (completed || setup.destroyed || !this._alive) {
            try { (component as CustomUiComponent | undefined)?.dispose?.(); } catch { /* isolated extension cleanup */ }
            finish(undefined as T);
            return;
          }
          if (!component || typeof component !== "object" || typeof (component as CustomUiComponent).render !== "function") {
            finish(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => finish(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          this.pendingCustomUiSetups.delete(id);
          if (completed || setup.destroyed || !this._alive) {
            finish(undefined as T);
            return;
          }
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          finish(undefined as T);
        });
    });
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this._alive || signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        if (this.pendingUiRequests.delete(id)) {
          this.projectedHub.accept({ type: "extension_dialog_closed", id });
        }
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) => this.requestExtensionUi(
        { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      confirm: (title, message, opts) => this.requestExtensionUi(
        { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        false,
        (response) => "confirmed" in response ? response.confirmed : false,
        opts?.timeout,
        opts?.signal,
      ),
      input: (title, placeholder, opts) => this.requestExtensionUi(
        { method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      editor: (title, prefill, opts) => this.requestExtensionUi(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        if (content !== undefined && !Array.isArray(content)) return;
        if (content === undefined) {
          this.extensionWidgets.delete(key);
        } else {
          this.extensionWidgets.set(key, {
            key,
            lines: content,
            placement: options?.placement ?? "aboveEditor",
          });
        }
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        } as ExtensionUiRequest as AgentEvent);
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() { return PLAIN_TEXT_THEME; },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported in pi-web extension UI yet" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.clearProjectedExtensionState();
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
        this.applyForcedEmptySystemPrompt();
      },
    };
  }
}

// ============================================================================
// Session registry
// ============================================================================

export interface RpcSessionStartResult {
  session: AgentSessionWrapper;
  realSessionId: string;
}

export interface PreparedRpcSession extends RpcSessionStartResult {
  forceEmptySystemPrompt?: boolean;
}

export interface RpcSessionStartHooks {
  validatePrepared?(prepared: PreparedRpcSession): void;
  beforePublication?(): void;
  afterPublication?(published: RpcSessionStartResult): void;
}

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<RpcSessionStartResult>> | undefined;
  var __piRunningListeners: Set<(ids: string[]) => void> | undefined;
  var __piRunningSessionIds: Set<string> | undefined;
  var __piLastRunningSnapshot: string | undefined;
  var __piSessionListRefreshListeners: Set<(generation: number) => void> | undefined;
  var __piSessionListRefreshGeneration: number | undefined;
  var __piRpcCleanupRegistered: boolean | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) globalThis.__piSessions = new Map();
  if (!globalThis.__piRpcCleanupRegistered) {
    globalThis.__piRpcCleanupRegistered = true;
    const cleanup = () => {
      invalidateHostedImplementationCapability();
      for (const session of [...(globalThis.__piSessions?.values() ?? [])]) session.destroy();
    };
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<RpcSessionStartResult>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

/** Exact registry-owner check used immediately before issuing capabilities. */
export function isCurrentRpcSession(
  sessionId: string,
  session: AgentSessionWrapper,
): boolean {
  try {
    return getRegistry().get(sessionId) === session
      && session.isAlive()
      && session.sessionId === sessionId;
  } catch {
    return false;
  }
}

function getRunningProjection(): Set<string> {
  if (!globalThis.__piRunningSessionIds) globalThis.__piRunningSessionIds = new Set();
  return globalThis.__piRunningSessionIds;
}

export function getRunningRpcSessionIds(): string[] {
  return [...getRunningProjection()].sort();
}

// ----------------------------------------------------------------------------
// Running-status and ordinary session-list refresh broadcasters. Both use the
// existing running SSE route; only native session discovery remains
// authoritative for SessionInfo data.
// ----------------------------------------------------------------------------

function getRunningListeners(): Set<(ids: string[]) => void> {
  if (!globalThis.__piRunningListeners) globalThis.__piRunningListeners = new Set();
  return globalThis.__piRunningListeners;
}

function getSessionListRefreshListeners(): Set<(generation: number) => void> {
  if (!globalThis.__piSessionListRefreshListeners) globalThis.__piSessionListRefreshListeners = new Set();
  return globalThis.__piSessionListRefreshListeners;
}

/** Subscribe to running-session-id changes. Returns an unsubscribe function. */
export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Subscribe to a request to reload the ordinary native session list. */
export function subscribeSessionListRefresh(listener: (generation: number) => void): () => void {
  const listeners = getSessionListRefreshListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Current replay token for initial and reconnected SSE consumers. */
export function getSessionListRefreshGeneration(): number {
  return globalThis.__piSessionListRefreshGeneration ?? 0;
}

/** Invalidate server discovery and prompt connected browsers to reload it. */
export function notifySessionListRefresh(): void {
  invalidateSessionListCache();
  const generation = getSessionListRefreshGeneration() + 1;
  globalThis.__piSessionListRefreshGeneration = generation;
  for (const listener of getSessionListRefreshListeners()) {
    try { listener(generation); } catch { /* ignore listener errors */ }
  }
}

/** Publish one wrapper's current running state into the HMR-stable projection. */
export function publishRunningSessionState(sessionId: string, running: boolean): void {
  const projection = getRunningProjection();
  const changed = running ? !projection.has(sessionId) : projection.has(sessionId);
  if (!changed) return;
  if (running) projection.add(sessionId);
  else projection.delete(sessionId);

  const ids = [...projection].sort();
  const snapshot = JSON.stringify(ids);
  if (snapshot === globalThis.__piLastRunningSnapshot) return;
  globalThis.__piLastRunningSnapshot = snapshot;
  for (const listener of getRunningListeners()) {
    try { listener(ids); } catch { /* ignore listener errors */ }
  }
}

/**
 * Internal shared-start seam. The final hook runs immediately before a fully
 * synchronous subscribe/cache/publication/binding block. A failure before
 * publication disposes the unpublished native session; post-publication hook
 * failures are target-owned and cannot turn into a caller retry.
 */
export async function getOrCreateRpcSession(
  sessionId: string,
  prepare: () => Promise<PreparedRpcSession>,
  hooks: RpcSessionStartHooks = {},
): Promise<RpcSessionStartResult> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: existing.sessionId || sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    let prepared: PreparedRpcSession | undefined;
    let published = false;
    try {
      prepared = await prepare();
      hooks.validatePrepared?.(prepared);
      hooks.beforePublication?.();

      // No asynchronous gap is allowed from the final cancellation/validity
      // check through ownership publication.
      const session = prepared.session;
      const realSessionId = prepared.realSessionId;
      session.start();
      const realSessionFile = session.sessionFile;
      if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);
      session.onDestroy(() => {
        if (registry.get(realSessionId) === session) registry.delete(realSessionId);
      });
      registry.set(realSessionId, session);
      published = true;
      session.beginExtensionBinding({ forceEmptySystemPrompt: prepared.forceEmptySystemPrompt });

      const result: RpcSessionStartResult = { session, realSessionId };
      try { hooks.afterPublication?.(result); } catch { /* target-owned after publication */ }
      return result;
    } catch (error) {
      if (prepared && !published) prepared.session.destroy();
      throw error;
    }
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}

function normalizedExistingSessionPath(value: string): string | null {
  if (!value || value.includes("\0") || !isAbsolute(value)) return null;
  const normalized = resolvePath(value);
  return Buffer.byteLength(normalized, "utf8") <= 4_096 ? normalized : null;
}

/** Baseline identity invariant for every existing-file startup initiator. */
export function assertExistingRpcSessionIdentity(
  session: AgentSessionWrapper,
  realSessionId: string,
  expected: { sessionId: string; sessionFile: string; cwd: string },
): void {
  const actualFile = normalizedExistingSessionPath(session.sessionFile);
  const expectedFile = normalizedExistingSessionPath(expected.sessionFile);
  const actualCwd = normalizedExistingSessionPath(session.inner.sessionManager.getCwd());
  const expectedCwd = normalizedExistingSessionPath(expected.cwd);
  if (realSessionId !== expected.sessionId || session.sessionId !== expected.sessionId
    || !actualFile || !expectedFile || actualFile !== expectedFile
    || !actualCwd || !expectedCwd || actualCwd !== expectedCwd) {
    throw new Error("rpc_existing_session_identity_mismatch");
  }
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
  hooks: RpcSessionStartHooks = {},
): Promise<RpcSessionStartResult> {
  return getOrCreateRpcSession(sessionId, async () => {
    // Some extensions access the SDK's global theme even outside the terminal UI.
    initTheme();
    const agentDir = getAgentDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      // toolNames === [] -> "all off" (an empty allow-list disables every tool).
      // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
      // set allowedToolNames to coding builtins only, which filtered every
      // extension/package-provided tool (e.g. subagents, web access) out of the
      // tool registry — so they were unavailable in pi-web sessions even though the
      // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
      // tools (and activate extension tools); we narrow the ACTIVE set below.
      toolsOption = toolNames.length === 0 ? [] : undefined;
    }

    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    const services = await createAgentSessionServices({ cwd, agentDir });
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
    });

    // If specific tool names were requested (non-empty), set the active tools to the
    // requested builtin coding tools PLUS all extension/package tools, so installed
    // extensions stay usable in pi-web just like in the `pi` CLI.
    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
    }

    const wrapper = new AgentSessionWrapper(inner);
    if (sessionFile) {
      try {
        assertExistingRpcSessionIdentity(wrapper, inner.sessionId as string, {
          sessionId,
          sessionFile,
          cwd,
        });
      } catch (error) {
        wrapper.destroy();
        throw error;
      }
    }
    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // keep this forced after extension resource discovery and reloads as well.
    if (toolNames?.length === 0) wrapper.setForceEmptySystemPrompt(true);

    return {
      session: wrapper,
      realSessionId: inner.sessionId as string,
      forceEmptySystemPrompt: toolNames?.length === 0,
    };
  }, hooks);
}

function assertHostedTargetIdentity(
  session: AgentSessionWrapper,
  request: HostedImplementationLaunchRequest,
): void {
  if (session.sessionId !== request.targetSessionId) throw new Error("Hosted target session ID mismatch");
  if (resolvePath(session.sessionFile) !== resolvePath(request.targetSessionFile)) {
    throw new Error("Hosted target session file mismatch");
  }
  if (resolvePath(session.inner.sessionManager.getCwd()) !== resolvePath(request.targetCwd)) {
    throw new Error("Hosted target cwd mismatch");
  }
}

function assertHostedAttemptOpen(
  request: HostedImplementationLaunchRequest,
  isCapabilityActive: () => boolean,
): void {
  if (!isCapabilityActive()) throw new Error("Hosted capability was invalidated before publication");
  if (request.sourceSignal?.aborted) {
    const error = new Error("Hosted target registration was cancelled before publication");
    error.name = "AbortError";
    throw error;
  }
}

async function startHostedImplementationTarget(
  request: HostedImplementationLaunchRequest,
  options: {
    isCapabilityActive: () => boolean;
    lifecycle: HostedImplementationLifecycle;
  },
): Promise<void> {
  let scheduledDuringPublication = false;
  const schedule = (session: AgentSessionWrapper): boolean => {
    if (!session.startHostedPrompt(request.kickoff, options.lifecycle)) {
      options.lifecycle.targetFailed(new Error("Hosted kickoff was already scheduled"));
      return false;
    }
    session.onDestroy(options.lifecycle.ownerCleanedUp);
    notifySessionListRefresh();
    return true;
  };

  const result = await startRpcSession(
    request.targetSessionId,
    request.targetSessionFile,
    request.targetCwd,
    undefined,
    {
      validatePrepared: ({ session }) => assertHostedTargetIdentity(session, request),
      beforePublication: () => assertHostedAttemptOpen(request, options.isCapabilityActive),
      afterPublication: ({ session }) => {
        scheduledDuringPublication = true;
        schedule(session);
      },
    },
  );

  // If browser selection won the startup race, that caller published the same
  // exact owner. Re-check cancellation/capability validity, then schedule once.
  if (!scheduledDuringPublication) {
    assertHostedTargetIdentity(result.session, request);
    assertHostedAttemptOpen(request, options.isCapabilityActive);
    if (!schedule(result.session)) throw new Error("Hosted target kickoff was already scheduled");
  }
}

registerHostedImplementationCapability({
  startTarget: startHostedImplementationTarget,
});
