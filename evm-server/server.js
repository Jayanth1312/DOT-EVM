require("dotenv").config();
const express = require("express");
const { neon } = require("@neondatabase/serverless");
const chalk = require("chalk");
const crypto = require("crypto");
const fs = require("fs");
const bcrypt = require("bcrypt");

const sql = neon(process.env.DATABASE_URL);
const app = express();

const privateKey = fs.readFileSync("../keys/private.pem", "utf8");

app.use(express.json());

app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    let decryptedPassword;
    try {
      decryptedPassword = crypto
        .privateDecrypt(privateKey, Buffer.from(password, "base64"))
        .toString();
    } catch (e) {
      return res.status(400).json({ error: "Password decryption failed" });
    }

    const hashedPassword = await bcrypt.hash(decryptedPassword, 10);

    await sql`
      INSERT INTO users (email, password)
      VALUES (${email}, ${hashedPassword})
    `;

    res.json({ success: true, message: "User registered!" });
  } catch (err) {
    console.error(chalk.red("[ERROR] Registration failed:"), err);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    let decryptedPassword;
    try {
      decryptedPassword = crypto
        .privateDecrypt(privateKey, Buffer.from(password, "base64"))
        .toString();
    } catch (e) {
      return res.status(400).json({ error: "Password decryption failed" });
    }

    const result = await sql`
      SELECT * FROM users WHERE email = ${email}
    `;

    console.log(
      chalk.yellow(
        `[DEBUG] User lookup for ${email}: Found ${result.length} users`
      )
    );

    if (result.length === 0) {
      console.log(chalk.yellow("[DEBUG] User not found, auto-registering..."));
      try {
        const hashedPassword = await bcrypt.hash(decryptedPassword, 10);
        await sql`
          INSERT INTO users (email, password)
          VALUES (${email}, ${hashedPassword})
        `;
        console.log(chalk.green("[SUCCESS] User auto-registered successfully"));
        return res.json({
          success: true,
          message: "User registered and logged in!",
        });
      } catch (registerErr) {
        console.error(
          chalk.red("[ERROR] Auto-registration failed:"),
          registerErr
        );
        return res.status(500).json({ error: "Registration failed" });
      }
    }

    const user = result[0];
    console.log(
      chalk.yellow(`[DEBUG] Comparing decrypted password with bcrypt hash`)
    );

    const isPasswordValid = await bcrypt.compare(
      decryptedPassword,
      user.password
    );

    if (!isPasswordValid) {
      console.log(
        chalk.red("[DEBUG] Password mismatch - sending invalid credentials")
      );
      return res.status(401).json({ error: "Invalid credentials" });
    }

    console.log(chalk.green("[SUCCESS] Password match - login successful"));

    res.json({ success: true, message: "Login successful!" });
  } catch (err) {
    console.error(chalk.red("[ERROR] Login failed:"), err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/user", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const result = await sql`
      SELECT * FROM users WHERE email = ${email}
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

// Sync environment files endpoint
app.post("/env-files", async (req, res) => {
  try {
    const {
      user_email,
      project_name,
      file_name,
      encrypted_content,
      iv,
      tag,
      created_at,
      updated_at,
    } = req.body;

    console.log(
      chalk.yellow(`[SYNC] Syncing ${file_name} for user ${user_email}`)
    );

    // First, get the user ID
    const userResult = await sql`
      SELECT id FROM users WHERE email = ${user_email}
    `;

    if (userResult.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult[0].id;

    // Check if project exists, create if not
    let projectResult = await sql`
      SELECT id FROM projects WHERE user_id = ${userId} AND name = ${project_name}
    `;

    let projectId;
    if (projectResult.length === 0) {
      console.log(chalk.yellow(`[SYNC] Creating new project: ${project_name}`));
      const newProject = await sql`
        INSERT INTO projects (user_id, name)
        VALUES (${userId}, ${project_name})
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
            INSERT INTO env_files (project_id, name, encrypted_content, iv, tag)
            VALUES (${projectId}, ${file_name}, ${encrypted_content}, ${iv}, ${tag})
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
app.post("/env-versions", async (req, res) => {
  try {
    const {
      user_email,
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

    console.log(
      chalk.yellow(
        `[VERSION] Syncing version ${version_token} for ${file_name} (user: ${user_email})`
      )
    );

    // First, get the user ID
    const userResult = await sql`
      SELECT id FROM users WHERE email = ${user_email}
    `;

    if (userResult.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult[0].id;

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
          ${created_at}
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
app.post("/rollback-history", async (req, res) => {
  try {
    const {
      user_email,
      project_name,
      file_name,
      from_version_token,
      to_version_token,
      reason,
      performed_by,
      created_at,
    } = req.body;

    console.log(
      chalk.yellow(
        `[ROLLBACK] Syncing rollback from ${from_version_token} to ${to_version_token} for ${file_name} (user: ${user_email})`
      )
    );

    // First, get the user ID
    const userResult = await sql`
      SELECT id FROM users WHERE email = ${user_email}
    `;

    if (userResult.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult[0].id;

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
          ${created_at}
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
app.delete("/projects", async (req, res) => {
  try {
    const { user_email, project_name } = req.body;

    console.log(
      chalk.yellow(
        `[DELETE] Deleting project "${project_name}" for user ${user_email}`
      )
    );

    // Get user ID
    const userResult = await sql`
      SELECT id FROM users WHERE email = ${user_email}
    `;

    if (userResult.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult[0].id;

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
app.delete("/env-files", async (req, res) => {
  try {
    const { user_email, project_name, file_name } = req.body;

    console.log(
      chalk.yellow(
        `[DELETE] Deleting file "${file_name}" from project "${project_name}" for user ${user_email}`
      )
    );

    // Get user ID
    const userResult = await sql`
      SELECT id FROM users WHERE email = ${user_email}
    `;

    if (userResult.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult[0].id;

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

app.listen(process.env.PORT || 3000, () => {
  console.log(
    chalk.green(
      `[SERVER] Running on http://localhost:${process.env.PORT || 3000}`
    )
  );
});
