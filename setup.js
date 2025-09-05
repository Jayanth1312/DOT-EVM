#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

// Create ~/.evm directory for user data
const evmDir = path.join(os.homedir(), ".evm");

if (!fs.existsSync(evmDir)) {
  fs.mkdirSync(evmDir, { recursive: true });
  console.log("Created EVM directory:", evmDir);
}

// Create default config if it doesn't exist
const configPath = path.join(evmDir, "config.json");
if (!fs.existsSync(configPath)) {
  const defaultConfig = {
    serverUrl: process.env.EVM_SERVER_URL || "http://localhost:4000",
    databasePath: path.join(evmDir, "evm.db"),
    sessionPath: path.join(evmDir, "session.json"),
  };

  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  console.log("Created default configuration");
}

console.log("EVM CLI setup complete!");
console.log('Run "evm --help" to get started.');
