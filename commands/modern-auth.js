const chalk = require("chalk");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { dbOps, sessionManager } = require("../db");
const loginUI = require("../login-ui");

// Configuration
const SERVER_URL = process.env.EVM_SERVER_URL || "http://localhost:4000";
const JWT_SECRET =
  process.env.JWT_SECRET || "evm-default-secret-change-in-production";

/**
 * Modern JWT-based authentication
 */
class ModernAuth {
  constructor() {
    this.axiosInstance = axios.create({
      baseURL: SERVER_URL,
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Add request interceptor to include JWT token
    this.axiosInstance.interceptors.request.use(
      (config) => {
        const token = this.getStoredToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for token refresh
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (
          error.response?.status === 401 &&
          error.response?.data?.error === "Token expired"
        ) {
          console.log(
            chalk.yellow("[INFO] Token expired, attempting refresh...")
          );
          const refreshed = await this.refreshToken();
          if (refreshed) {
            // Retry the original request
            const originalRequest = error.config;
            originalRequest.headers.Authorization = `Bearer ${this.getStoredToken()}`;
            return this.axiosInstance.request(originalRequest);
          } else {
            console.log(
              chalk.red("[ERROR] Session expired. Please log in again.")
            );
            sessionManager.clearSession();
            process.exit(1);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get stored JWT token from session
   */
  getStoredToken() {
    const session = sessionManager.getCurrentUser();
    return session?.token;
  }

  /**
   * Verify if a JWT token is valid and not expired
   */
  isTokenValid(token) {
    if (!token) return false;

    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) return false;

      const currentTime = Math.floor(Date.now() / 1000);
      return decoded.exp > currentTime;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if user is currently authenticated
   */
  isAuthenticated() {
    const token = this.getStoredToken();
    return this.isTokenValid(token);
  }

  /**
   * Prompt user for credentials
   */
  async promptCredentials() {
    return loginUI.promptCredentials();
  }

  /**
   * Register a new user
   */
  async register() {
    const { email, password } = await this.promptCredentials();

    console.log(chalk.yellow("[INFO] Registering with server..."));

    try {
      const response = await this.axiosInstance.post("/auth/register", {
        email,
        password,
      });

      const { token, refreshToken, user } = response.data;

      // Create local user and get local ID
      const localResult = await dbOps.createUser(email, password, true);
      let localUserId;

      if (localResult.success) {
        localUserId = localResult.userId;
        console.log(
          chalk.blue("[INFO] User cached locally for offline access")
        );
      } else {
        // If user already exists locally, get their ID
        const existingUser = dbOps.getUserByEmail(email);
        if (existingUser) {
          localUserId = existingUser.id;
        } else {
          throw new Error("Failed to create or find local user");
        }
      }

      // Store session with LOCAL user ID, not server ID
      sessionManager.setCurrentUser(
        user.email,
        localUserId,
        token,
        refreshToken
      );

      console.log(chalk.green("[SUCCESS] Registration successful!"));
      console.log(chalk.blue(`[INFO] Welcome, ${user.email}!`));

      return { success: true, user, token };
    } catch (error) {
      if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        console.log(
          chalk.yellow("[WARNING] Server unavailable, registering locally only")
        );
        return this.registerOffline(email, password);
      } else if (error.response?.status === 409) {
        console.error(chalk.red("[ERROR] User already exists"));
        throw error;
      } else if (error.response?.data?.error) {
        console.error(chalk.red("[ERROR]"), error.response.data.error);
        throw error;
      } else {
        console.error(chalk.red("[ERROR] Registration failed:"), error.message);
        throw error;
      }
    }
  }

  /**
   * Register user locally when server is unavailable
   */
  async registerOffline(email, password) {
    const localResult = await dbOps.createUser(email, password, false);

    if (localResult.success) {
      // Create a temporary local session (no server token)
      sessionManager.setCurrentUser(email, localResult.userId, null, null);

      console.log(
        chalk.green("[SUCCESS] User registered locally (offline mode)")
      );
      console.log(
        chalk.yellow("[INFO] Will sync to server when connection is restored")
      );

      return { success: true, offline: true };
    } else {
      console.error(
        chalk.red("[ERROR] Local registration failed:"),
        localResult.error
      );
      throw new Error(localResult.error);
    }
  }

  async login() {
    const { email, password } = await this.promptCredentials();

    console.log(chalk.yellow("[INFO] Authenticating ..."));
    try {
      const serverAuth = await this.authenticateWithServer(email, password);

      if (serverAuth.success) {
        // Find or create local user and get the local ID
        let localUserId;
        const existingLocalUser = dbOps.getUserByEmail(serverAuth.user.email);

        if (existingLocalUser) {
          localUserId = existingLocalUser.id;
        } else {
          // Create local user
          const localResult = await dbOps.createUser(email, password, true);
          if (localResult.success) {
            localUserId = localResult.userId;
            console.log(
              chalk.blue("[INFO] User cached locally for offline access")
            );
          } else {
            throw new Error("Failed to create local user");
          }
        }

        // Store session with LOCAL user ID, not server ID
        sessionManager.setCurrentUser(
          serverAuth.user.email,
          localUserId, // Use LOCAL ID here
          serverAuth.token,
          serverAuth.refreshToken
        );

        console.log(chalk.green("[SUCCESS] Login successful!"));
        console.log(chalk.blue(`[INFO] Welcome, ${serverAuth.user.email}!`));

        return { success: true };
      }
    } catch (error) {
      if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        console.log(
          chalk.yellow(
            "[WARNING] Server unavailable, trying local authentication..."
          )
        );

        const localResult = await dbOps.verifyUser(email, password);

        if (localResult.success) {
          sessionManager.setCurrentUser(email, localResult.userId, null, null);

          console.log(
            chalk.green("[SUCCESS] Local authentication successful!")
          );
          console.log(chalk.yellow("[INFO] Running in offline mode"));
          console.log(chalk.blue(`[INFO] Welcome back, ${email}!`));

          return { success: true };
        } else {
          console.error(
            chalk.red("[ERROR] Local authentication failed:"),
            localResult.error
          );
          throw new Error(
            "Authentication failed - server unavailable and no local credentials found"
          );
        }
      } else if (error.response?.status === 401) {
        console.error(chalk.red("[ERROR] Invalid credentials"));
        throw error;
      } else {
        console.error(chalk.red("[ERROR] Login failed:"), error.message);
        throw error;
      }
    }
  }

  async authenticateWithServer(email, password) {
    const response = await this.axiosInstance.post("/auth/login", {
      email,
      password,
    });

    return response.data;
  }

  async refreshToken() {
    try {
      const session = sessionManager.getCurrentUser();
      if (!session?.refreshToken) {
        return false;
      }

      const response = await this.axiosInstance.post("/auth/refresh", {
        refreshToken: session.refreshToken,
      });

      const { token, refreshToken } = response.data;

      sessionManager.updateTokens(token, refreshToken);

      return true;
    } catch (error) {
      console.log(chalk.red("[ERROR] Token refresh failed:"), error.message);
      return false;
    }
  }

  async logout() {
    try {
      const token = this.getStoredToken();

      if (token) {
        await this.axiosInstance.post("/auth/logout");
      }
    } catch (error) {
      console.log(
        chalk.yellow("[WARNING] Server logout failed (offline mode)")
      );
    }

    sessionManager.clearSession();
    console.log(chalk.green("[SUCCESS] Logged out successfully"));
  }

  async getCurrentUser(localOnly = false) {
    const session = sessionManager.getCurrentUser();
    if (!session) {
      return null;
    }

    // Always try to get the local user ID for database operations
    let localUserId = session.userId;

    // If we have a server session and not in local-only mode, try to get fresh data
    if (!localOnly && session.token && this.isAuthenticated()) {
      try {
        // Get fresh user data from server
        const response = await this.axiosInstance.get("/auth/me");
        const serverUser = response.data.user;

        // Find the local user record
        const localUser = dbOps.getUserByEmail(serverUser.email);
        if (localUser) {
          localUserId = localUser.id;
        }

        return {
          email: serverUser.email,
          id: localUserId,
          serverId: serverUser.id,
          source: "server",
        };
      } catch (error) {
        console.log(
          chalk.yellow(
            "[WARNING] Could not fetch user data from server, using cached data"
          )
        );
      }
    }

    // Return cached user data with local ID
    return {
      email: session.email,
      id: localUserId,
      source: "local",
    };
  }

  async requireAuth(localOnly = false) {
    if (!this.isAuthenticated() && !sessionManager.isLoggedIn()) {
      console.log(chalk.yellow("[INFO] Authentication required"));
      await this.login();
    }

    return this.getCurrentUser(localOnly);
  }
}

module.exports = {
  ModernAuth,
  JWT_SECRET,
  SERVER_URL,
};
