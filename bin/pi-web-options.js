"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values: cliArgs } = parseArgs({
    args,
    options: {
      port:      { type: "string", short: "p" },
      hostname:  { type: "string", short: "H" },
      "no-open":        { type: "boolean" },
      "tailscale-serve": { type: "boolean" },
      dev:               { type: "boolean" },
    },
    strict: false,
  });

  const port = cliArgs.port ?? env.PORT ?? "30141";
  const hostname = cliArgs.hostname ?? "127.0.0.1";
  const tailscaleServe = cliArgs["tailscale-serve"] === true;

  if (tailscaleServe && hostname !== "127.0.0.1") {
    const error = new Error("tailscale_serve_requires_loopback");
    error.code = "tailscale_serve_requires_loopback";
    throw error;
  }
  const numericPort = Number(port);
  if (tailscaleServe && (numericPort === 0 || numericPort === 443)) {
    const error = new Error("tailscale_serve_port_not_allowed");
    error.code = "tailscale_serve_port_not_allowed";
    throw error;
  }

  return {
    port,
    hostname,
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.PI_WEB_NO_OPEN),
    dev: cliArgs.dev === true,
    tailscaleServe,
  };
}

module.exports = { parseLaunchOptions };
