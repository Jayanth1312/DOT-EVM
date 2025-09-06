#!/usr/bin/env node
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");
const path = require("path");
const cliUI = require("./cli-ui");
const loginUI = require("./login-ui");
const { initializeProject } = require("./project-init");
const {
  addEnvFiles,
  pushStagedFiles,
  syncPendingFiles,
  decryptContent,
} = require("./env-manager");
const chalk = require("chalk");
const { dbOps } = require("./db");

// Command suggestions mapping
function getCommandSuggestions(partialCommand) {
  const commandMap = {
    rm: [
      chalk.white("  evm rm <filename>") +
        chalk.gray("         Remove file from current project"),
      chalk.white("  evm rm <filename> --force") +
        chalk.gray("   Remove file (local + cloud)"),
    ],
    rename: [
      chalk.white("  evm rename <name>") +
        chalk.gray("          Rename current project"),
      chalk.white("  evm rename <old> <new>") +
        chalk.gray("     Rename environment file"),
    ],
    list: [
      chalk.white("  evm list") +
        chalk.gray("                   List files in current project"),
      chalk.white("  evm -l") +
        chalk.gray("                     List files in current project"),
      chalk.white("  evm <proj> list") +
        chalk.gray("            List files in specific project"),
      chalk.white("  evm <proj> -l") +
        chalk.gray("              List files in specific project"),
    ],
    revert: [
      chalk.white("  evm revert <hash>") +
        chalk.gray("          Rollback to previous commit"),
    ],
    rollback: [
      chalk.white("  evm rollback history") +
        chalk.gray("      View rollback history"),
    ],
    diff: [
      chalk.white("  evm diff") +
        chalk.gray(
          "                   Show changes between local and last commit"
        ),
    ],
    log: [
      chalk.white("  evm log") +
        chalk.gray("                    Show commit history"),
      chalk.white("  evm log --oneline") +
        chalk.gray("           Show commit history in compact table"),
    ],
    clone: [
      chalk.white("  evm clone") +
        chalk.gray("                  Clone a project from database"),
    ],
    sync: [
      chalk.white("  evm sync") +
        chalk.gray(
          "                   Manually sync local files to cloud (optional)"
        ),
    ],
    pending: [
      chalk.white("  evm pending") +
        chalk.gray("               Show pending operations queued for sync"),
    ],
    pull: [
      chalk.white("  evm pull") +
        chalk.gray(
          "                   Pull latest files from cloud to local project"
        ),
    ],
    push: [
      chalk.white("  evm push") +
        chalk.gray(
          "                   Commit staged changes to local database and cloud"
        ),
    ],
    add: [
      chalk.white("  evm add") +
        chalk.gray("                    Stage environment files for commit"),
      chalk.white("  evm add .") +
        chalk.gray("                  Stage all changed files for commit"),
    ],
    status: [
      chalk.white("  evm status") +
        chalk.gray("                 Show status of changed files"),
    ],
    init: [
      chalk.white("  evm init") +
        chalk.gray("                   Initialize a new project"),
    ],
    login: [
      chalk.white("  evm login") +
        chalk.gray("                  User login (JWT/modern auth)"),
    ],
    register: [
      chalk.white("  evm register") +
        chalk.gray("               User registration (JWT/modern auth)"),
    ],
    logout: [
      chalk.white("  evm logout") +
        chalk.gray("                 Logout current user"),
    ],
    whoami: [
      chalk.white("  evm whoami") +
        chalk.gray("                 Show current user info"),
    ],
  };

  // Finding exact matches first
  if (commandMap[partialCommand]) {
    return commandMap[partialCommand];
  }

  // Finding partial matches
  const suggestions = [];
  for (const [command, options] of Object.entries(commandMap)) {
    if (command.startsWith(partialCommand)) {
      suggestions.push(...options);
    }
  }

  return suggestions;
}

// Import command modules
const { showHelp } = require("./commands/core");
const {
  handleLogin,
  handleRegister,
  handleLogout,
  handleWhoami,
} = require("./commands/auth");
const {
  handleRename,
  handleProjectList,
  handleRemove,
} = require("./commands/project");
const {
  handleStatus,
  handleDiff,
  handleLog,
  handleRevert,
  handleRollbackHistory,
} = require("./commands/workflow");
const {
  handleSync,
  handlePendingOperations,
  handlePull,
  handleClone,
} = require("./commands/cloud");

const args = process.argv.slice(2);

async function showUsers() {
  try {
    const rows = await dbOps.getAllUsers();
    if (!rows || rows.length === 0) {
      console.log(chalk.yellow("[INFO] No local users found"));
      process.exit(0);
    }

    console.log(chalk.blue("Local users:"));
    console.log();
    console.log(
      chalk.green(
        "ID".padEnd(4) +
          "  " +
          "Email".padEnd(30) +
          "  " +
          "CreatedAt".padEnd(24) +
          "  " +
          "LastLogin".padEnd(24) +
          "  " +
          "Synced"
      )
    );

    for (const r of rows) {
      const id = String(r.id).padEnd(4);
      const email = String(r.email || "").padEnd(30);
      const createdAt = String(r.createdAt || r.created_at || "").padEnd(24);
      const lastLogin = String(
        r.lastLogin || r.last_login || r.lastLoginAt || ""
      ).padEnd(24);
      const synced = r.syncedToServer ? "yes" : "no";
      console.log(
        id + "  " + email + "  " + createdAt + "  " + lastLogin + "  " + synced
      );
    }
    process.exit(0);
  } catch (err) {
    console.error(
      chalk.red("[ERROR] Could not read local users:"),
      err.message || err
    );
    process.exit(1);
  }
}

async function dispatchRaw(cmd) {
  if (!cmd) return;
  const parts = cmd.trim().split(/\s+/);
  if (parts[0] === "evm") parts.shift();
  if (parts.length === 0) return;
  if (parts[0] === "login" || parts[0] === "user") return handleLogin([]);
  if (parts[0] === "register") return handleRegister([]);
  if (parts[0] === "logout") return handleLogout([]);
  if (parts[0] === "whoami") return handleWhoami([]);
  if (parts[0] === "show" && (parts[1] === "user" || parts[1] === "users"))
    return showUsers();
  if (parts[0] === "init") {
    return initializeProject();
  }
  if (parts[0] === "add") {
    return addEnvFiles(parts.slice(1));
  }
  if (parts[0] === "commit") {
    console.log(chalk.green("[INFO] Commit created (stub)"));
    process.exit(0);
  }
  if (parts[0] === "sync") {
    return handleSync(parts.slice(1));
  }
  if (parts[0] === "pending") {
    return handlePendingOperations(parts.slice(1));
  }

  console.log(chalk.yellow("[USAGE] Unknown command from launcher:"), cmd);
  process.exit(1);
}

if (args.length === 0) {
  (async () => {
    try {
      const result = await cliUI.showLauncher();

      if (
        result &&
        typeof result === "object" &&
        result.type === "startLogin"
      ) {
        return handleLogin([]);
      } else {
        await dispatchRaw(result);
      }
    } catch (err) {
      console.error(chalk.red("[ERROR] Launcher failed:"), err.message);
      process.exit(1);
    }
  })();
} else if (args.length === 1 && args[0] === "user") {
  handleLogin([]);
} else if (args.length === 1 && args[0] === "login") {
  handleLogin([]);
} else if (args.length === 1 && args[0] === "register") {
  handleRegister([]);
} else if (args.length === 1 && args[0] === "logout") {
  handleLogout([]);
} else if (args.length === 1 && args[0] === "whoami") {
  handleWhoami([]);
} else if (args.length === 1 && args[0] === "init") {
  initializeProject();
} else if (args.length === 1 && args[0] === "add") {
  addEnvFiles();
} else if (args.length === 2 && args[0] === "add" && args[1] === ".") {
  addEnvFiles(["."]);
} else if (args.length === 1 && args[0] === "push") {
  pushStagedFiles();
} else if (args.length === 1 && args[0] === "sync") {
  handleSync(args.slice(1));
} else if (args.length === 1 && args[0] === "pending") {
  handlePendingOperations(args.slice(1));
} else if (args.length === 1 && args[0] === "pull") {
  handlePull(args.slice(1));
} else if (args.length === 1 && args[0] === "clone") {
  handleClone(args.slice(1));
} else if (args.length === 1 && args[0] === "status") {
  handleStatus();
} else if (args.length >= 1 && args[0] === "diff") {
  handleDiff(args);
} else if (args.length >= 1 && args[0] === "log") {
  handleLog(args);
} else if (args.length >= 2 && args[0] === "revert") {
  handleRevert(args);
} else if (
  args.length === 2 &&
  args[0] === "rollback" &&
  args[1] === "history"
) {
  handleRollbackHistory(args);
} else if (
  args.length === 1 &&
  (args[0] === "--help" || args[0] === "-h" || args[0] === "help")
) {
  showHelp();
} else if (args.length >= 2 && args[0] === "rename") {
  handleRename(args);
} else if (args.length >= 2 && args[0] === "rm") {
  handleRemove(args);
} else if (
  (args.length === 1 && (args[0] === "list" || args[0] === "-l")) ||
  (args.length === 2 && (args[1] === "list" || args[1] === "-l")) ||
  (args.length === 2 && args[0] === "list" && args[1] === "--all")
) {
  handleProjectList(args);
} else {
  if (args.length === 1) {
    const partialCommand = args[0];
    const suggestions = getCommandSuggestions(partialCommand);

    if (suggestions.length > 0) {
      console.log(chalk.yellow.bold(`\nDid you mean one of these commands?\n`));
      suggestions.forEach((suggestion) => {
        console.log(suggestion);
      });
      console.log(
        chalk.gray("\nUse 'evm --help' to see all available commands.\n")
      );
      return;
    }
  }

  console.log(chalk.red.bold("Unknown command or invalid usage\n"));
  showHelp();
}
