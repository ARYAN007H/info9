/**
 * Minimal hand-rolled CLI argument parser — no external dependencies.
 * Supported forms:
 *   info9 <command> [args...] [--flag] [--key=value]
 */

export interface CliInvocation {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

export const CLI_COMMANDS = [
  'connectors',
  'recon',
  'geocode',
  'landmarks',
  'weather',
  'entity',
  'screen',
  'help',
] as const;

export function parseCliArgs(argv: string[]): CliInvocation {
  const [command = 'help', ...rest] = argv;
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (const token of rest) {
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq === -1) {
        flags[body] = true;
      } else {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      }
    } else {
      args.push(token);
    }
  }
  return { command, args, flags };
}
