# Barbearia Vintage — Backend

API REST do sistema de gestão da Barbearia Vintage: autenticação de funcionários, cadastro de clientes, serviços e agendamentos, com automação de e-mail via n8n.

Case da 2ª fase do Processo Seletivo da Insper Jr.

## Stack

| Camada | Tecnologia | Por quê |
|---|---|---|
| Runtime | Node.js + Express | Leve, direto e padrão de mercado para APIs REST |
| ORM | Prisma | Schema declarativo, migrations versionadas e queries type-safe |
| Banco | SQLite (dev) / PostgreSQL | Trocar o provider no `schema.prisma` é a única mudança necessária |
| Autenticação | JWT + bcrypt | Token stateless com expiração de 12h; senhas nunca ficam em texto puro |
| Validação | Zod | Toda entrada é validada antes de tocar o banco |
| Automação | n8n (webhook) | Ao criar um agendamento, a API notifica o n8n, que envia o e-mail de confirmação ao cliente |

## Como rodar

```bash
npm install
npx prisma migrate dev   # cria o banco e roda o seed automaticamente
npm run dev              # sobe a API em http://localhost:3001
```

Copie `.env.example` para `.env` e preencha as variáveis (ou use o `.env` enviado por e-mail).

**Login de teste criado pelo seed:** `admin@barbeariavintage.com` / `barbearia123`

## Rotas da API

Todas as rotas (exceto login e health) exigem o header `Authorization: Bearer <token>`.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Autentica um funcionário e devolve o JWT |
| GET | `/api/auth/me` | Usuário da sessão atual |
| GET | `/api/clients` | Lista clientes (com contagem de atendimentos) |
| POST | `/api/clients` | Cadastra cliente (nome, email, observações) |
| PUT | `/api/clients/:id` | Edita cliente |
| DELETE | `/api/clients/:id` | Remove cliente (agendamentos em cascata) |
| GET | `/api/services` | Lista os serviços oferecidos |
| GET | `/api/barbers` | Lista os profissionais e suas escalas |
| GET | `/api/public/services` | (Pública) Serviços, para o agendamento online |
| GET | `/api/public/barbers` | (Pública) Profissionais e escalas, para o agendamento online |
| GET | `/api/public/availability?date=&barberId=` | (Pública) Horários livres do profissional no dia |
| POST | `/api/public/bookings` | (Pública) Cria a solicitação de agendamento do cliente |
| GET | `/api/appointments` | Agenda ordenada por data/horário (`?from=&to=` opcional) |
| POST | `/api/appointments` | Cria agendamento **e dispara o e-mail via n8n** |
| PUT | `/api/appointments/:id` | Edita data, horário, cliente ou serviço |
| PATCH | `/api/appointments/:id/status` | Atualiza o status (`agendado`, `concluido`, `cancelado`, `nao_compareceu`) |
| DELETE | `/api/appointments/:id` | Remove agendamento |

## Regras de negócio

- **Sem horários duplicados:** a API recusa (HTTP 409) dois agendamentos ativos no mesmo horário **para o mesmo profissional** — exatamente o problema que o caderno físico causava. Profissionais diferentes podem atender em paralelo.
- **Escalas por profissional:** cada um dos 6 profissionais tem dias e faixas de horário próprios (tabela `Barber`); o agendamento online só oferece horários dentro da escala de quem foi escolhido, já cruzada com o funcionamento da casa.
- **Status controlados:** apenas os quatro status definidos no case são aceitos.
- **Falha isolada da automação:** se o n8n estiver indisponível, o agendamento é salvo normalmente e o erro fica no log. A automação nunca derruba a operação.

### Agendamento online (rotas públicas)

O cliente pode solicitar um horário pela página pública, mas **não visualiza nem gerencia a agenda** — isso continua exclusivo dos funcionários logados, como o case exige. Proteções do endpoint público:

- Só aceita horários dentro do funcionamento (ter–sex 9h–19h, sáb 8h–18h), no passo de 30 minutos e com antecedência mínima de 30 minutos;
- Recusa horário já ocupado (HTTP 409);
- Rate limit de 5 solicitações por IP por hora;
- Se o email já é de um cliente da casa, reaproveita o cadastro em vez de duplicar;
- A resposta devolve apenas o que o próprio cliente informou — nenhum dado de terceiros.

## Integração com o n8n

O workflow está versionado em [`n8n/barbearia-vintage-workflow.json`](n8n/barbearia-vintage-workflow.json).

Fluxo: `POST /api/appointments` → API grava no banco → API chama `N8N_WEBHOOK_URL` com os dados do agendamento (nome, e-mail, serviço, data, horário) → o n8n envia o e-mail de confirmação ao cliente via SMTP.

Para configurar: importe o JSON no n8n, crie a credencial SMTP, ative o workflow e copie a URL de produção do webhook para `N8N_WEBHOOK_URL` no `.env`.

## Estrutura

```
prisma/
  schema.prisma    # User, Client, Service, Appointment
  seed.js          # usuário admin, serviços e dados de exemplo
src/
  server.js        # bootstrap
  app.js           # middlewares e montagem das rotas
  middleware/auth.js  # verificação do JWT
  routes/          # auth, clients, services, appointments
  lib/prisma.js    # instância única do Prisma
  lib/n8n.js       # notificação do webhook (fire-and-forget)
n8n/               # workflow exportado
```
