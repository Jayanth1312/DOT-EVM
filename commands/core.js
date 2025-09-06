const chalk = require("chalk");

function showHelp() {
  console.log(
    chalk.blue.bold("\n📦 DOT EVM - Environment Variable Management CLI\n")
  );

  console.log(chalk.green.bold("CORE COMMANDS"));
  console.log(
    chalk.white("  evm") +
      chalk.gray("                          Launch interactive mode")
  );
  console.log(
    chalk.white("  evm login") +
      chalk.gray("                    User login or registration")
  );
  console.log(
    chalk.white("  evm register") +
      chalk.gray("                 User registration")
  );
  console.log(
    chalk.white("  evm whoami") +
      chalk.gray("                   Logged in user info")
  );
  console.log(
    chalk.white("  evm logout") +
      chalk.gray("                   Logout current user")
  );
  console.log(
    chalk.white("  evm init") +
      chalk.gray("                     Initialize a new project")
  );
  console.log(
    chalk.white("  evm --help or evm -h") +
      chalk.gray("         Show this help message")
  );

  console.log(chalk.green.bold("\nWORKFLOW"));
  console.log(
    chalk.white("  evm add") +
      chalk.gray("                      Stage environment files for commit")
  );
  console.log(
    chalk.white("  evm add .") +
      chalk.gray("                    Stage all changed files for commit")
  );
  console.log(
    chalk.white("  evm push") +
      chalk.gray(
        "                     Commit staged changes to local database and cloud"
      )
  );
  // console.log(
  //   chalk.white("  evm pull") +
  //     chalk.gray("                   Pull environment data from database")
  // );
  console.log(
    chalk.white("  evm status") +
      chalk.gray("                   Show status of changed files")
  );
  console.log(
    chalk.white("  evm diff") +
      chalk.gray(
        "                     Show changes between local and last commit"
      )
  );
  console.log(
    chalk.white("  evm log") +
      chalk.gray("                      Show commit history")
  );
  console.log(
    chalk.white("  evm log --oneline") +
      chalk.gray("            Show commit history in compact table")
  );
  console.log(
    chalk.white("  evm sync") +
      chalk.gray(
        "                     Manually sync local files to cloud (optional)"
      )
  );

  console.log(chalk.green.bold("\nPROJECT MANAGEMENT"));
  console.log(
    chalk.white("  evm list") +
      chalk.gray("                     List files in current project")
  );
  console.log(
    chalk.white("  evm <proj> list") +
      chalk.gray("              List files in specific project")
  );
  console.log(
    chalk.white("  evm list --all") +
      chalk.gray(
        "               List all projects and files of the current user"
      )
  );

  // console.log(
  //   chalk.white("  evm clone") +
  //     chalk.gray("                  Clone a project from database")
  // );
  console.log(
    chalk.white("  evm rename <name>") +
      chalk.gray("            Rename current project")
  );
  console.log(
    chalk.white("  evm rename <old> <new>") +
      chalk.gray("     Rename environment file")
  );
  console.log(
    chalk.white("  evm rm <filename>") +
      chalk.gray("           Remove file from current project")
  );
  console.log(
    chalk.white("  evm rm <filename> --force") +
      chalk.gray("   Remove file (local + cloud)")
  );

  console.log(chalk.green.bold("\nVERSION CONTROL"));
  console.log(
    chalk.white("  evm revert <hash>") +
      chalk.gray("            Rollback to previous commit")
  );
  console.log(
    chalk.white("  evm rollback history") +
      chalk.gray("         View rollback history")
  );

  console.log(chalk.blue.bold("\nEXAMPLES:"));
  console.log(
    chalk.gray("  evm init                     # Start a new project")
  );
  console.log(
    chalk.gray(
      "  evm add                      # Stage changed .env files (interactive)"
    )
  );
  console.log(
    chalk.gray("  evm add .                    # Stage all changed .env files")
  );
  console.log(
    chalk.gray(
      "  evm push                     # Commit staged files to local DB and cloud"
    )
  );
  console.log(
    chalk.gray(
      "  evm sync                     # Manually sync files to cloud (optional)"
    )
  );
  console.log(
    chalk.gray("  evm list                     # List files in current project")
  );
  console.log(
    chalk.gray("  evm myproject list           # List files in 'myproject'")
  );
  console.log(
    chalk.gray("  evm list --all               # List files in current project")
  );
  console.log(
    chalk.gray("  evm rename newname           # Rename current project")
  );
  console.log(
    chalk.gray("  evm rename .env .env.prod    # Rename .env to .env.prod")
  );
  console.log(
    chalk.gray("  evm log                      # View commit history")
  );
  console.log(
    chalk.gray("  evm revert abc123            # Rollback to commit abc123")
  );
  console.log(
    chalk.gray("  evm rollback history         # View rollback history\n")
  );
}

module.exports = {
  showHelp,
};
