import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { notifyNewAppointment } from "../lib/n8n.js";

const router = Router();

export const STATUSES = ["agendado", "concluido", "cancelado", "nao_compareceu"];

const appointmentSchema = z.object({
  clientId: z.coerce.number().int().positive("Selecione um cliente"),
  serviceId: z.coerce.number().int().positive("Selecione um serviço"),
  scheduledAt: z.coerce.date({ errorMap: () => ({ message: "Data ou horário inválido" }) }),
});

const statusSchema = z.object({
  status: z.enum(STATUSES, { errorMap: () => ({ message: "Status inválido" }) }),
});

const fullInclude = {
  client: { select: { id: true, name: true, email: true } },
  service: { select: { id: true, name: true } },
};

// Regra de negócio central: não permitir dois agendamentos ativos no mesmo
// horário — exatamente o problema de "horários duplicados" do caderno físico.
async function findConflict(scheduledAt, ignoreId = null) {
  return prisma.appointment.findFirst({
    where: {
      scheduledAt,
      status: "agendado",
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
    include: fullInclude,
  });
}

// GET /api/appointments — agenda completa, ordenada por data e horário.
// Aceita ?from=YYYY-MM-DD&to=YYYY-MM-DD para filtrar um período.
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.from || req.query.to) {
      where.scheduledAt = {};
      if (req.query.from) where.scheduledAt.gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) where.scheduledAt.lte = new Date(`${req.query.to}T23:59:59`);
    }

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      include: fullInclude,
    });
    res.json(appointments);
  } catch (err) {
    next(err);
  }
});

// POST /api/appointments — cria um agendamento e dispara o e-mail via n8n
router.post("/", async (req, res, next) => {
  try {
    const parsed = appointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { clientId, serviceId, scheduledAt } = parsed.data;

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return res.status(400).json({ error: "Cliente não encontrado" });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return res.status(400).json({ error: "Serviço não encontrado" });

    const conflict = await findConflict(scheduledAt);
    if (conflict) {
      return res.status(409).json({
        error: `Este horário já está ocupado por ${conflict.client.name} (${conflict.service.name})`,
      });
    }

    const appointment = await prisma.appointment.create({
      data: { clientId, serviceId, scheduledAt },
      include: fullInclude,
    });

    // Automação: o n8n envia o e-mail de confirmação ao cliente.
    // Não bloqueia a resposta — o agendamento já está salvo.
    notifyNewAppointment(appointment);

    res.status(201).json(appointment);
  } catch (err) {
    next(err);
  }
});

// PUT /api/appointments/:id — edita data/horário, cliente ou serviço
router.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.appointment.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Agendamento não encontrado" });

    const parsed = appointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { clientId, serviceId, scheduledAt } = parsed.data;

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return res.status(400).json({ error: "Cliente não encontrado" });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return res.status(400).json({ error: "Serviço não encontrado" });

    const conflict = await findConflict(scheduledAt, id);
    if (conflict) {
      return res.status(409).json({
        error: `Este horário já está ocupado por ${conflict.client.name} (${conflict.service.name})`,
      });
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: { clientId, serviceId, scheduledAt },
      include: fullInclude,
    });
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/appointments/:id/status — atualiza apenas o status
router.patch("/:id/status", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.appointment.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Agendamento não encontrado" });

    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: { status: parsed.data.status },
      include: fullInclude,
    });
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/appointments/:id — remove um agendamento
router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.appointment.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Agendamento não encontrado" });

    await prisma.appointment.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
