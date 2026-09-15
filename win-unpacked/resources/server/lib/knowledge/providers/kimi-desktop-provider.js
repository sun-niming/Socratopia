/**
 * Canonical Kimi Desktop provider entrypoint.
 *
 * The historical implementation file is kept as a compatibility shim target
 * for older requires and patch history, but its exported provider id is now
 * `kimi-desktop`.
 */
"use strict";

module.exports = require("./kimi-client-provider.js");
