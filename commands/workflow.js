const chalk = require("chalk");
const { dbOps, sessionManager } = require("../db");
const { decryptContent } = require("../env-manager");

// Show status of changed files
async function handleStatus() {
  if (!dbOps.isLoggedIn()) {
    console.log(chalk.red("You must be logged in. Run 'evm login' first."));
    process.exit(1);
  }

  const currentUser = dbOps.getCurrentUser();
  if (!currentUser) {
    console.log(chalk.red("Failed to get current user."));
    process.exit(1);
  }

  // Get current project
  const currentProject = dbOps.getCurrentProject(currentUser.userId);
  if (!currentProject.success) {
    console.log(chalk.red("No active project found. Run 'evm init' first."));
    process.exit(1);
  }

  console.log(
    chalk.blue.bold(`\nStatus for project: ${currentProject.project.name}`)
  );

  const fs = require("fs");
  const path = require("path");

  // Get all files that start with .env
  const allFiles = fs.readdirSync(".");
  const foundFiles = allFiles.filter(
    (file) => file.startsWith(".env") && fs.statSync(file).isFile()
  );

  if (foundFiles.length === 0) {
    console.log(
      chalk.yellow("\nNo environment files found in current directory")
    );
    return;
  }

  // Get database files for comparison
  const dbFiles = dbOps.getEnvFilesByProject(currentProject.project.id);

  let hasChanges = false;

  console.log(chalk.green.bold("\nEnvironment Files Status:"));

  for (const file of foundFiles) {
    try {
      const currentContent = fs.readFileSync(file, "utf8");

      // Find this file in database
      let dbFile = null;
      if (dbFiles.success && dbFiles.envFiles) {
        dbFile = dbFiles.envFiles.find((f) => f.name === file);
      }

      if (!dbFile) {
        console.log(chalk.yellow(`   ${file}`));
        console.log(chalk.yellow(`      Status: New file (not tracked)`));
        hasChanges = true;
      } else {
        // Get latest version to compare
        const versions = dbOps.getEnvVersionsByFile(dbFile.id);
        if (versions.success && versions.versions.length > 0) {
          const latestVersion = versions.versions[0];

          try {
            const userSalt = dbOps.getUserEncryptionSalt(currentUser.email);
            const decryptedContent = decryptContent(
              latestVersion.encrypted_content,
              latestVersion.iv,
              latestVersion.tag,
              currentUser.email,
              userSalt
            );

            if (currentContent.trim() === decryptedContent.trim()) {
              console.log(chalk.green(` ${file}`));
              console.log(chalk.gray(`      Status: Up to date`));
            } else {
              console.log(chalk.red(`   ${file}`));
              console.log(chalk.red(`       Status: Modified`));
              hasChanges = true;
            }
          } catch (decryptError) {
            console.log(chalk.yellow(`   ${file}`));
            console.log(
              chalk.yellow(
                `         Status: Cannot compare (decryption failed)`
              )
            );
          }
        } else {
          console.log(chalk.yellow(`   ${file}`));
          console.log(chalk.yellow(`      Status: No versions found`));
          hasChanges = true;
        }
      }
      console.log();
    } catch (error) {
      console.log(chalk.red(`   ${file}`));
      console.log(chalk.red(`      Error: ${error.message}`));
      console.log();
    }
  }

  if (!hasChanges) {
    console.log(chalk.green("All files are up to date"));
    console.log(chalk.gray("   Use 'evm add' to stage new changes"));
  } else {
    console.log(chalk.yellow(" Use 'evm add' to stage changed files"));
    console.log(chalk.gray("   Use 'evm diff' to see detailed changes"));
  }
}

// Show differences between current files and last commit
async function handleDiff(args) {
  if (!dbOps.isLoggedIn()) {
    console.log(chalk.red("You must be logged in. Run 'evm login' first."));
    process.exit(1);
  }

  const currentUser = dbOps.getCurrentUser();
  if (!currentUser) {
    console.log(chalk.red("Failed to get current user."));
    process.exit(1);
  }

  // Get current project
  const currentProject = dbOps.getCurrentProject(currentUser.userId);
  if (!currentProject.success) {
    console.log(chalk.red("No active project found. Run 'evm init' first."));
    process.exit(1);
  }

  let targetFile = null;
  if (args.length === 2) {
    targetFile = args[1];
  }

  console.log(
    chalk.blue.bold(`\nDiff for project: ${currentProject.project.name}`)
  );

  // Check for environment files in current directory
  const fs = require("fs");

  // Get all files that start with .env
  const allFiles = fs.readdirSync(".");
  let foundFiles = allFiles.filter(
    (file) => file.startsWith(".env") && fs.statSync(file).isFile()
  );

  if (targetFile) {
    if (!fs.existsSync(targetFile)) {
      console.log(
        chalk.red(`\nFile "${targetFile}" not found in current directory`)
      );
      process.exit(1);
    }
    foundFiles = [targetFile];
  }

  if (foundFiles.length === 0) {
    console.log(
      chalk.yellow("\nNo environment files found in current directory")
    );
    return;
  }

  // Get database files for comparison
  const dbFiles = dbOps.getEnvFilesByProject(currentProject.project.id);

  let hasAnyDiff = false;

  for (const file of foundFiles) {
    try {
      const currentContent = fs.readFileSync(file, "utf8");

      let dbFile = null;
      if (dbFiles.success && dbFiles.envFiles) {
        dbFile = dbFiles.envFiles.find((f) => f.name === file);
      }

      console.log(chalk.cyan.bold(`\n${file}:`));

      if (!dbFile) {
        console.log(chalk.yellow("   Status: New file (not in database)"));
        console.log(chalk.green("   + All content is new:"));
        const lines = currentContent.split("\n");
        lines.forEach((line, index) => {
          console.log(chalk.green(`   + ${index + 1}: ${line}`));
        });
        hasAnyDiff = true;
      } else {
        const versions = dbOps.getEnvVersionsByFile(dbFile.id);
        if (versions.success && versions.versions.length > 0) {
          const latestVersion = versions.versions[0];

          try {
            // Use the proper decryption function
            const userSalt = dbOps.getUserEncryptionSalt(currentUser.email);
            const decryptedContent = decryptContent(
              latestVersion.encrypted_content,
              latestVersion.iv,
              latestVersion.tag,
              currentUser.email,
              userSalt
            );

            if (currentContent.trim() === decryptedContent.trim()) {
              console.log(chalk.green("   Status: No changes"));
            } else {
              console.log(chalk.yellow("   Status: Modified"));

              // Show line-by-line diff
              const currentLines = currentContent.split("\n");
              const dbLines = decryptedContent.split("\n");

              const maxLines = Math.max(currentLines.length, dbLines.length);

              for (let i = 0; i < maxLines; i++) {
                const currentLine = currentLines[i] || "";
                const dbLine = dbLines[i] || "";

                if (currentLine !== dbLine) {
                  if (dbLine && !currentLine) {
                    console.log(chalk.red(`   - ${i + 1}: ${dbLine}`));
                  } else if (currentLine && !dbLine) {
                    console.log(chalk.green(`   + ${i + 1}: ${currentLine}`));
                  } else {
                    console.log(chalk.red(`   - ${i + 1}: ${dbLine}`));
                    console.log(chalk.green(`   + ${i + 1}: ${currentLine}`));
                  }
                  hasAnyDiff = true;
                }
              }

              if (!hasAnyDiff) {
                console.log(chalk.gray("   (Only whitespace differences)"));
              }
            }
          } catch (decryptError) {
            console.log(
              chalk.red(
                `   Error: Cannot decrypt database content (${decryptError.message})`
              )
            );
          }
        } else {
          console.log(chalk.yellow("   Status: No versions found in database"));
        }
      }
    } catch (error) {
      console.log(chalk.red(`   Error reading ${file}: ${error.message}`));
    }
  }

  if (!hasAnyDiff) {
    console.log(chalk.green("\nNo differences found"));
  } else {
    console.log(chalk.gray("\nUse 'evm add' to stage these changes"));
  }
}

// Show commit history like git log
async function handleLog(args) {
  if (!dbOps.isLoggedIn()) {
    console.log(chalk.red("You must be logged in. Run 'evm login' first."));
    process.exit(1);
  }

  const currentUser = dbOps.getCurrentUser();
  if (!currentUser) {
    console.log(chalk.red("Failed to get current user."));
    process.exit(1);
  }

  // Get current project
  const currentProject = dbOps.getCurrentProject(currentUser.userId);
  if (!currentProject.success) {
    console.log(chalk.red("No active project found. Run 'evm init' first."));
    process.exit(1);
  }

  const commitLog = dbOps.getProjectCommitLog(currentProject.project.id);

  if (!commitLog.success) {
    console.log(chalk.red(`Failed to get commit log: ${commitLog.error}`));
    process.exit(1);
  }

  if (commitLog.commits.length === 0) {
    console.log(chalk.yellow("\nNo commits found in this project"));
    console.log(
      chalk.gray("   Use 'evm add' and 'evm push' to create your first commit")
    );
    return;
  }

  // Check for --oneline flag
  const isOneline = args.includes("--oneline");

  if (isOneline) {
    // Display oneline format in tabular style like evm list
    console.log(
      chalk.blue.bold(
        `\nCommit History for project: ${currentProject.project.name}\n`
      )
    );

    // Table headers
    const headers = ["Commit Message", "Commit Hash", "File", "Status"];
    const colWidths = [40, 12, 15, 8];

    // Print header
    let headerLine = "";
    headers.forEach((header, index) => {
      headerLine += header.padEnd(colWidths[index]);
    });
    console.log(chalk.white.bold(headerLine));

    // Print separator line
    let separatorLine = "";
    colWidths.forEach((width) => {
      separatorLine += "-".repeat(width);
    });
    console.log(chalk.gray(separatorLine));

    // Print commits
    commitLog.commits.forEach((commit, index) => {
      const message = (
        commit.commit_message || `Auto-commit for ${commit.file_name}`
      ).slice(0, 37);
      const shortHash = commit.version_token.substring(0, 8);
      const fileName = commit.file_name.slice(0, 12);
      const status = index === 0 ? "HEAD" : "";

      const commitMessage = message.padEnd(colWidths[0]);
      const hashColumn = shortHash.padEnd(colWidths[1]);
      const fileColumn = fileName.padEnd(colWidths[2]);
      const statusColumn = status.padEnd(colWidths[3]);

      // Color the first row (HEAD) differently
      if (index === 0) {
        console.log(
          chalk.white(commitMessage) +
            chalk.yellow(hashColumn) +
            chalk.cyan(fileColumn) +
            chalk.green.bold(statusColumn)
        );
      } else {
        console.log(
          chalk.white(commitMessage) +
            chalk.gray(hashColumn) +
            chalk.gray(fileColumn) +
            chalk.gray(statusColumn)
        );
      }
    });

    console.log(chalk.gray(`\nTotal commits: ${commitLog.commits.length}`));
    console.log(chalk.gray("Use 'evm log' for detailed view"));
    console.log(chalk.gray("Use 'evm revert <commit-hash>' to rollback"));
    return;
  }

  // Original detailed log format
  console.log(
    chalk.blue.bold(`\nCommit Log for project: ${currentProject.project.name}`)
  );

  console.log(
    chalk.green.bold(`\nTotal commits: ${commitLog.commits.length}\n`)
  );

  // Parse limit from args (e.g., evm log -n 10 or evm log --limit 10)
  let limit = null;
  if (args.length >= 3) {
    if (
      (args[1] === "-n" || args[1] === "--limit") &&
      !isNaN(parseInt(args[2]))
    ) {
      limit = parseInt(args[2]);
    }
  }

  const commitsToShow = limit
    ? commitLog.commits.slice(0, limit)
    : commitLog.commits;

  commitsToShow.forEach((commit, index) => {
    const commitDate = new Date(commit.createdAt);
    const timeAgo = getTimeAgo(commitDate);

    const shortToken = commit.version_token.substring(0, 7);

    console.log(chalk.yellow.bold(`commit ${commit.version_token}`));
    console.log(chalk.gray(`Author: ${commit.author_email || "Unknown"}`));
    console.log(chalk.gray(`Date:   ${commitDate.toLocaleString()}`));
    console.log(chalk.gray(`File:   ${commit.file_name}`));

    if (commit.commit_message) {
      console.log(chalk.white(`\n    ${commit.commit_message}`));
    } else {
      console.log(chalk.gray(`\n    Auto-commit for ${commit.file_name}`));
    }

    console.log(chalk.blue(`    ${shortToken} - ${timeAgo}`));

    // Add separator between commits
    if (index < commitsToShow.length - 1) {
      console.log("");
    }
  });

  // Show summary if limit was applied
  if (limit && commitLog.commits.length > limit) {
    const remaining = commitLog.commits.length - limit;
    console.log(chalk.gray(`\n... and ${remaining} more commits`));
    console.log(
      chalk.gray(
        `Use 'evm log --limit ${commitLog.commits.length}' to see all commits`
      )
    );
  }

  console.log(chalk.gray(`\nUse 'evm diff' to see changes`));
  console.log(
    chalk.gray(
      `Use 'evm revert <commit-hash>' to rollback to a specific commit`
    )
  );
}

function getTimeAgo(date) {
  const now = new Date();

  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return "unknown time";
  }

  const diffMs = now.getTime() - date.getTime();

  const absDiffMs = Math.abs(diffMs);

  const diffSeconds = Math.floor(absDiffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) {
    return `${diffYears} year${diffYears > 1 ? "s" : ""} ago`;
  } else if (diffMonths > 0) {
    return `${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
  } else if (diffWeeks > 0) {
    return `${diffWeeks} week${diffWeeks > 1 ? "s" : ""} ago`;
  } else if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""} ago`;
  } else if (diffSeconds > 5) {
    return `${diffSeconds} second${diffSeconds > 1 ? "s" : ""} ago`;
  } else {
    return "just now";
  }
}

async function handleRevert(args) {
  if (!args || args.length < 2) {
    console.log(chalk.red("Missing commit hash"));
    console.log(chalk.yellow("Usage: evm revert <commit-hash>"));
    console.log(chalk.gray("Example: evm revert abc123def"));
    return;
  }

  const commitHash = args[1];
  const reason = args.slice(2).join(" ") || "Manual rollback via CLI";

  try {
    // Get current user session
    const currentUser = sessionManager.getCurrentUser();
    if (!currentUser) {
      console.log(chalk.red('Not logged in. Please run "evm login" first.'));
      return;
    }

    console.log(chalk.blue(`Reverting to commit ${commitHash}...`));

    // First, find the version by commit hash
    const db = require("../db");
    const { dbOps } = db;

    // Get version by token (commit hash)
    const stmt = db.db.prepare(
      "SELECT * FROM env_versions WHERE version_token LIKE ?"
    );
    const matchingVersions = stmt.all(`${commitHash}%`);

    if (matchingVersions.length === 0) {
      console.log(chalk.red(`Commit hash "${commitHash}" not found`));
      console.log(chalk.yellow('Use "evm log" to see available commits'));
      return;
    }

    // Group versions by commit hash to handle multiple files in same commit
    const commitGroups = {};
    matchingVersions.forEach((version) => {
      if (!commitGroups[version.version_token]) {
        commitGroups[version.version_token] = [];
      }
      commitGroups[version.version_token].push(version);
    });

    if (Object.keys(commitGroups).length > 1) {
      console.log(
        chalk.yellow(`Multiple commits found matching "${commitHash}":`)
      );
      Object.keys(commitGroups).forEach((token) => {
        const version = commitGroups[token][0]; // Get first version for commit info
        console.log(
          chalk.gray(
            `  ${token.substring(0, 8)} - ${
              version.commit_message || "No message"
            } (${commitGroups[token].length} file${
              commitGroups[token].length > 1 ? "s" : ""
            })`
          )
        );
      });
      console.log(
        chalk.yellow("Please provide a longer commit hash to be more specific.")
      );
      return;
    }

    // Get the single commit with all its files
    const targetCommitHash = Object.keys(commitGroups)[0];
    const targetVersions = commitGroups[targetCommitHash];
    const firstVersion = targetVersions[0];

    console.log(
      chalk.cyan(`Found commit: ${firstVersion.commit_message || "No message"}`)
    );
    console.log(chalk.gray(`   Hash: ${targetCommitHash}`));
    console.log(
      chalk.gray(
        `   Date: ${new Date(firstVersion.createdAt).toLocaleString()}`
      )
    );
    console.log(
      chalk.gray(
        `   Files: ${targetVersions.length} file${
          targetVersions.length > 1 ? "s" : ""
        }`
      )
    );

    // Show files being reverted
    const fileStmt = db.db.prepare("SELECT name FROM env_files WHERE id = ?");
    console.log(chalk.cyan("\nFiles to be reverted:"));
    targetVersions.forEach((version) => {
      const fileInfo = fileStmt.get(version.env_file_id);
      if (fileInfo) {
        console.log(chalk.gray(`  - ${fileInfo.name}`));
      }
    });

    console.log(); // Empty line for spacing

    // Instead of individual rollbacks, we'll revert all files together like Git
    try {
      // Get project info from the first file
      const envFileStmt = db.db.prepare("SELECT * FROM env_files WHERE id = ?");
      const firstEnvFile = envFileStmt.get(targetVersions[0].env_file_id);

      if (!firstEnvFile) {
        throw new Error("Environment file not found");
      }

      // Prepare revert data for all files
      const revertFiles = [];
      const { decryptContent } = require("../env-manager");
      const path = require("path");

      for (const version of targetVersions) {
        // Get the file info
        const envFile = envFileStmt.get(version.env_file_id);
        if (!envFile) continue;

        // Get user's salt for decryption
        const userSalt = dbOps.getUserEncryptionSalt(currentUser.email);

        // Decrypt the content from the target version
        const decryptedContent = decryptContent(
          version.encrypted_content,
          version.iv,
          version.tag,
          currentUser.email,
          userSalt
        );

        revertFiles.push({
          name: envFile.name,
          path: path.join(process.cwd(), envFile.name),
          content: decryptedContent,
          size: decryptedContent.length,
        });

        console.log(chalk.green(`✓ Prepared revert: ${envFile.name}`));
      }

      if (revertFiles.length === 0) {
        throw new Error("No files to revert");
      }

      // Stage all reverted files together with same commit message (Git-like behavior)
      const { saveStagedFiles } = require("../env-manager");

      // Use the ORIGINAL commit message, not a revert message
      const originalCommitMessage =
        firstVersion.commit_message || "Restored commit";

      const stagedData = {
        projectId: firstEnvFile.project_id,
        projectName: "prod_proj", // We'll get this properly if needed
        userEmail: currentUser.email,
        commitMessage: originalCommitMessage, // Keep original message
        isRevert: false, // We want this to create a normal commit
        files: revertFiles,
        stagedAt: new Date().toISOString(),
      };

      saveStagedFiles(stagedData);

      console.log(
        chalk.green(
          `\n✓ Successfully staged ${revertFiles.length} file${
            revertFiles.length > 1 ? "s" : ""
          } for restore`
        )
      );
      console.log(chalk.cyan("Staged files:"));
      revertFiles.forEach((file) => {
        console.log(chalk.gray(`  - ${file.name}`));
      });
      console.log(chalk.cyan(`\nCommit message: "${originalCommitMessage}"`));

      console.log(
        chalk.yellow.bold(
          '\nIMPORTANT: Run "evm push" to complete the restore'
        )
      );
      console.log(
        chalk.gray(
          "This will restore the files to their state at that commit"
        )
      );
    } catch (error) {
      console.log(chalk.red(`✗ Revert failed: ${error.message}`));
    }
  } catch (error) {
    console.log(chalk.red(`Revert failed: ${error.message}`));
  }
}

function handleRollbackHistory(args) {
  try {
    // Get current user session
    const currentUser = sessionManager.getCurrentUser();
    if (!currentUser) {
      console.log(chalk.red('Not logged in. Please run "evm login" first.'));
      return;
    }

    console.log(chalk.blue("Rollback History\n"));

    // Get all projects for the current user
    const projectsResult = dbOps.getProjectsByUser(currentUser.userId);

    if (!projectsResult.success) {
      console.log(chalk.red(`Failed to get projects: ${projectsResult.error}`));
      return;
    }

    const projects = projectsResult.projects;

    if (projects.length === 0) {
      console.log(chalk.yellow("No projects found"));
      return;
    }

    let totalRollbacks = 0;

    for (const project of projects) {
      const envFilesResult = dbOps.getEnvFilesByProject(project.id);

      if (envFilesResult.success && envFilesResult.envFiles.length > 0) {
        let projectHasRollbacks = false;

        for (const envFile of envFilesResult.envFiles) {
          // Get rollback history for this file
          const stmt = require("../db").db.prepare(
            "SELECT * FROM rollback_history WHERE env_file_id = ? ORDER BY createdAt DESC"
          );
          const rollbacks = stmt.all(envFile.id);

          if (rollbacks.length > 0) {
            if (!projectHasRollbacks) {
              console.log(chalk.cyan(`\n Project: ${project.name}`));
              projectHasRollbacks = true;
            }

            console.log(chalk.yellow(`   File: ${envFile.name}`));

            rollbacks.forEach((rollback) => {
              const date = new Date(rollback.createdAt);
              console.log(chalk.gray(` ${date.toLocaleString()}`));
              console.log(
                chalk.white(
                  `       From: ${rollback.from_version_token.substring(
                    0,
                    8
                  )}...`
                )
              );
              console.log(
                chalk.white(
                  `       To:   ${rollback.to_version_token.substring(0, 8)}...`
                )
              );
              console.log(chalk.white(`       By:   ${rollback.performed_by}`));
              if (rollback.rollback_reason) {
                console.log(
                  chalk.gray(`       Reason: ${rollback.rollback_reason}`)
                );
              }
              console.log("");
              totalRollbacks++;
            });
          }
        }
      }
    }

    if (totalRollbacks === 0) {
      console.log(chalk.yellow("No rollback history found"));
      console.log(
        chalk.gray("Use 'evm revert <commit-hash>' to create rollback entries")
      );
    } else {
      console.log(chalk.green(`\nTotal rollbacks: ${totalRollbacks}`));
    }
  } catch (error) {
    console.log(chalk.red(`Failed to get rollback history: ${error.message}`));
  }
}

module.exports = {
  handleStatus,
  handleDiff,
  handleLog,
  handleRevert,
  handleRollbackHistory,
};
