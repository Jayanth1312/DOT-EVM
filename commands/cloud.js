const chalk = require("chalk");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { dbOps, sessionManager } = require("../db");
const { decryptContent } = require("../env-manager");

// Get current user session with token
const getCurrentUser = () => {
  const session = sessionManager.getCurrentUser();
  if (!session) {
    throw new Error("Not logged in. Please run 'evm login' first.");
  }
  return session;
};

// Create axios instance with JWT authentication
const createAuthenticatedAxios = () => {
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
};

// Hash content for integrity checking
const hashContent = (content) => {
  return crypto.createHash("sha256").update(content).digest("hex");
};

async function handleSync(args) {
  try {
    const currentUser = getCurrentUser();

    const currentProjectResult = dbOps.getCurrentProject(currentUser.userId);

    if (!currentProjectResult.success) {
      console.log(chalk.red("No active project found. Run 'evm init' first."));
      return;
    }

    const project = currentProjectResult.project;

    if (!project) {
      console.log(chalk.yellow("No local projects found"));
      console.log(chalk.cyan("Checking for projects in 1cloud..."));

      try {
        const api = createAuthenticatedAxios();
        const response = await api.get(
          `/projects?user_email=${encodeURIComponent(currentUser.email)}`
        );

        if (
          response.data.success &&
          response.data.projects &&
          response.data.projects.length > 0
        ) {
          console.log(
            chalk.green(
              `Found ${response.data.projects.length} project(s) in cloud!`
            )
          );
          console.log(chalk.yellow("\nAvailable options:"));
          console.log(
            chalk.white(
              "   1. Use 'evm pull' to download all projects from cloud"
            )
          );
          console.log(
            chalk.white(
              "   2. Use 'evm clone <project-name>' to download a specific project"
            )
          );
          console.log(
            chalk.white(
              "   3. Create new local projects with 'evm init <project-name>'"
            )
          );

          console.log(chalk.cyan("\nProjects available in cloud:"));
          response.data.projects.forEach((project) => {
            const updatedDate = new Date(
              project.updated_at
            ).toLocaleDateString();
            console.log(
              chalk.gray(`   • ${project.name} (last updated: ${updatedDate})`)
            );
          });

          return;
        } else {
          console.log(chalk.gray("No projects found in cloud either"));
          console.log(
            chalk.yellow(
              "Create your first project with 'evm init <project-name>'"
            )
          );
          return;
        }
      } catch (cloudError) {
        console.log(chalk.yellow("Could not check cloud projects"));
        console.log(
          chalk.gray(
            "Create a new project with 'evm init <project-name>' to start syncing"
          )
        );
        return;
      }
    }

    const api = createAuthenticatedAxios();

    try {
      const envFilesResult = dbOps.getEnvFilesByProject(project.id);

      if (!envFilesResult.success) {
        console.log(
          chalk.red(`Failed to get env files: ${envFilesResult.error}`)
        );
        return;
      }

      const envFiles = envFilesResult.envFiles;

      if (envFiles.length === 0) {
        console.log(
          chalk.gray(`No environment files in project ${project.name}`)
        );
        return;
      }

      for (const envFile of envFiles) {
        try {
          const syncData = {
            user_email: currentUser.email,
            project_name: project.name,
            file_name: envFile.name,
            encrypted_content: envFile.encrypted_content,
            iv: envFile.iv,
            tag: envFile.tag,
            created_at: envFile.createdAt,
            updated_at: envFile.updatedAt,
          };

          const response = await api.post("/env-files", syncData);

          if (response.data.success) {
            await new Promise((resolve) => setTimeout(resolve, 100));

            const { dbOps } = require("../db");
            const versionsResult = dbOps.getUnsyncedVersionHistory(envFile.id);

            if (versionsResult.success && versionsResult.versions.length > 0) {
              console.log(
                chalk.cyan(
                  `Syncing ${versionsResult.versions.length} unsynced version(s) for ${envFile.name}`
                )
              );

              let versionSyncedCount = 0;
              let versionErrorCount = 0;

              for (const version of versionsResult.versions) {
                try {
                  const versionSyncData = {
                    user_email: currentUser.email,
                    project_name: project.name,
                    file_name: envFile.name,
                    version_token: version.version_token,
                    encrypted_content: version.encrypted_content,
                    iv: version.iv,
                    tag: version.tag,
                    commit_message: version.commit_message,
                    author_email: version.author_email,
                    created_at: version.createdAt,
                  };

                  const versionResponse = await api.post(
                    "/env-versions",
                    versionSyncData
                  );

                  if (versionResponse.data.success) {
                    const markSyncResult = dbOps.markVersionAsSynced(
                      version.version_token
                    );
                    versionSyncedCount++;
                  } else {
                    console.log(
                      chalk.yellow(
                        `⚠ Version sync failed: ${versionResponse.data.error}`
                      )
                    );
                    versionErrorCount++;
                  }
                } catch (versionSyncError) {
                  const errorMsg =
                    versionSyncError.response?.data?.error ||
                    versionSyncError.message;
                  console.log(
                    chalk.yellow(
                      `⚠ Could not sync version ${version.version_token}: ${errorMsg}`
                    )
                  );
                  // Check for JWT expiration
                  if (
                    versionSyncError.response?.status === 401 ||
                    errorMsg.includes("Token expired")
                  ) {
                    console.log(chalk.yellow("Login to use cloud operations"));
                  }
                  versionErrorCount++;
                }
              }

              if (versionSyncedCount > 0) {
                console.log(
                  chalk.green(
                    `✓ Successfully synced ${versionSyncedCount}/${versionsResult.versions.length} new versions`
                  )
                );
              }
              if (versionErrorCount > 0) {
                console.log(
                  chalk.yellow(
                    `    ⚠ Failed to sync ${versionErrorCount} versions`
                  )
                );
              }
            } else {
              console.log(
                chalk.gray(
                  `✓ All versions for ${envFile.name} are already synced`
                )
              );
            }

            // Now sync rollback history for this file
            const rollbackResult = dbOps.getUnsyncedRollbackHistory(envFile.id);

            if (rollbackResult.success && rollbackResult.rollbacks.length > 0) {
              console.log(
                chalk.cyan(
                  `Syncing ${rollbackResult.rollbacks.length} unsynced rollback(s) for ${envFile.name}`
                )
              );

              let rollbackSyncedCount = 0;
              let rollbackErrorCount = 0;

              for (const rollback of rollbackResult.rollbacks) {
                try {
                  const rollbackSyncData = {
                    user_email: currentUser.email,
                    project_name: project.name,
                    file_name: envFile.name,
                    from_version_token: rollback.from_version_token,
                    to_version_token: rollback.to_version_token,
                    reason: rollback.rollback_reason,
                    performed_by: rollback.performed_by,
                    created_at: rollback.createdAt,
                  };

                  const rollbackResponse = await api.post(
                    "/rollback-history",
                    rollbackSyncData
                  );

                  if (rollbackResponse.data.success) {
                    const markRollbackSyncResult = dbOps.markRollbackAsSynced(
                      rollback.id
                    );
                    rollbackSyncedCount++;
                  } else {
                    console.log(
                      chalk.yellow(
                        `⚠ Rollback sync failed: ${rollbackResponse.data.error}`
                      )
                    );
                    rollbackErrorCount++;
                  }
                } catch (rollbackSyncError) {
                  const errorMsg =
                    rollbackSyncError.response?.data?.error ||
                    rollbackSyncError.message;
                  console.log(
                    chalk.yellow(
                      `⚠ Could not sync rollback ${rollback.id}: ${errorMsg}`
                    )
                  );
                  // Check for JWT expiration
                  if (
                    rollbackSyncError.response?.status === 401 ||
                    errorMsg.includes("Token expired")
                  ) {
                    console.log(chalk.yellow("Login to use cloud operations"));
                  }
                  rollbackErrorCount++;
                }
              }

              if (rollbackSyncedCount > 0) {
                console.log(
                  chalk.green(
                    `✓ Successfully synced ${rollbackSyncedCount}/${rollbackResult.rollbacks.length} rollback entries`
                  )
                );
              }
              if (rollbackErrorCount > 0) {
                console.log(
                  chalk.yellow(
                    `    ⚠ Failed to sync ${rollbackErrorCount} rollback entries`
                  )
                );
              }
            } else {
              console.log(
                chalk.gray(
                  `✓ All rollback history for ${envFile.name} is already synced`
                )
              );
            }
          } else {
            console.log(
              chalk.red(
                `Sync failed: ${response.data.error || "Unknown error"}`
              )
            );
          }
        } catch (fileError) {
          console.log(chalk.red(`File sync error: ${fileError.message}`));
        }
      }
    } catch (projectError) {
      console.log(chalk.red(`Project sync error: ${projectError.message}`));
    }
  } catch (error) {
    console.log(chalk.red(`Sync failed: ${error.message}`));

    if (error.message.includes("Not logged in")) {
      console.log(chalk.yellow("Run 'evm login' to authenticate first"));
    } else if (
      error.response?.status === 401 ||
      error.message.includes("Token expired") ||
      error.message.includes("No valid token found")
    ) {
      console.log(chalk.yellow("Login to use cloud operations"));
    } else if (error.code === "ECONNREFUSED") {
      console.log(
        chalk.yellow("Make sure the server is running on localhost:4000")
      );
      console.log(
        chalk.gray("   Start server: cd evm-server && node server.js")
      );
    }
  }
}

async function handlePull(args) {
  console.log(chalk.blue("⬇ Pull from Cloud - Coming Soon!"));
  console.log(
    chalk.gray("This feature will pull the latest changes from the cloud.")
  );
  console.log(chalk.yellow("\nPlanned pull features:"));
  console.log(chalk.white("  • Pull specific projects"));
  console.log(chalk.white("  • Pull all projects"));
  console.log(chalk.white("  • Pull with conflict detection"));
  console.log(chalk.white("  • Pull dry-run (preview changes)"));

  if (args.length > 0) {
    console.log(chalk.gray(`\nReceived args: ${args.join(", ")}`));
  }
}

async function handleClone(args) {
  console.log(chalk.blue("Clone from Cloud - Coming Soon!"));
  console.log(chalk.gray("This feature will clone projects from the cloud."));
  console.log(chalk.yellow("\nPlanned clone features:"));
  console.log(chalk.white("  • Clone public projects"));
  console.log(chalk.white("  • Clone shared team projects"));
  console.log(chalk.white("  • Clone with specific permissions"));
  console.log(chalk.white("  • Clone to custom local name"));

  if (args.length > 0) {
    console.log(chalk.gray(`\nReceived args: ${args.join(", ")}`));
  }
}

// Cloud rename project function
async function handleCloudRenameProject(project, newName) {
  try {
    const currentUser = getCurrentUser();
    const api = createAuthenticatedAxios();

    const requestData = {
      newName: newName,
      projectName: project.name, // Always send the project name
    };

    console.log(
      chalk.blue(
        `[DEBUG CLIENT] Renaming project "${project.name}" to "${newName}"`
      )
    );

    const response = await api.put(`/projects/rename`, requestData);

    if (response.data.success) {
      console.log(
        chalk.green(`☁️  Cloud project renamed: ${response.data.message}`)
      );
      return { success: true, data: response.data };
    } else {
      console.log(chalk.red(`☁️  Cloud rename failed: ${response.data.error}`));
      return { success: false, error: response.data.error };
    }
  } catch (error) {
    const errorMsg = error.response?.data?.error || error.message;
    console.log(
      chalk.red(`☁️  Could not rename project in cloud: ${errorMsg}`)
    );

    // Check for JWT expiration
    if (error.response?.status === 401 || errorMsg.includes("Token expired")) {
      console.log(chalk.yellow("Login to use cloud operations"));
    } else if (error.code === "ECONNREFUSED") {
      console.log(
        chalk.yellow("Make sure the server is running on localhost:4000")
      );
    }

    return { success: false, error: errorMsg };
  }
}

// Cloud rename env file function
async function handleCloudRenameFile(project, oldFileName, newFileName) {
  try {
    const currentUser = getCurrentUser();
    const api = createAuthenticatedAxios();

    const requestData = {
      projectName: project.name,
      oldFileName: oldFileName,
      newFileName: newFileName,
    };

    console.log(
      // chalk.blue(
      //   `[DEBUG CLIENT FILE] Sending request data:`,
      //   JSON.stringify(requestData)
      // )
    );

    const response = await api.put(`/env-files/rename`, requestData);

    if (response.data.success) {
      console.log(
        chalk.green(`Cloud file renamed: ${response.data.message}`)
      );
      return { success: true, data: response.data };
    } else {
      console.log(chalk.red(`Cloud rename failed: ${response.data.error}`));
      return { success: false, error: response.data.error };
    }
  } catch (error) {
    const errorMsg = error.response?.data?.error || error.message;
    console.log(chalk.red(`Could not rename file in cloud: ${errorMsg}`));

    // Check for JWT expiration
    if (error.response?.status === 401 || errorMsg.includes("Token expired")) {
      console.log(chalk.yellow("Login to use cloud operations"));
    } else if (error.code === "ECONNREFUSED") {
      console.log(
        chalk.yellow("Make sure the server is running on localhost:4000")
      );
    }

    return { success: false, error: errorMsg };
  }
}

module.exports = {
  handleSync,
  handlePull,
  handleClone,
  handleCloudRenameProject,
  handleCloudRenameFile,
};
