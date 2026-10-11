// Hand-written App Route module for /api/assets/<id>/meta (see lib/assets/route-module.js).
"use strict";

module.exports = require("../../../../../../../lib/assets/route-module.js")
  .create("/api/assets/[id]/meta/route", "/api/assets/[id]/meta", "app/api/assets/[id]/meta/route");
