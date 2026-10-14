function stamp(): string {
  return new Date().toISOString();
}

export const log = {
  info: (...args: unknown[]): void => console.log(stamp(), '[info]', ...args),
  warn: (...args: unknown[]): void => console.warn(stamp(), '[warn]', ...args),
  error: (...args: unknown[]): void => console.error(stamp(), '[error]', ...args),
};
