"use strict";

var skill = require("./skill.js");
var disabled = /^(?:0|false|off)$/i.test(String(process.env.SOCRATOPIA_CLOSE_READING || "1"));

module.exports = {
  enabled: !disabled,
  isCommand: function (text) { return !disabled && skill.isCommand(text); },
  parseCommand: skill.parseCommand,
  execute: skill.execute,
  readTextbookExcerpt: skill.readTextbookExcerpt,
};
