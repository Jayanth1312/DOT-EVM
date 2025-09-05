const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const { createSimplePrompt } = require("./components/text-input");
const { dbOps } = require("./db");
const { requireAuth } = require("./commands/auth");
const { configManager } = require("./config");

async function scanForEnvFiles(directory = process.cwd()) {
  try {
    const files = fs.readdirSync(directory);
    const envFiles = files.filter(
      (file) =>
        file.startsWith(".env") || file === ".env" || file.includes(".env.")
    );
    return envFiles;
  } catch (error) {
    console.error(chalk.red("Error scanning directory:"), error.message);
    return [];
  }
}

async function initializeProject() {
  console.log(chalk.bold.cyan("Initializing new EVM project...\n"));

  try {
    // Use modern authentication in local-only mode for init
    const currentUser = await requireAuth(true);
    const currentDirectory = process.cwd();
    const existingProject = dbOps.getProjectByUserAndDirectory(
      currentUser.id,
      currentDirectory
    );

    if (existingProject.success) {
      console.error(chalk.red(`Project is already initialized`));
      console.log(chalk.yellow(`Use evm add`));
      process.exit(1);
    }

    const projectName = await createSimplePrompt({
      title: "📦 EVM Project Setup",
      placeholder: "Enter project name",
      width: 50,
      borderColor: "gray",
      validateInput: (value) => {
        if (value.length < 2) return false;
        if (!/^[a-zA-Z0-9-_\.]+$/.test(value)) return false;
        return true;
      },
      errorMessage:
        "Project name must be at least 2 characters and contain only letters, numbers, hyphens, underscores, and dots",
    });

    const createResult = dbOps.createProject(
      currentUser.id,
      projectName,
      "",
      process.cwd()
    );

    if (!createResult.success) {
      console.error(chalk.red(`Database error: ${createResult.error}`));
      process.exit(1);
    }

    const envFiles = await scanForEnvFiles();

    const projectConfig = {
      name: projectName,
      createdAt: new Date().toISOString(),
      directory: process.cwd(),
      envFiles: envFiles,
      variables: [],
    };

    const configPath = configManager.getProjectConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(projectConfig, null, 2));

    console.log(chalk.whiteBright(`EVM project initialized`));

    if (envFiles.length > 0) {
      console.log(chalk.yellow(`\nNext steps:`));
      console.log(
        chalk.white(
          `   • Use "evm add" to select and manage environment variables`
        )
      );
      console.log(
        chalk.white(`   • Use "evm push" to sync variables to the server`)
      );
      console.log(
        chalk.white(`   • Use "evm pull" to sync variables from the server`)
      );
    } else {
      console.log(
        chalk.yellow(
          `Tip: Create .env files in this directory, then use "evm add" to manage them`
        )
      );
    }

    return projectConfig;
  } catch (error) {
    console.error(chalk.red("Project initialization failed."), error.message);
    process.exit(1);
  }
}

module.exports = {
  initializeProject,
  scanForEnvFiles,
};
