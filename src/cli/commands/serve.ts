import { Command } from 'commander';

export const serveCommand = new Command('serve')
  .description('Start the memex daemon')
  .action(async () => {
    try {
      const { startDaemon } = await import('../../daemon.js');
      await startDaemon();
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });
