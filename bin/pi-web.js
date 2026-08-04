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

async function runPiWebCli(options = {}) {
  const processRef = options.process ?? process;
  const logger = options.logger ?? console;
  const args = options.args ?? processRef.argv.slice(2);
  const env = options.env ?? processRef.env;
  const launchOptions = parseLaunchOptions(args, env);
  const mode = launchOptions.dev ? "development" : "production";

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

  const url = browserUrl(launchOptions.hostname, startedServer.address.port);
  logger.log(`[pi-web] Ready on ${url}`);
  if (launchOptions.openBrowser) {
    openBrowser(url, {
      spawn: options.spawn,
      platform: options.platform,
      warn: (message) => logger.warn(message),
    });
  }

  let closePromise = null;
  const close = () => {
    if (closePromise) return closePromise;
    closePromise = Promise.resolve().then(() => startedServer.close());
    return closePromise;
  };

  return {
    ...startedServer,
    close,
  };
}

async function runTerminalEntry(options = {}) {
  const processRef = options.process ?? process;
  const logger = options.logger ?? console;
  const terminate = options.terminate ?? ((exitCode) => processRef.exit(exitCode));
  let firstSignal = null;
  let shutdownPromise = null;
  let runningPromise;

  const removeSignalHandlers = () => {
    processRef.off("SIGINT", onSigint);
    processRef.off("SIGTERM", onSigterm);
  };

  const beginSignalShutdown = (signal) => {
    if (firstSignal) return shutdownPromise;
    firstSignal = signal;
    const signalExitCode = SIGNAL_EXIT_CODES[signal];
    logger.log("[pi-web] terminal_shutdown_started", {
      signal,
      exitCode: signalExitCode,
    });

    shutdownPromise = (async () => {
      let running;
      try {
        running = await runningPromise;
      } catch (error) {
        removeSignalHandlers();
        logger.error("[pi-web] startup_failed", { errorName: publicErrorClass(error) });
        terminate(1);
        return;
      }

      try {
        await running.close();
      } catch (error) {
        removeSignalHandlers();
        logger.error("[pi-web] close_failed", { errorName: publicErrorClass(error) });
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
  void runTerminalEntry().catch((error) => {
    console.error("[pi-web] terminal_failed", { errorName: publicErrorClass(error) });
    process.exitCode = 1;
  });
}

module.exports = {
  browserUrl,
  openBrowser,
  publicErrorClass,
  runPiWebCli,
};
