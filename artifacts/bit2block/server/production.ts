import express from "express";
import path from "path";
import { createServerApp } from "./app";

(async () => {
  const { app, server } = await createServerApp();
  const staticDirectory = path.resolve(import.meta.dirname, "public");
  app.use(express.static(staticDirectory));
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(staticDirectory, "index.html"));
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(port, "0.0.0.0", () => {
    console.info(`BIT2BLOCK production server listening on port ${port}`);
  });
})().catch((error) => {
  console.error("BIT2BLOCK production server failed to start:", error);
  process.exit(1);
});
