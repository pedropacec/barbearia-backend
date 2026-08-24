import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const router = Router();

const clientSchema = z.object({
  name: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres").max(80, "Nome muito longo"),
  email: z.string().trim().email("Email inválido"),
  phone: z.string().trim().max(20, "Telefone muito longo").optional().or(z.literal("")),
  notes: z.string().trim().max(500, "Observações muito longas").optional().or(z.literal("")),
});

// GET /api/clients — lista os clientes, com contagem de atendimentos e a
// data do último corte concluído (para calcular "há quanto tempo" no front)
router.get("/", async (_req, res, next) => {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { appointments: true } },
        appointments: {
          where: { status: "concluido" },
          orderBy: { scheduledAt: "desc" },
          take: 1,
          select: { scheduledAt: true },
        },
      },
    });
    // Achata o último corte num campo simples e remove a lista auxiliar
    const withLastCut = clients.map(({ appointments, ...c }) => ({
      ...c,
      lastCutAt: appointments[0]?.scheduledAt ?? null,
    }));
    res.json(withLastCut);
  } catch (err) {
    next(err);
  }
});

// POST /api/clients — cadastra um novo cliente
router.post("/", async (req, res, next) => {
  try {
    const parsed = clientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { name, email, phone, notes } = parsed.data;
    const client = await prisma.client.create({
      data: { name, email, phone: phone || null, notes: notes || null },
    });
    res.status(201).json(client);
  } catch (err) {
    next(err);
  }
});

// PUT /api/clients/:id — edita um cliente existente
router.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = clientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const { name, email, phone, notes } = parsed.data;
    const client = await prisma.client.update({
      where: { id },
      data: { name, email, phone: phone || null, notes: notes || null },
    });
    res.json(client);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/clients/:id — remove o cliente (e seus agendamentos, em cascata)
router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    await prisma.client.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
