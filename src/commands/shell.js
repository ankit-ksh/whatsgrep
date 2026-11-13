import { createInterface } from 'node:readline';
import { COMMANDS_HELP, runCommand } from './commands.js';

// Splits a line like a shell would: spaces separate words, quotes group them.
export function tokenize(line) {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

export function runShell(ctx) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'whatsgrep> ' });
  console.log(`whatsgrep shell. Type "help" for commands, "exit" to leave.\nconfig: ${ctx.configFile}`);
  rl.prompt();
  // A password typed in the shell is not echoed.
  const askSecret = (label) => new Promise((resolve) => {
    const write = rl._writeToOutput;
    rl._writeToOutput = (t) => { if (t.startsWith(label)) write.call(rl, t); };
    rl.question(label, (a) => { rl._writeToOutput = write; process.stdout.write('\n'); resolve(a); });
  });
  const shellCtx = { ...ctx, askSecret };
  rl.on('line', async (line) => {
    const argv = tokenize(line.trim());
    const [cmd] = argv;
    if (cmd === 'exit' || cmd === 'quit') return rl.close();
    if (cmd === 'help' || cmd === '?') console.log(COMMANDS_HELP);
    else if (cmd) {
      try {
        const out = await runCommand(argv, shellCtx);
        if (out) console.log(out);
      } catch (e) {
        console.error(`error: ${e.message}`);
      }
    }
    rl.prompt();
  });
  return new Promise((resolve) => rl.on('close', resolve));
}
