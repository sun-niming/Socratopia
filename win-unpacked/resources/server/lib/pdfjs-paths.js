"use strict";

var path = require("path");

// PDF.js' NodeCMapReaderFactory passes cMapUrl and standardFontDataUrl to
// fs.promises.readFile(). On Windows that requires a native absolute path,
// not a file:// URL. PDF.js joins resource names with '/', so normalize the
// separators and always retain a trailing slash.
function resourceDir(value) {
  var resolved = path.resolve(String(value || "")).replace(/\\/g, "/");
  return resolved.endsWith("/") ? resolved : resolved + "/";
}

module.exports = {
  resourceDir: resourceDir,
};
