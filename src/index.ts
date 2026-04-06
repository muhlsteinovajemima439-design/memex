#!/usr/bin/env node

import { Command } from 'commander';
import { serveCommand } from './cli/commands/serve.js';
import { createCommand } from './cli/commands/create.js';
import { destroyCommand } from './cli/commands/destroy.js';
import { configCommand } from './cli/commands/config.js';
import { loginCommand } from './cli/commands/login.js';
import { ingestCommand } from './cli/commands/ingest.js';
import { queryCommand } from './cli/commands/query.js';
import { lintCommand } from './cli/commands/lint.js';
import { logsCommand } from './cli/commands/logs.js';
import { listCommand } from './cli/commands/list.js';
import { chownCommand } from './cli/commands/chown.js';
import { statusCommand } from './cli/commands/status.js';

const program = new Command();

program
  .name('memex')
  .description('Isolated, queued claude -p runtime for persistent knowledge bases')
  .version('0.1.0');

program.addCommand(serveCommand);
program.addCommand(createCommand);
program.addCommand(destroyCommand);
program.addCommand(configCommand);
program.addCommand(loginCommand);
program.addCommand(ingestCommand);
program.addCommand(queryCommand);
program.addCommand(lintCommand);
program.addCommand(logsCommand);
program.addCommand(listCommand);
program.addCommand(chownCommand);
program.addCommand(statusCommand);

program.parseAsync().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
