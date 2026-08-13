# Google Calendar — configuração da Trap Houze

O site usa exclusivamente o calendário **Booking**:

`bab49f46fa47e6fb7a9ffc1fe4ec50ccf2922a6775ffc14891d2bafe2d053537@group.calendar.google.com`

## Configuração única antes do deploy

1. Na Google Cloud Console, criar ou selecionar o projeto da Trap Houze.
2. Ativar **Google Calendar API**.
3. Configurar o ecrã de consentimento OAuth para a conta `traphouzerec@gmail.com`.
4. Criar credenciais **OAuth Client ID → Web application**.
5. Adicionar este redirect URI:

   `https://trap-houze-cms.traphouzerec.workers.dev/google-calendar/callback`

6. No Worker Cloudflare, guardar estes secrets:

   - `GOOGLE_CALENDAR_CLIENT_ID`
   - `GOOGLE_CALENDAR_CLIENT_SECRET`
   - `GOOGLE_CALENDAR_TOKEN_KEY` — frase aleatória longa, exclusiva desta integração.

## Ligação da conta

Depois de publicar o Worker e abrir `/admin.html?section=schedule`, carregar em **Ligar conta Google** e autorizar `traphouzerec@gmail.com`.

As novas reservas são espelhadas no calendário Booking; eventos criados diretamente nesse calendário bloqueiam disponibilidade no site e aparecem na Agenda do Admin como eventos externos.
