import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import publicRoutes from "./routes/public.js";
import clientRoutes from "./routes/clients.js";
import serviceRoutes from "./routes/services.js";
import appointmentRoutes from "./routes/appointments.js";
import { authRequired } from "./middleware/auth.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);

// Agendamento online da página do cliente (sem login):
// o cliente só cria a solicitação — gerenciar continua interno
app.use("/api/public", publicRoutes);

// Todas as rotas abaixo exigem um funcionário autenticado
app.use("/api/clients", authRequired, clientRoutes);
app.use("/api/services", authRequired, serviceRoutes);
app.use("/api/appointments", authRequired, appointmentRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

// Tratador central de erros: nada de stack trace vazando para o cliente
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

export default app;
