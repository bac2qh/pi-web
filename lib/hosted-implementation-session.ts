import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

export const HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL = Symbol.for("pi-web.hosted-implementation-session");
const HOSTED_IMPLEMENTATION_RUNTIME_SYMBOL = Symbol.for("pi-web.hosted-implementation-session.runtime");

export const HOSTED_IMPLEMENTATION_PROTOCOL = "pi-web-hosted-implementation-session" as const;
export const HOSTED_IMPLEMENTATION_VERSION = 1 as const;
export const HOSTED_IMPLEMENTATION_OWNER = "pi-web" as const;

export type HostedImplementationLaunchKind = "start" | "orchestrate";

export interface HostedImplementationLaunchRequest {
  targetSessionId: string;
  targetSessionFile: string;
  targetCwd: string;
  kickoff: string;
  launchKind: HostedImplementationLaunchKind;
  sourceSignal: AbortSignal | undefined;
}

export interface HostedImplementationLaunchResponse {
  protocol: typeof HOSTED_IMPLEMENTATION_PROTOCOL;
  version: typeof HOSTED_IMPLEMENTATION_VERSION;
  owner: typeof HOSTED_IMPLEMENTATION_OWNER;
  runtimeId: string;
  outcome: "hosted";
  targetSessionId: string;
}

export interface HostedImplementationCapabilityV1 {
  protocol: typeof HOSTED_IMPLEMENTATION_PROTOCOL;
  version: typeof HOSTED_IMPLEMENTATION_VERSION;
  owner: typeof HOSTED_IMPLEMENTATION_OWNER;
  runtimeId: string;
  active: boolean;
  launch(request: HostedImplementationLaunchRequest): Promise<HostedImplementationLaunchResponse>;
}

export type HostedImplementationLifecycle = {
  ownershipAccepted(): void;
  kickoffScheduled(): void;
  kickoffDispatched(): void;
  targetSettled(): void;
  targetFailed(error: unknown): void;
  ownerCleanedUp(): void;
};

export interface HostedImplementationCapabilityDependencies {
  startTarget(
    request: HostedImplementationLaunchRequest,
    options: {
      isCapabilityActive: () => boolean;
      lifecycle: HostedImplementationLifecycle;
    },
  ): Promise<void>;
  logger?: Pick<Console, "info" | "error">;
}

interface HostedImplementationRuntimeIdentity {
  protocol: typeof HOSTED_IMPLEMENTATION_PROTOCOL;
  version: typeof HOSTED_IMPLEMENTATION_VERSION;
  owner: typeof HOSTED_IMPLEMENTATION_OWNER;
  runtimeId: string;
}

type SymbolScope = Record<PropertyKey, unknown>;

type RegistrationResult =
  | { registered: true; record: HostedImplementationCapabilityV1 }
  | { registered: false; reason: "foreign" | "incompatible" };

const TARGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ERROR_CLASS_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/;
const HOSTED_REQUEST_KEYS = new Set<PropertyKey>([
  "targetSessionId",
  "targetSessionFile",
  "targetCwd",
  "kickoff",
  "launchKind",
  "sourceSignal",
]);

function runtimeIdentity(scope: SymbolScope): HostedImplementationRuntimeIdentity | null {
  const existing = scope[HOSTED_IMPLEMENTATION_RUNTIME_SYMBOL];
  if (existing !== undefined) {
    if (
      typeof existing !== "object"
      || existing === null
      || (existing as Partial<HostedImplementationRuntimeIdentity>).protocol !== HOSTED_IMPLEMENTATION_PROTOCOL
      || (existing as Partial<HostedImplementationRuntimeIdentity>).version !== HOSTED_IMPLEMENTATION_VERSION
      || (existing as Partial<HostedImplementationRuntimeIdentity>).owner !== HOSTED_IMPLEMENTATION_OWNER
      || typeof (existing as Partial<HostedImplementationRuntimeIdentity>).runtimeId !== "string"
      || (existing as Partial<HostedImplementationRuntimeIdentity>).runtimeId?.length === 0
    ) {
      return null;
    }
    return existing as HostedImplementationRuntimeIdentity;
  }

  const created: HostedImplementationRuntimeIdentity = {
    protocol: HOSTED_IMPLEMENTATION_PROTOCOL,
    version: HOSTED_IMPLEMENTATION_VERSION,
    owner: HOSTED_IMPLEMENTATION_OWNER,
    runtimeId: randomUUID(),
  };
  scope[HOSTED_IMPLEMENTATION_RUNTIME_SYMBOL] = created;
  return created;
}

function isCompatibleCapability(value: unknown): value is HostedImplementationCapabilityV1 {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<HostedImplementationCapabilityV1>;
  return record.protocol === HOSTED_IMPLEMENTATION_PROTOCOL
    && record.version === HOSTED_IMPLEMENTATION_VERSION
    && record.owner === HOSTED_IMPLEMENTATION_OWNER
    && typeof record.runtimeId === "string"
    && record.runtimeId.length > 0
    && typeof record.active === "boolean"
    && typeof record.launch === "function";
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (typeof value !== "object" || value === null) return false;
  const signal = value as Partial<AbortSignal>;
  return typeof signal.aborted === "boolean"
    && typeof signal.addEventListener === "function"
    && typeof signal.removeEventListener === "function";
}

function assertValidRequest(request: HostedImplementationLaunchRequest): void {
  if (typeof request !== "object" || request === null) throw new Error("Hosted launch request is invalid");
  const requestKeys = Reflect.ownKeys(request);
  if (requestKeys.length !== HOSTED_REQUEST_KEYS.size || requestKeys.some((key) => !HOSTED_REQUEST_KEYS.has(key))) {
    throw new Error("Hosted launch request must contain exactly the supported fields");
  }
  if (!TARGET_ID_PATTERN.test(request.targetSessionId)) throw new Error("Hosted target session ID is invalid");
  if (typeof request.targetSessionFile !== "string" || !isAbsolute(request.targetSessionFile)) {
    throw new Error("Hosted target session file must be absolute");
  }
  if (typeof request.targetCwd !== "string" || !isAbsolute(request.targetCwd)) {
    throw new Error("Hosted target cwd must be absolute");
  }
  if (typeof request.kickoff !== "string" || request.kickoff.length === 0) {
    throw new Error("Hosted target kickoff is invalid");
  }
  if (request.launchKind !== "start" && request.launchKind !== "orchestrate") {
    throw new Error("Hosted launch kind is invalid");
  }
  if (request.sourceSignal !== undefined && !isAbortSignal(request.sourceSignal)) {
    throw new Error("Hosted source signal is invalid");
  }
}

function safeErrorClass(error: unknown): string {
  const candidate = error instanceof Error ? error.name : "Error";
  return ERROR_CLASS_PATTERN.test(candidate) ? candidate : "Error";
}

function diagnostic(
  logger: Pick<Console, "info" | "error">,
  level: "info" | "error",
  stage: string,
  request?: Pick<HostedImplementationLaunchRequest, "launchKind">,
  error?: unknown,
): void {
  const fields = [
    "[pi-web][hosted-implementation]",
    `stage=${stage}`,
    ...(request ? [`launch=${request.launchKind}`] : []),
    ...(error === undefined ? [] : [`errorClass=${safeErrorClass(error)}`, "errorMessage=operation-failed"]),
  ];
  logger[level](fields.join(" ").slice(0, 512));
}

export function registerHostedImplementationCapability(
  dependencies: HostedImplementationCapabilityDependencies,
  scope: SymbolScope = globalThis as unknown as SymbolScope,
): RegistrationResult {
  const identity = runtimeIdentity(scope);
  if (!identity) {
    diagnostic(dependencies.logger ?? console, "error", "capability_registration_rejected");
    return { registered: false, reason: "foreign" };
  }

  const existing = scope[HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL];
  if (existing !== undefined) {
    if (!isCompatibleCapability(existing)) {
      diagnostic(dependencies.logger ?? console, "error", "capability_registration_rejected");
      return { registered: false, reason: "incompatible" };
    }
    if (existing.runtimeId !== identity.runtimeId) {
      diagnostic(dependencies.logger ?? console, "error", "capability_registration_rejected");
      return { registered: false, reason: "foreign" };
    }
    existing.active = false;
  }

  const logger = dependencies.logger ?? console;
  const record: HostedImplementationCapabilityV1 = {
    protocol: HOSTED_IMPLEMENTATION_PROTOCOL,
    version: HOSTED_IMPLEMENTATION_VERSION,
    owner: HOSTED_IMPLEMENTATION_OWNER,
    runtimeId: identity.runtimeId,
    active: true,
    async launch(request) {
      if (!record.active) throw new Error("Pi Web hosted capability is invalidated");
      assertValidRequest(request);
      const diagnosticIdentity = {
        launchKind: request.launchKind,
      };
      diagnostic(logger, "info", "registration_started", diagnosticIdentity);

      // Lifecycle callbacks retain only bounded stage and launch-kind fields;
      // they never retain an identifier, signal, kickoff, cwd, or session path.
      const lifecycle: HostedImplementationLifecycle = {
        ownershipAccepted: () => diagnostic(logger, "info", "ownership_accepted", diagnosticIdentity),
        kickoffScheduled: () => diagnostic(logger, "info", "kickoff_scheduled", diagnosticIdentity),
        kickoffDispatched: () => diagnostic(logger, "info", "kickoff_dispatched", diagnosticIdentity),
        targetSettled: () => diagnostic(logger, "info", "target_settled", diagnosticIdentity),
        targetFailed: (error) => diagnostic(logger, "error", "target_failed", diagnosticIdentity, error),
        ownerCleanedUp: () => diagnostic(logger, "info", "owner_cleanup", diagnosticIdentity),
      };

      try {
        await dependencies.startTarget(request, {
          isCapabilityActive: () => record.active,
          lifecycle,
        });
      } catch (error) {
        diagnostic(logger, "error", "registration_failed", diagnosticIdentity, error);
        throw new Error(`Pi Web hosted target registration failed (${safeErrorClass(error)})`);
      }

      return {
        protocol: HOSTED_IMPLEMENTATION_PROTOCOL,
        version: HOSTED_IMPLEMENTATION_VERSION,
        owner: HOSTED_IMPLEMENTATION_OWNER,
        runtimeId: identity.runtimeId,
        outcome: "hosted",
        targetSessionId: request.targetSessionId,
      };
    },
  };

  scope[HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL] = record;
  diagnostic(logger, "info", "capability_registered");
  return { registered: true, record };
}

export function invalidateHostedImplementationCapability(
  scope: SymbolScope = globalThis as unknown as SymbolScope,
): void {
  const identity = runtimeIdentity(scope);
  const record = scope[HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL];
  if (!identity || !isCompatibleCapability(record) || record.runtimeId !== identity.runtimeId) return;
  record.active = false;
}
