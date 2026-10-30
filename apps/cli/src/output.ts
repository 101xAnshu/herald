import pc from "picocolors";

export const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

export const printTable = (
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index] ?? "").length)),
  );

  const line = (values: Array<string | number | null | undefined>, bold = false) =>
    values
      .map((value, index) => {
        const text = String(value ?? "");
        return (bold ? pc.bold(text) : text).padEnd(widths[index] ?? text.length);
      })
      .join("  ");

  process.stdout.write(`${line(headers, true)}\n`);
  process.stdout.write(`${pc.dim(widths.map((width) => "-".repeat(width)).join("  "))}\n`);

  for (const row of rows) {
    process.stdout.write(`${line(row)}\n`);
  }
};

export const ok = (message: string): void => {
  process.stdout.write(`${pc.green("ok")} ${message}\n`);
};

export const warn = (message: string): void => {
  process.stdout.write(`${pc.yellow("warn")} ${message}\n`);
};

export const fail = (message: string): void => {
  process.stderr.write(`${pc.red("fail")} ${message}\n`);
};

export const info = (message: string): void => {
  process.stdout.write(`${pc.dim(message)}\n`);
};

export const heading = (message: string): void => {
  process.stdout.write(`${pc.bold(message)}\n`);
};

export const check = (condition: boolean, label: string, detail?: string): void => {
  const mark = condition ? pc.green("✓") : pc.red("✗");
  process.stdout.write(`${mark} ${label}${detail ? ` ${pc.dim(detail)}` : ""}\n`);
};

export const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }

  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  return `${Math.floor(seconds / 86_400)}d ago`;
};
