// Integração com o n8n: quando um agendamento é criado, enviamos os dados
// para o webhook, e o workflow do n8n dispara o e-mail de confirmação
// ao cliente. A chamada é "fire and forget" com tratamento de erro:
// se o n8n estiver fora do ar, o agendamento é salvo normalmente e o
// problema fica registrado no log — o sistema nunca trava por causa disso.

const WEEKDAYS = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado",
];

export async function notifyNewAppointment(appointment) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) {
    console.warn("[n8n] N8N_WEBHOOK_URL não configurada — e-mail não enviado");
    return;
  }

  const date = new Date(appointment.scheduledAt);
  const payload = {
    clientName: appointment.client.name,
    clientEmail: appointment.client.email,
    service: appointment.service.name,
    date: date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    weekday: WEEKDAYS[date.getDay()],
    time: date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    }),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[n8n] webhook respondeu ${res.status}`);
    } else {
      console.log(`[n8n] confirmação enviada para ${payload.clientEmail}`);
    }
  } catch (err) {
    console.error("[n8n] falha ao chamar o webhook:", err.message);
  }
}
