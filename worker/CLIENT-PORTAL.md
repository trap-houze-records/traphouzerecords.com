# Área do Cliente — preparação segura

Este documento descreve a passagem do protótipo local para uma Área do Cliente online. A base D1 isolada já foi criada e recebeu apenas o esquema vazio; o Worker atual continua sem alterações publicadas.

## Arquitetura proposta

- GitHub Pages: páginas estáticas client.html e gestão de clientes.
- Cloudflare Worker: API privada para entrada, consulta do portal e gestão pelo administrador GitHub.
- Cloudflare D1: guarda clientes, músicas, reservas, pagamentos e sessões.
- client-portal-schema.sql: esquema da base de dados D1.

## Segurança obrigatória antes de ativar

- Nunca guardar palavras-passe em texto simples; guardar apenas hash PBKDF2 com salt individual.
- Criar sessão curta assinada e HttpOnly; nunca colocar credenciais ou sessões no URL.
- Limitar o administrador à sessão GitHub já existente no Worker.
- Validar todos os dados no Worker e verificar origem/CORS.
- Manter histórico de alterações administrativas.
- As ligações de pagamento são tratadas como links externos; a confirmação de pagamento é manual nesta primeira versão.

## Dados suportados

- Cliente: nome, utilizador, WhatsApp e conta ativa/pausada.
- Música: título, fase (Iniciar, Mix, Master), valor e estado/link de pagamento.
- Reserva: serviço, data/hora, valor e estado/link de pagamento.

## Próxima ativação

1. Executar o guião `AREA-CLIENTE-TESTES.md` numa versão de ensaio, com uma conta de cliente e uma conta de administração, antes de publicar a interface online.

## Endpoints locais já preparados

- `POST /client/auth/login`: entrada de cliente; devolve uma sessão temporária assinada.
- `POST /client/auth/logout`: termina a sessão de cliente.
- `GET /client/portal`: devolve apenas os dados do cliente autenticado.
- `GET /client/admin/clients`: lista clientes para o administrador autenticado por GitHub.
- `GET /client/admin/clients/:id`: consulta o detalhe de um cliente para gestão, incluindo músicas e reservas.
- `POST /client/admin/clients`: cria um cliente com palavra-passe protegida por PBKDF2.
- `PATCH /client/admin/clients/:id`: edita cliente, pausa acesso ou redefine palavra-passe e termina sessões anteriores.
- `POST /client/admin/tracks/:clientId` e `POST /client/admin/bookings/:clientId`: cria música ou reserva.
- `PATCH` e `DELETE` nas rotas de músicas/reservas: atualiza ou remove o respetivo registo.

Estes endpoints existem apenas no código local até ser autorizada uma publicação do Worker. A página do cliente e o gestor já têm adaptadores para a API, mas mantêm o modo local até `assets/js/client-config.js` receber um URL de ensaio ou produção.
