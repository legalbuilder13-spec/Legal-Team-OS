import bolt from '@slack/bolt';
import { env } from './env';
import { registerLegalCommand } from './commands/legal';
import { registerAppMention } from './events/app-mention';
import { registerMessageEvents } from './events/message';

const { App, LogLevel } = bolt;

const app = new App({
  token: env.SLACK_BOT_TOKEN,
  signingSecret: env.SLACK_SIGNING_SECRET,
  socketMode: env.SOCKET_MODE,
  appToken: env.SLACK_APP_TOKEN,
  logLevel: process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG,
});

registerLegalCommand(app);
registerAppMention(app);
registerMessageEvents(app);

async function main() {
  await app.start(env.PORT);
  console.log(`Slack bot running on port ${env.PORT} (socketMode=${env.SOCKET_MODE})`);
}

main().catch((err) => {
  console.error('bot failed to start', err);
  process.exit(1);
});
