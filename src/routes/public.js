import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { notifyNewAppointment } from "../lib/n8n.js";
import { scheduleLabel, slotsForBarberDate } from "../lib/schedule.js";

// Rotas públicas do agendamento online (página do cliente).
// O cliente apenas CRIA uma solicitação de horário; visualizar e
// gerenciar a agenda continua restrito aos funcionários logados.

const router = Router();

// Limite simples de abuso: no máximo 5 agendamentos por IP por hora
const bookingLog = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (bookingLog.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= 5) return true;
  recent.push(now);
  bookingLog.set(ip, recent);
  return false;
}

// GET /api/public/services — serviços oferecidos (leitura pública)
router.get("/services", async (_req, res, next) => {
  try {
    const services = await prisma.service.findMany({ orderBy: { id: "asc" } });
    res.json(services);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/barbers — profissionais e suas escalas
router.get("/barbers", async (_req, res, next) => {
  try {
    const barbers = await prisma.barber.findMany({ orderBy: { name: "asc" } });
    res.json(barbers.map((b) => ({ id: b.id, name: b.name, schedule: scheduleLabel(b) })));
  } catch (err) {
    next(err);
  }
});

// GET /api/public/availability?date=YYYY-MM-DD&barberId=N
// Horários livres do profissional escolhido naquele dia
router.get("/availability", async (req, res, next) => {
  try {
    const dateStr = String(req.query.date || "");
    const barberId = Number(req.query.barberId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: "Data inválida" });
    }
    if (!Number.isInteger(barberId) || barberId <= 0) {
      return res.status(400).json({ error: "Escolha o profissional" });
    }

    const barber = await prisma.barber.findUnique({ where: { id: barberId } });
    if (!barber) return res.status(400).json({ error: "Profissional não encontrado" });

    const slots = slotsForBarberDate(barber, dateStr);
    if (slots === null) return res.status(400).json({ error: "Data inválida" });
    if (slots.length === 0) return res.json({ open: false, slots: [] });

    // Remove horários já ocupados DESTE profissional
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59`);
    const taken = await prisma.appointment.findMany({
      where: { status: "agendado", barberId, scheduledAt: { gte: dayStart, lte: dayEnd } },
      select: { scheduledAt: true },
    });
    const takenTimes = new Set(taken.map((a) => a.scheduledAt.getTime()));

    const free = slots
      .filter((s) => !takenTimes.has(s.getTime()))
      .map((s) => ({
        iso: s.toISOString(),
        label: s.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      }));

    res.json({ open: true, slots: free });
  } catch (err) {
    next(err);
  }
});

const bookingSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome"),
  email: z.string().trim().toLowerCase().email("Email inválido"),
  serviceId: z.coerce.number().int().positive("Selecione um serviço"),
  barberId: z.coerce.number().int().positive("Escolha o profissional"),
  scheduledAt: z.coerce.date({ errorMap: () => ({ message: "Horário inválido" }) }),
});

// POST /api/public/bookings — cria a solicitação de agendamento
router.post("/bookings", async (req, res, next) => {
  try {
    if (rateLimited(req.ip)) {
      return res.status(429).json({ error: "Muitas tentativas. Tente novamente em instantes." });
    }

    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { name, email, serviceId, barberId, scheduledAt } = parsed.data;

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return res.status(400).json({ error: "Serviço não encontrado" });

    const barber = await prisma.barber.findUnique({ where: { id: barberId } });
    if (!barber) return res.status(400).json({ error: "Profissional não encontrado" });

    // O horário precisa ser um slot válido DA ESCALA do profissional
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = `${scheduledAt.getFullYear()}-${pad(scheduledAt.getMonth() + 1)}-${pad(scheduledAt.getDate())}`;
    const valid = (slotsForBarberDate(barber, dateStr) || []).some(
      (s) => s.getTime() === scheduledAt.getTime()
    );
    if (!valid) {
      return res.status(400).json({ error: "Este horário não está disponível para este profissional" });
    }

    const conflict = await prisma.appointment.findFirst({
      where: { scheduledAt, barberId, status: "agendado" },
    });
    if (conflict) {
      return res.status(409).json({ error: "Este horário acabou de ser ocupado. Escolha outro." });
    }

    // Reaproveita o cadastro se o email já for cliente da casa
    let client = await prisma.client.findFirst({ where: { email } });
    if (!client) {
      client = await prisma.client.create({ data: { name, email } });
    }

    const appointment = await prisma.appointment.create({
      data: { clientId: client.id, serviceId, barberId, scheduledAt },
      include: {
        client: { select: { id: true, name: true, email: true } },
        service: { select: { id: true, name: true } },
        barber: { select: { id: true, name: true } },
      },
    });

    // Mesmo fluxo do sistema interno: n8n envia o e-mail de confirmação
    notifyNewAppointment(appointment);

    // Resposta mínima: nada além do que o próprio cliente informou
    res.status(201).json({
      service: service.name,
      barber: barber.name,
      scheduledAt: appointment.scheduledAt,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
