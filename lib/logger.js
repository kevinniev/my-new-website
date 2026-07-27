/**
 * Structured logger for Vercel functions.
 * Outputs JSON lines that are easily parsed in Vercel's log viewer.
 */

export function log(level, message, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    env: process.env.VERCEL_ENV || "development",
    ...data,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export const logger = {
  info: (msg, data) => log("info", msg, data),
  warn: (msg, data) => log("warn", msg, data),
  error: (msg, data) => log("error", msg, data),
  debug: (msg, data) => {
    if (process.env.DEBUG === "true") log("debug", msg, data);
  },
};

/**
 * Named logger factory — creates a logger with a specific prefix.
 * @param {string} name
 */
export function createLogger(name) {
  return {
    info: (msg, data) => log("info", `[${name}] ${msg}`, data),
    warn: (msg, data) => log("warn", `[${name}] ${msg}`, data),
    error: (msg, data) => log("error", `[${name}] ${msg}`, data),
    debug: (msg, data) => {
      if (process.env.DEBUG === "true") log("debug", `[${name}] ${msg}`, data);
    },
  };
}

export default logger;
