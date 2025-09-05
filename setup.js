#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

console.log("🚀 Setting up EVM CLI...");

// Create ~/.evm directory for user data
const evmDir = path.join(os.homedir(), ".evm");

if (!fs.existsSync(evmDir)) {
  fs.mkdirSync(evmDir, { recursive: true });
  console.log("✅ Created EVM directory:", evmDir);
} else {
  console.log("📁 EVM directory already exists:", evmDir);
}

// Create projects directory
const projectsDir = path.join(evmDir, "projects");
if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir, { recursive: true });
  console.log("✅ Created projects directory");
}

// Create temp directory
const tempDir = path.join(evmDir, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  console.log("✅ Created temp directory");
}

// Create default config if it doesn't exist
const configPath = path.join(evmDir, "config.json");
if (!fs.existsSync(configPath)) {
  const defaultConfig = {
    serverUrl: process.env.EVM_SERVER_URL || "http://localhost:4000",
    databasePath: path.join(evmDir, "evm.db"),
    sessionPath: path.join(evmDir, "session.json"),
    stagingPath: path.join(evmDir, "staging.json"),
    tempDir: tempDir,
    version: "1.0.0",
  };

  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  console.log("✅ Created default configuration");
} else {
  console.log("📄 Configuration already exists");
}

// Migrate old files if they exist in the project directory
const oldDbPath = path.join(process.cwd(), "evm.db");
const newDbPath = path.join(evmDir, "evm.db");

if (fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
  try {
    fs.copyFileSync(oldDbPath, newDbPath);
    console.log("📦 Migrated database to user directory");
  } catch (error) {
    console.log("⚠️  Could not migrate database:", error.message);
  }
}

const oldSessionPath = path.join(process.cwd(), ".evm-session.json");
const newSessionPath = path.join(evmDir, "session.json");

if (fs.existsSync(oldSessionPath) && !fs.existsSync(newSessionPath)) {
  try {
    fs.copyFileSync(oldSessionPath, newSessionPath);
    console.log("📦 Migrated session to user directory");
  } catch (error) {
    console.log("⚠️  Could not migrate session:", error.message);
  }
}

console.log("🎉 EVM CLI setup complete!");
console.log("📍 User data location:", evmDir);
console.log('🚀 Run "evm --help" to get started.');
