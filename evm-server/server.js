require("dotenv").config();
const express = require("express");
const { neon } = require("@neondatabase/serverless");
const chalk = require("chalk");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const sql = neon(process.env.DATABASE_URL);
const app = express();

// JWT Configuration
const JWT_SECRET =
  process.env.JWT_SECRET || "evm-default-secret-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";

// Middleware
app.use(cors());
app.use(express.json());

// JWT Utilities
const generateTokens = (userId, email) => {
  const payload = { userId, email };

  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: "evm-cli",
  });

  const refreshToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    issuer: "evm-cli",
  });

  return { token, refreshToken };
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: "Token expired" });
  }

  req.user = decoded;
  next();
};

// Store for refresh tokens (in production, use Redis or database)
const refreshTokens = new Set();

// Auth Routes

// Register
app.post("/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Check if user already exists
    const existingUser = await sql`
      SELECT id FROM users WHERE email = ${email}
    `;

    if (existingUser.length > 0) {
      return res.status(409).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate a unique salt for encryption
    const crypto = require("crypto");
    const encryptionSalt = crypto.randomBytes(32).toString("hex");

    const result = await sql`
      INSERT INTO users (email, password, encryption_salt, created_at)
      VALUES (${email}, ${hashedPassword}, ${encryptionSalt}, NOW())
      RETURNING id, email, created_at
    `;

    const user = result[0];
    const { token, refreshToken } = generateTokens(user.id, user.email);

    // Store refresh token
    refreshTokens.add(refreshToken);

    console.log(chalk.green(`[SUCCESS] User registered: ${email}`));

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
      },
      token,
      refreshToken,
    });
  } catch (err) {
    console.error(chalk.red("[ERROR] Registration failed:"), err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const result = await sql`
      SELECT id, email, password, created_at FROM users WHERE email = ${email}
    `;

    if (result.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Update last login (only if column exists)
    try {
      await sql`
        UPDATE users SET last_login = NOW() WHERE id = ${user.id}
      `;
    } catch (error) {
      // Column might not exist, that's okay for now
      console.log(
        chalk.yellow(
          "[WARNING] Could not update last_login - column may not exist"
        )
      );
    }

    const { token, refreshToken } = generateTokens(user.id, user.email);

    // Store refresh token
    refreshTokens.add(refreshToken);

    console.log(chalk.green(`[SUCCESS] User logged in: ${email}`));

    res.json({
      success: true,
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
      },
      token,
      refreshToken,
    });
  } catch (err) {
    console.error(chalk.red("[ERROR] Login failed:"), err);
    res.status(500).json({ error: "Login failed" });
  }
});

// Refresh Token
app.post("/auth/refresh", (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ error: "Refresh token required" });
  }

  if (!refreshTokens.has(refreshToken)) {
    return res.status(403).json({ error: "Invalid refresh token" });
  }

  const decoded = verifyToken(refreshToken);
  if (!decoded) {
    refreshTokens.delete(refreshToken);
    return res.status(403).json({ error: "Invalid refresh token" });
  }

  // Generate new tokens
  const { token, refreshToken: newRefreshToken } = generateTokens(
    decoded.userId,
    decoded.email
  );

  // Remove old refresh token and add new one
  refreshTokens.delete(refreshToken);
  refreshTokens.add(newRefreshToken);

  res.json({
    success: true,
    token,
    refreshToken: newRefreshToken,
  });
});

// Logout
app.post("/auth/logout", authenticateToken, (req, res) => {
  // Remove refresh token if provided
  const { refreshToken } = req.body;
  if (refreshToken) {
    refreshTokens.delete(refreshToken);
  }

  console.log(chalk.blue(`[INFO] User logged out: ${req.user.email}`));
  res.json({ success: true, message: "Logged out successfully" });
});

// Get current user
app.get("/auth/me", authenticateToken, async (req, res) => {
  try {
    const result = await sql`
      SELECT id, email, created_at FROM users WHERE id = ${req.user.userId}
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      user: result[0],
    });
  } catch (err) {
    console.error(chalk.red("[ERROR] Failed to fetch user:"), err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// Backward compatibility endpoint for older clients
app.get("/user", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const result = await sql`
      SELECT id, email, created_at FROM users WHERE email = ${email}
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true, user: result[0] });
  } catch (err) {
    console.error(chalk.red("[ERROR] Failed to fetch user:"), err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Protected endpoints - Environment file operations

// Sync environment files endpoint
app.post("/env-files", authenticateToken, async (req, res) => {
  try {
    const {
      project_name,
      file_name,
      encrypted_content,
      iv,
      tag,
      created_at,
      updated_at,
    } = req.body;

    const user_email = req.user.email; // Get from JWT token
    const userId = req.user.userId; // Get from JWT token

    console.log(
      chalk.yellow(`[SYNC] Syncing ${file_name} for user ${user_email}`)
    );

    // Check if project exists, create if not
    let projectResult = await sql`
      SELECT id FROM projects WHERE user_id = ${userId} AND name = ${project_name}
    `;

    let projectId;
    if (projectResult.length === 0) {
      console.log(chalk.yellow(`[SYNC] Creating new project: ${project_name}`));
      const newProject = await sql`
        INSERT INTO projects (user_id, name, created_at)
        VALUES (${userId}, ${project_name}, NOW())
        RETURNING id
      `;
      projectId = newProject[0].id;
    } else {
      projectId = projectResult[0].id;
    }

    // Check if file already exists
    const existingFile = await sql`
      SELECT id FROM env_files
      WHERE project_id = ${projectId} AND name = ${file_name}
    `;

    if (existingFile.length > 0) {
      // Update existing file with proper date handling
      const updateQuery = updated_at
        ? sql`
            UPDATE env_files
            SET encrypted_content = ${encrypted_content},
                iv = ${iv},
                tag = ${tag},
                updated_at = ${updated_at}
            WHERE id = ${existingFile[0].id}
          `
        : sql`
            UPDATE env_files
            SET encrypted_content = ${encrypted_content},
                iv = ${iv},
                tag = ${tag},
                updated_at = NOW()
            WHERE id = ${existingFile[0].id}
          `;

      await updateQuery;
      console.log(chalk.green(`[SYNC] Updated ${file_name} successfully`));
    } else {
      // Insert new file with proper date handling
      const insertQuery =
        created_at && updated_at
          ? sql`
            INSERT INTO env_files (project_id, name, encrypted_content, iv, tag, created_at, updated_at)
            VALUES (${projectId}, ${file_name}, ${encrypted_content}, ${iv}, ${tag}, ${created_at}, ${updated_at})
          `
          : sql`
            INSERT INTO env_files (project_id, name, encrypted_content, iv, tag, created_at, updated_at)
            VALUES (${projectId}, ${file_name}, ${encrypted_content}, ${iv}, ${tag}, NOW(), NOW())
          `;

      await insertQuery;
      console.log(chalk.green(`[SYNC] Created ${file_name} successfully`));
    }

    res.json({ success: true, message: "File synced successfully" });
  } catch (err) {
    console.error(chalk.red("[ERROR] Sync failed:"), err);
    res.status(500).json({ error: "Sync failed: " + err.message });
  }
});

// Sync environment file versions endpoint
app.post("/env-versions", authenticateToken, async (req, res) => {
  try {
    const {
      project_name,
      file_name,
      version_token,
      encrypted_content,
      iv,
      tag,
      commit_message,
      author_email,
      created_at,
    } = req.body;

    const user_email = req.user.email; // Get from JWT token
    const userId = req.user.userId; // Get from JWT token

    console.log(
      chalk.yellow(
        `[VERSION] Syncing version ${version_token} for ${file_name} (user: ${user_email})`
      )
    );

    // Get project ID
    const projectResult = await sql`
      SELECT id FROM projects WHERE user_id = ${userId} AND name = ${project_name}
    `;

    if (projectResult.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = projectResult[0].id;

    // Get env file ID
    const envFileResult = await sql`
      SELECT id FROM env_files WHERE project_id = ${projectId} AND name = ${file_name}
    `;

    if (envFileResult.length === 0) {
      return res.status(404).json({ error: "Environment file not found" });
    }

    const envFileId = envFileResult[0].id;

    // Check if version already exists
    const existingVersion = await sql`
      SELECT id FROM env_versions
      WHERE env_file_id = ${envFileId} AND version_token = ${version_token}
    `;

    if (existingVersion.length === 0) {
      // Insert new version
      await sql`
        INSERT INTO env_versions (
          env_file_id,
          version_token,
          encrypted_content,
          iv,
          tag,
          commit_message,
          author_email,
          created_at
        )
        VALUES (
          ${envFileId},
          ${version_token},
          ${encrypted_content},
          ${iv},
          ${tag},
          ${commit_message},
          ${author_email},
          ${created_at || "NOW()"}
        )
      `;
      console.log(
        chalk.green(`[VERSION] Created version ${version_token} successfully`)
      );
    } else {
      console.log(
        chalk.gray(
          `[VERSION] Version ${version_token} already exists, skipping`
        )
      );
    }

    res.json({ success: true, message: "Version synced successfully" });
  } catch (err) {
    console.error(chalk.red("[ERROR] Version sync failed:"), err);
    res.status(500).json({ error: "Version sync failed: " + err.message });
  }
});

// Sync rollback history endpoint
app.post("/rollback-history", authenticateToken, async (req, res) => {
  try {
    const {
      project_name,
      file_name,
      from_version_token,
      to_version_token,
      reason,
      performed_by,
      created_at,
    } = req.body;

    const user_email = req.user.email; // Get from JWT token
    const userId = req.user.userId; // Get from JWT token

    console.log(
      chalk.yellow(
        `[ROLLBACK] Syncing rollback from ${from_version_token} to ${to_version_token} for ${file_name} (user: ${user_email})`
      )
    );

    // Get project ID
    const projectResult = await sql`
      SELECT id FROM projects WHERE user_id = ${userId} AND name = ${project_name}
    `;

    if (projectResult.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = projectResult[0].id;

    // Get env file ID
    const envFileResult = await sql`
      SELECT id FROM env_files WHERE project_id = ${projectId} AND name = ${file_name}
    `;

    if (envFileResult.length === 0) {
      return res.status(404).json({ error: "Environment file not found" });
    }

    const envFileId = envFileResult[0].id;

    // Check if rollback entry already exists
    const existingRollback = await sql`
      SELECT id FROM rollback_history
      WHERE env_file_id = ${envFileId}
        AND from_version_token = ${from_version_token}
        AND to_version_token = ${to_version_token}
        AND created_at = ${created_at}
    `;

    if (existingRollback.length === 0) {
      // Insert new rollback entry
      await sql`
        INSERT INTO rollback_history (
          env_file_id,
          from_version_token,
          to_version_token,
          rollback_reason,
          performed_by,
          created_at
        )
        VALUES (
          ${envFileId},
          ${from_version_token},
          ${to_version_token},
          ${reason},
          ${performed_by},
          ${created_at || "NOW()"}
        )
      `;
      console.log(
        chalk.green(`[ROLLBACK] Created rollback entry successfully`)
      );
    } else {
      console.log(
        chalk.gray(`[ROLLBACK] Rollback entry already exists, skipping`)
      );
    }

    res.json({
      success: true,
      message: "Rollback history synced successfully",
    });
  } catch (err) {
    console.error(chalk.red("[ERROR] Rollback history sync failed:"), err);
    res
      .status(500)
      .json({ error: "Rollback history sync failed: " + err.message });
  }
});

// Delete project endpoint
app.delete("/projects", authenticateToken, async (req, res) => {
  try {
    const { project_name } = req.body;

    const user_email = req.user.email; // Get from JWT token
    const userId = req.user.userId; // Get from JWT token

    console.log(
      chalk.yellow(
        `[DELETE] Deleting project "${project_name}" for user ${user_email}`
      )
    );

    // Get project ID
    const projectResult = await sql`
      SELECT id FROM projects WHERE user_id = ${userId} AND name = ${project_name}
    `;

    if (projectResult.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = projectResult[0].id;

    // Start transaction-like deletion
    // First, get all env files for cascade deletion
    const envFiles = await sql`
      SELECT id FROM env_files WHERE project_id = ${projectId}
    `;

    // Delete all versions for each env file
    for (const envFile of envFiles) {
      await sql`DELETE FROM env_versions WHERE env_file_id = ${envFile.id}`;
      await sql`DELETE FROM rollback_history WHERE env_file_id = ${envFile.id}`;
    }

    // Delete all env files
    await sql`DELETE FROM env_files WHERE project_id = ${projectId}`;

    // Finally delete the project
    await sql`DELETE FROM projects WHERE id = ${projectId}`;

    console.log(
      chalk.green(`[DELETE] Project "${project_name}" deleted successfully`)
    );
    res.json({ success: true, message: "Project deleted successfully" });
  } catch (err) {
    console.error(chalk.red("[ERROR] Project deletion failed:"), err);
    res.status(500).json({ error: "Project deletion failed: " + err.message });
  }
});

// Delete env file endpoint
app.delete("/env-files", authenticateToken, async (req, res) => {
  try {
    const { project_name, file_name } = req.body;

    const user_email = req.user.email; // Get from JWT token
    const userId = req.user.userId; // Get from JWT token

    console.log(
      chalk.yellow(
        `[DELETE] Deleting file "${file_name}" from project "${project_name}" for user ${user_email}`
      )
    );

    // Get project ID
    const projectResult = await sql`
      SELECT id FROM projects WHERE user_id = ${userId} AND name = ${project_name}
    `;

    if (projectResult.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectId = projectResult[0].id;

    // Get env file ID
    const envFileResult = await sql`
      SELECT id FROM env_files WHERE project_id = ${projectId} AND name = ${file_name}
    `;

    if (envFileResult.length === 0) {
      return res.status(404).json({ error: "Environment file not found" });
    }

    const envFileId = envFileResult[0].id;

    // Delete cascade: versions and rollback history first
    await sql`DELETE FROM env_versions WHERE env_file_id = ${envFileId}`;
    await sql`DELETE FROM rollback_history WHERE env_file_id = ${envFileId}`;

    // Delete the env file
    await sql`DELETE FROM env_files WHERE id = ${envFileId}`;

    console.log(
      chalk.green(`[DELETE] File "${file_name}" deleted successfully`)
    );
    res.json({
      success: true,
      message: "Environment file deleted successfully",
    });
  } catch (err) {
    console.error(chalk.red("[ERROR] File deletion failed:"), err);
    res.status(500).json({ error: "File deletion failed: " + err.message });
  }
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(
    chalk.green(`[SERVER] EVM Server running on http://localhost:${PORT}`)
  );
  console.log(chalk.blue(`[INFO] JWT Authentication enabled`));
  console.log(
    chalk.yellow(`[SECURITY] Remember to set JWT_SECRET in production!`)
  );
});
