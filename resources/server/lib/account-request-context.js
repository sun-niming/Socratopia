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

  function get() {
    return storage.getStore() || null;
  }

  function run(accountId, callback) {
    if (!validAccountId(accountId)) throw new TypeError("Invalid accountId");
    if (typeof callback !== "function") throw new TypeError("Account context callback is required");
    return storage.run(Object.freeze({ accountId: accountId }), callback);
  }

  function runContext(context, callback) {
    if (!context || !validAccountId(context.accountId)) throw new TypeError("Invalid trusted account context");
    if (typeof callback !== "function") throw new TypeError("Account context callback is required");
    return storage.run(Object.freeze(Object.assign({}, context)), callback);
  }

  return Object.freeze({
    getAccountId: getAccountId,
    get: get,
    run: run,
    runContext: runContext
  });
}

module.exports = {
  createAccountRequestContext: createAccountRequestContext,
  validAccountId: validAccountId
};
