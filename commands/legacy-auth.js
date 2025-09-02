const chalk = require("chalk");
const axios = require("axios");
const { dbOps } = require("../db");
const loginUI = require("../login-ui");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Load public key for encryption
const publicKey = fs.readFileSync(
  path.join(__dirname, "..", "keys", "public.pem"),
  "utf8"
);

function encryptPassword(password) {
  return crypto
    .publicEncrypt(publicKey, Buffer.from(password))
    .toString("base64");
}

async function promptCredentials() {
  return loginUI.promptCredentials();
}

async function legacyLogin() {
  const { email, password } = await promptCredentials();

  console.log(chalk.yellow("[INFO] Checking local database..."));
  const localResult = await dbOps.verifyUser(email, password);

  if (localResult.success) {
    console.log(chalk.green("[SUCCESS] Local login successful!"));
    console.log(chalk.blue(`[INFO] Welcome back, ${email}!`));

    try {
      const encryptedPassword = encryptPassword(password);
      await axios.post("http://localhost:4000/login", {
        email,
        password: encryptedPassword,
      });
      console.log(chalk.blue("[INFO] Synced with server successfully"));
    } catch (err) {
      console.log(chalk.yellow("[WARNING] Server sync failed (offline mode)"));
    }
    process.exit(0);
  }

  console.log(chalk.yellow("[INFO] Local login failed, trying server..."));
  try {
    const encryptedPassword = encryptPassword(password);
    const res = await axios.post("http://localhost:4000/login", {
      email,
      password: encryptedPassword,
    });

    const createResult = await dbOps.createUser(email, password, true);
    if (createResult.success) {
      console.log(chalk.blue("[INFO] User cached locally for offline access"));
    }
    console.log(chalk.green("[SUCCESS]"), res.data.message);
    process.exit(0);
  } catch (err) {
    console.error(
      chalk.red("[ERROR] Login failed:"),
      err.response?.data || err.message
    );
    process.exit(1);
  }
}

// Register function
async function legacyRegister() {
  const { email, password } = await promptCredentials();

  try {
    const encryptedPassword = encryptPassword(password);
    const res = await axios.post("http://localhost:4000/register", {
      email,
      password: encryptedPassword,
    });

    const localResult = await dbOps.createUser(email, password, true);
    if (localResult.success) {
      console.log(chalk.blue("[INFO] User stored locally for offline access"));
    }
    console.log(chalk.green("[SUCCESS]"), res.data.message);
    process.exit(0);
  } catch (err) {
    console.log(
      chalk.yellow("[WARNING] Server registration failed, storing locally only")
    );
    const localResult = await dbOps.createUser(email, password, false);

    if (localResult.success) {
      console.log(
        chalk.green("[SUCCESS] User registered locally (offline mode)")
      );
      console.log(
        chalk.yellow("[INFO] Will sync to server when connection is restored")
      );
      process.exit(0);
    } else {
      console.error(
        chalk.red("[ERROR] Local registration failed:"),
        localResult.error
      );
      process.exit(1);
    }
  }
}

module.exports = {
  promptCredentials,
  legacyLogin,
  legacyRegister,
  encryptPassword,
};
