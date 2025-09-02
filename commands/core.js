const chalk = require("chalk");

function showHelp() {
  console.log(
    chalk.blue.bold("\n📦 DOT EVM - Environment Variable Management CLI\n")
  );

  console.log(chalk.green.bold("CORE COMMANDS"));
  console.log(
    chalk.white("  evm") +
      chalk.gray("                        Launch interactive mode")
  );
  console.log(
    chalk.white("  evm login") +
      chalk.gray("                  User login or registration")
  );
  console.log(
    chalk.white("  evm init") +
      chalk.gray("                   Initialize a new project")
  );
  console.log(
    chalk.white("  evm --help or evm -h") +
      chalk.gray("       Show this help message")
  );

  console.log(chalk.green.bold("\nWORKFLOW"));
  console.log(
    chalk.white("  evm add") +
      chalk.gray("                    Stage environment files for commit")
  );
  console.log(
    chalk.white("  evm push") +
      chalk.gray(
        "                   Commit staged changes to local database and cloud"
      )
  );
  console.log(
    chalk.white("  evm pull") +
      chalk.gray("                   Pull environment data from database")
  );
  console.log(
    chalk.white("  evm status") +
      chalk.gray("                 Show status of changed files")
  );
  console.log(
    chalk.white("  evm diff") +
      chalk.gray(
        "                   Show changes between local and last commit"
      )
  );
  console.log(
    chalk.white("  evm log") +
      chalk.gray("                    Show commit history")
  );
  console.log(
    chalk.white("  evm log --oneline") +
      chalk.gray("           Show commit history in compact table")
  );
  console.log(
    chalk.white("  evm sync") +
      chalk.gray(
        "                   Manually sync local files to cloud (optional)"
      )
  );

  console.log(chalk.green.bold("\nPROJECT MANAGEMENT"));
  console.log(
    chalk.white("  evm list") +
      chalk.gray("                   List files in current project")
  );
  console.log(
    chalk.white("  evm -l") +
      chalk.gray("                     List files in current project")
  );
  console.log(
    chalk.white("  evm <proj> list") +
      chalk.gray("            List files in specific project")
  );
  console.log(
    chalk.white("  evm <proj> -l") +
      chalk.gray("              List files in specific project")
  );
  console.log(
    chalk.white("  evm clone") +
      chalk.gray("                  Clone a project from database")
  );
  console.log(
    chalk.white("  evm rename <name>") +
      chalk.gray("          Rename current project")
  );
  console.log(
    chalk.white("  evm rename <proj> <file>") +
      chalk.gray("   Rename environment file")
  );
  console.log(
    chalk.white("  evm rm <project>") +
      chalk.gray("           Remove project locally")
  );
  console.log(
    chalk.white("  evm rm <project> --force") +
      chalk.gray("     Remove project (local + cloud)")
  );
  console.log(
    chalk.white("  evm rm <proj> <file>") +
      chalk.gray("       Remove file locally")
  );
  console.log(
    chalk.white("  evm rm <proj> <file> --force") +
      chalk.gray(" Remove file (local + cloud)")
  );

  console.log(chalk.green.bold("\nVERSION CONTROL"));
  console.log(
    chalk.white("  evm revert <hash>") +
      chalk.gray("          Rollback to previous commit")
  );
  console.log(
    chalk.white("  evm rollback history") +
      chalk.gray("      View rollback history")
  );

  console.log(chalk.blue.bold("\nEXAMPLES:"));
  console.log(
    chalk.gray("  evm init                     # Start a new project")
  );
  console.log(
    chalk.gray("  evm add                      # Stage all changed .env files")
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
    chalk.gray("  evm rename newname           # Rename current project")
  );
  console.log(
    chalk.gray("  evm rename myproj .env.prod  # Rename file in project")
  );
  console.log(
    chalk.gray("  evm log                      # View commit history")
  );
  console.log(
    chalk.gray("  evm revert abc123            # Rollback to commit abc123")
  );
  console.log(
    chalk.gray("  evm rollback history         # View rollback history")
  );

  console.log(
    chalk.yellow.bold("\nNOTE:") +
      chalk.gray(" Some commands are not yet implemented.")
  );
  console.log(
    chalk.gray(
      "For more information, visit: https://github.com/Jayanth1312/EVM\n"
    )
  );
}

module.exports = {
  showHelp,
};
