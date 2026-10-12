import { setupVite, log } from "./vite";
import { createServerApp } from "./app";

(async () => {
  const { app, server } = await createServerApp();

  await setupVite(app, server);

  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
  });
})().catch((error) => {
  console.error("BIT2BLOCK development server failed to start:", error);
  process.exit(1);
});
