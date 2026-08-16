# Notificações de reservas por e-mail

Cada reserva criada pelo público ou por um artista com sessão iniciada, bem como cada reagendamento do artista, envia um e-mail para `traphouzerec@gmail.com`.

O Worker usa a API do Resend. A reserva é guardada mesmo que o fornecedor de e-mail esteja temporariamente indisponível; o erro fica registado no log do Worker para ser verificado.

## Ativação única

1. Crie uma conta no [Resend](https://resend.com) e adicione o domínio `notify.traphouzerecords.com`.
2. No Resend, escolha a ligação à Cloudflare para inserir automaticamente os registos DNS de envio e valide o domínio.
3. Crie uma API key com permissões de envio.
4. Na pasta `worker`, execute:

```powershell
npx wrangler secret put RESEND_API_KEY
```

5. Cole a chave quando o Wrangler pedir o valor e faça o deploy do Worker.

O remetente configurado é `Agenda Trap Houze <reservas@notify.traphouzerecords.com>` e o destinatário é `traphouzerec@gmail.com`. Ambos podem ser alterados em `worker/wrangler.toml` antes do deploy.

## Conteúdo da notificação

- Tipo: nova reserva ou reagendamento.
- Cliente e e-mail, quando foi fornecido.
- Serviço, dia, hora de início e fim.
- Estado e notas deixadas pelo cliente.

`RESEND_API_KEY` é um segredo do Cloudflare: não deve ser adicionado ao Git nem enviado pelo chat.
