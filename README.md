# DOT EVM - Environment Variable Manager

[![npm version](https://badge.fury.io/js/@jayanth1312%2Fevm-cli.svg)](https://badge.fury.io/js/@jayanth1312%2Fevm-cli)
[![npm downloads](https://img.shields.io/npm/dt/@jayanth1312/evm-cli.svg)](https://www.npmjs.com/package/@jayanth1312/evm-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![EVM CLI Demo](./assets/EVM.png)

A Git-like CLI tool for managing environment variables across projects with encryption and cloud synchronization.

## 📦 NPM Package

This tool is now available as an npm package! Install globally and use from anywhere.

## ✨ Features

- **Git-like Workflow**: `add`, `push`, `pull`, `sync`, `revert` commands
- **Intelligent Operations**: Smart rename detection, selective pull, offline queue
- **Multi-file Support**: Automatic detection of `.env*` files
- **AES-256 Encryption**: Secure storage with user-specific salts
- **Project Management**: Organize variables by project with dynamic commands
- **Cloud Sync**: PostgreSQL cloud backup with offline support and pending operations
- **Version Control**: Complete history with rollback capabilities
- **Command Intelligence**: Partial command matching and suggestions
- **Filesystem Sync**: Git-like file operations (rm removes from disk + DB)
- **Cross-platform**: Works on Windows, macOS, Linux

## 🚀 Installation & Quick Start

### Install from npm (Recommended)

```bash
# Install globally
npm install -g @jayanth1312/evm-cli

# Or use with npx (no installation required)
npx @jayanth1312/evm-cli
```

### Install from Source

```bash
# Clone the repository
git clone https://github.com/Jayanth1312/DOT-EVM.git
cd DOT-EVM

# Install dependencies and setup
npm install
npm run postinstall
```

### Setup & Authentication

```bash
# Register a new account
evm register

# Or login with existing account
evm login

# Verify you're logged in
evm whoami
```

### Basic Usage

```bash
# Initialize project
evm init

# Stage environment files
evm add

# Commit to local database
evm push

# Pull missing files from cloud
evm pull

# Sync to cloud (optional)
evm sync

# View status
evm status

# Show history
evm log

# Rename files or projects intelligently
evm rename new_project_name    # Rename project
evm rename .env .env.prod      # Rename file

# Remove files (Git-like behavior)
evm rm .env.old                # Remove from DB + filesystem
evm rm .env.temp --force       # Remove locally + from cloud
```

## 📋 Commands

### Core Commands

| Command              | Description            |
| -------------------- | ---------------------- |
| `evm init`           | Initialize new project |
| `evm login/register` | User authentication    |
| `evm whoami`         | Show logged in user    |
| `evm logout`         | Logout current user    |

### Workflow Commands

| Command      | Description                   |
| ------------ | ----------------------------- |
| `evm add`    | Stage modified .env files     |
| `evm add .`  | Stage all changed files       |
| `evm push`   | Commit staged files           |
| `evm pull`   | Pull missing files from cloud |
| `evm sync`   | Sync to/from cloud            |
| `evm status` | Show file status              |

### Project Management

| Command                     | Description                   |
| --------------------------- | ----------------------------- |
| `evm list`                  | List files in current project |
| `evm list --all`            | List all projects and files   |
| `evm rename <new_name>`     | Rename current project        |
| `evm rename <old> <new>`    | Rename environment file       |
| `evm rm <filename>`         | Remove file (DB + filesystem) |
| `evm rm <filename> --force` | Remove file (local + cloud)   |

### Version Control

| Command                | Description            |
| ---------------------- | ---------------------- |
| `evm log`              | Show commit history    |
| `evm log --oneline`    | Compact commit history |
| `evm diff`             | Show file differences  |
| `evm revert <hash>`    | Rollback to commit     |
| `evm rollback history` | View rollback history  |

### Advanced Commands

| Command       | Description                  |
| ------------- | ---------------------------- |
| `evm pending` | Show pending operations      |
| `evm clone`   | Clone projects (coming soon) |

## 🎯 Key Improvements

### Smart Command Detection

- **Dynamic Rename**: `evm rename` automatically detects project vs file renames
- **Intelligent Pull**: Only pulls files missing from filesystem or newer in cloud
- **Context Aware**: Commands adapt based on current state and arguments

### Offline-First Architecture

- **Pending Operations**: Queue operations when offline for later sync
- **Git-like Behavior**: `rm` command removes from both database AND filesystem
- **Selective Sync**: Pull only what you need, skip what's already up to date

### Enhanced User Experience

- **Project Name Validation**: Prevents invalid project names (no leading dots)
- **Clear Status Messages**: Detailed feedback on what operations are performed
- **Version History Preservation**: Pull restores complete file history and metadata

## 🏗️ Architecture

```
~/.evm/                    # User data directory
├── evm.db                # SQLite database
├── config.json           # Configuration
├── session.json          # User session
└── projects/             # Project files

evm-cli/                  # CLI source
├── commands/             # Command modules
├── evm-server/           # Cloud sync server
└── components/           # UI components
```

## 🔧 Configuration

- **Database**: SQLite (local) + PostgreSQL (cloud)
- **Encryption**: AES-256-GCM with user-specific salts
- **Authentication**: JWT tokens
- **Server**: Express.js with REST API

## 📦 Package Information

- **Package**: `@jayanth1312/evm-cli`
- **Version**: 1.0.0
- **Command**: `evm`
- **Repository**: [GitHub](https://github.com/Jayanth1312/DOT-EVM)
- **NPM**: [npm package](https://www.npmjs.com/package/@jayanth1312/evm-cli)

## 🛠️ Development

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Local Development

```bash
# Clone and setup
git clone https://github.com/Jayanth1312/DOT-EVM.git
cd DOT-EVM
npm install

# Run locally
node index.js

# Run tests (when available)
npm test
```

## 📦 Dependencies

- Node.js v14+
- npm/yarn
- PostgreSQL (optional, for cloud sync)

## 🔒 Security

- AES-256-GCM for environment data
- bcrypt password hashing
- User-specific encryption salts

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

**Built with ❤️ using Node.js, SQLite, PostgreSQL, and Express**
