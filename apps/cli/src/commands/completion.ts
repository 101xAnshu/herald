import type { Command } from "commander";

const commands = [
  "init", "doctor", "config", "completion", "version", "seed", "reset", "demo",
  "send", "batch", "simulate", "notifications", "trace", "tail", "health", "stats",
  "inbox", "campaign", "dlq", "source", "provider", "failover", "keys", "templates",
];

const bash = `_herald_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${commands.join(" ")}"
  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
}
complete -F _herald_complete herald
`;

const zsh = `#compdef herald
_herald() {
  local -a commands
  commands=(${commands.map((command) => `'${command}'`).join(" ")})
  _describe 'command' commands
}
compdef _herald herald
`;

const fish = commands.map((command) => `complete -c herald -f -a "${command}"`).join("\n") + "\n";

export const registerCompletionCommand = (program: Command): void => {
  program
    .command("completion <shell>")
    .description("print shell completion for bash, zsh, or fish")
    .action((shell: string) => {
      if (shell === "bash") {
        process.stdout.write(bash);
        return;
      }

      if (shell === "zsh") {
        process.stdout.write(zsh);
        return;
      }

      if (shell === "fish") {
        process.stdout.write(fish);
        return;
      }

      throw new Error("shell must be bash, zsh, or fish");
    });
};
