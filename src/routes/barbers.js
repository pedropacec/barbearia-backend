import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { scheduleLabel } from "../lib/schedule.js";

const router = Router();

// GET /api/barbers — profissionais da casa com a escala legível
router.get("/", async (_req, res, next) => {
  try {
    const barbers = await prisma.barber.findMany({ orderBy: { name: "asc" } });
    res.json(barbers.map((b) => ({ id: b.id, name: b.name, schedule: scheduleLabel(b) })));
  } catch (err) {
    next(err);
  }
});

export default router;
