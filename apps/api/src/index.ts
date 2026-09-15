import "dotenv/config";
import { buildServer } from "./server.js";
import { startTelegramBot } from "./telegram/bot.js";

const port = Number(process.env.PORT ?? 3000);
const app = buildServer();

app.listen({ port }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Wired here rather than in buildServer() — server.ts is reused directly by route tests, and
  // starting a real long-polling Telegram bot as a side effect of building the Fastify instance
  // would leak into those. A missing TELEGRAM_BOT_TOKEN just skips this, same as a missing
  // STRIPE_SECRET_KEY/OPENAI_API_KEY only breaks the routes that need it, not the whole server.
  startTelegramBot(app.log);
});
