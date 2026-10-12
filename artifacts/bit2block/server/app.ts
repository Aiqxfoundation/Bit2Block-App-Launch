import express, { type NextFunction, type Request, type Response } from "express";
import { registerRoutes } from "./routes";
import { initStorage, storage } from "./storage";
import { pool } from "./db";

export async function createServerApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  await initStorage();
  await storage.ensurePrimaryAdmin();

  app.get("/api/healthz", async (_req, res) => {
    try {
      await pool!.query("SELECT 1");
      res.status(200).json({ ok: true, database: "connected" });
    } catch {
      res.status(503).json({ ok: false, database: "unavailable" });
    }
  });

  const server = await registerRoutes(app);

  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = error.status || error.statusCode || 500;
    const message = status >= 500 ? "Internal Server Error" : error.message;
    console.error("[Express Error]", status, error);
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });

  return { app, server };
}
