const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const { configManager } = require("./config");

const db = new Database(configManager.getDatabasePath());

// Session management - store current user
const SESSION_FILE = configManager.getSessionPath();

const sessionManager = {
  setCurrentUser(userEmail, userId, token = null, refreshToken = null) {
    const sessionData = {
      email: userEmail,
      userId: userId,
      token: token,
      refreshToken: refreshToken,
      loginTime: new Date().toISOString(),
      isOnline: token !== null,
    };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));
    // console.log(
    //   `Session created for user: ${userEmail}${
    //     token ? " (online)" : " (offline)"
    //   }`
    // );
  },

  updateTokens(token, refreshToken) {
    const currentSession = this.getCurrentUser();
    if (currentSession) {
      currentSession.token = token;
      currentSession.refreshToken = refreshToken;
      currentSession.isOnline = true;
      fs.writeFileSync(SESSION_FILE, JSON.stringify(currentSession, null, 2));
    }
  },

  getCurrentUser() {
    try {
      if (fs.existsSync(SESSION_FILE)) {
        const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
        return sessionData;
      }
      return null;
    } catch (error) {
      return null;
    }
  },

  clearSession() {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  },

  isLoggedIn() {
    return this.getCurrentUser() !== null;
  },

  isOnline() {
    const session = this.getCurrentUser();
    return session?.isOnline || false;
  },

  getToken() {
    const session = this.getCurrentUser();
    return session?.token;
  },

  getRefreshToken() {
    const session = this.getCurrentUser();
    return session?.refreshToken;
  },
};

function migrateDatabase() {
  try {
    const tableInfo = db.pragma("table_info(users)");
    const hasUsername = tableInfo.some((col) => col.name === "username");
    const hasEmail = tableInfo.some((col) => col.name === "email");
    const hasEncryptionSalt = tableInfo.some(
      (col) => col.name === "encryption_salt"
    );

    if (hasUsername && !hasEmail) {
      console.log("Migrating database schema from username to email...");

      db.prepare("DROP TABLE IF EXISTS users").run();

      db.prepare(
        `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          passwordHash TEXT NOT NULL,
          encryption_salt TEXT NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          lastLogin DATETIME,
          syncedToServer BOOLEAN DEFAULT 0
        )
      `
      ).run();

      console.log("Database migration completed successfully!");
    } else if (!hasUsername && !hasEmail) {
      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          passwordHash TEXT NOT NULL,
          encryption_salt TEXT NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          lastLogin DATETIME,
          syncedToServer BOOLEAN DEFAULT 0
        )
      `
      ).run();
    } else if (hasEmail && !hasEncryptionSalt) {
      // Add encryption_salt column for existing users
      console.log("Adding encryption_salt column for existing users...");
      db.prepare("ALTER TABLE users ADD COLUMN encryption_salt TEXT").run();

      // Generate salt for existing users
      const crypto = require("crypto");
      const existingUsers = db
        .prepare("SELECT id, email FROM users WHERE encryption_salt IS NULL")
        .all();
      const updateSalt = db.prepare(
        "UPDATE users SET encryption_salt = ? WHERE id = ?"
      );

      for (const user of existingUsers) {
        const salt = crypto.randomBytes(32).toString("hex");
        updateSalt.run(salt, user.id);
        console.log(`Generated encryption salt for user: ${user.email}`);
      }

      // Make the column NOT NULL after populating
      db.prepare(
        `
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          passwordHash TEXT NOT NULL,
          encryption_salt TEXT NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          lastLogin DATETIME,
          syncedToServer BOOLEAN DEFAULT 0
        )
      `
      ).run();

      db.prepare("INSERT INTO users_new SELECT * FROM users").run();
      db.prepare("DROP TABLE users").run();
      db.prepare("ALTER TABLE users_new RENAME TO users").run();

      console.log("Encryption salt migration completed!");
    }
  } catch (error) {
    console.error("Migration error:", error.message);
    db.prepare("DROP TABLE IF EXISTS users").run();
    db.prepare(
      `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        lastLogin DATETIME,
        syncedToServer BOOLEAN DEFAULT 0
      )
    `
    ).run();
  }

  // Create projects table with user relationship
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      directory_path TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, name)
    )
  `
  ).run();

  // Create env_files table
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS env_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      encrypted_content TEXT NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      current_version_id INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      UNIQUE(project_id, name)
    )
  `
  ).run();

  // Create env_versions table for Git-like rollback functionality
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS env_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      env_file_id INTEGER NOT NULL,
      version_token TEXT NOT NULL,
      encrypted_content TEXT NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      commit_message TEXT,
      author_email TEXT,
      parent_version_id INTEGER,
      syncedToServer BOOLEAN DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (env_file_id) REFERENCES env_files(id),
      FOREIGN KEY (parent_version_id) REFERENCES env_versions(id),
      UNIQUE(env_file_id, version_token)
    )
  `
  ).run();

  // Add syncedToServer column to existing env_versions table if it doesn't exist
  try {
    db.prepare(
      `ALTER TABLE env_versions ADD COLUMN syncedToServer BOOLEAN DEFAULT 0`
    ).run();
  } catch (error) {
    // Column already exists, ignore error
  }

  // Migrate env_versions table to allow multiple files per commit hash
  try {
    // Check if we need to migrate the constraint
    const tableInfo = db.prepare("PRAGMA table_info(env_versions)").all();
    const indexes = db.prepare("PRAGMA index_list(env_versions)").all();

    // Check if the old UNIQUE constraint on version_token exists
    const hasOldConstraint = indexes.some(
      (index) =>
        index.name && index.name.includes("version_token") && index.unique
    );

    if (hasOldConstraint) {
      console.log("Migrating database schema to support multi-file commits...");

      // Create a temporary table with the new schema
      db.prepare(
        `
        CREATE TABLE env_versions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          env_file_id INTEGER NOT NULL,
          version_token TEXT NOT NULL,
          encrypted_content TEXT NOT NULL,
          iv TEXT NOT NULL,
          tag TEXT NOT NULL,
          commit_message TEXT,
          author_email TEXT,
          parent_version_id INTEGER,
          syncedToServer BOOLEAN DEFAULT 0,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (env_file_id) REFERENCES env_files(id),
          FOREIGN KEY (parent_version_id) REFERENCES env_versions(id),
          UNIQUE(env_file_id, version_token)
        )
      `
      ).run();

      // Copy data from old table
      db.prepare(
        `
        INSERT INTO env_versions_new
        SELECT * FROM env_versions
      `
      ).run();

      // Drop old table and rename new table
      db.prepare("DROP TABLE env_versions").run();
      db.prepare("ALTER TABLE env_versions_new RENAME TO env_versions").run();

      console.log("Database migration completed successfully.");
    }
  } catch (error) {
    console.log("Database migration failed:", error.message);
    // Continue anyway as this is not critical for basic functionality
  }

  // Create rollback_history table for tracking rollbacks
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS rollback_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      env_file_id INTEGER NOT NULL,
      from_version_token TEXT NOT NULL,
      to_version_token TEXT NOT NULL,
      rollback_reason TEXT,
      performed_by TEXT,
      syncedToServer BOOLEAN DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (env_file_id) REFERENCES env_files(id)
    )
  `
  ).run();

  // Add syncedToServer column to existing rollback_history table if it doesn't exist
  try {
    db.prepare(
      `ALTER TABLE rollback_history ADD COLUMN syncedToServer BOOLEAN DEFAULT 0`
    ).run();
  } catch (error) {
    // Column already exists, ignore error
  }

  // Create pending_operations table for tracking offline operations
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS pending_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      old_name TEXT,
      new_name TEXT,
      project_id INTEGER,
      user_id INTEGER NOT NULL,
      operation_data TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed BOOLEAN DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `
  ).run();
}

migrateDatabase();

const statements = {
  insertUser: db.prepare(`
    INSERT INTO users (email, passwordHash, encryption_salt, syncedToServer)
    VALUES (?, ?, ?, ?)
  `),
  getUserByEmail: db.prepare(`
    SELECT * FROM users WHERE email = ?
  `),
  updateLastLogin: db.prepare(`
    UPDATE users SET lastLogin = CURRENT_TIMESTAMP WHERE email = ?
  `),
  updateSyncStatus: db.prepare(`
    UPDATE users SET syncedToServer = 1 WHERE email = ?
  `),
  updateUser: db.prepare(`
    UPDATE users SET passwordHash = ?, syncedToServer = ? WHERE email = ?
  `),
  getAllUsers: db.prepare(`
    SELECT * FROM users
  `),

  // Project operations
  insertProject: db.prepare(`
    INSERT INTO projects (user_id, name, description, directory_path)
    VALUES (?, ?, ?, ?)
  `),
  getProjectsByUser: db.prepare(`
    SELECT * FROM projects WHERE user_id = ?
  `),
  getProjectById: db.prepare(`
    SELECT * FROM projects WHERE id = ?
  `),
  getProjectByUserAndName: db.prepare(`
    SELECT * FROM projects WHERE user_id = ? AND name = ?
  `),
  getProjectByUserAndDirectory: db.prepare(`
    SELECT * FROM projects WHERE user_id = ? AND directory_path = ?
  `),

  // Environment file operations
  insertEnvFile: db.prepare(`
    INSERT INTO env_files (project_id, name, encrypted_content, iv, tag)
    VALUES (?, ?, ?, ?, ?)
  `),
  getEnvFilesByProject: db.prepare(`
    SELECT * FROM env_files WHERE project_id = ?
  `),
  getEnvFileByProjectAndName: db.prepare(`
    SELECT * FROM env_files WHERE project_id = ? AND name = ?
  `),
  getEnvFileById: db.prepare(`
    SELECT * FROM env_files WHERE id = ?
  `),
  updateEnvFileVersion: db.prepare(`
    UPDATE env_files SET current_version_id = ?, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  updateEnvFile: db.prepare(`
    UPDATE env_files SET encrypted_content = ?, iv = ?, tag = ?, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  // Version operations
  insertEnvVersion: db.prepare(`
    INSERT INTO env_versions (env_file_id, version_token, encrypted_content, iv, tag, commit_message, author_email, parent_version_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getVersionsByEnvFile: db.prepare(`
    SELECT * FROM env_versions WHERE env_file_id = ? ORDER BY createdAt DESC
  `),
  getUnsyncedVersionsByEnvFile: db.prepare(`
    SELECT * FROM env_versions WHERE env_file_id = ? AND syncedToServer = 0 ORDER BY createdAt DESC
  `),
  markVersionAsSynced: db.prepare(`
    UPDATE env_versions SET syncedToServer = 1 WHERE version_token = ?
  `),
  getVersionByToken: db.prepare(`
    SELECT * FROM env_versions WHERE version_token = ?
  `),
  getVersionsByProject: db.prepare(`
    SELECT
      v.*,
      f.name as file_name
    FROM env_versions v
    JOIN env_files f ON v.env_file_id = f.id
    WHERE f.project_id = ?
    ORDER BY v.createdAt DESC
  `),

  // Rollback operations
  insertRollbackHistory: db.prepare(`
    INSERT INTO rollback_history (env_file_id, from_version_token, to_version_token, rollback_reason, performed_by, syncedToServer)
    VALUES (?, ?, ?, ?, ?, 0)
  `),
  getRollbackHistory: db.prepare(`
    SELECT * FROM rollback_history WHERE env_file_id = ? ORDER BY createdAt DESC
  `),
  getUnsyncedRollbackHistory: db.prepare(`
    SELECT * FROM rollback_history WHERE env_file_id = ? AND syncedToServer = 0 ORDER BY createdAt DESC
  `),
  markRollbackAsSynced: db.prepare(`
    UPDATE rollback_history SET syncedToServer = 1 WHERE id = ?
  `),

  // Delete operations
  deleteProject: db.prepare(`
    DELETE FROM projects WHERE id = ? AND user_id = ?
  `),
  deleteEnvFile: db.prepare(`
    DELETE FROM env_files WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)
  `),
  deleteEnvVersionsByFileId: db.prepare(`
    DELETE FROM env_versions WHERE env_file_id = ?
  `),
  deleteRollbackHistoryByFileId: db.prepare(`
    DELETE FROM rollback_history WHERE env_file_id = ?
  `),
};

const dbOps = {
  // Project operations
  createProject(
    userId,
    projectName,
    description = "",
    directoryPath = process.cwd()
  ) {
    try {
      const result = statements.insertProject.run(
        userId,
        projectName,
        description,
        directoryPath
      );
      return { success: true, projectId: result.lastInsertRowid };
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return {
          success: false,
          error: "Project with this name already exists for this user",
        };
      }
      return { success: false, error: error.message };
    }
  },

  getProjectsByUser(userId) {
    try {
      return {
        success: true,
        projects: statements.getProjectsByUser.all(userId),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getProjectByUserAndName(userId, projectName) {
    try {
      const project = statements.getProjectByUserAndName.get(
        userId,
        projectName
      );
      return project
        ? { success: true, project }
        : { success: false, error: "Project not found" };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getProjectById(projectId) {
    try {
      const project = statements.getProjectById.get(projectId);
      return project
        ? { success: true, project }
        : { success: false, error: "Project not found" };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getProjectByUserAndDirectory(userId, directoryPath) {
    try {
      const project = statements.getProjectByUserAndDirectory.get(
        userId,
        directoryPath
      );
      return project
        ? { success: true, project }
        : { success: false, error: "No project found in this directory" };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Environment file operations
  createEnvFile(projectId, fileName, encryptedContent, iv, tag) {
    try {
      const result = statements.insertEnvFile.run(
        projectId,
        fileName,
        encryptedContent,
        iv,
        tag
      );
      return { success: true, envFileId: result.lastInsertRowid };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getEnvFileByProjectAndName(projectId, fileName) {
    try {
      const envFile = statements.getEnvFileByProjectAndName.get(
        projectId,
        fileName
      );
      return envFile
        ? { success: true, envFile }
        : { success: false, error: "Environment file not found" };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  createOrUpdateEnvFile(projectId, fileName, encryptedContent, iv, tag) {
    try {
      // First, check if the file already exists
      const existingFile = this.getEnvFileByProjectAndName(projectId, fileName);

      if (existingFile.success) {
        // File exists, update it
        const updateResult = statements.updateEnvFile.run(
          encryptedContent,
          iv,
          tag,
          existingFile.envFile.id
        );
        return {
          success: true,
          envFileId: existingFile.envFile.id,
          updated: true,
        };
      } else {
        // File doesn't exist, create new
        const result = statements.insertEnvFile.run(
          projectId,
          fileName,
          encryptedContent,
          iv,
          tag
        );
        return {
          success: true,
          envFileId: result.lastInsertRowid,
          updated: false,
        };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  updateEnvFileContent(fileId, encryptedContent, iv, tag) {
    try {
      const updateResult = statements.updateEnvFile.run(
        encryptedContent,
        iv,
        tag,
        fileId
      );

      if (updateResult.changes > 0) {
        return { success: true };
      } else {
        return { success: false, error: "No file was updated" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  restoreFileWithVersions(projectId, fileName, fileData, versions) {
    try {
      const transaction = db.transaction(() => {
        // First check if file already exists
        const existingFile = this.getEnvFileByProjectAndName(
          projectId,
          fileName
        );

        let fileId;
        if (existingFile.success) {
          // Update existing file
          fileId = existingFile.envFile.id;
          const updateResult = statements.updateEnvFile.run(
            fileData.encrypted_content,
            fileData.iv,
            fileData.tag,
            fileId
          );

          if (updateResult.changes === 0) {
            throw new Error("Failed to update file");
          }
        } else {
          // Create new file
          const result = statements.insertEnvFile.run(
            projectId,
            fileName,
            fileData.encrypted_content,
            fileData.iv,
            fileData.tag
          );
          fileId = result.lastInsertRowid;
        }

        // Delete existing versions for this file
        db.prepare(`DELETE FROM env_versions WHERE env_file_id = ?`).run(
          fileId
        );

        // Insert all versions
        for (const version of versions) {
          statements.insertEnvVersion.run(
            fileId,
            version.version_token,
            version.encrypted_content,
            version.iv,
            version.tag,
            version.commit_message,
            version.author_email,
            version.parent_version_id
          );
        }

        // Update current_version_id if provided
        if (fileData.current_version_id) {
          db.prepare(
            `UPDATE env_files SET current_version_id = ? WHERE id = ?`
          ).run(fileData.current_version_id, fileId);
        }

        return fileId;
      });

      const fileId = transaction();
      return { success: true, fileId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getEnvFilesByProject(projectId) {
    try {
      const envFiles = statements.getEnvFilesByProject.all(projectId);
      return { success: true, envFiles };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getEnvFileById(envFileId) {
    try {
      const envFile = statements.getEnvFileById.get(envFileId);
      return envFile
        ? { success: true, envFile }
        : { success: false, error: "Environment file not found" };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Version control operations
  createEnvVersion(
    envFileId,
    versionToken,
    encryptedContent,
    iv,
    tag,
    commitMessage,
    authorEmail,
    parentVersionId = null
  ) {
    try {
      const result = statements.insertEnvVersion.run(
        envFileId,
        versionToken,
        encryptedContent,
        iv,
        tag,
        commitMessage,
        authorEmail,
        parentVersionId
      );

      statements.updateEnvFileVersion.run(result.lastInsertRowid, envFileId);

      return { success: true, versionId: result.lastInsertRowid };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getVersionHistory(envFileId) {
    try {
      return {
        success: true,
        versions: statements.getVersionsByEnvFile.all(envFileId),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getUnsyncedVersionHistory(envFileId) {
    try {
      return {
        success: true,
        versions: statements.getUnsyncedVersionsByEnvFile.all(envFileId),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  markVersionAsSynced(versionToken) {
    try {
      statements.markVersionAsSynced.run(versionToken);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getUnsyncedRollbackHistory(envFileId) {
    try {
      return {
        success: true,
        rollbacks: statements.getUnsyncedRollbackHistory.all(envFileId),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  markRollbackAsSynced(rollbackId) {
    try {
      statements.markRollbackAsSynced.run(rollbackId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getEnvVersionsByFile(envFileId) {
    return this.getVersionHistory(envFileId);
  },

  getProjectCommitLog(projectId) {
    try {
      const versions = statements.getVersionsByProject.all(projectId);
      return {
        success: true,
        commits: versions,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  rollbackToVersion(envFileId, targetVersionToken, reason, performedBy) {
    try {
      const targetVersion =
        statements.getVersionByToken.get(targetVersionToken);
      if (!targetVersion) {
        return { success: false, error: "Version not found" };
      }

      // Get the env file info
      const envFile = statements.getEnvFileById.get(envFileId);
      if (!envFile) {
        return { success: false, error: "Environment file not found" };
      }

      const currentVersion = statements.getVersionsByEnvFile.get(envFileId);

      // Record the rollback in history
      statements.insertRollbackHistory.run(
        envFileId,
        currentVersion?.version_token || "unknown",
        targetVersionToken,
        reason,
        performedBy
      );

      const crypto = require("crypto");
      const newVersionToken = crypto.randomBytes(20).toString("hex");
      const rollbackCommitMessage = `${
        targetVersion.commit_message || "No message"
      }`;

      const newVersionResult = statements.insertEnvVersion.run(
        envFileId,
        newVersionToken,
        targetVersion.encrypted_content,
        targetVersion.iv,
        targetVersion.tag,
        rollbackCommitMessage,
        performedBy,
        currentVersion?.id || null
      );

      statements.updateEnvFile.run(
        targetVersion.encrypted_content,
        targetVersion.iv,
        targetVersion.tag,
        envFileId
      );

      statements.updateEnvFileVersion.run(
        newVersionResult.lastInsertRowid,
        envFileId
      );

      const fs = require("fs");
      const { decryptContent } = require("./env-manager");

      try {
        const currentUser = sessionManager.getCurrentUser();
        if (currentUser) {
          const userSalt = this.getUserEncryptionSalt(currentUser.email);
          const decryptedContent = decryptContent(
            targetVersion.encrypted_content,
            targetVersion.iv,
            targetVersion.tag,
            currentUser.email,
            userSalt
          );

          fs.writeFileSync(envFile.name, decryptedContent, "utf8");
        }
      } catch (fileError) {
        console.warn(
          `Warning: Failed to write file to filesystem: ${fileError.message}`
        );
      }

      return {
        success: true,
        message: `Rolled back to version ${targetVersionToken}`,
        newVersionToken: newVersionToken,
        isRollback: true,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  generateVersionToken() {
    const crypto = require("crypto");
    return crypto.randomBytes(20).toString("hex");
  },

  async createUser(email, plainPassword, syncedToServer = false) {
    try {
      const crypto = require("crypto");
      const hashedPassword = await bcrypt.hash(plainPassword, 10);
      const encryptionSalt = crypto.randomBytes(32).toString("hex");

      const result = statements.insertUser.run(
        email,
        hashedPassword,
        encryptionSalt,
        syncedToServer ? 1 : 0
      );
      return { success: true, userId: result.lastInsertRowid, encryptionSalt };
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return { success: false, error: "User already exists locally" };
      }
      return { success: false, error: error.message };
    }
  },

  async verifyUser(email, plainPassword) {
    try {
      const user = statements.getUserByEmail.get(email);
      if (!user) {
        return { success: false, error: "User not found locally" };
      }

      const isValid = await bcrypt.compare(plainPassword, user.passwordHash);
      if (isValid) {
        statements.updateLastLogin.run(email);
        sessionManager.setCurrentUser(email, user.id);
        return { success: true, user };
      } else {
        return { success: false, error: "Invalid password" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async updateUser(user) {
    try {
      const result = statements.updateUser.run(user.password, 1, user.email);
      return { success: true, changes: result.changes };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getUserByEmail(email) {
    return statements.getUserByEmail.get(email);
  },

  getUserEncryptionSalt(email) {
    const user = statements.getUserByEmail.get(email);
    return user ? user.encryption_salt : null;
  },

  markAsSynced(email) {
    statements.updateSyncStatus.run(email);
  },

  getAllUsers() {
    return statements.getAllUsers.all();
  },

  // Session management
  getCurrentUser() {
    return sessionManager.getCurrentUser();
  },

  clearSession() {
    sessionManager.clearSession();
  },

  isLoggedIn() {
    return sessionManager.isLoggedIn();
  },

  // Project management operations
  getCurrentProject(userId) {
    try {
      // First try to find project by current directory
      const currentDir = process.cwd();
      const projectByDir = statements.getProjectByUserAndDirectory.get(
        userId,
        currentDir
      );
      if (projectByDir) {
        return { success: true, project: projectByDir };
      }

      // Fallback to first project if no directory match
      const project = statements.getProjectsByUser.get(userId);
      if (project) {
        return { success: true, project };
      } else {
        return { success: false, error: "No project found" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getProjectByName(userId, projectName) {
    try {
      const project = db
        .prepare("SELECT * FROM projects WHERE user_id = ? AND name = ?")
        .get(userId, projectName);
      if (project) {
        return { success: true, project };
      } else {
        return { success: false, error: "Project not found" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  renameProject(projectId, newName) {
    try {
      const stmt = db.prepare("UPDATE projects SET name = ? WHERE id = ?");
      const result = stmt.run(newName, projectId);
      if (result.changes > 0) {
        return { success: true };
      } else {
        return { success: false, error: "Project not found" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  renameEnvFile(envFileId, newName) {
    try {
      const stmt = db.prepare("UPDATE env_files SET name = ? WHERE id = ?");
      const result = stmt.run(newName, envFileId);
      if (result.changes > 0) {
        return { success: true };
      } else {
        return { success: false, error: "Environment file not found" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Delete operations
  deleteProject(projectId, userId) {
    try {
      // Start transaction
      const transaction = db.transaction(() => {
        // Get all env files for this project
        const envFiles = statements.getEnvFilesByProject.all(projectId);

        // Delete all related data for each env file
        for (const envFile of envFiles) {
          statements.deleteRollbackHistoryByFileId.run(envFile.id);
          statements.deleteEnvVersionsByFileId.run(envFile.id);
        }

        // Delete all env files in the project
        const deleteEnvFilesStmt = db.prepare(
          "DELETE FROM env_files WHERE project_id = ?"
        );
        deleteEnvFilesStmt.run(projectId);

        // Finally delete the project
        const result = statements.deleteProject.run(projectId, userId);
        return result;
      });

      const result = transaction();

      if (result.changes > 0) {
        return {
          success: true,
          message: "Project and all related data deleted successfully",
        };
      } else {
        return {
          success: false,
          error: "Project not found or permission denied",
        };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  deleteEnvFile(envFileId, userId) {
    try {
      // Start transaction
      const transaction = db.transaction(() => {
        // Delete rollback history for this file
        statements.deleteRollbackHistoryByFileId.run(envFileId);

        // Delete all versions for this file
        statements.deleteEnvVersionsByFileId.run(envFileId);

        // Delete the env file
        const result = statements.deleteEnvFile.run(envFileId, userId);
        return result;
      });

      const result = transaction();

      if (result.changes > 0) {
        return {
          success: true,
          message: "Environment file and all related data deleted successfully",
        };
      } else {
        return {
          success: false,
          error: "Environment file not found or permission denied",
        };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getProjectByName(userId, projectName) {
    try {
      const stmt = db.prepare(
        "SELECT * FROM projects WHERE user_id = ? AND name = ?"
      );
      const project = stmt.get(userId, projectName);

      if (project) {
        return { success: true, project };
      } else {
        return { success: false, error: "Project not found" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Pending operations management
  addPendingOperation(
    operationType,
    entityType,
    entityId,
    oldName,
    newName,
    projectId,
    userId,
    operationData = null
  ) {
    try {
      const stmt = db.prepare(`
        INSERT INTO pending_operations
        (operation_type, entity_type, entity_id, old_name, new_name, project_id, user_id, operation_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        operationType,
        entityType,
        entityId,
        oldName,
        newName,
        projectId,
        userId,
        operationData
      );

      if (result.changes > 0) {
        return { success: true, operationId: result.lastInsertRowid };
      } else {
        return { success: false, error: "Failed to add pending operation" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getPendingOperations(userId) {
    try {
      const stmt = db.prepare(`
        SELECT * FROM pending_operations
        WHERE user_id = ? AND processed = 0
        ORDER BY createdAt ASC
      `);

      const operations = stmt.all(userId);
      return { success: true, operations };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  markOperationAsProcessed(operationId) {
    try {
      const stmt = db.prepare(`
        UPDATE pending_operations
        SET processed = 1
        WHERE id = ?
      `);

      const result = stmt.run(operationId);

      if (result.changes > 0) {
        return { success: true };
      } else {
        return { success: false, error: "Operation not found" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  removePendingOperation(operationId) {
    try {
      const stmt = db.prepare(`
        DELETE FROM pending_operations
        WHERE id = ?
      `);

      const result = stmt.run(operationId);

      if (result.changes > 0) {
        return { success: true };
      } else {
        return { success: false, error: "Operation not found" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Helper functions for different operation types
  addPendingFileOperation(
    operationType,
    fileId,
    fileName,
    projectId,
    userId,
    operationData = null
  ) {
    return this.addPendingOperation(
      operationType,
      "FILE",
      fileId,
      fileName,
      null,
      projectId,
      userId,
      operationData
    );
  },

  addPendingProjectOperation(
    operationType,
    projectId,
    projectName,
    userId,
    operationData = null
  ) {
    return this.addPendingOperation(
      operationType,
      "PROJECT",
      projectId,
      projectName,
      null,
      projectId,
      userId,
      operationData
    );
  },

  addPendingVersionOperation(
    operationType,
    versionId,
    versionToken,
    projectId,
    userId,
    operationData = null
  ) {
    return this.addPendingOperation(
      operationType,
      "VERSION",
      versionId,
      versionToken,
      null,
      projectId,
      userId,
      operationData
    );
  },

  getEnvFileByName(projectId, fileName) {
    try {
      const stmt = db.prepare(
        "SELECT * FROM env_files WHERE project_id = ? AND name = ?"
      );
      const envFile = stmt.get(projectId, fileName);

      if (envFile) {
        return { success: true, envFile };
      } else {
        return { success: false, error: "Environment file not found" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

module.exports = { db, dbOps, sessionManager };
