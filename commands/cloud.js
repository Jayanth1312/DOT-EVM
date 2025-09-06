const chalk = require("chalk");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { dbOps, sessionManager } = require("../db");
const {
  decryptContent,
  getStagedFiles,
  saveStagedFiles,
} = require("../env-manager");

// Import delete functions from project.js
const { deleteFileFromCloud } = require("./project");

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
      // Process pending operations first
      console.log(chalk.cyan("Processing pending operations..."));
      const pendingOpsResult = dbOps.getPendingOperations(currentUser.userId);

      if (pendingOpsResult.success && pendingOpsResult.operations.length > 0) {
        console.log(
          chalk.yellow(
            `Found ${pendingOpsResult.operations.length} pending operation(s)`
          )
        );

        for (const operation of pendingOpsResult.operations) {
          try {
            let opSuccess = false;

            if (
              operation.operation_type === "RENAME" &&
              operation.entity_type === "FILE"
            ) {
              console.log(
                chalk.cyan(
                  `Processing file rename: ${operation.old_name} → ${operation.new_name}`
                )
              );

              const operationData = operation.operation_data
                ? JSON.parse(operation.operation_data)
                : {};
              const projectName = operationData.projectName;

              const renameResult = await handleCloudRenameFile(
                { name: projectName, id: operation.project_id },
                operation.old_name,
                operation.new_name
              );

              if (renameResult.success) {
                opSuccess = true;
                console.log(
                  chalk.green(`✓ Pending rename operation completed`)
                );
              } else {
                console.log(
                  chalk.red(
                    `✗ Pending rename operation failed: ${renameResult.error}`
                  )
                );
              }
            } else if (
              operation.operation_type === "RENAME" &&
              operation.entity_type === "PROJECT"
            ) {
              console.log(
                chalk.cyan(
                  `Processing project rename: ${operation.old_name} → ${operation.new_name}`
                )
              );

              const renameResult = await handleCloudRenameProject(
                { name: operation.old_name, id: operation.project_id },
                operation.new_name
              );

              if (renameResult.success) {
                opSuccess = true;
                console.log(chalk.green(`✓ Pending project rename completed`));
              } else {
                console.log(
                  chalk.red(
                    `✗ Pending project rename failed: ${renameResult.error}`
                  )
                );
              }
            } else if (
              operation.operation_type === "DELETE" &&
              operation.entity_type === "FILE"
            ) {
              console.log(
                chalk.cyan(`Processing file deletion: ${operation.old_name}`)
              );

              const operationData = operation.operation_data
                ? JSON.parse(operation.operation_data)
                : {};
              const projectName = operationData.projectName;

              const deleteResult = await deleteFileFromCloud(
                currentUser.email,
                projectName,
                operation.old_name
              );

              if (deleteResult.success) {
                opSuccess = true;
                console.log(chalk.green(`✓ Pending file deletion completed`));
              } else {
                console.log(
                  chalk.red(
                    `✗ Pending file deletion failed: ${deleteResult.error}`
                  )
                );
              }
            } else if (
              operation.operation_type === "SYNC" &&
              operation.entity_type === "FILE"
            ) {
              console.log(
                chalk.cyan(`Processing file sync: ${operation.old_name}`)
              );

              const operationData = operation.operation_data
                ? JSON.parse(operation.operation_data)
                : {};

              // Get the file data
              const envFile = dbOps.getEnvFileById(operation.entity_id);
              if (envFile.success) {
                const syncData = {
                  user_email: currentUser.email,
                  project_name: operationData.projectName,
                  file_name: envFile.envFile.name,
                  encrypted_content: envFile.envFile.encrypted_content,
                  iv: envFile.envFile.iv,
                  tag: envFile.envFile.tag,
                  created_at: envFile.envFile.createdAt,
                  updated_at: envFile.envFile.updatedAt,
                };

                const response = await api.post("/env-files", syncData);

                if (response.data.success) {
                  // Also sync versions if it's from a push operation
                  if (operationData.isPush) {
                    const versionsResult = dbOps.getUnsyncedVersionHistory(
                      envFile.envFile.id
                    );
                    if (
                      versionsResult.success &&
                      versionsResult.versions.length > 0
                    ) {
                      for (const version of versionsResult.versions) {
                        const versionSyncData = {
                          user_email: currentUser.email,
                          project_name: operationData.projectName,
                          file_name: envFile.envFile.name,
                          version_token: version.version_token,
                          encrypted_content: version.encrypted_content,
                          iv: version.iv,
                          tag: version.tag,
                          commit_message:
                            version.commit_message ||
                            operationData.commitMessage,
                          author_email: version.author_email,
                          created_at: version.createdAt,
                        };

                        await api.post("/env-versions", versionSyncData);
                        dbOps.markVersionAsSynced(version.version_token);
                      }
                    }
                  }

                  opSuccess = true;
                  console.log(chalk.green(`✓ Pending file sync completed`));
                } else {
                  console.log(
                    chalk.red(
                      `✗ Pending file sync failed: ${
                        response.data.error || "Unknown error"
                      }`
                    )
                  );
                }
              }
            }

            if (opSuccess) {
              dbOps.markOperationAsProcessed(operation.id);
            }
          } catch (error) {
            console.log(
              chalk.red(`Error processing pending operation: ${error.message}`)
            );
          }
        }

        console.log();
      }

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

async function handlePendingOperations(args) {
  try {
    const currentUser = getCurrentUser();
    const pendingResult = dbOps.getPendingOperations(currentUser.userId);

    if (!pendingResult.success) {
      console.log(
        chalk.red(`Error getting pending operations: ${pendingResult.error}`)
      );
      return;
    }

    if (pendingResult.operations.length === 0) {
      console.log(chalk.green("No pending operations"));
      return;
    }

    console.log(
      chalk.cyan(
        `\nFound ${pendingResult.operations.length} pending operation(s):\n`
      )
    );

    pendingResult.operations.forEach((op, index) => {
      const date = new Date(op.createdAt).toLocaleDateString();
      const type = op.operation_type.toLowerCase();
      const entity = op.entity_type.toLowerCase();

      console.log(chalk.white(`${index + 1}. ${type} ${entity}`));

      if (type === "rename" && op.old_name && op.new_name) {
        console.log(chalk.gray(`   ${op.old_name} → ${op.new_name}`));
      } else if (type === "delete" && op.old_name) {
        console.log(chalk.gray(`   ${op.old_name} (force delete)`));
      } else if (type === "sync" && op.old_name) {
        const operationData = op.operation_data
          ? JSON.parse(op.operation_data)
          : {};
        const label = operationData.isPush ? "push sync" : "regular sync";
        console.log(chalk.gray(`   ${op.old_name} (${label})`));
      }

      console.log(chalk.gray(`   Created: ${date}`));
      console.log();
    });
    console.log(chalk.yellow("Run 'evm sync' to process these operations"));
  } catch (error) {
    console.log(chalk.red(`Error: ${error.message}`));
  }
}

async function handlePull(args) {
  try {
    const currentUser = getCurrentUser();
    const currentProjectResult = dbOps.getCurrentProject(currentUser.userId);

    if (!currentProjectResult.success) {
      console.log(chalk.red("No active project found. Run 'evm init' first."));
      return;
    }

    const project = currentProjectResult.project;
    console.log(chalk.cyan(`Pulling files for project: ${project.name}`));

    // Get user's encryption salt for decryption
    const userSalt = dbOps.getUserEncryptionSalt(currentUser.email);
    if (!userSalt) {
      console.log(chalk.red("Failed to get encryption salt for user"));
      return;
    }

    const api = createAuthenticatedAxios();

    // Get project files from cloud
    const response = await api.get(
      `/projects/${encodeURIComponent(
        project.name
      )}/files?user_email=${encodeURIComponent(currentUser.email)}`
    );

    if (!response.data.success) {
      console.log(chalk.red("Failed to fetch project files from cloud"));
      return;
    }

    const cloudFiles = response.data.files || [];

    if (cloudFiles.length === 0) {
      console.log(chalk.yellow("No files found in cloud for this project"));
      return;
    }

    console.log(chalk.green(`Found ${cloudFiles.length} file(s) in cloud`));

    // Get local files for comparison
    const localFilesResult = dbOps.getEnvFilesByProject(project.id);
    const localFiles = localFilesResult.success
      ? localFilesResult.envFiles
      : [];

    // Create a map of local files for easy lookup
    const localFileMap = new Map();
    localFiles.forEach((file) => {
      localFileMap.set(file.name, file);
    });

    let pulledCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Process each cloud file
    for (const cloudFile of cloudFiles) {
      const { name, encrypted_content, iv, tag, updated_at, versions } =
        cloudFile;
      const localFile = localFileMap.get(name);

      try {
        // Check if file exists locally on filesystem
        const filePath = path.join(process.cwd(), name);
        const fileExistsOnDisk = fs.existsSync(filePath);

        // Decision logic for whether to pull the file
        let shouldPull = false;
        let action = "";

        if (!fileExistsOnDisk && !localFile) {
          // File doesn't exist anywhere locally - pull it
          shouldPull = true;
          action = "pulling new file from cloud";
        } else if (!fileExistsOnDisk && localFile) {
          // File exists in DB but missing from filesystem - restore it
          shouldPull = true;
          action = "restoring missing file from cloud";
        } else if (fileExistsOnDisk && !localFile) {
          // File exists on disk but not in DB - add to database only
          shouldPull = true;
          action = "file exists on disk but not in database, updating database";
        } else if (fileExistsOnDisk && localFile) {
          // File exists both in DB and filesystem - check if cloud is newer
          const cloudUpdateTime = new Date(updated_at);
          const localUpdateTime = new Date(localFile.updated_at);

          if (cloudUpdateTime > localUpdateTime) {
            shouldPull = true;
            action = "cloud version is newer, updating";
          } else {
            // File is up to date, skip it
            console.log(chalk.gray(`⇣ ${name} - local version is up to date`));
            skippedCount++;
            continue;
          }
        }

        // Skip if we don't need to pull
        if (!shouldPull) {
          console.log(chalk.gray(`⇣ ${name} - skipping`));
          skippedCount++;
          continue;
        }

        // Show what we're doing
        console.log(chalk.cyan(`⇣ ${name} - ${action}...`));

        // Decrypt the content with user email and salt
        const decryptedContent = decryptContent(
          encrypted_content,
          iv,
          tag,
          currentUser.email,
          userSalt
        );

        // Write/overwrite the file to disk
        fs.writeFileSync(filePath, decryptedContent, "utf8");

        // Restore complete file with all versions
        const restoreResult = dbOps.restoreFileWithVersions(
          project.id,
          name,
          {
            encrypted_content,
            iv,
            tag,
            current_version_id: cloudFile.current_version_id,
          },
          cloudFile.versions || []
        );

        if (!restoreResult.success) {
          console.log(
            chalk.red(
              `⇣ ${name} - failed to restore to database: ${restoreResult.error}`
            )
          );
          // Remove the file from disk if DB operation failed
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          errorCount++;
          continue;
        }

        // Remove file from staging area if it exists
        try {
          const stagedFiles = getStagedFiles();
          if (stagedFiles[name]) {
            delete stagedFiles[name];
            saveStagedFiles(stagedFiles);
            console.log(chalk.gray(`⇣ ${name} - removed from staging area`));
          }
        } catch (error) {
          // Ignore staging area errors
        }

        console.log(
          chalk.green(
            `⇣ ${name} - restored with ${
              cloudFile.versions?.length || 0
            } version(s)`
          )
        );
        pulledCount++;
      } catch (error) {
        console.log(chalk.red(`⇣ ${name} - error: ${error.message}`));
        errorCount++;
      }
    }

    // Summary
    console.log(chalk.cyan(`\nPull complete:`));
    if (pulledCount > 0) {
      console.log(
        chalk.green(`  ✓ ${pulledCount} file(s) pulled successfully`)
      );
    }
    if (skippedCount > 0) {
      console.log(chalk.gray(`  - ${skippedCount} file(s) already up to date`));
    }
    if (errorCount > 0) {
      console.log(chalk.red(`  ✗ ${errorCount} file(s) failed to pull`));
    }
  } catch (error) {
    const errorMsg = error.response?.data?.error || error.message;
    console.log(chalk.red(`Failed to pull files: ${errorMsg}`));

    // Check for JWT expiration
    if (error.response?.status === 401 || errorMsg.includes("Token expired")) {
      console.log(chalk.yellow("Please login again: evm login"));
    } else if (error.code === "ECONNREFUSED") {
      console.log(
        chalk.yellow("Make sure the server is running on localhost:4000")
      );
    }
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
      projectName: project.name,
    };

    const response = await api.put(`/projects/rename`, requestData);

    if (response.data.success) {
      console.log(
        chalk.green(`Cloud project renamed: ${response.data.message}`)
      );
      return { success: true, data: response.data };
    } else {
      console.log(chalk.red(`Cloud rename failed: ${response.data.error}`));
      return { success: false, error: response.data.error };
    }
  } catch (error) {
    const errorMsg = error.response?.data?.error || error.message;
    console.log(chalk.red(`Could not rename project in cloud: ${errorMsg}`));

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
      oldFileName: oldFileName,
      newFileName: newFileName,
    };

    if (project.cloud_project_id) {
      requestData.cloudProjectId = project.cloud_project_id;
    } else {
      requestData.projectName = project.name;
    }

    const response = await api.put(`/env-files/rename`, requestData);

    if (response.data.success) {
      console.log(chalk.green(`Cloud file renamed: ${response.data.message}`));
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
  handlePendingOperations,
  handlePull,
  handleClone,
  handleCloudRenameProject,
  handleCloudRenameFile,
};
