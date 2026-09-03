import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseLaunchOptions } = require("../bin/pi-web-options.js");

test("defaults to local-only launch and ignores generic HOSTNAME", () => {
  for (const env of [{}, { HOSTNAME: "container-name" }]) {
    assert.deepEqual(parseLaunchOptions([], env), {
      port: "30141",
      hostname: "127.0.0.1",
      openBrowser: true,
      dev: false,
      tailscaleServe: false,
    });
  }
});

test("supports the internal development mode", () => {
  assert.equal(parseLaunchOptions(["--dev"], {}).dev, true);
  assert.equal(parseLaunchOptions([], { NODE_ENV: "development" }).dev, false);
});

test("supports the no-open CLI option", () => {
  assert.equal(parseLaunchOptions(["--no-open"], {}).openBrowser, false);
});

test("supports truthy PI_WEB_NO_OPEN values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(parseLaunchOptions([], { PI_WEB_NO_OPEN: value }).openBrowser, false);
  }
});

test("does not disable browser opening for false PI_WEB_NO_OPEN values", () => {
  for (const value of ["0", "false", "off", ""]) {
    assert.equal(parseLaunchOptions([], { PI_WEB_NO_OPEN: value }).openBrowser, true);
  }
});

test("preserves port and hostname options", () => {
  assert.deepEqual(
    parseLaunchOptions(["-p", "8080", "-H", "127.0.0.1"], {}),
    {
      port: "8080",
      hostname: "127.0.0.1",
      openBrowser: true,
      dev: false,
      tailscaleServe: false,
    },
  );
  assert.equal(parseLaunchOptions(["--hostname", "0.0.0.0"], {}).hostname, "0.0.0.0");
});

test("supports opt-in Tailscale Serve on the selected port", () => {
  assert.deepEqual(parseLaunchOptions(["--tailscale-serve", "--port", "31000"], {}), {
    port: "31000",
    hostname: "127.0.0.1",
    openBrowser: true,
    dev: false,
    tailscaleServe: true,
  });
  assert.equal(parseLaunchOptions(["--tailscale-serve"], {}).port, "30141");
});

test("rejects Serve-only hostname and port conflicts before launch", () => {
  for (const port of [
    "0", "000", "+0", "-0", "0.0", " 0 ",
    "443", "0443", "+443", "443.0", " 443 ", "4.43e2",
  ]) {
    assert.throws(
      () => parseLaunchOptions(["--tailscale-serve", "--port", port], {}),
      (error) => error?.code === "tailscale_serve_port_not_allowed",
    );
  }
  assert.throws(
    () => parseLaunchOptions(["--tailscale-serve", "--hostname", "localhost"], {}),
    (error) => error?.code === "tailscale_serve_requires_loopback",
  );
  assert.equal(
    parseLaunchOptions(["--hostname", "localhost", "--port", "443"], {}).hostname,
    "localhost",
  );
  assert.equal(parseLaunchOptions(["--port", "+0"], {}).port, "+0");
});
