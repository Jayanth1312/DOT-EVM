# DOT EVM - Environment Variable Management CLI

![EVM CLI Demo](./assets/EVM.png)

A Git-like CLI tool for managing environment variables across multiple projects with hybrid offline/online cloud synchronization, featuring advanced rollback capabilities and intelligent command suggestions.

## 🚀 Features

- **Git-like Workflow**: Use `evm add`, `evm push`, `evm sync`, and `evm revert` commands
- **Change Detection**: Automatically detects all `.env*` files (`.env`, `.env.prod`, `.env.test`, etc.)
- **Intelligent Command Suggestions**: Partial command matching with helpful suggestions
- **Hybrid Storage**: Local SQLite database with PostgreSQL cloud sync
- **Advanced Encryption**: AES-256-GCM encryption for secure storage
- **Project Management**: Organize environment files by project with automatic config cleanup
- **Version Control**: Complete history tracking with commit messages and version tokens
- **Rollback System**: Full rollback capabilities with cloud sync support
- **Compact Logging**: `--oneline` format for tabular commit history display
- **Multi-file Support**: Status and diff commands detect all environment file changes
- **Offline Support**: Works without internet connection, syncs when back online
- **User Authentication**: Secure user registration and login system

## 📋 Prerequisites

Before setting up the project, ensure you have:

- **Node.js** (v14 or higher)
- **npm** or **yarn**
- **Git**
- **PostgreSQL database** (for cloud sync - optional)
  - Recommended: [Neon](https://neon.tech/) for serverless PostgreSQL

## 🛠️ Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/Jayanth1312/EVM.git
cd EVM
```

### 2. Install Dependencies

```bash
# Install main CLI dependencies
npm install

# Install server dependencies
cd evm-server
npm install
cd ..
```

### 3. Generate RSA Key Pair

The CLI uses RSA encryption for password security:

```bash
node generateKeys.js
```

This creates:

- `keys/private.pem` - Private key for decryption
- `keys/public.pem` - Public key for encryption

### 4. Database Setup

#### Local Database (SQLite)

The local database is automatically created when you first run the CLI.

#### Cloud Database (PostgreSQL)

If you want cloud synchronization, set up the database schema from `postgres.txt`:

```sql
-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Projects table
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Environment files table
CREATE TABLE env_files (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    encrypted_content TEXT NOT NULL,
    iv VARCHAR(255) NOT NULL,
    tag VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Environment versions table
CREATE TABLE env_versions (
    id SERIAL PRIMARY KEY,
    env_file_id INTEGER REFERENCES env_files(id) ON DELETE CASCADE,
    version_token VARCHAR(255) NOT NULL,
    encrypted_content TEXT NOT NULL,
    iv VARCHAR(255) NOT NULL,
    tag VARCHAR(255) NOT NULL,
    commit_message TEXT,
    author_email VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rollback history table
CREATE TABLE rollback_history (
    id SERIAL PRIMARY KEY,
    env_file_id INTEGER REFERENCES env_files(id) ON DELETE CASCADE,
    from_version_token VARCHAR(255) NOT NULL,
    to_version_token VARCHAR(255) NOT NULL,
    rollback_reason TEXT,
    performed_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Configure environment variables in `evm-server/.env`:

```env
DATABASE_URL=your_postgresql_connection_string
PORT=4000
```

### 5. Install CLI Globally

```bash
npm install -g .
```

Or create a symlink for development:

```bash
npm link
```

## 🎯 Usage

### Basic Workflow

1. **Initialize a project** (first time):

```bash
evm init
```

2. **Register/Login**:

```bash
evm user
```

3. **Stage environment files**:

```bash
evm add
```

Automatically detects all `.env*` files and stages modified ones.

4. **Push staged files to local database**:

```bash
evm push
```

5. **Sync to cloud**:

```bash
evm sync
```

Syncs environment files, versions, and rollback history to cloud.

### Advanced Commands

#### Project Management

```bash
# List all projects and files
evm list

# Remove/delete a project
evm rm
```

#### Version Control & History

```bash
# View detailed commit history
evm log

# View compact tabular commit history
evm log --oneline

# Check project status
evm status

# View file differences
evm diff

# Rollback to a specific commit
evm revert <commit-hash>
```

#### Command Suggestions

The CLI provides intelligent command suggestions when you type partial commands:

```bash
# Typing partial commands shows suggestions
evm r     # Shows: rm, revert commands
evm lo    # Shows: log, login commands
```

### Command Reference

| Command             | Description               | Example                     |
| ------------------- | ------------------------- | --------------------------- |
| `evm init`          | Initialize new project    | `evm init`                  |
| `evm register`      | Register new user         | `evm register`              |
| `evm user`         | Login to account          | `evm user`                 |
| `evm add`           | Stage modified .env files | `evm add`                   |
| `evm push`          | Commit staged files       | `evm push` |
| `evm sync`          | Sync to cloud             | `evm sync`                  |
| `evm list`          | List projects and files   | `evm list`                  |
| `evm log`           | Show commit history       | `evm log`                   |
| `evm log --oneline` | Compact commit history    | `evm log --oneline`         |
| `evm status`        | Show file status          | `evm status`                |
| `evm diff`          | Show file differences     | `evm diff`                  |
| `evm revert <hash>` | Rollback to commit        | `evm revert abc123`         |
| `evm rm`            | Delete project            | `evm rm <project_name>`
| `evm rm`            | Delete project files          | `evm rm <project_name> <file_name>`                    |
| `evm rm --force`            | Delete project from cloud and localDB          | `evm rm <project_name> --force`
| `evm rm --force`            | Delete project files from cloud and localDB        | `evm rm <project_name> <file_name> --force`                    |

## 🏗️ Architecture

### Project Structure

```
evm-cli/
├── assets/               # Project assets
│   └── EVM.png
├── commands/            # Command implementations
│   ├── auth.js         # Authentication commands
│   ├── cloud.js        # Cloud sync operations
│   ├── core.js         # Core help and utilities
│   ├── legacy-auth.js  # Legacy authentication
│   ├── project.js      # Project management
│   └── workflow.js     # Git-like workflow commands
├── components/          # UI components
│   └── text-input.js   # Text input component
├── evm-server/         # Cloud sync server
│   ├── server.js       # Express server
│   ├── package.json    # Server dependencies
│   └── .env           # Server configuration
├── keys/              # RSA encryption keys
│   ├── private.pem    # Private key
│   └── public.pem     # Public key
├── index.js           # CLI entry point with command routing
├── db.js              # SQLite database operations
├── env-manager.js     # Environment file management
├── cli-ui.js          # Terminal UI components
├── login-ui.js        # Authentication interface
├── project-init.js    # Project initialization
├── generateKeys.js    # RSA key generation utility
├── evm.db            # SQLite database file
├── postgres.txt      # PostgreSQL schema reference
├── package.json      # CLI dependencies
├── LICENSE           # MIT License
└── README.md         # This file
```

### Key Components

#### Local Components

- **index.js**: Main CLI entry point with enhanced command routing and suggestions
- **db.js**: SQLite database operations with sync tracking capabilities
- **commands/**: Modular command implementations
  - `workflow.js`: Git-like operations (status, diff, log, revert)
  - `cloud.js`: Cloud synchronization with rollback history support
  - `project.js`: Project management with config file maintenance
  - `auth.js`: User authentication and registration
- **env-manager.js**: Core environment file management
- **cli-ui.js**: Terminal user interface components

#### Server Components

- **evm-server/server.js**: Express server with endpoints for:
  - User authentication (`/register`, `/login`)
  - Environment file sync (`/env-files`)
  - Version history sync (`/env-versions`)
  - Rollback history sync (`/rollback-history`)
  - Project management (`/projects`)

### Database Schema

#### Local SQLite Schema

- **users**: User authentication data
- **projects**: Project information with sync tracking
- **env_files**: Environment file data with encryption
- **env_versions**: Complete version history with sync status
- **rollback_history**: Rollback operations with cloud sync support

#### Cloud PostgreSQL Schema

Mirrors local schema with optimized indexes for cloud operations.

### Key Features Implementation

#### Intelligent Command Suggestions

```javascript
// Partial command matching with fuzzy search
const commandMap = {
  r: ["rm", "revert"],
  lo: ["log", "login"],
  st: ["status"],
  sy: ["sync"],
};
```

#### Multi-file Detection

```javascript
// Dynamic .env* file detection
const envFiles = fs
  .readdirSync(projectPath)
  .filter((file) => file.match(/^\.env/));
```

#### Sync Optimization

- Only syncs unsynced versions using `syncedToServer` flags
- Efficient batch operations for large projects
- Automatic retry mechanisms for failed syncs

#### Rollback System

- Complete file restoration to filesystem
- New commit creation for rollback operations
- Full history tracking with cloud synchronization

## 🌐 Cloud Sync

The enhanced cloud sync feature provides:

- **Complete Data Synchronization**: Environment files, versions, and rollback history
- **Efficient Sync**: Only uploads unsynced data to minimize bandwidth
- **Cross-platform Access**: Access files from multiple machines
- **Team Collaboration**: Share projects with team members
- **Backup & Recovery**: Secure cloud backup of all environment data

### Server Endpoints

| Endpoint            | Method | Purpose                  |
| ------------------- | ------ | ------------------------ |
| `/health`           | GET    | Health check             |
| `/register`         | POST   | User registration        |
| `/login`            | POST   | User authentication      |
| `/env-files`        | POST   | Sync environment files   |
| `/env-versions`     | POST   | Sync version history     |
| `/rollback-history` | POST   | Sync rollback operations |
| `/projects`         | DELETE | Delete projects          |

## 🔒 Security

- **RSA Encryption**: 2048-bit RSA key pair for password encryption
- **AES-256-GCM**: Environment file contents encrypted with AES
- **bcrypt**: Password hashing with salt rounds for database storage
- **PBKDF2**: Key derivation from user email for encryption keys
- **Secure Headers**: CORS and security headers on server endpoints

## 🐛 Troubleshooting

### Common Issues

1. **"RSA key not found"**:

   ```bash
   node generateKeys.js
   ```

2. **"evm command not found"**:

   ```bash
   npm install -g .
   # or
   npm link
   ```

3. **Cloud sync fails**:

   - Check server status: `http://localhost:4000/health`
   - Verify `DATABASE_URL` in `evm-server/.env`
   - Ensure PostgreSQL database is accessible
   - Check network connectivity

4. **Rollback history sync error**:

   - Verify PostgreSQL schema matches `postgres.txt`
   - Check column names match between local and cloud databases
   - Restart server after schema changes

5. **Command suggestions not working**:

   - Ensure you're using the latest version
   - Check if partial command exists in command map

6. **Multi-file detection issues**:
   - Ensure files follow `.env*` naming pattern
   - Check file permissions in project directory

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
# Set debug environment variable
export DEBUG=evm:*
evm sync
```

## 🔄 Version History

### Latest Updates

- ✅ **Command Autocompletion**: Intelligent partial command matching
- ✅ **Sync Optimization**: Only uploads unsynced versions and rollback history
- ✅ **Enhanced Rollback**: Complete file restoration with cloud sync
- ✅ **Compact Logging**: `--oneline` format for tabular display
- ✅ **Multi-file Detection**: Automatic detection of all `.env*` files
- ✅ **Config Management**: Automatic cleanup on project deletion
- ✅ **Rollback History Sync**: Complete cloud synchronization support

## 📝 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit a pull request

### Development Guidelines

- Follow existing code style and patterns
- Add comprehensive error handling
- Include debug logging for new features
- Update tests for new functionality
- Document new commands and features

## 📞 Support

If you encounter any issues or have questions:

1. Check the troubleshooting section above
2. Review the command reference and examples
3. Open an issue on GitHub with:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Node.js version)

## 🚀 Future Roadmap

- [ ] **Web Dashboard**: Browser-based project management
- [ ] **Team Permissions**: Role-based access control
- [ ] **Environment Templates**: Predefined environment configurations
- [ ] **Integration APIs**: REST APIs for external tool integration
- [ ] **Automated Backups**: Scheduled cloud backups
- [ ] **Audit Logging**: Comprehensive activity logging
- [ ] **Multi-cloud Support**: Support for multiple cloud providers

---

**Built with ❤️ using Node.js, Ink, SQLite, PostgreSQL, and Express**

_DOT EVM - Making environment variable management as easy as Git_
