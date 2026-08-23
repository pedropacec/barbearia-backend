import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

// GET /api/services — lista os serviços oferecidos pela barbearia
router.get("/", async (_req, res, next) => {
  try {
    const services = await prisma.service.findMany({ orderBy: { id: "asc" } });
    res.json(services);
  } catch (err) {
    next(err);
  }
});

export default router;
