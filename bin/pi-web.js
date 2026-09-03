#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("node:child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions } = require("./pi-web-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertNodeToolchain } = require("./pi-web-toolchain");

const SIGNAL_EXIT_CODES = Object.freeze({
  SIGINT: 130,
  SIGTERM: 143,
});
const PUBLIC_ERROR_CLASSES = new Set([
  "AbortError", "AggregateError", "Error", "EvalError", "RangeError",
  "ReferenceError", "SyntaxError", "TypeError", "URIError",
]);

function publicErrorClass(error) {
  try {
    const name = error?.name;
    return typeof name === "string" && name.length <= 32 && PUBLIC_ERROR_CLASSES.has(name) ? name : "Error";
  } catch { return "Error"; }
}

function browserUrl(hostname, port) {
  const host = hostname ?? "localhost";
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${formattedHost}:${port}`;
}

function openBrowser(url, options = {}) {
  const spawnProcess = options.spawn ?? spawn;
  const platform = options.platform ?? process.platform;
  const warn = options.warn ?? console.warn;
  const isWindows = platform === "win32";
  const command = isWindows ? "start" : platform === "darwin" ? "open" : "xdg-open";
  const opener = spawnProcess(command, [url], {
    shell: isWindows,
    stdio: "ignore",
    detached: true,
  });

  opener.on("error", () => {
    warn("Could not open browser automatically.");
  });
  opener.unref();
  return opener;
}

function codedError(code, name = "Error") {
  const error = new Error(code);
  error.code = code;
  error.name = name;
  return error;
}

function childCleanupSignal(signal) {
  return signal === "SIGTERM" ? "SIGTERM" : "SIGINT";
}

function isStartupAbort(error) {
  if (error?.code === "pi_web_startup_aborted" || error?.code === "tailscale_serve_startup_aborted") {
    return true;
  }
  return error instanceof AggregateError && error.errors.some((nested) => isStartupAbort(nested));
}

function hasErrorCode(error, code, seen = new Set()) {
  if (!error || (typeof error !== "object" && typeof error !== "function") || seen.has(error)) {
    return false;
  }
  seen.add(error);
  try {
    if (error.code === code) return true;
    return error instanceof AggregateError &&
      error.errors.some((nested) => hasErrorCode(nested, code, seen));
  } catch {
    return false;
  }
}

function reportCloseFailure(logger, error) {
  if (hasErrorCode(error, "tailscale_serve_cleanup_unconfirmed")) {
    logger.error("[pi-web] Tailscale cleanup could not be confirmed.");
    return;
  }
  logger.error("[pi-web] close_failed", { errorName: publicErrorClass(error) });
}

async function closeOwnedResources(stages, aggregateMessage) {
  const pending = stages.map((stage) => {
    try { return Promise.resolve(stage()); }
    catch (error) { return Promise.reject(error); }
  });
  const results = await Promise.allSettled(pending);
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, aggregateMessage);
}

async function runPiWebCli(options = {}) {
  assertNodeToolchain(process.version);
  const processRef = options.process ?? process;
  const logger = options.logger ?? console;
  const args = options.args ?? processRef.argv.slice(2);
  const env = options.env ?? processRef.env;
  const launchOptions = parseLaunchOptions(args, env);
  const mode = launchOptions.dev ? "development" : "production";
  const startupSignal = options.startupSignal;

  // The server module lazy-loads Next, so set the selected mode first.
  processRef.env.NODE_ENV = mode;
  process.env.NODE_ENV = mode;

  const packageDirectory = options.dir ?? path.join(__dirname, "..");
  if (!launchOptions.dev && !fs.existsSync(path.join(packageDirectory, ".next"))) {
    const error = new Error("build_artifacts_missing");
    error.code = "build_artifacts_missing";
    throw error;
  }

  const loadServer = options.loadServer ?? (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("./pi-web-server");
  });
  const startPiWebServer = options.startPiWebServer ?? loadServer().startPiWebServer;
  const startedServer = await startPiWebServer({
    dev: launchOptions.dev,
    dir: packageDirectory,
    hostname: launchOptions.hostname,
    port: launchOptions.port,
    lifecycleOwner: options.lifecycleOwner ?? "programmatic",
  });

  let serveOwner = null;
  try {
    if (startupSignal?.aborted) throw codedError("pi_web_startup_aborted", "AbortError");
    if (launchOptions.tailscaleServe) {
      const startTailscaleServe = options.startTailscaleServe ?? (() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("./pi-web-tailscale-serve").startTailscaleServe;
      })();
      serveOwner = await startTailscaleServe({
        port: startedServer.address.port,
        signal: startupSignal,
        spawn: options.tailscaleSpawn,
        platform: options.platform,
        processKill: options.tailscaleProcessKill,
        warn: (message) => logger.warn(message),
      });
    }
    if (startupSignal?.aborted) throw codedError("pi_web_startup_aborted", "AbortError");
  } catch (error) {
    let rollbackError = null;
    try {
      await closeOwnedResources([
        ...(serveOwner ? [() => serveOwner.close(childCleanupSignal(startupSignal?.reason))] : []),
        () => startedServer.close(),
      ], "pi_web_startup_rollback_failed");
    } catch (caught) {
      rollbackError = caught;
    }

    if (isStartupAbort(error)) {
      if (rollbackError || error?.code === "tailscale_serve_startup_cleanup_failed") {
        const aggregate = new AggregateError(
          [error, ...(rollbackError ? [rollbackError] : [])],
          "pi_web_startup_abort_cleanup_failed",
        );
        aggregate.code = "pi_web_startup_abort_cleanup_failed";
        throw aggregate;
      }
      throw codedError("pi_web_startup_aborted", "AbortError");
    }
    if (rollbackError) {
      const aggregate = new AggregateError([error, rollbackError], "pi_web_startup_rollback_failed");
      aggregate.code = "pi_web_startup_rollback_failed";
      throw aggregate;
    }
    throw error;
  }

  let closePromise = null;
  const close = (signal = "SIGINT") => {
    if (closePromise) return closePromise;
    closePromise = closeOwnedResources([
      () => startedServer.close(),
      ...(serveOwner ? [() => serveOwner.close(childCleanupSignal(signal))] : []),
    ], "pi_web_runtime_close_failed");
    return closePromise;
  };

  let failure = null;
  if (serveOwner) {
    failure = serveOwner.unexpectedExit.then(() => {
      try {
        logger.warn("[pi-web] Tailscale command exited; private access may be unavailable.");
      } catch {
        // Diagnostics are isolated from the still-running local backend.
      }
      return codedError("tailscale_serve_child_exited");
    });
  }

  const url = browserUrl(launchOptions.hostname, startedServer.address.port);
  logger.log(`[pi-web] Ready on ${url}`);
  if (launchOptions.openBrowser) {
    openBrowser(url, {
      spawn: options.spawn,
      platform: options.platform,
      warn: (message) => logger.warn(message),
    });
  }

  return {
    ...startedServer,
    close,
    failure,
  };
}

async function runTerminalEntry(options = {}) {
  const processRef = options.process ?? process;
  const logger = options.logger ?? console;
  const terminate = options.terminate ?? ((exitCode) => processRef.exit(exitCode));
  const startupController = new AbortController();
  let shutdownKind = null;
  let shutdownPromise = null;
  let runningPromise;

  const removeSignalHandlers = () => {
    processRef.off("SIGINT", onSigint);
    processRef.off("SIGTERM", onSigterm);
  };

  const beginSignalShutdown = (signal) => {
    if (shutdownKind) return shutdownPromise;
    shutdownKind = "signal";
    const signalExitCode = SIGNAL_EXIT_CODES[signal];
    logger.log("[pi-web] terminal_shutdown_started", {
      signal,
      exitCode: signalExitCode,
    });
    startupController.abort(signal);

    shutdownPromise = (async () => {
      let running;
      try {
        running = await runningPromise;
      } catch (error) {
        removeSignalHandlers();
        if (error?.code === "pi_web_startup_aborted") {
          logger.log("[pi-web] terminal_shutdown_complete", {
            signal,
            exitCode: signalExitCode,
          });
          terminate(signalExitCode);
        } else if (error?.code === "pi_web_startup_abort_cleanup_failed") {
          reportCloseFailure(logger, error);
          terminate(1);
        } else {
          logger.error("[pi-web] startup_failed", { errorName: publicErrorClass(error) });
          terminate(1);
        }
        return;
      }

      try {
        await running.close(signal);
      } catch (error) {
        removeSignalHandlers();
        reportCloseFailure(logger, error);
        terminate(1);
        return;
      }

      removeSignalHandlers();
      logger.log("[pi-web] terminal_shutdown_complete", {
        signal,
        exitCode: signalExitCode,
      });
      terminate(signalExitCode);
    })();

    return shutdownPromise;
  };

  function onSigint() {
    void beginSignalShutdown("SIGINT");
  }

  function onSigterm() {
    void beginSignalShutdown("SIGTERM");
  }

  // Keep both handlers installed until cleanup finishes so later signals are
  // observed and deliberately ignored instead of taking their default action.
  processRef.on("SIGINT", onSigint);
  processRef.on("SIGTERM", onSigterm);

  runningPromise = runPiWebCli({
    ...options,
    process: processRef,
    logger,
    lifecycleOwner: "terminal",
    startupSignal: startupController.signal,
  });

  try {
    const running = await runningPromise;
    if (shutdownPromise) await shutdownPromise;
    return running;
  } catch (error) {
    if (shutdownPromise) {
      await shutdownPromise;
      return null;
    }
    removeSignalHandlers();
    if (error?.code === "build_artifacts_missing") {
      logger.error("Build artifacts not found. Please report this issue.");
    } else {
      logger.error("[pi-web] startup_failed", { errorName: publicErrorClass(error) });
    }
    processRef.exitCode = 1;
    terminate(1);
    return null;
  }
}

if (require.main === module) {
  try {
    assertNodeToolchain(process.version);
    void runTerminalEntry().catch((error) => {
      console.error("[pi-web] terminal_failed", { errorName: publicErrorClass(error) });
      process.exitCode = 1;
    });
  } catch (error) {
    if (error?.code === "pi_web_toolchain_mismatch") {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write("[pi-web] Toolchain preflight failed.\n");
    }
    process.exitCode = 1;
  }
}

module.exports = {
  browserUrl,
  openBrowser,
  publicErrorClass,
  runPiWebCli,
};
