const enabled = !process.env.NO_COLOR && (process.env.FORCE_COLOR !== undefined || (process.stdout.isTTY ?? false));

function wrap(code: string) {
  return (s: string) => (enabled ? `\u001b[${code}m${s}\u001b[0m` : s);
}

export const colors = {
  enabled,
  red: wrap('31'),
  yellow: wrap('33'),
  cyan: wrap('36'),
  gray: wrap('90'),
  bold: wrap('1'),
  dim: wrap('2'),
  underline: wrap('4'),
  green: wrap('32'),
  magenta: wrap('35'),
};
