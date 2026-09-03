"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("node:child_process");

const TAILSCALE_SERVE_READY_MARKER = Buffer.from("Press Ctrl+C to exit.", "utf8");
const TAILSCALE_SERVE_STARTUP_TIMEOUT_MS = 60_000;
const TAILSCALE_SERVE_CLEANUP_GRACE_MS = 10_000;
const TAILSCALE_SERVE_FORCE_WAIT_MS = 10_000;

function publicError(code, name = "Error") {
  const error = new Error(code);
  error.code = code;
  error.name = name;
  return error;
}

function cleanupSignal(signal) {
  return signal === "SIGTERM" ? "SIGTERM" : "SIGINT";
}

function startTailscaleServe(options = {}) {
  const port = options.port;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535 || port === 443) {
    return Promise.reject(publicError("tailscale_serve_invalid_port", "TypeError"));
  }

  const startupSignal = options.signal;
  if (startupSignal?.aborted) {
    return Promise.reject(publicError("tailscale_serve_startup_aborted", "AbortError"));
  }

  const platform = options.platform ?? process.platform;
  const useProcessGroup = platform !== "win32";
  const spawnProcess = options.spawn ?? spawn;
  const processKill = options.processKill ?? process.kill.bind(process);
  const setTimer = options.setTimeout ?? setTimeout;
  const clearTimer = options.clearTimeout ?? clearTimeout;
  const warn = options.warn ?? (() => {});
  const startupTimeoutMs = options.startupTimeoutMs ?? TAILSCALE_SERVE_STARTUP_TIMEOUT_MS;
  const cleanupGraceMs = options.cleanupGraceMs ?? TAILSCALE_SERVE_CLEANUP_GRACE_MS;
  const forceWaitMs = options.forceWaitMs ?? TAILSCALE_SERVE_FORCE_WAIT_MS;

  let child;
  try {
    child = spawnProcess(
      "tailscale",
      ["serve", `--https=${port}`, `http://127.0.0.1:${port}`],
      {
        shell: false,
        detached: useProcessGroup,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    return Promise.reject(publicError("tailscale_serve_spawn_failed"));
  }

  return new Promise((resolve, reject) => {
    let ready = false;
    let markerSeen = false;
    let startupSettled = false;
    let intentionalShutdown = false;
    let exitSeen = false;
    let closeSeen = false;
    let childErrorSeen = false;
    let startupTimer = null;
    let closePromise = null;
    let cleanupSignalFailed = false;
    let forceWarningRecorded = false;
    let overlap = Buffer.alloc(0);
    let ownedGroupPid = useProcessGroup && Number.isInteger(child.pid) && child.pid > 0
      ? child.pid
      : null;
    let directChildOwned = !useProcessGroup;
    let resolveClose;
    let resolveUnexpectedExit;
    let unexpectedExitSettled = false;
    const closeConfirmed = new Promise((resolveCloseEvent) => {
      resolveClose = resolveCloseEvent;
    });
    const unexpectedExit = new Promise((resolveExit) => {
      resolveUnexpectedExit = resolveExit;
    });

    const removeStartupControls = () => {
      if (startupTimer !== null) {
        clearTimer(startupTimer);
        startupTimer = null;
      }
      startupSignal?.removeEventListener?.("abort", onStartupAbort);
    };

    const clearSignalOwnership = () => {
      ownedGroupPid = null;
      directChildOwned = false;
    };

    const hasOwnedSignalTarget = () => useProcessGroup
      ? ownedGroupPid !== null
      : directChildOwned;

    const signalOwnedTarget = (signal) => {
      if (!hasOwnedSignalTarget()) return false;
      try {
        const sent = useProcessGroup
          ? processKill(-ownedGroupPid, signal)
          : child.kill(signal);
        if (sent !== true) cleanupSignalFailed = true;
      } catch {
        cleanupSignalFailed = true;
      }
      return true;
    };

    const waitForClose = (timeoutMs) => {
      if (closeSeen) return Promise.resolve(true);
      return new Promise((resolveWait) => {
        const timer = setTimer(() => resolveWait(false), timeoutMs);
        void closeConfirmed.then(() => {
          clearTimer(timer);
          resolveWait(true);
        });
      });
    };

    const recordForceWarning = () => {
      if (forceWarningRecorded) return;
      forceWarningRecorded = true;
      try {
        warn("[pi-web] Tailscale cleanup required a forced stop.");
      } catch {
        // Diagnostics must not interfere with owned cleanup.
      }
    };

    const owner = Object.freeze({
      unexpectedExit,
      close(signal = "SIGINT") {
        if (closePromise) return closePromise;
        intentionalShutdown = true;
        removeStartupControls();
        closePromise = (async () => {
          if (closeSeen) return;

          signalOwnedTarget(cleanupSignal(signal));

          if (await waitForClose(cleanupGraceMs)) {
            if (cleanupSignalFailed) throw publicError("tailscale_serve_shutdown_failed");
            return;
          }

          if (hasOwnedSignalTarget()) {
            recordForceWarning();
            signalOwnedTarget("SIGKILL");
          }

          if (await waitForClose(forceWaitMs)) {
            if (cleanupSignalFailed) throw publicError("tailscale_serve_shutdown_failed");
            return;
          }

          throw publicError("tailscale_serve_cleanup_unconfirmed");
        })();
        return closePromise;
      },
    });

    const failStartup = (error, signal = "SIGINT") => {
      if (startupSettled) return;
      startupSettled = true;
      removeStartupControls();
      void owner.close(signal).then(
        () => reject(error),
        (cleanupError) => {
          const aggregate = new AggregateError(
            [error, cleanupError],
            "tailscale_serve_startup_cleanup_failed",
          );
          aggregate.code = "tailscale_serve_startup_cleanup_failed";
          reject(aggregate);
        },
      );
    };

    const notifyUnexpectedExit = (reason) => {
      if (unexpectedExitSettled || intentionalShutdown) return;
      unexpectedExitSettled = true;
      resolveUnexpectedExit(Object.freeze({ reason }));
    };

    const onChildError = () => {
      if (closeSeen) return;
      childErrorSeen = true;
      if (intentionalShutdown) {
        cleanupSignalFailed = true;
      } else if (!ready) {
        failStartup(publicError("tailscale_serve_spawn_failed"));
      } else {
        notifyUnexpectedExit("error");
      }
    };

    const onChildExit = () => {
      if (exitSeen) return;
      clearSignalOwnership();
      exitSeen = true;
      if (!ready) {
        failStartup(publicError(
          childErrorSeen
            ? "tailscale_serve_spawn_failed"
            : "tailscale_serve_exited_before_ready",
        ));
      } else {
        notifyUnexpectedExit("exited");
      }
    };

    const onChildClose = () => {
      if (closeSeen) return;
      clearSignalOwnership();
      closeSeen = true;
      resolveClose();
      if (!ready) {
        failStartup(publicError(
          childErrorSeen
            ? "tailscale_serve_spawn_failed"
            : "tailscale_serve_exited_before_ready",
        ));
      }
    };

    function onStartupAbort() {
      failStartup(
        publicError("tailscale_serve_startup_aborted", "AbortError"),
        cleanupSignal(startupSignal?.reason),
      );
    }

    const onStdout = (chunk) => {
      if (markerSeen || startupSettled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const combined = overlap.length === 0 ? bytes : Buffer.concat([overlap, bytes]);
      if (combined.indexOf(TAILSCALE_SERVE_READY_MARKER) !== -1) {
        markerSeen = true;
        overlap = Buffer.alloc(0);
        if (startupTimer !== null) {
          clearTimer(startupTimer);
          startupTimer = null;
        }
        queueMicrotask(() => {
          if (startupSettled || exitSeen || closeSeen) return;
          if (useProcessGroup && ownedGroupPid === null) {
            failStartup(publicError("tailscale_serve_spawn_failed"));
            return;
          }
          startupSettled = true;
          ready = true;
          removeStartupControls();
          resolve(owner);
        });
        return;
      }
      const overlapLength = Math.min(
        combined.length,
        TAILSCALE_SERVE_READY_MARKER.length - 1,
      );
      overlap = Buffer.from(combined.subarray(combined.length - overlapLength));
    };

    const onStdoutError = () => {
      if (!ready) failStartup(publicError("tailscale_serve_stdout_failed"));
    };

    child.on("error", onChildError);
    child.once("exit", onChildExit);
    child.once("close", onChildClose);

    if (!child.stdout || !child.stderr) {
      failStartup(publicError("tailscale_serve_stdio_unavailable"));
      return;
    }
    child.stdout.on("data", onStdout);
    child.stdout.on("error", onStdoutError);
    child.stderr.on("data", () => {});
    child.stderr.on("error", () => {});

    startupSignal?.addEventListener?.("abort", onStartupAbort, { once: true });
    startupTimer = setTimer(() => {
      failStartup(publicError("tailscale_serve_readiness_timeout"));
    }, startupTimeoutMs);
  });
}

module.exports = {
  TAILSCALE_SERVE_CLEANUP_GRACE_MS,
  TAILSCALE_SERVE_FORCE_WAIT_MS,
  TAILSCALE_SERVE_READY_MARKER,
  TAILSCALE_SERVE_STARTUP_TIMEOUT_MS,
  startTailscaleServe,
};
