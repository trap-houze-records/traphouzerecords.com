# Worker de publicação

Este Worker autentica o administrador com uma OAuth App de GitHub (só leitura de perfil) e usa uma GitHub App, limitada a este repositório, para publicar `data/site.json` na branch `main`.

## Configuração

1. Crie uma **GitHub App** pertencente à organização `trap-houze-records`.
   - Repository permissions: **Contents: Read and write** e **Metadata: Read-only**.
   - Instale-a apenas em `traphouzerecords.com` e guarde o ID da instalação.
2. Crie uma **OAuth App** no GitHub.
   - Callback URL: `https://SEU-WORKER.workers.dev/auth/callback`.
   - Esta app só pede o âmbito `read:user` para identificar o administrador.
3. No Cloudflare Workers, crie os cinco secrets indicados em `wrangler.toml` e preencha as variáveis públicas.
4. Publique o Worker com `npx wrangler deploy` dentro desta pasta.
5. Atualize `assets/js/admin-config.js` com o URL real do Worker e publique esse ficheiro no site. Este URL não é um segredo.

O Worker permite publicar apenas utilizadores enumerados em `ALLOWED_GITHUB_USERS`; a chave privada da GitHub App e os restantes segredos nunca são enviados ao browser.
