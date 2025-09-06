const chalk = require("chalk");
const { dbOps, sessionManager } = require("../db");
const { createSimplePrompt } = require("../components/text-input");
const { configManager } = require("../config");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Config file management functions
function getConfigPath() {
  return configManager.getProjectConfigPath();
}

function readConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const configData = fs.readFileSync(configPath, "utf8");
    return JSON.parse(configData);
  } catch (error) {
    return null;
  }
}

function updateConfig(config) {
  const configPath = getConfigPath();
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    return false;
  }
}

function removeConfig() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Create authenticated axios instance for server calls
function createAuthenticatedAxios() {
  const session = sessionManager.getCurrentUser();
  if (!session?.token) {
    throw new Error("No valid token found. Please login again.");
  }

  return axios.create({
    baseURL: "http://localhost:4000",
    timeout: 10000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
  });
}

// Cloud deletion functions
async function deleteProjectFromCloud(userEmail, projectName) {
  try {
    const api = createAuthenticatedAxios();
    const response = await api.delete("/projects", {
      data: {
        user_email: userEmail,
        project_name: projectName,
      },
    });

    return { success: true, data: response.data };
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      return {
        success: false,
        error: "Cloud server not available",
        offline: true,
      };
    }
    // Check for JWT expiration
    if (
      error.response?.status === 401 ||
      error.response?.data?.error === "Token expired"
    ) {
      return {
        success: false,
        error: "Login to use cloud operations",
        jwtExpired: true,
      };
    }
    return {
      success: false,
      error: error.response?.data?.error || error.message,
    };
  }
}

async function deleteFileFromCloud(userEmail, projectName, fileName) {
  try {
    const api = createAuthenticatedAxios();
    const response = await api.delete("/env-files", {
      data: {
        user_email: userEmail,
        project_name: projectName,
        file_name: fileName,
      },
    });

    return { success: true, data: response.data };
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      return {
        success: false,
        error: "Cloud server not available",
        offline: true,
      };
    }
    // Check for JWT expiration
    if (
      error.response?.status === 401 ||
      error.response?.data?.error === "Token expired"
    ) {
      return {
        success: false,
        error: "Login to use cloud operations",
        jwtExpired: true,
      };
    }
    return {
      success: false,
      error: error.response?.data?.error || error.message,
    };
  }
}

async function handleRename(args) {
  if (!dbOps.isLoggedIn()) {
    console.log(chalk.red("You must be logged in. Run 'evm login' first."));
    process.exit(1);
  }

  const currentUser = dbOps.getCurrentUser();
  if (!currentUser) {
    console.log(chalk.red("Failed to get current user."));
    process.exit(1);
  }

  if (args.length === 2) {
    const newProjectName = args[1];

    // Get current project
    const currentProject = dbOps.getCurrentProject(currentUser.userId);
    if (!currentProject.success) {
      console.log(chalk.red("No active project found. Run 'evm init' first."));
      process.exit(1);
    }

    const oldProjectName = currentProject.project.name;

    // First rename locally
    const localResult = dbOps.renameProject(
      currentProject.project.id,
      newProjectName
    );

    if (!localResult.success) {
      console.log(
        chalk.red(`Failed to rename project locally: ${localResult.error}`)
      );
      process.exit(1);
    }

    console.log(
      chalk.green(
        `Local project renamed from "${oldProjectName}" to "${newProjectName}"`
      )
    );

    try {
      const { handleCloudRenameProject } = require("./cloud");

      console.log(chalk.blue("Syncing rename to cloud..."));

      const projectForCloud = {
        ...currentProject.project,
        name: oldProjectName,
      };

      const cloudResult = await handleCloudRenameProject(
        projectForCloud,
        newProjectName
      );

      if (cloudResult.success) {
        console.log(chalk.green("Project rename synchronized to cloud"));
      } else {
        console.log(
          chalk.yellow("Local rename completed, but cloud sync failed")
        );
        console.log(
          chalk.gray("Run 'evm sync' later to synchronize with cloud")
        );
      }
    } catch (error) {
      console.log(
        chalk.yellow("Local rename completed, but cloud sync failed")
      );
      console.log(
        chalk.gray("Run 'evm sync' later to synchronize with cloud")
      );
    }
  } else if (args.length === 3) {
    const projectName = args[1];
    const newFileName = args[2];

    // Get project by name
    const project = dbOps.getProjectByName(currentUser.userId, projectName);
    if (!project.success) {
      console.log(chalk.red(`Project "${projectName}" not found.`));
      process.exit(1);
    }

    const envFiles = dbOps.getEnvFilesByProject(project.project.id);
    if (!envFiles.success || envFiles.envFiles.length === 0) {
      console.log(
        chalk.red(`No environment files found in project "${projectName}".`)
      );
      process.exit(1);
    }

    const oldFileName = envFiles.envFiles[0].name;
    const fileId = envFiles.envFiles[0].id;

    // First rename locally
    const localResult = dbOps.renameEnvFile(fileId, newFileName);
    if (!localResult.success) {
      console.log(
        chalk.red(`Failed to rename file locally: ${localResult.error}`)
      );
      process.exit(1);
    }

    console.log(
      chalk.green(
        `Local file renamed from "${oldFileName}" to "${newFileName}" in project "${projectName}"`
      )
    );

    try {
      const { handleCloudRenameFile } = require("./cloud");

      const cloudResult = await handleCloudRenameFile(
        project.project,
        oldFileName,
        newFileName
      );

      if (cloudResult.success) {
        console.log();
      } else {
        console.log(
          chalk.yellow("Local rename completed, but cloud sync failed")
        );
        console.log(
          chalk.gray("   Run 'evm sync' later to synchronize with cloud")
        );
      }
    } catch (error) {
      console.log(
        chalk.yellow("Local rename completed, but cloud sync failed")
      );
      console.log(
        chalk.gray("   Run 'evm sync' later to synchronize with cloud")
      );
    }
  } else {
    console.log(chalk.red("Invalid usage for rename command"));
    console.log(chalk.yellow("Usage:"));
    console.log(chalk.yellow("  evm rename <new_project_name>"));
    console.log(chalk.yellow("  evm rename <project_name> <new_file_name>"));
    process.exit(1);
  }
}

// List all projects and their files for the current user
async function handleListAllProjects(currentUser) {

  const allProjects = dbOps.getProjectsByUser(currentUser.userId);
  if (!allProjects.success || allProjects.projects.length === 0) {
    console.log(
      chalk.yellow("\n   No projects found. Create a project with 'evm init'.")
    );
    return;
  }

  const projectCol = "Project".padEnd(20);
  const fileCol = "File".padEnd(20);
  const sizeCol = "File Size".padEnd(12);
  const createdAtCol = "Created At".padEnd(16);
  const lastUpdatedCol = "Last Updated";

  console.log(
    chalk.cyan(
      `${projectCol} ${fileCol} ${sizeCol} ${createdAtCol} ${lastUpdatedCol}`
    )
  );
  console.log(chalk.gray("-".repeat(100)));

  allProjects.projects.forEach((project) => {
    const envFiles = dbOps.getEnvFilesByProject(project.id);

    if (!envFiles.success || envFiles.envFiles.length === 0) {
      // Print project row with no files
      const projectName = project.name.padEnd(20);
      const emptyFile = "-".padEnd(20);
      const emptySize = "-".padEnd(12);
      const createdAt = project.createdAt
        ? new Date(project.createdAt).toLocaleString()
        : "-";
      const createdAtStr = String(createdAt).padEnd(16);
      console.log(
        chalk.white(
          `${projectName} ${emptyFile} ${emptySize} ${createdAtStr} -`
        )
      );
      return;
    }

    envFiles.envFiles.forEach((file, idx) => {
      const projectName = idx === 0 ? project.name.padEnd(20) : "".padEnd(20);
      const fileName = file.name.padEnd(20);
      const fileSize = file.encrypted_content
        ? `${file.encrypted_content.length} bytes`.padEnd(12)
        : "0 bytes".padEnd(12);

      const createdAt = file.createdAt
        ? new Date(file.createdAt).toLocaleString()
        : "-";
      const updatedAt = file.updatedAt
        ? new Date(file.updatedAt).toLocaleString()
        : "-";

      const createdAtStr = String(createdAt).padEnd(16);

      console.log(
        chalk.white(
          `${projectName} ${fileName} ${fileSize} ${createdAtStr} ${updatedAt}`
        )
      );
    });
  });
}

// List files in a project
async function handleProjectList(args) {
  if (!dbOps.isLoggedIn()) {
    console.log(chalk.red("You must be logged in. Run 'evm login' first."));
    process.exit(1);
  }

  const currentUser = dbOps.getCurrentUser();
  if (!currentUser) {
    console.log(chalk.red("Failed to get current user."));
    process.exit(1);
  }

  // Check for --all flag
  if (args.length === 2 && args[1] === "--all") {
    return handleListAllProjects(currentUser);
  }

  let projectName;

  if (args.length === 1 && (args[0] === "list" || args[0] === "-l")) {
    const currentProject = dbOps.getCurrentProject(currentUser.userId);
    if (!currentProject.success) {
      console.log(chalk.red("No active project found. Run 'evm init' first."));
      process.exit(1);
    }
    projectName = currentProject.project.name;
  } else if (args.length === 2 && (args[1] === "list" || args[1] === "-l")) {
    projectName = args[0];
  } else {
    console.log(chalk.red("Invalid usage for list command"));
    console.log(chalk.yellow("Usage:"));
    console.log(
      chalk.yellow(
        "  evm list                    # List files in current project"
      )
    );
    console.log(
      chalk.yellow(
        "  evm -l                      # List files in current project"
      )
    );
    console.log(
      chalk.yellow(
        "  evm <project_name> list     # List files in specific project"
      )
    );
    console.log(
      chalk.yellow(
        "  evm <project_name> -l       # List files in specific project"
      )
    );
    console.log(
      chalk.yellow(
        "  evm list --all              # List all projects and their files"
      )
    );
    process.exit(1);
  }

  const project = dbOps.getProjectByName(currentUser.userId, projectName);
  if (!project.success) {
    console.log(chalk.red(`Project "${projectName}" not found.`));
    process.exit(1);
  }

  const envFiles = dbOps.getEnvFilesByProject(project.project.id);
  if (!envFiles.success) {
    console.log(chalk.red(`Failed to get files for project "${projectName}".`));
    process.exit(1);
  }

  // Format project creation date
  let formattedCreatedAt = "Invalid Date";
  if (project.project.createdAt) {
    try {
      const date = new Date(project.project.createdAt);
      const day = date.getDate().toString().padStart(2, "0");
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      formattedCreatedAt = `${day}/${month} ${hours}:${minutes}`;
    } catch (error) {
      formattedCreatedAt = "Invalid Date";
    }
  }

  console.log("");

  if (envFiles.envFiles.length === 0) {
    console.log(
      chalk.yellow("\n   No environment files found in this project.")
    );
  } else {
    // Table header
    const projectCol = "Project".padEnd(15);
    const fileCol = "File".padEnd(12);
    const sizeCol = "File Size".padEnd(12);
    const createdAtCol = "Created At".padEnd(12);
    const lastUpdatedCol = "Last Updated";

    console.log(
      chalk.cyan(
        `${projectCol} ${fileCol} ${sizeCol} ${createdAtCol} ${lastUpdatedCol}`
      )
    );
    console.log(chalk.gray("-".repeat(80)));

    // Table rows
    envFiles.envFiles.forEach((file) => {
      const fileSize = file.encrypted_content
        ? `${file.encrypted_content.length} bytes`
        : "0 bytes";

      let createdAt = "Invalid Date";
      if (file.createdAt) {
        try {
          const date = new Date(file.createdAt);
          const day = date.getDate().toString().padStart(2, "0");
          const month = (date.getMonth() + 1).toString().padStart(2, "0");
          const hours = date.getHours().toString().padStart(2, "0");
          const minutes = date.getMinutes().toString().padStart(2, "0");
          createdAt = `${day}/${month} ${hours}:${minutes}`;
        } catch (error) {
          createdAt = "Invalid Date";
        }
      }

      let lastUpdated = "Invalid Date";
      if (file.updatedAt) {
        try {
          const date = new Date(file.updatedAt);
          const day = date.getDate().toString().padStart(2, "0");
          const month = (date.getMonth() + 1).toString().padStart(2, "0");
          const hours = date.getHours().toString().padStart(2, "0");
          const minutes = date.getMinutes().toString().padStart(2, "0");
          lastUpdated = `${day}/${month} ${hours}:${minutes}`;
        } catch (error) {
          lastUpdated = "Invalid Date";
        }
      }

      const projectName_padded = projectName.padEnd(15);
      const fileName_padded = file.name.padEnd(12);
      const fileSize_padded = fileSize.padEnd(12);
      const createdAt_padded = createdAt.padEnd(12);
      const lastUpdated_padded = lastUpdated;

      console.log(
        chalk.white(
          `${projectName_padded} ${fileName_padded} ${fileSize_padded} ${createdAt_padded} ${lastUpdated_padded}`
        )
      );
    });
    console.log();
  }
}

async function handleRemove(args) {
  if (!dbOps.isLoggedIn()) {
    console.log(chalk.red("You must be logged in. Run 'evm login' first."));
    process.exit(1);
  }

  const currentUser = dbOps.getCurrentUser();
  if (!currentUser) {
    console.log(chalk.red("Failed to get current user."));
    process.exit(1);
  }

  if (args.length < 2) {
    console.log(chalk.red("Missing arguments"));
    console.log(chalk.yellow("Usage:"));
    console.log(
      chalk.white(
        "  evm rm <project>                    # Remove entire project (local only)"
      )
    );
    console.log(
      chalk.white(
        "  evm rm <project> --force            # Remove entire project (local + cloud)"
      )
    );
    console.log(
      chalk.white(
        "  evm rm <project> <file>             # Remove specific file from project (local only)"
      )
    );
    console.log(
      chalk.white(
        "  evm rm <project> <file> --force     # Remove specific file from project (local + cloud)"
      )
    );
    return;
  }

  // Check for --force flag
  const forceFlag = args.includes("--force");
  const filteredArgs = args.filter((arg) => arg !== "--force");

  const projectName = filteredArgs[1];

  // Get project by name
  const projectResult = dbOps.getProjectByName(currentUser.userId, projectName);
  if (!projectResult.success) {
    console.log(chalk.red(`Project "${projectName}" not found.`));
    return;
  }

  const project = projectResult.project;

  if (filteredArgs.length === 2) {
    const deleteLocation = forceFlag
      ? "local database and cloud"
      : "local database only";
    console.log(
      chalk.yellow(
        `\nYou are about to delete the entire project "${projectName}" from ${deleteLocation}`
      )
    );
    console.log(chalk.red("  This will delete:"));

    const envFilesResult = dbOps.getEnvFilesByProject(project.id);
    if (envFilesResult.success && envFilesResult.envFiles.length > 0) {
      console.log(
        chalk.red(`   • ${envFilesResult.envFiles.length} environment files`)
      );
      envFilesResult.envFiles.forEach((file) => {
        console.log(chalk.red(`     - ${file.name}`));
      });

      const { db } = require("../db");
      const versionCountStmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM env_versions v
        JOIN env_files f ON v.env_file_id = f.id
        WHERE f.project_id = ?
      `);
      const versionCount = versionCountStmt.get(project.id);
      if (versionCount && versionCount.count > 0) {
        console.log(
          chalk.red(`   • ${versionCount.count} version history entries`)
        );
      }
    }

    console.log(chalk.red("   • All rollback history"));
    console.log(chalk.red("   • Project metadata"));

    console.log(chalk.yellow("\nThis action cannot be undone!\n"));
    if (forceFlag) {
      console.log(
        chalk.cyan(
          "Note: This will delete the project from both your local device AND the cloud."
        )
      );
      console.log(
        chalk.red("Warning: The cloud version will be permanently lost!")
      );
    } else {
      console.log(
        chalk.cyan(
          "Note: This will only delete the project from your local device."
        )
      );
      console.log(
        chalk.cyan("The cloud version of this project will remain intact.")
      );
    }

    try {
      const confirmationTitle = forceFlag
        ? "Type 'yes' to confirm deletion from local AND cloud:"
        : "Type 'yes' to confirm local deletion:";

      const confirmation = await createSimplePrompt({
        title: confirmationTitle,
        placeholder: "yes",
        width: 50,
        borderColor: "red",
        validateInput: (input) => input.toLowerCase() === "yes",
        errorMessage:
          "Please type 'yes' to confirm deletion or Ctrl+C to cancel",
      });

      if (confirmation.toLowerCase() !== "yes") {
        console.log(chalk.yellow("Project deletion cancelled"));
        return;
      }
    } catch (error) {
      console.log(chalk.yellow("\nProject deletion cancelled"));
      return;
    }

    console.log(chalk.blue("\n Deleting project..."));
    const deleteResult = dbOps.deleteProject(project.id, currentUser.userId);

    if (deleteResult.success) {
      console.log(
        chalk.green(`Project "${projectName}" deleted from local database`)
      );

      // Update or remove the config file
      const config = readConfig();
      if (config && config.name === projectName) {
        // If this is the project in the config file, remove the entire config
        const configRemoved = removeConfig();
        if (configRemoved) {
          console.log(chalk.gray("Local configuration file removed"));
        } else {
          console.log(
            chalk.yellow("Warning: Could not remove configuration file")
          );
        }
      }

      if (forceFlag) {
        // Try to delete from cloud when --force is used
        const cloudDeleteResult = await deleteProjectFromCloud(
          currentUser.email,
          projectName
        );
        if (cloudDeleteResult.success) {
          console.log(
            chalk.green(`Project "${projectName}" deleted from cloud`)
          );
          console.log(
            chalk.gray(
              "All associated files, versions, and history have been removed from both local and cloud"
            )
          );
        } else {
          if (
            cloudDeleteResult.jwtExpired ||
            cloudDeleteResult.error === "Login to use cloud operations"
          ) {
            console.log(chalk.yellow("Login to use cloud operations"));
          } else {
            console.log(
              chalk.yellow(
                `Warning: Could not delete from cloud (offline?): ${cloudDeleteResult.error}`
              )
            );
            console.log(
              chalk.gray(
                "   Project deleted locally but cloud deletion failed. Try again when online."
              )
            );
          }
        }
      } else {
        console.log(
          chalk.cyan(`Note: Project is only deleted from your offline copy`)
        );
        console.log(
          chalk.cyan(`The cloud version of this project remains untouched`)
        );
        console.log(
          chalk.gray(
            "All associated files, versions, and history have been removed locally"
          )
        );
      }
    } else {
      console.log(chalk.red(`Failed to delete project: ${deleteResult.error}`));
    }
  } else if (filteredArgs.length === 3) {
    const fileName = filteredArgs[2];

    const envFileResult = dbOps.getEnvFileByName(project.id, fileName);
    if (!envFileResult.success) {
      console.log(
        chalk.red(`File "${fileName}" not found in project "${projectName}"`)
      );
      return;
    }

    const envFile = envFileResult.envFile;

    const deleteLocation = forceFlag
      ? "local database and cloud"
      : "local database only";
    console.log(chalk.yellow(`You are about to delete file "${fileName}"`));

    // Get version count for this file
    const versionsResult = dbOps.getVersionHistory(envFile.id);
    if (versionsResult.success && versionsResult.versions.length > 0) {
      console.log(
        chalk.red(
          `This will delete ${versionsResult.versions.length} version history entries`
        )
      );
    }

    console.log(chalk.yellow("This action cannot be undone!\n"));
    if (forceFlag) {
      console.log(
        chalk.cyan(
          "Note: This will delete the file from both your local device AND the cloud."
        )
      );
      console.log(
        chalk.red("Warning: The cloud version will be permanently lost!")
      );
    } else {
      console.log(
        chalk.cyan(
          "Note: This will only delete the file from your local device."
        )
      );
      console.log(
        chalk.cyan("The cloud version of this file will remain intact.")
      );
    }

    try {
      const confirmationTitle = forceFlag
        ? "Type 'yes' to confirm deletion from local AND cloud:"
        : "Type 'yes' to confirm local deletion:";

      const confirmation = await createSimplePrompt({
        title: confirmationTitle,
        placeholder: "yes",
        width: 50,
        borderColor: "red",
        validateInput: (input) => input.toLowerCase() === "yes",
        errorMessage:
          "Please type 'yes' to confirm deletion or Ctrl+C to cancel",
      });

      if (confirmation.toLowerCase() !== "yes") {
        console.log(chalk.yellow("File deletion cancelled"));
        return;
      }
    } catch (error) {
      console.log(chalk.yellow("\nFile deletion cancelled"));
      return;
    }

    console.log(chalk.blue("\nDeleting file..."));
    const deleteResult = dbOps.deleteEnvFile(envFile.id, currentUser.userId);

    if (deleteResult.success) {
      console.log(
        chalk.green(`File "${fileName}" deleted from project "${projectName}"`)
      );

      // Update the config file to remove the deleted file
      const config = readConfig();
      if (config && config.name === projectName && config.envFiles) {
        const updatedEnvFiles = config.envFiles.filter(
          (file) => file !== fileName
        );
        config.envFiles = updatedEnvFiles;
        const configUpdated = updateConfig(config);
        if (configUpdated) {
          console.log(
            chalk.gray(`Configuration file updated (removed ${fileName})`)
          );
        } else {
          console.log(
            chalk.yellow("Warning: Could not update configuration file")
          );
        }
      }

      if (forceFlag) {
        // Try to delete from cloud when --force is used
        const cloudDeleteResult = await deleteFileFromCloud(
          currentUser.email,
          projectName,
          fileName
        );
        if (cloudDeleteResult.success) {
          console.log(chalk.green(`File "${fileName}" deleted from cloud`));
          console.log(
            chalk.gray(
              "All associated versions and history have been removed from both local and cloud"
            )
          );
        } else {
          if (
            cloudDeleteResult.jwtExpired ||
            cloudDeleteResult.error === "Login to use cloud operations"
          ) {
            console.log(chalk.yellow("Login to use cloud operations"));
          } else {
            console.log(
              chalk.yellow(
                `Warning: Could not delete from cloud (offline?): ${cloudDeleteResult.error}`
              )
            );
            console.log(
              chalk.gray(
                "   File deleted locally but cloud deletion failed. Try again when online."
              )
            );
          }
        }
      } else {
        // Note that the file is only deleted locally
        console.log(
          chalk.cyan(`Note: File is only deleted from your offline copy`)
        );
        console.log(
          chalk.cyan(`The cloud version of this file remains untouched`)
        );
        console.log(
          chalk.gray(
            "All associated versions and history have been removed locally"
          )
        );
      }
    } else {
      console.log(chalk.red(`Failed to delete file: ${deleteResult.error}`));
    }
  } else {
    console.log(chalk.red("Too many arguments"));
    console.log(chalk.yellow("Usage:"));
    console.log(
      chalk.white(
        "  evm rm <project>                    # Remove entire project (local only)"
      )
    );
    console.log(
      chalk.white(
        "  evm rm <project> --force            # Remove entire project (local + cloud)"
      )
    );
    console.log(
      chalk.white(
        "  evm rm <project> <file>             # Remove specific file from project (local only)"
      )
    );
    console.log(
      chalk.white(
        "  evm rm <project> <file> --force     # Remove specific file from project (local + cloud)"
      )
    );
  }
}

module.exports = {
  handleRename,
  handleProjectList,
  handleRemove,
};
