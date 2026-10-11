// Hand-written App Route module for /api/assets/<id> (see lib/assets/route-module.js).
"use strict";

module.exports = require("../../../../../../lib/assets/route-module.js")
  .create("/api/assets/[id]/route", "/api/assets/[id]", "app/api/assets/[id]/route");
