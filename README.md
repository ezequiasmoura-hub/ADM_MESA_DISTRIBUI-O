# Mesa de Distribuicao BKO

Aplicacao Electron para geracao de base CSV e limpeza controlada da mesa de protocolos no Genesys Cloud. O projeto foi ajustado para operar em ambiente de producao com confirmacao explicita, logs, controle global de rate limit e cuidado para nao subir ou remover protocolos indevidamente.

## Objetivo

O objetivo da aplicacao e apoiar a operacao da mesa de protocolos do BackOffice:

- gerar `inputMesa/mesa_distribuicao.csv` no padrao da aba `MESA DE DISTRIBUICAO` do BI;
- aplicar filtros equivalentes aos usados na operacao;
- consultar a mesa atual no Genesys para remover da base final protocolos que ja estao na mesa;
- executar extracoes das bases de origem em JavaScript;
- opcionalmente executar o processo externo de subida da mesa;
- consultar e limpar conversas da mesa com filtros, confirmacao e auditoria.

## Principais funcionalidades

- Tela **Gerar Base** com filtros por estado, SLA, responsavel, origem/site, skill, tipo de servico e e-mail.
- Botoes **todos** e **limpar** em cada filtro de tags da geracao.
- Geracao do CSV fixo `inputMesa/mesa_distribuicao.csv`, com separador `;` e UTF-8 com BOM.
- Deduplicacao contra a mesa atual do Genesys usando consulta rapida de protocolos.
- Tela **Limpeza da Mesa** com consulta em tempo real, filtros multiselecao, tabela, selecao e confirmacao.
- Limpeza por itens selecionados quando existem filtros detalhados.
- Limpeza por ID de fila quando nao ha filtros ou quando ha somente filtro de estado.
- Rate limiter global da limpeza, padrao `280` requisicoes/minuto e limite configuravel ate `300`.
- Paralelismo configuravel da limpeza, padrao `10`.
- Retry automatico em `429`, respeitando `Retry-After` e fallback de `30` segundos.
- Indicadores de limpeza: encontradas, processadas, sucesso, erro, pendentes, req/min e status.
- Logs de limpeza em `logs/limpeza-mesa-AAAA-MM-DD.jsonl`.
- Tela **Extrair Bases** para rodar Site Novo, Site Antigo, GO e RS/CEEE.
- Tela **Modo Automatico** para rodar extracoes, gerar base com os filtros atuais e, se habilitado, subir a mesa.
- Tela **Configuracoes** para caminhos, credenciais Genesys, credenciais de extracao, IDs de fila, tema, velocidade de limpeza e subida.

## Tecnologias

- Electron 33
- Node.js
- JavaScript no processo principal, preload e interface
- HTML/CSS/JavaScript sem framework de frontend
- `purecloud-platform-client-v2` para Genesys Cloud
- `xlsx` para leitura de planilhas
- `playwright` e `cheerio` nos extratores
- Python somente para o script operacional externo `inputMesa/MesaDistribuicao.py`, quando existir

## Estrutura de pastas

```text
MESA AUTO/
  main.js                    Processo principal: regras, Genesys, CSV, limpeza e extracoes
  preload.js                 Ponte segura IPC entre UI e main process
  index.html                 Interface Electron
  package.json               Scripts npm e dependencias
  package-lock.json          Lockfile
  start.bat                  Atalho Windows para iniciar o app
  .env.example               Modelo seguro de configuracao
  .gitignore                 Regras para nao versionar dados sensiveis/gerados
  docs/                      Documentacao do projeto
  scripts/extracao/          Extratores oficiais em JavaScript
  inputMesa/                 Arquivos operacionais locais da mesa
  logs/                      Logs gerados localmente, nao versionados
  legacy/                    Codigo antigo mantido como referencia
  extracao/                  Material legado externo, nao usado pelo fluxo atual
```

## Instalacao

Pre-requisitos:

- Windows;
- Node.js instalado;
- acesso de rede aos sistemas de origem e ao Genesys;
- credenciais OAuth Client Credentials do Genesys;
- credenciais dos sites de extracao, quando for rodar extracoes.

Instale as dependencias:

```powershell
npm install
```

## Configuracao

Crie um arquivo `.env` na raiz do projeto, usando `.env.example` como base. O app tambem carrega `inputMesa/.env` como fallback.

Variaveis minimas para Genesys:

```env
ORG_REGION=sa_east_1
CLIENT_ID=seu_client_id_oauth
CLIENT_SECRET=seu_client_secret_oauth
QUEUE_IDS=
CLEANUP_CONCURRENCY=10
CLEANUP_RATE_LIMIT_PER_MINUTE=280
CLEANUP_RATE_LIMIT_FALLBACK_SECONDS=30
```

As demais configuracoes podem ser ajustadas na tela **Configuracoes**. O app salva configuracoes da interface em `mesa_config.json` dentro da pasta de dados do usuario do Electron, nao na raiz do projeto.

## Executar em desenvolvimento

```powershell
npm start
```

Ou use:

```powershell
.\start.bat
```

Validacao estatica:

```powershell
npm run check
```

## Gerar executavel

O projeto ainda nao possui script de empacotamento configurado no `package.json`. Hoje o fluxo suportado e rodar via Electron (`npm start`) ou `start.bat`. Para empacotar o app como `.exe`, consulte [docs/BUILD_E_EXECUTAVEL.md](docs/BUILD_E_EXECUTAVEL.md). Esse documento marca o build como etapa pendente de configuracao e sugere o caminho com `electron-builder`.

Importante: `inputMesa/MesaDistribuicao.exe` nao e o executavel da aplicacao Electron. Ele e o executor externo usado para subir o CSV na mesa quando a UI manda executar a subida.

## Como usar

1. Abra o app com `npm start` ou `start.bat`.
2. Acesse **Configuracoes** e confirme credenciais, regiao, filas e caminhos das bases.
3. Se precisar atualizar bases, use **Extrair Bases** e rode os quatro scripts.
4. Em **Gerar Base**, aplique os filtros e clique em **Gerar Agora**.
5. Escolha o modo:
   - **So CSV**: apenas gera `inputMesa/mesa_distribuicao.csv`;
   - **CSV + Subir Mesa**: gera o CSV e executa `MesaDistribuicao.py` ou `MesaDistribuicao.exe`;
   - **Tudo Automatico**: roda extracoes, gera base com os filtros atuais e pode subir a mesa.
6. Para limpeza, abra **Limpeza da Mesa**, consulte a mesa, filtre, selecione e confirme.

## Geracao do CSV

O CSV final segue esta estrutura:

```text
Regiao;Nota;Conclusao_desejada;Mandante;Protocolo;Tipo_de_servico;Coluna;Dados;Skill;Fluxo;Prioridade;STATUS_PRAZO_MESA
```

Regras principais:

- protocolo e normalizado para comparar base e Genesys;
- o prazo considera D+1 util a partir da data de abertura;
- os tipos removidos por padrao sao `Cadastro baixa renda`, `Cadastro de Comunicadores`, `Problemas com Login` e `Agencia Web`;
- registros ja presentes na mesa sao removidos do CSV final;
- a ordenacao final usa prioridade calculada por prazo, fonte, credenciado e planilha de priorizacao;
- o arquivo e sempre salvo como `inputMesa/mesa_distribuicao.csv`.

## Limpeza da mesa

A limpeza nunca executa automaticamente ao abrir a tela. O usuario precisa clicar no botao de limpeza e confirmar a caixa exibida.

Dois modos existem:

- **Selecionados**: quando ha filtros detalhados, o app limpa somente os `conversationId` selecionados na tabela. Antes de desconectar, valida se eles ainda estao na mesa.
- **Por ID da mesa**: quando nao ha filtros ou quando ha somente filtro de estado, o app consulta os `queueId` configurados em **IDs da mesa para limpeza** e limpa o resultado confirmado. Nesse modo, a selecao manual da tabela e ignorada e a confirmacao mostra total, estados e filas.

Cada execucao gera log JSONL com filtros, IDs, protocolos conhecidos, quantidade removida, ignorados e falhas.

## Rate limit, paralelismo e retry

A limpeza usa dois controles separados:

- **Paralelismo** (`CLEANUP_CONCURRENCY`): quantas conversas podem estar em processamento ao mesmo tempo.
- **Rate limit global** (`CLEANUP_RATE_LIMIT_PER_MINUTE`): quantas chamadas totais de desconexao podem iniciar por minuto.

Mesmo com paralelo `10`, o rate limiter global impede que a aplicacao passe do limite configurado. O padrao e `280 req/min`; o maximo configuravel pela normalizacao atual e `300 req/min`.

Se a Genesys retornar `429`:

1. a limpeza nao para;
2. o app le o header `Retry-After`;
3. se nao houver `Retry-After`, aguarda `CLEANUP_RATE_LIMIT_FALLBACK_SECONDS`;
4. a tela mostra contagem regressiva;
5. a fila continua do ponto atual.

Erros transitorios `408`, `500`, `502`, `503` e `504` recebem retry curto por conversa antes de serem registrados como falha.

## Variaveis de ambiente

Consulte [docs/CONFIGURACOES.md](docs/CONFIGURACOES.md) para a lista completa. Nunca versionar `.env`, client secret, tokens, senhas ou logs com dados operacionais.

## Seguranca

- `.env` e `inputMesa/.env` ficam ignorados pelo Git.
- Logs de extracao passam por sanitizacao para mascarar segredos conhecidos.
- Logs de limpeza nao devem conter tokens.
- `inputMesa/MesaDistribuicao.py` e `inputMesa/MesaDistribuicao.exe` sao tratados como artefatos locais sensiveis/operacionais e nao devem ser versionados enquanto contiverem credenciais ou logica privada.
- Nao rode limpeza em producao sem conferir filtros, estados e total na confirmacao.
- Nao use o codigo legado de `legacy/` para operacao real.

## Problemas conhecidos

- O build `.exe` da aplicacao Electron ainda nao esta configurado no `package.json`.
- O script externo `inputMesa/MesaDistribuicao.py`, quando presente, ainda usa credenciais internas e deve ser refatorado para `.env` antes de qualquer versionamento.
- A limpeza mantem progresso em memoria durante a execucao; se o app for fechado, deve-se consultar a mesa novamente.
- Os caminhos padrao de bases apontam para estrutura operacional local e devem ser ajustados na tela **Configuracoes** quando o ambiente mudar.

## Proximos passos

- Externalizar credenciais do script de subida para `.env` ou cofre seguro.
- Configurar empacotamento oficial da aplicacao Electron.
- Adicionar testes automatizados para geracao de CSV e rate limiter.
- Criar validacao automatica contra uma exportacao BI de referencia.
- Separar `main.js` em modulos menores quando houver janela para refatoracao segura.

## Documentacao

- [Manual do Usuario](docs/MANUAL_USUARIO.md)
- [Documentacao Tecnica](docs/DOCUMENTACAO_TECNICA.md)
- [Fluxo de Limpeza](docs/FLUXO_LIMPEZA.md)
- [API Genesys](docs/API_GENESYS.md)
- [Configuracoes](docs/CONFIGURACOES.md)
- [Build e Executavel](docs/BUILD_E_EXECUTAVEL.md)
- [Changelog](docs/CHANGELOG.md)
