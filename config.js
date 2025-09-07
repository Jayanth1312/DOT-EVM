const fs = require("fs");
const path = require("path");
const os = require("os");

class ConfigManager {
  constructor() {
    this.evmDir = path.join(os.homedir(), ".evm");
    this.configPath = path.join(this.evmDir, "config.json");
    this.ensureConfigExists();
  }

  ensureConfigExists() {
    // Create ~/.evm directory if it doesn't exist
    if (!fs.existsSync(this.evmDir)) {
      fs.mkdirSync(this.evmDir, { recursive: true });
    }

    // Create default config if it doesn't exist
    if (!fs.existsSync(this.configPath)) {
      const defaultConfig = {
        serverUrl:
          process.env.EVM_SERVER_URL || "https://dot-evm-jbko.vercel.app",
        databasePath: path.join(this.evmDir, "evm.db"),
        sessionPath: path.join(this.evmDir, "session.json"),
        stagingPath: path.join(this.evmDir, "staging.json"),
        tempDir: path.join(this.evmDir, "temp"),
        version: "1.0.0",
      };

      fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2));
    }
  }

  getConfig() {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, "utf8"));
    } catch (error) {
      console.error("Error reading config:", error.message);
      return this.getDefaultConfig();
    }
  }

  getDefaultConfig() {
    return {
      serverUrl:
        process.env.EVM_SERVER_URL || "https://dot-evm-jbko.vercel.app",
      databasePath: path.join(this.evmDir, "evm.db"),
      sessionPath: path.join(this.evmDir, "session.json"),
      stagingPath: path.join(this.evmDir, "staging.json"),
      tempDir: path.join(this.evmDir, "temp"),
      version: "1.0.0",
    };
  }

  updateConfig(updates) {
    try {
      const currentConfig = this.getConfig();
      const newConfig = { ...currentConfig, ...updates };
      fs.writeFileSync(this.configPath, JSON.stringify(newConfig, null, 2));
      return true;
    } catch (error) {
      console.error("Error updating config:", error.message);
      return false;
    }
  }

  // Convenience methods for common paths
  getDatabasePath() {
    return this.getConfig().databasePath;
  }

  getSessionPath() {
    return this.getConfig().sessionPath;
  }

  getStagingPath() {
    return this.getConfig().stagingPath;
  }

  getServerUrl() {
    return this.getConfig().serverUrl;
  }

  getEvmDir() {
    return this.evmDir;
  }

  getTempDir() {
    const tempDir = this.getConfig().tempDir;
    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
  }

  // Project-specific config paths
  getProjectConfigPath(projectDir = process.cwd()) {
    return path.join(projectDir, ".evm-config.json");
  }

  // Environment-specific staging (per project)
  getProjectStagingPath(projectDir = process.cwd()) {
    const projectName = path.basename(projectDir);
    const stagingDir = path.join(this.evmDir, "projects", projectName);
    if (!fs.existsSync(stagingDir)) {
      fs.mkdirSync(stagingDir, { recursive: true });
    }
    return path.join(stagingDir, "staging.json");
  }
}

// Export singleton instance
const configManager = new ConfigManager();
module.exports = { configManager, ConfigManager };
