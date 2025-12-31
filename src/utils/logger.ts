export function log(message: string, ...args: unknown[]): void {
  console.log(`[${new Date().toISOString()}]`, message, ...args);
}

export function error(message: string, ...args: unknown[]): void {
  console.error(`[${new Date().toISOString()}] ERROR:`, message, ...args);
}

export function warn(message: string, ...args: unknown[]): void {
  console.warn(`[${new Date().toISOString()}] WARN:`, message, ...args);
}

export function debug(message: string, ...args: unknown[]): void {
  if (process.env.DEBUG) {
    console.log(`[${new Date().toISOString()}] DEBUG:`, message, ...args);
  }
}
