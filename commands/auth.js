const chalk = require("chalk");
const { ModernAuth } = require("./modern-auth");

// Initialize modern auth
const modernAuth = new ModernAuth();

async function handleLogin(args) {
  console.log(chalk.blue("[INFO] USER LOGIN"));
  await modernAuth.login();
}

async function handleRegister(args) {
  console.log(chalk.blue("[INFO] USER REGISTRATION"));
  await modernAuth.register();
}

async function handleLogout(args) {
  await modernAuth.logout();
}

async function handleWhoami(args) {
  const user = await modernAuth.getCurrentUser();
  if (user) {
    console.log(chalk.green("[INFO] Current user:"));
    console.log(chalk.blue(`  Email: ${user.email}`));
    console.log(chalk.blue(`  ID: ${user.id}`));
    if (modernAuth.isAuthenticated()) {
      console.log(chalk.green(`  Status: Online`));
    } else {
      console.log(chalk.yellow(`  Status: Offline`));
    }
  } else {
    console.log(chalk.red("[ERROR] Not logged in"));
    process.exit(1);
  }
}

async function requireAuth(localOnly = false) {
  return await modernAuth.requireAuth(localOnly);
}

module.exports = {
  handleLogin,
  handleRegister,
  handleLogout,
  handleWhoami,
  requireAuth,
  modernAuth,
};
