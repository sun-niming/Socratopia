"use strict";

var AsyncLocalStorage = require("async_hooks").AsyncLocalStorage;

function validAccountId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function createAccountRequestContext() {
  var storage = new AsyncLocalStorage();

  function getAccountId() {
    var store = storage.getStore();
    return store && store.accountId || null;
  }

  function run(accountId, callback) {
    if (!validAccountId(accountId)) throw new TypeError("Invalid accountId");
    if (typeof callback !== "function") throw new TypeError("Account context callback is required");
    return storage.run(Object.freeze({ accountId: accountId }), callback);
  }

  return Object.freeze({
    getAccountId: getAccountId,
    run: run
  });
}

module.exports = {
  createAccountRequestContext: createAccountRequestContext,
  validAccountId: validAccountId
};
