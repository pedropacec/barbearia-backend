// Seed: cria o usuário de acesso da banca, os serviços da barbearia
// e alguns clientes/agendamentos de exemplo para a demonstração.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Helper: data de hoje + N dias, em um horário específico
function at(daysFromNow, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  // Usuário de acesso (enviado à banca junto com o .env)
  const password = await bcrypt.hash("barbearia123", 10);
  await prisma.user.upsert({
    where: { email: "admin@barbeariavintage.com" },
    update: { password },
    create: {
      name: "Marcelo Andrade",
      email: "admin@barbeariavintage.com",
      password,
    },
  });

  // Serviços oferecidos
  const serviceNames = ["Corte", "Barba", "Corte + Barba", "Sobrancelha", "Acabamento (pezinho)"];
  const services = [];
  for (const name of serviceNames) {
    services.push(
      await prisma.service.upsert({ where: { name }, update: {}, create: { name } })
    );
  }

  // Clientes e agendamentos de exemplo (apenas se o banco estiver vazio,
  // para o seed poder rodar de novo sem duplicar dados)
  const clientCount = await prisma.client.count();
  if (clientCount === 0) {
    const clients = await Promise.all(
      [
        { name: "João Ferreira", email: "joao.ferreira@example.com", notes: "Prefere máquina 2 nas laterais" },
        { name: "Rafael Souza", email: "rafael.souza@example.com", notes: "Cliente desde a inauguração" },
        { name: "Lucas Mendes", email: "lucas.mendes@example.com", notes: null },
        { name: "André Oliveira", email: "andre.oliveira@example.com", notes: "Alérgico a talco" },
        { name: "Bruno Costa", email: "bruno.costa@example.com", notes: null },
      ].map((data) => prisma.client.create({ data }))
    );

    const sampleAppointments = [
      { client: 0, service: 2, when: at(0, 10), status: "concluido" },
      { client: 1, service: 0, when: at(0, 11), status: "concluido" },
      { client: 2, service: 1, when: at(0, 15), status: "agendado" },
      { client: 3, service: 0, when: at(0, 16, 30), status: "agendado" },
      { client: 4, service: 2, when: at(1, 9, 30), status: "agendado" },
      { client: 0, service: 3, when: at(1, 14), status: "agendado" },
      { client: 1, service: 2, when: at(2, 10), status: "agendado" },
      { client: 2, service: 0, when: at(-1, 17), status: "nao_compareceu" },
      { client: 4, service: 1, when: at(-1, 11), status: "cancelado" },
    ];

    for (const a of sampleAppointments) {
      await prisma.appointment.create({
        data: {
          clientId: clients[a.client].id,
          serviceId: services[a.service].id,
          scheduledAt: a.when,
          status: a.status,
        },
      });
    }
  }

  console.log("Seed concluído: usuário admin, serviços e dados de exemplo criados.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
