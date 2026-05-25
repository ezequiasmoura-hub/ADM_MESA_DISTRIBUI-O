# Scripts de extracao

Extratores integrados ao projeto, todos em JavaScript e executados com o Node do proprio app.

- `site-novo.js`: gera `01_Todos_Aberto.xls` e `02_Todos_Pendente.xls`.
- `site-antigo.js`: gera `bko_all.csv`.
- `go.js`: gera `EQTL_GO.csv`.
- `rs.js`: gera `EQTL_RS.csv`.

As credenciais devem ficar em `.env` ou `inputMesa/.env`:

```env
EXTRACAO_USUARIO=
EXTRACAO_SENHA=
EXTRACAO_HEADLESS=1
```

Tambem e possivel configurar pela tela **Configuracoes**. Senhas especificas por extrator usam estas variaveis quando rodadas fora da interface:

```env
EXTRACAO_SITE_NOVO_USUARIO=
EXTRACAO_SITE_NOVO_SENHA=
EXTRACAO_SITE_ANTIGO_USUARIO=
EXTRACAO_SITE_ANTIGO_SENHA=
EXTRACAO_GO_USUARIO=
EXTRACAO_GO_SENHA=
EXTRACAO_RS_USUARIO=
EXTRACAO_RS_SENHA=
```

Por padrao, o Site Novo abre um Chromium pelo Playwright e faz login normal. Se for necessario reaproveitar um navegador ja aberto em CDP na porta `9222`, use `EXTRACAO_SITE_NOVO_CDP=1`.

Comandos uteis:

```bash
npm run extract:site-novo
npm run extract:site-antigo
npm run extract:go
npm run extract:rs
npm run extract:all
```
