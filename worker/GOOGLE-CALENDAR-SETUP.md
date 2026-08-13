# Google Calendar — configuração da Trap Houze

O site usa exclusivamente o calendário **Booking**:

`bab49f46fa47e6fb7a9ffc1fe4ec50ccf2922a6775ffc14891d2bafe2d053537@group.calendar.google.com`

## Configuração ativa: conta de serviço

1. Na Google Cloud Console, criar ou selecionar o projeto da Trap Houze.
2. Ativar **Google Calendar API**.
3. Criar uma conta de serviço chamada **Trap Houze Booking Calendar**.
4. Criar uma chave JSON para essa conta de serviço e guardar no Cloudflare Worker, apenas como secret:

   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — o valor completo de `private_key` da chave JSON.

5. No Google Calendar, abrir as definições do calendário **Booking** e partilhá-lo com:

   `trap-houze-booking-calendar@trap-houze-records.iam.gserviceaccount.com`

   com a permissão **Fazer alterações a eventos**.

Não há nenhuma autenticação OAuth para fazer no painel. A conta de serviço dá acesso somente ao calendário Booking que foi partilhado com ela.

As novas reservas são espelhadas no calendário Booking; eventos criados diretamente nesse calendário bloqueiam disponibilidade no site e aparecem na Agenda do Admin como eventos externos.
