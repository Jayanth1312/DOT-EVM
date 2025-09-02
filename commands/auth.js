const chalk = require("chalk");
const { dbOps } = require("../db");
const { legacyLogin } = require("./legacy-auth");

async function handleLogin(args) {
  return legacyLogin();
}

module.exports = {
  handleLogin,
};
