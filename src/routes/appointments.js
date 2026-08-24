import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { notifyNewAppointment } from "../lib/n8n.js";

const router = Router();

export const STATUSES = ["agendado", "concluido", "cancelado", "nao_compareceu"];

const appointmentSchema = z.object({
  clientId: z.coerce.number().int().positive("Selecione um cliente"),
  serviceId: z.coerce.number().int().positive("Selecione um serviço"),
  // Profissional é opcional no uso interno (o funcionário pode definir depois)
  barberId: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? null : v),
    z.coerce.number().int().positive("Profissional inválido").nullable()
  ),
  scheduledAt: z.coerce.date({ errorMap: () => ({ message: "Data ou horário inválido" }) }),
});

const statusSchema = z.object({
  status: z.enum(STATUSES, { errorMap: () => ({ message: "Status inválido" }) }),
});

const fullInclude = {
  client: { select: { id: true, name: true, email: true } },
  service: { select: { id: true, name: true } },
  barber: { select: { id: true, name: true } },
};

// Regra de negócio central: não permitir dois agendamentos ativos no mesmo
// horário PARA O MESMO profissional — o problema de "horários duplicados"
// do caderno físico. Agendamentos sem profissional definido conflitam
// entre si (uma "cadeira" própria).
async function findConflict(scheduledAt, barberId, ignoreId = null) {
  return prisma.appointment.findFirst({
    where: {
      scheduledAt,
      barberId,
      status: "agendado",
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
    include: fullInclude,
  });
}

// GET /api/appointments — agenda completa, ordenada por data e horário.
// Aceita ?from=YYYY-MM-DD&to=YYYY-MM-DD e ?barberId=N para filtrar.
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.barberId) {
      const barberId = Number(req.query.barberId);
      if (!Number.isInteger(barberId) || barberId <= 0) {
        return res.status(400).json({ error: "Profissional inválido" });
      }
      where.barberId = barberId;
    }
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
    const { clientId, serviceId, barberId, scheduledAt } = parsed.data;

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return res.status(400).json({ error: "Cliente não encontrado" });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return res.status(400).json({ error: "Serviço não encontrado" });

    if (barberId) {
      const barber = await prisma.barber.findUnique({ where: { id: barberId } });
      if (!barber) return res.status(400).json({ error: "Profissional não encontrado" });
    }

    const conflict = await findConflict(scheduledAt, barberId);
    if (conflict) {
      return res.status(409).json({
        error: `Este horário já está ocupado por ${conflict.client.name} (${conflict.service.name})${conflict.barber ? ` com ${conflict.barber.name}` : ""}`,
      });
    }

    const appointment = await prisma.appointment.create({
      data: { clientId, serviceId, barberId, scheduledAt },
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
    const { clientId, serviceId, barberId, scheduledAt } = parsed.data;

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return res.status(400).json({ error: "Cliente não encontrado" });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return res.status(400).json({ error: "Serviço não encontrado" });

    if (barberId) {
      const barber = await prisma.barber.findUnique({ where: { id: barberId } });
      if (!barber) return res.status(400).json({ error: "Profissional não encontrado" });
    }

    const conflict = await findConflict(scheduledAt, barberId, id);
    if (conflict) {
      return res.status(409).json({
        error: `Este horário já está ocupado por ${conflict.client.name} (${conflict.service.name})${conflict.barber ? ` com ${conflict.barber.name}` : ""}`,
      });
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: { clientId, serviceId, barberId, scheduledAt },
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
