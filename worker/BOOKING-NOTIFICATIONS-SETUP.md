# Notificações de reservas por e-mail

Cada reserva criada pelo público ou por um artista com sessão iniciada, bem como cada reagendamento do artista, envia um e-mail para `booking@traphouzerecords.com`.

O Worker usa o serviço de e-mail nativo da Cloudflare. O endereço `booking@traphouzerecords.com` encaminha para a caixa verificada `traphouzerec@gmail.com`. A reserva é guardada mesmo que o fornecedor de e-mail esteja temporariamente indisponível; o erro fica registado no log do Worker para ser verificado.

## Configuração

O Email Routing de `traphouzerecords.com` deve estar ativo. A caixa de entrega `traphouzerec@gmail.com` deve permanecer verificada na conta Cloudflare e associada ao binding `BOOKING_MAILER` em `worker/wrangler.toml`.

O remetente configurado é `Agenda Trap Houze <booking@traphouzerecords.com>` e a identidade de resposta é `booking@traphouzerecords.com`.

## Conteúdo da notificação

- Tipo: nova reserva ou reagendamento.
- Cliente e e-mail, quando foi fornecido.
- Serviço, dia, hora de início e fim.
- Estado e notas deixadas pelo cliente.

`RESEND_API_KEY` continua suportado apenas como fallback opcional, caso o binding nativo da Cloudflare seja removido.
