// Seed: cria o usuário de acesso da banca, os serviços da barbearia
// e alguns clientes/agendamentos de exemplo para a demonstração.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Dias em que a barbearia abre (0 = domingo ... 6 = sábado). Fecha dom/seg.
function isOpenDay(d) {
  return d.getDay() !== 0 && d.getDay() !== 1;
}

// Retorna as próximas `count` datas abertas no passado (-1) ou futuro (+1),
// a partir de hoje. Assim nenhum agendamento cai em dia fechado.
function openDays(count, direction) {
  const res = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (res.length < count) {
    d.setDate(d.getDate() + direction);
    if (isOpenDay(d)) res.push(new Date(d));
  }
  return res;
}

function atTime(baseDate, hour, minute = 0) {
  const d = new Date(baseDate);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// Escolhe um profissional cuja escala cobra aquele dia/horário, evitando
// que dois agendamentos ativos caiam no mesmo profissional e instante.
function pickBarber(barbers, date, hour, used, spread) {
  const dow = date.getDay();
  const fit = barbers.filter(
    (b) => b.days.split(",").map(Number).includes(dow) && hour >= b.startHour && hour < b.endHour
  );
  for (let i = 0; i < fit.length; i++) {
    const b = fit[(spread + i) % fit.length];
    const key = `${b.id}@${date.getTime()}`;
    if (!used.has(key)) {
      used.add(key);
      return b;
    }
  }
  return fit[0] || null;
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

  // Profissionais da casa — cada um com a própria escala
  // (dias: 0 = domingo ... 6 = sábado; casa fecha dom/seg)
  const barberSeed = [
    { name: "Otávio Ramos", days: "2,3,4,5,6", startHour: 9, endHour: 15 },
    { name: "Henrique Farias", days: "2,3,4,5,6", startHour: 13, endHour: 19 },
    { name: "Caio Bittencourt", days: "2,3,4", startHour: 9, endHour: 19 },
    { name: "Edu Malta", days: "4,5,6", startHour: 8, endHour: 14 },
    { name: "Vicente Sarmento", days: "2,3,4,5", startHour: 11, endHour: 17 },
    { name: "Nato Borges", days: "3,4,5,6", startHour: 10, endHour: 18 },
  ];
  const barbers = [];
  for (const b of barberSeed) {
    barbers.push(
      await prisma.barber.upsert({ where: { name: b.name }, update: { days: b.days, startHour: b.startHour, endHour: b.endHour }, create: b })
    );
  }

  // Clientes e agendamentos de exemplo (apenas se o banco estiver vazio,
  // para o seed poder rodar de novo sem duplicar dados)
  const clientCount = await prisma.client.count();
  if (clientCount === 0) {
    const clients = await Promise.all(
      [
        { name: "João Ferreira", email: "joao.ferreira@example.com", phone: "11987650001", notes: "Prefere máquina 2 nas laterais" },
        { name: "Rafael Souza", email: "rafael.souza@example.com", phone: "11987650002", notes: "Cliente desde a inauguração" },
        { name: "Lucas Mendes", email: "lucas.mendes@example.com", phone: "11987650003", notes: null },
        { name: "André Oliveira", email: "andre.oliveira@example.com", phone: null, notes: "Alérgico a talco" },
        { name: "Bruno Costa", email: "bruno.costa@example.com", phone: "11987650005", notes: null },
      ].map((data) => prisma.client.create({ data }))
    );

    const future = openDays(4, 1); // próximos dias abertos (agendamentos futuros)
    const past = openDays(2, -1); // últimos dias abertos (histórico)

    // client/service por índice; day = data base; hour/min = horário; status.
    // O profissional é escolhido em runtime conforme a escala cobre o horário.
    const specs = [
      { client: 0, service: 2, day: future[0], hour: 10, status: "agendado" },
      { client: 1, service: 0, day: future[0], hour: 14, status: "agendado" },
      { client: 2, service: 1, day: future[1], hour: 11, status: "agendado" },
      { client: 3, service: 0, day: future[1], hour: 15, status: "agendado" },
      { client: 4, service: 2, day: future[2], hour: 13, status: "agendado" },
      { client: 0, service: 3, day: future[3], hour: 16, status: "agendado" },
      { client: 1, service: 2, day: past[0], hour: 10, status: "concluido" },
      { client: 0, service: 0, day: past[0], hour: 14, status: "concluido" },
      { client: 2, service: 0, day: past[1], hour: 11, status: "nao_compareceu" },
      { client: 4, service: 1, day: past[1], hour: 15, status: "cancelado" },
    ];

    const used = new Set();
    let i = 0;
    for (const s of specs) {
      const when = atTime(s.day, s.hour, s.min || 0);
      const barber = pickBarber(barbers, when, s.hour, used, i++);
      await prisma.appointment.create({
        data: {
          clientId: clients[s.client].id,
          serviceId: services[s.service].id,
          barberId: barber ? barber.id : null,
          scheduledAt: when,
          status: s.status,
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
