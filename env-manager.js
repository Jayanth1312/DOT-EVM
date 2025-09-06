const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const { createTextBox } = require("./components/text-input");
const { dbOps, sessionManager } = require("./db");
const { configManager } = require("./config");
const chalk = require("chalk");

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;

async function checkServerConnectivity() {
  try {
    await axios.get(`${configManager.getServerUrl()}/health`, {
      timeout: 3000,
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function syncToCloud(fileData, userEmail) {
  try {
    const response = await axios.post(
      `${configManager.getServerUrl()}/env-files`,
      {
        user_email: userEmail,
        project_name: fileData.projectName,
        file_name: fileData.fileName,
        file_content: fileData.encryptedContent,
        file_hash: fileData.versionToken,
      },
      { timeout: 10000 }
    );

    return { success: true, cloudId: response.data.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function generateEncryptionKey(userEmail, userSalt) {
  if (!userSalt) {
    // Get user's salt from database
    userSalt = dbOps.getUserEncryptionSalt(userEmail);
    if (!userSalt) {
      throw new Error(`No encryption salt found for user: ${userEmail}`);
    }
  }
  return crypto.pbkdf2Sync(userEmail, userSalt, 100000, KEY_LENGTH, "sha256");
}

function encryptContent(content, userEmail, userSalt = null) {
  try {
    const key = generateEncryptionKey(userEmail, userSalt);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(userEmail));

    let encrypted = cipher.update(content, "utf8", "hex");
    encrypted += cipher.final("hex");

    const tag = cipher.getAuthTag();

    return {
      encryptedContent: encrypted,
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
    };
  } catch (error) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

async function scanEnvFiles(directory = process.cwd()) {
  try {
    const files = fs.readdirSync(directory);
    const envFiles = files.filter(
      (file) =>
        file.startsWith(".env") || file === ".env" || file.includes(".env.")
    );

    return envFiles.map((file) => ({
      name: file,
      path: path.join(directory, file),
      size: fs.statSync(path.join(directory, file)).size,
    }));
  } catch (error) {
    console.log("Error scanning directory:", error.message);
    return [];
  }
}

async function hasFileChanged(projectId, fileName, currentContent, userEmail) {
  try {
    const existingFile = dbOps.getEnvFileByProjectAndName(projectId, fileName);

    if (!existingFile.success) {
      return true;
    }

    // Get the latest version to compare
    const versions = dbOps.getEnvVersionsByFile(existingFile.envFile.id);
    if (!versions.success || versions.versions.length === 0) {
      return true;
    }

    // Decrypt the latest version and compare
    const latestVersion = versions.versions[0];
    const userSalt = dbOps.getUserEncryptionSalt(userEmail);
    const decryptedContent = decryptContent(
      latestVersion.encrypted_content,
      latestVersion.iv,
      latestVersion.tag,
      userEmail,
      userSalt
    );

    return currentContent !== decryptedContent;
  } catch (error) {
    return true;
  }
}

function decryptContent(encryptedContent, iv, tag, userEmail, userSalt = null) {
  try {
    const key = generateEncryptionKey(userEmail, userSalt);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "hex")
    );
    decipher.setAAD(Buffer.from(userEmail));
    decipher.setAuthTag(Buffer.from(tag, "hex"));

    let decrypted = decipher.update(encryptedContent, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

function saveStagedFiles(stagedFiles) {
  const stagingPath = configManager.getProjectStagingPath();
  fs.writeFileSync(stagingPath, JSON.stringify(stagedFiles, null, 2));
}

function loadStagedFiles() {
  const stagingPath = configManager.getProjectStagingPath();
  if (!fs.existsSync(stagingPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(stagingPath, "utf8"));
  } catch (error) {
    return null;
  }
}

function clearStagingArea() {
  const stagingPath = configManager.getProjectStagingPath();
  if (fs.existsSync(stagingPath)) {
    fs.unlinkSync(stagingPath);
  }
}

async function promptCommitMessage() {
  return new Promise(async (resolve) => {
    let hasResolved = false;
    const ReactModule = await import("react");
    const React = ReactModule.default || ReactModule;
    const ink = await import("ink");
    const TextInputModule = await import("ink-text-input");
    const TextInput = TextInputModule.default || TextInputModule;

    const { render, Box, Text } = ink;
    const { useState } = React;

    const App = ({ onSubmit }) => {
      const [inputValue, setInputValue] = useState("");

      const submit = () => {
        if (!hasResolved) {
          hasResolved = true;
          onSubmit(inputValue.trim() || "Updated environment files");
        }
      };

      return React.createElement(
        Box,
        { flexDirection: "column" },

        createTextBox(React, Text, Box, TextInput, {
          width: 60,
          placeholder: "Enter commit message (optional)",
          value: inputValue,
          onChange: setInputValue,
          onSubmit: submit,
          borderColor: "gray",
          isActive: true,
        }),

        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(
            Text,
            { color: "gray" },
            "Enter to submit commit message"
          )
        )
      );
    };

    const instance = render(
      React.createElement(App, {
        onSubmit: (commitMessage) => {
          try {
            instance.unmount();
            resolve(commitMessage);
          } catch (error) {
            if (!hasResolved) {
              hasResolved = true;
              resolve(commitMessage);
            }
          }
        },
      })
    );
  });
}

async function promptFileSelectionAndCommit(envFiles) {
  return new Promise(async (resolve) => {
    let hasResolved = false;
    const ReactModule = await import("react");
    const React = ReactModule.default || ReactModule;
    const ink = await import("ink");
    const TextInputModule = await import("ink-text-input");
    const TextInput = TextInputModule.default || TextInputModule;

    const { render, Box, Text } = ink;
    const { useState } = React;

    const App = ({ onSubmit }) => {
      const [inputValue, setInputValue] = useState("");
      const [currentStep, setCurrentStep] = useState("fileSelection");
      const [collectedData, setCollectedData] = useState({});

      const getCurrentPlaceholder = () => {
        switch (currentStep) {
          case "fileSelection":
            return "Enter file numbers (e.g., 1,2,3 or 'all' or '.')";
          case "commitMessage":
            return "Enter commit message (optional)";
          default:
            return "Enter file numbers";
        }
      };

      const validateFileSelection = (value) => {
        if (value.toLowerCase() === "all" || value === ".") return true;
        const nums = value.split(",").map((n) => parseInt(n.trim()));
        return nums.every((num) => num >= 1 && num <= envFiles.length);
      };

      const submit = () => {
        const trimmedValue = inputValue.trim();

        if (currentStep === "fileSelection") {
          if (!trimmedValue || !validateFileSelection(trimmedValue)) {
            return;
          }
          setCollectedData({ ...collectedData, fileSelection: trimmedValue });
          setCurrentStep("commitMessage");
          setInputValue("");
          return;
        }

        if (currentStep === "commitMessage") {
          const finalData = {
            fileSelection: collectedData.fileSelection,
            commitMessage: trimmedValue,
          };
          if (!hasResolved) {
            hasResolved = true;
            onSubmit(finalData);
          }
          return;
        }
      };

      return React.createElement(
        Box,
        { flexDirection: "column" },

        createTextBox(React, Text, Box, TextInput, {
          width: 60,
          placeholder: getCurrentPlaceholder(),
          value: inputValue,
          onChange: setInputValue,
          onSubmit: submit,
          borderColor: "gray",
          isActive: true,
        }),

        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(
            Text,
            { color: "gray" },
            currentStep === "fileSelection"
              ? "Step 1/2: Select files, Enter to continue"
              : "Step 2/2: Commit message, Enter to submit"
          )
        )
      );
    };

    const instance = render(
      React.createElement(App, {
        onSubmit: (data) => {
          try {
            instance.unmount();
            resolve(data);
          } catch (error) {
            if (!hasResolved) {
              hasResolved = true;
              resolve(data);
            }
          }
        },
      })
    );
  });
}

async function selectProject(userId) {
  const projectsResult = dbOps.getProjectsByUser(userId);

  if (!projectsResult.success || projectsResult.projects.length === 0) {
    console.log("No projects found. Run 'evm init' to create a project first.");
    process.exit(1);
  }

  if (projectsResult.projects.length === 1) {
    console.log(`Using project: ${projectsResult.projects[0].name}`);
    return projectsResult.projects[0];
  }

  console.log("Select a project:");
  projectsResult.projects.forEach((project, index) => {
    console.log(`  ${index + 1}. ${project.name} (${project.directory_path})`);
  });

  return new Promise(async (resolve) => {
    let hasResolved = false;
    const ReactModule = await import("react");
    const React = ReactModule.default || ReactModule;
    const ink = await import("ink");
    const TextInputModule = await import("ink-text-input");
    const TextInput = TextInputModule.default || TextInputModule;

    const { render, Box, Text } = ink;
    const { useState } = React;

    const App = ({ onSubmit }) => {
      const [inputValue, setInputValue] = useState("");

      const submit = () => {
        const num = parseInt(inputValue.trim());
        if (num >= 1 && num <= projectsResult.projects.length) {
          if (!hasResolved) {
            hasResolved = true;
            onSubmit(projectsResult.projects[num - 1]);
          }
        }
      };

      return React.createElement(
        Box,
        { flexDirection: "column" },

        createTextBox(React, Text, Box, TextInput, {
          width: 30,
          placeholder: "Enter project number",
          value: inputValue,
          onChange: setInputValue,
          onSubmit: submit,
          borderColor: "gray",
          isActive: true,
        }),

        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(
            Text,
            { color: "gray" },
            "Enter to select project"
          )
        )
      );
    };

    const instance = render(
      React.createElement(App, {
        onSubmit: (project) => {
          try {
            instance.unmount();
            resolve(project);
          } catch (error) {
            if (!hasResolved) {
              hasResolved = true;
              resolve(project);
            }
          }
        },
      })
    );
  });
}

async function addEnvFiles(args = []) {
  console.log("Staging environment files for EVM...\n");

  try {
    if (!dbOps.isLoggedIn()) {
      console.log("You must be logged in. Run 'evm login' first.");
      process.exit(1);
    }

    const currentUser = dbOps.getCurrentUser();

    const currentProjectResult = dbOps.getCurrentProject(currentUser.userId);
    let project;

    if (currentProjectResult.success) {
      project = currentProjectResult.project;
      console.log(
        chalk.green(
          `✓ Using project: ${project.name} (${project.directory_path})`
        )
      );
    } else {
      console.log(
        chalk.yellow(
          "No project found in current directory. Please select a project:"
        )
      );
      project = await selectProject(currentUser.userId);
    }
    const envFiles = await scanEnvFiles();

    if (envFiles.length === 0) {
      console.log("No .env files found in current directory.");
      console.log("Create .env files first, then run 'evm add' again.");
      process.exit(0);
    }

    const changedFiles = [];
    for (const file of envFiles) {
      const content = fs.readFileSync(file.path, "utf8");
      const hasChanged = await hasFileChanged(
        project.id,
        file.name,
        content,
        currentUser.email
      );

      if (hasChanged) {
        changedFiles.push({ ...file, content });
      }
    }

    if (changedFiles.length === 0) {
      console.log("No changes detected in environment files.");
      console.log("All files are up to date. Nothing to stage.");
      process.exit(0);
    }

    console.log("Found changed environment files:");
    changedFiles.forEach((file, index) => {
      console.log(`${index + 1}. [ ${file.name} ]`);
    });
    console.log();

    let fileSelection, commitMessage;
    if (args.includes(".")) {
      console.log(chalk.cyan("Auto-staging all changed files..."));
      fileSelection = "all";
      commitMessage = await promptCommitMessage();
    } else {
      const result = await promptFileSelectionAndCommit(changedFiles);
      fileSelection = result.fileSelection;
      commitMessage = result.commitMessage;
    }

    let selectedFiles;
    if (fileSelection.toLowerCase() === "all" || fileSelection === ".") {
      selectedFiles = changedFiles;
    } else {
      const indices = fileSelection
        .split(",")
        .map((n) => parseInt(n.trim()) - 1);
      selectedFiles = indices.map((i) => changedFiles[i]);
    }

    const stagedData = {
      projectId: project.id,
      projectName: project.name,
      userEmail: currentUser.email,
      commitMessage: commitMessage || "Updated environment files",
      files: selectedFiles.map((file) => ({
        name: file.name,
        path: file.path,
        content: file.content,
        size: file.size,
      })),
      stagedAt: new Date().toISOString(),
    };

    saveStagedFiles(stagedData);

    console.log("\nStaged for commit:");
    selectedFiles.forEach((file) => {
      console.log(`  ${file.name} (${file.size} bytes)`);
    });

    console.log(`\n${selectedFiles.length} file(s) staged successfully!`);
    console.log("Use 'evm push' to commit these changes to the database.");
  } catch (error) {
    console.log("Staging operation failed:", error.message);
    process.exit(1);
  }
}

function createAuthenticatedAxios() {
  const session = sessionManager.getCurrentUser();
  if (!session?.token) {
    throw new Error("No valid token found. Please login again.");
  }

  return axios.create({
    baseURL: configManager.getServerUrl(),
    timeout: 10000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
  });
}

// Sync only specific files that were just pushed
async function syncSpecificFiles(projectId, pushedFiles) {
  try {
    const currentUser = sessionManager.getCurrentUser();
    if (!currentUser) {
      throw new Error("Not logged in");
    }

    // Get project info
    const project = dbOps.getProjectById(projectId);
    if (!project.success) {
      throw new Error("Project not found");
    }

    const api = createAuthenticatedAxios();

    for (const pushedFile of pushedFiles) {
      // Get the env file record from database
      const envFile = dbOps.getEnvFileByProjectAndName(
        projectId,
        pushedFile.name
      );
      if (!envFile.success) {
        continue;
      }

      // Sync the env file to server
      const syncData = {
        user_email: currentUser.email,
        project_name: project.project.name,
        file_name: envFile.envFile.name,
        encrypted_content: envFile.envFile.encrypted_content,
        iv: envFile.envFile.iv,
        tag: envFile.envFile.tag,
        created_at: envFile.envFile.createdAt,
        updated_at: envFile.envFile.updatedAt,
      };

      await api.post("/env-files", syncData);

      // Sync only unsynced versions for this specific file
      const versionsResult = dbOps.getUnsyncedVersionHistory(
        envFile.envFile.id
      );
      if (versionsResult.success && versionsResult.versions.length > 0) {
        console.log(
          chalk.cyan(
            `Syncing ${versionsResult.versions.length} unsynced version(s) for ${envFile.envFile.name}`
          )
        );

        for (const version of versionsResult.versions) {
          const versionSyncData = {
            user_email: currentUser.email,
            project_name: project.project.name,
            file_name: envFile.envFile.name,
            version_token: version.version_token,
            encrypted_content: version.encrypted_content,
            iv: version.iv,
            tag: version.tag,
            commit_message: version.commit_message,
            author_email: version.author_email,
            created_at: version.createdAt,
          };

          await api.post("/env-versions", versionSyncData);
          dbOps.markVersionAsSynced(version.version_token);
        }

        console
          .log
          // chalk.green(
          //   `✓ Successfully synced ${versionsResult.versions.length} new versions for ${envFile.envFile.name}`
          // )
          ();
      }

      // Sync rollback history for this specific file
      const rollbackResult = dbOps.getUnsyncedRollbackHistory(
        envFile.envFile.id
      );
      if (rollbackResult.success && rollbackResult.rollbacks.length > 0) {
        console.log(
          chalk.cyan(
            `Syncing ${rollbackResult.rollbacks.length} unsynced rollback(s) for ${envFile.envFile.name}`
          )
        );

        for (const rollback of rollbackResult.rollbacks) {
          const rollbackSyncData = {
            user_email: currentUser.email,
            project_name: project.project.name,
            file_name: envFile.envFile.name,
            from_version_token: rollback.from_version_token,
            to_version_token: rollback.to_version_token,
            reason: rollback.rollback_reason,
            performed_by: rollback.performed_by,
            created_at: rollback.createdAt,
          };

          await api.post("/rollback-history", rollbackSyncData);
          dbOps.markRollbackAsSynced(rollback.id);
        }

        console.log(
          chalk.green(
            `✓ Successfully synced ${rollbackResult.rollbacks.length} rollback history entries for ${envFile.envFile.name}`
          )
        );
      }
    }
  } catch (error) {
    throw new Error(`Sync failed: ${error.message}`);
  }
}

async function pushStagedFiles() {
  console.log("Pushing staged files...\n");

  try {
    if (!dbOps.isLoggedIn()) {
      console.log("You must be logged in. Run 'evm login' first.");
      process.exit(1);
    }

    const stagedData = loadStagedFiles();
    if (!stagedData) {
      console.log("No staged files found.");
      console.log("Use 'evm add' to stage files first.");
      process.exit(0);
    }

    console.log(`Found ${stagedData.files.length} staged file(s):`);
    stagedData.files.forEach((file) => {
      console.log(`  ${file.name} (${file.size} bytes)`);
    });
    console.log();

    let successCount = 0;

    // Check if this is a revert - if so, skip version creation
    if (stagedData.isRevert) {
      console.log(
        chalk.cyan("Detected revert staging - skipping local version creation")
      );
      successCount = stagedData.files.length;
    } else {
      for (const file of stagedData.files) {
        try {
          const encrypted = encryptContent(file.content, stagedData.userEmail);
          const versionToken = dbOps.generateVersionToken();

          const envFileResult = dbOps.createOrUpdateEnvFile(
            stagedData.projectId,
            file.name,
            encrypted.encryptedContent,
            encrypted.iv,
            encrypted.tag
          );

          if (envFileResult.success) {
            const versionResult = dbOps.createEnvVersion(
              envFileResult.envFileId,
              versionToken,
              encrypted.encryptedContent,
              encrypted.iv,
              encrypted.tag,
              stagedData.commitMessage,
              stagedData.userEmail
            );

            if (versionResult.success) {
              successCount++;
            } else {
              console.log(`Failed to create version for ${file.name}`);
            }
          } else {
            console.log(`Failed to commit ${file.name}`);
          }
        } catch (error) {
          console.log(`Error processing ${file.name}: ${error.message}`);
        }
      }
    }

    clearStagingArea();

    console.log();

    try {
      // Only sync the files that were just pushed, not all files
      await syncSpecificFiles(stagedData.projectId, stagedData.files);

      console.log(
        chalk.green.bold("✓ Files pushed locally and synced to cloud")
      );
    } catch (syncError) {
      console.log(
        chalk.yellow("\nLocal push successful, but cloud sync failed:")
      );
      console.log(chalk.gray(`   Error: ${syncError.message}`));
      // Check for JWT expiration
      if (
        syncError.response?.status === 401 ||
        syncError.message.includes("Token expired") ||
        syncError.message.includes("No valid token found")
      ) {
        console.log(chalk.yellow("Login to use cloud operations"));
      }
      console.log(
        chalk.cyan("   You can manually sync later using 'evm sync'")
      );
    }

    console.log("Use 'evm log' to view version history");
  } catch (error) {
    console.log("Push operation failed:", error.message);
    process.exit(1);
  }
}

async function syncPendingFiles() {
  console.log("Syncing pending files to cloud...\n");

  try {
    if (!dbOps.isLoggedIn()) {
      console.log("You must be logged in. Run 'evm login' first.");
      process.exit(1);
    }

    // Check server connectivity
    const isOnline = await checkServerConnectivity();
    if (!isOnline) {
      console.log("Server is not available. Cannot sync to cloud.");
      console.log("Please check your internet connection and server status.");
      process.exit(1);
    }

    const currentUser = dbOps.getCurrentUser();
    const projects = dbOps.getProjectsByUser(currentUser.userId);

    if (!projects.success || projects.projects.length === 0) {
      console.log("No projects found to sync.");
      process.exit(0);
    }

    let totalSynced = 0;
    let totalFailed = 0;

    for (const project of projects.projects) {
      const envFiles = dbOps.getEnvFilesByProject(project.id);

      if (
        envFiles.success &&
        envFiles.envFiles &&
        envFiles.envFiles.length > 0
      ) {
        console.log(`Project: ${project.name}`);

        for (const envFile of envFiles.envFiles) {
          try {
            const versions = dbOps.getEnvVersionsByFile(envFile.id);

            if (versions.success && versions.versions.length > 0) {
              const latestVersion = versions.versions[0];

              const cloudSync = await syncToCloud(
                {
                  projectName: project.name,
                  fileName: envFile.name,
                  encryptedContent: envFile.encrypted_content,
                  versionToken: latestVersion.version_token,
                },
                currentUser.email
              );

              if (cloudSync.success) {
                console.log(`${envFile.name} synced to cloud`);
                totalSynced++;
              } else {
                console.log(`${envFile.name} sync failed: ${cloudSync.error}`);
                // Check for JWT expiration
                if (
                  cloudSync.error &&
                  (cloudSync.error.includes("Token expired") ||
                    cloudSync.error.includes("401"))
                ) {
                  console.log(chalk.yellow("Login to use cloud operations"));
                }
                totalFailed++;
              }
            }
          } catch (error) {
            console.log(`${envFile.name} sync error: ${error.message}`);
            // Check for JWT expiration
            if (
              error.response?.status === 401 ||
              error.message.includes("Token expired") ||
              error.message.includes("No valid token found")
            ) {
              console.log(chalk.yellow("Login to use cloud operations"));
            }
            totalFailed++;
          }
        }
        console.log();
      }
    }

    console.log(`Sync complete!`);
    console.log(`Successfully synced: ${totalSynced} file(s)`);
    if (totalFailed > 0) {
      console.log(`Failed to sync: ${totalFailed} file(s)`);
    }
  } catch (error) {
    console.log("Sync operation failed:", error.message);
    process.exit(1);
  }
}

// Function to automatically stage a reverted file for push
async function stageRevertedFile(
  envFileId,
  projectId,
  userEmail,
  commitMessage
) {
  try {
    // Get the env file info
    const envFile = dbOps.getEnvFileById(envFileId);
    if (!envFile.success) {
      throw new Error("Environment file not found");
    }

    // Get project info
    const project = dbOps.getProjectById(projectId);
    if (!project.success) {
      throw new Error("Project not found");
    }

    // Decrypt the current content to get the actual file content
    const userSalt = dbOps.getUserEncryptionSalt(userEmail);
    const decryptedContent = decryptContent(
      envFile.envFile.encrypted_content,
      envFile.envFile.iv,
      envFile.envFile.tag,
      userEmail,
      userSalt
    );

    // Create staging data
    const stagedData = {
      projectId: projectId,
      projectName: project.project.name,
      userEmail: userEmail,
      commitMessage: commitMessage || "Reverted to previous version",
      isRevert: true, // Flag to indicate this is a revert
      files: [
        {
          name: envFile.envFile.name,
          path: path.join(process.cwd(), envFile.envFile.name),
          content: decryptedContent,
          size: decryptedContent.length,
        },
      ],
      stagedAt: new Date().toISOString(),
    };

    // Save staging data
    saveStagedFiles(stagedData);

    return { success: true, fileName: envFile.envFile.name };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  addEnvFiles,
  pushStagedFiles,
  syncPendingFiles,
  scanEnvFiles,
  encryptContent,
  decryptContent,
  stageRevertedFile,
};
