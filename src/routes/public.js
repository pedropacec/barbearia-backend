import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { notifyNewAppointment } from "../lib/n8n.js";

// Rotas públicas do agendamento online (página do cliente).
// O cliente apenas CRIA uma solicitação de horário; visualizar e
// gerenciar a agenda continua restrito aos funcionários logados.

const router = Router();

// Horário de funcionamento: [abre, fecha] por dia da semana (0 = domingo).
// Domingo e segunda fechados — mesmo quadro exibido na página.
const BUSINESS_HOURS = {
  0: null,
  1: null,
  2: [9, 19],
  3: [9, 19],
  4: [9, 19],
  5: [9, 19],
  6: [8, 18],
};

const SLOT_MINUTES = 30;
const MIN_LEAD_MINUTES = 30; // antecedência mínima para agendar

// Gera os horários possíveis de um dia (a cada 30 min, último slot
// meia hora antes de fechar)
function slotsForDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  if (Number.isNaN(day.getTime())) return null;

  const hours = BUSINESS_HOURS[day.getDay()];
  if (!hours) return [];

  const slots = [];
  const cutoff = new Date(Date.now() + MIN_LEAD_MINUTES * 60 * 1000);
  const [open, close] = hours;
  for (let minutes = open * 60; minutes <= close * 60 - SLOT_MINUTES; minutes += SLOT_MINUTES) {
    const slot = new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (slot > cutoff) slots.push(slot);
  }
  return slots;
}

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

// GET /api/public/availability?date=YYYY-MM-DD — horários livres do dia
router.get("/availability", async (req, res, next) => {
  try {
    const dateStr = String(req.query.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: "Data inválida" });
    }

    const slots = slotsForDate(dateStr);
    if (slots === null) return res.status(400).json({ error: "Data inválida" });
    if (slots.length === 0) return res.json({ open: false, slots: [] });

    // Remove horários já ocupados por agendamentos ativos
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59`);
    const taken = await prisma.appointment.findMany({
      where: { status: "agendado", scheduledAt: { gte: dayStart, lte: dayEnd } },
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
    const { name, email, serviceId, scheduledAt } = parsed.data;

    // O horário precisa ser um slot válido do dia (dentro do horário
    // comercial, no passo de 30 min e com antecedência mínima)
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = `${scheduledAt.getFullYear()}-${pad(scheduledAt.getMonth() + 1)}-${pad(scheduledAt.getDate())}`;
    const valid = (slotsForDate(dateStr) || []).some((s) => s.getTime() === scheduledAt.getTime());
    if (!valid) {
      return res.status(400).json({ error: "Este horário não está disponível para agendamento" });
    }

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return res.status(400).json({ error: "Serviço não encontrado" });

    const conflict = await prisma.appointment.findFirst({
      where: { scheduledAt, status: "agendado" },
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
      data: { clientId: client.id, serviceId, scheduledAt },
      include: {
        client: { select: { id: true, name: true, email: true } },
        service: { select: { id: true, name: true } },
      },
    });

    // Mesmo fluxo do sistema interno: n8n envia o e-mail de confirmação
    notifyNewAppointment(appointment);

    // Resposta mínima: nada além do que o próprio cliente informou
    res.status(201).json({
      service: service.name,
      scheduledAt: appointment.scheduledAt,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
