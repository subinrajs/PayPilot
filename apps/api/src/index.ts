import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
const app = buildServer();

app.listen({ port }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
