# Manual do Usuario

Este manual explica como operar a aplicacao Mesa de Distribuicao BKO no dia a dia.

## Abrir a aplicacao

Use uma das opcoes:

```powershell
npm start
```

ou clique em `start.bat`.

Ao abrir, a tela inicial e **Gerar Base**. A barra lateral tambem mostra:

- **Limpeza da Mesa**;
- **Extrair Bases**;
- **Modo Automatico**;
- **Configuracoes**.

## Configurar antes de usar

Abra **Configuracoes** e confira:

- caminhos das bases CSV e XLS;
- credenciais Genesys;
- `ORG_REGION`, normalmente `sa_east_1`;
- `QUEUE_IDs` da mesa monitorada;
- IDs da mesa para limpeza por estado/sem filtro;
- credenciais das extracoes;
- velocidade da limpeza;
- configuracoes de subida da mesa;
- tema claro/escuro.

Depois clique em **Salvar**.

Use **Testar conexao agora** para validar o acesso ao Genesys.

## Selecionar fila/mesa

Na configuracao existem dois conjuntos de IDs:

- **QUEUE_IDs**: filas monitoradas para consulta geral da mesa e deduplicacao da base.
- **IDs da mesa para limpeza por estado/sem filtro**: filas usadas quando a limpeza estiver sem filtros ou apenas com filtro de estado.

Cada fila conhecida esta associada a um estado/empresa, como AL, GO, MA, PA, PI, CEA, CEEE e CSA. Quando voce filtra por estado, a aplicacao usa essa associacao para saber quais filas consultar.

## Extrair bases

Use a aba **Extrair Bases** quando precisar atualizar os arquivos usados para gerar o CSV.

Existem quatro botoes individuais:

- **Site Novo**;
- **Site Antigo - BKO All**;
- **GO**;
- **RS / CEEE**.

Tambem existe o botao **Rodar 4 scripts**, que dispara os quatro extratores em concorrencia. Cada card mostra seu proprio andamento. Se um script falhar, a tela mostra o erro e o log fica na pasta de logs configurada em **Configuracoes**, dentro de `extracoes/`.

## Gerar a base CSV

1. Abra **Gerar Base**.
2. Aplique os filtros desejados.
3. Use **todos** para marcar todas as opcoes de um filtro.
4. Use **limpar** para desmarcar um filtro.
5. Clique em **Gerar Agora**.

Modos disponiveis:

- **So CSV**: gera apenas o arquivo `mesa_distribuicao.csv`.
- **CSV + Subir Mesa**: gera o CSV e executa o processo de subida.
- **Tudo Automatico**: roda as extracoes antes de gerar e pode subir a mesa.

O arquivo final fica em:

```text
inputMesa/mesa_distribuicao.csv
```

Antes de gerar a base, a aplicacao consulta a mesa atual no Genesys para remover protocolos que ja estao nela. Isso evita subir protocolos repetidos.

## Consultar protocolos/conversas na limpeza

Abra **Limpeza da Mesa**. A aplicacao consulta a mesa via API Genesys e mostra a tabela com:

- protocolo;
- tipo de servico;
- empresa/estado;
- prazo;
- status;
- data;
- origem;
- skill;
- fila.

Se a tela ja estiver aberta, clique em **Atualizar mesa** para consultar novamente.

## Filtrar a limpeza

Filtros disponiveis:

- busca livre;
- empresa/estado;
- prazo;
- status;
- tipo de servico.

Os filtros de lista aceitam multiselecao. Se nada estiver selecionado em um filtro, a aplicacao considera todos os valores daquele campo.

## Selecionar itens para limpeza

Depois de filtrar, voce pode:

- marcar manualmente as conversas na tabela;
- clicar em **Selecionar filtrados**;
- clicar em **Limpar selecao** para desmarcar tudo.

Quando ha filtros detalhados, a limpeza remove somente os itens selecionados.

Atencao: quando a limpeza esta sem filtros ou apenas com filtro de estado, o botao muda para **Limpar por ID da mesa**. Nesse modo, a selecao manual da tabela e ignorada. A aplicacao consulta as filas configuradas naquele momento e mostra uma confirmacao com o total encontrado.

## Iniciar a limpeza

1. Confira os filtros.
2. Confira a quantidade e os estados no resumo.
3. Clique em **Limpar selecionados** ou **Limpar por ID da mesa**.
4. Leia a caixa de confirmacao.
5. Confirme somente se o total e os estados estiverem corretos.

A limpeza nao inicia sozinha e nao roda ao abrir a tela.

## Acompanhar o progresso

A aba de limpeza mostra:

- **Encontradas**: total que entrou na fila de limpeza.
- **Processadas**: quantidade ja concluida, com sucesso ou erro.
- **Sucesso**: conversas desconectadas com sucesso.
- **Erro**: conversas que falharam.
- **Pendentes**: conversas ainda na fila.
- **Req/min**: limite global configurado.
- **Status**: mensagem atual da operacao.

Tambem ha contadores no topo:

- total na mesa;
- total apos filtros;
- total selecionado;
- removidos na ultima execucao.

## Quando aparecer rate limit

Se aparecer:

```text
Rate limit atingido. Aguardando X segundos para continuar...
```

nao feche a aplicacao e nao use Ctrl+C. A aplicacao esta obedecendo a Genesys e vai continuar automaticamente.

Ela usa o `Retry-After` recebido da Genesys. Se a Genesys nao informar tempo, a aplicacao aguarda o fallback configurado, por padrao `30` segundos.

## Interpretar resultado final

No final, a aplicacao mostra:

- removidos;
- falhas;
- ignorados.

Significados:

- **Removidos**: conversas desconectadas com sucesso.
- **Falhas**: conversas que a API nao conseguiu desconectar.
- **Ignorados**: conversas selecionadas que nao estavam mais na mesa quando a limpeza foi executar.
- **Pendentes**: deve chegar a zero quando a execucao termina.

## O que fazer em caso de erro

1. Leia a mensagem na tela.
2. Consulte o log `limpeza-mesa-AAAA-MM-DD.jsonl` na pasta de logs configurada.
3. Atualize a mesa e veja se a conversa ainda aparece.
4. Se houver muitos erros `429`, reduza `req/min` para um valor menor, como `250`.
5. Se houver erro de credencial, teste a conexao em **Configuracoes**.
6. Se houver erro de permissao, acione o administrador Genesys.

## Finalizar com seguranca

Depois de uma limpeza:

1. aguarde a operacao terminar;
2. confira se **Pendentes** ficou zero;
3. confira o resumo final;
4. clique em **Atualizar mesa**;
5. confirme que os protocolos esperados sairam da tabela.

Nao feche a aplicacao no meio de uma limpeza. O progresso e mantido em memoria durante a execucao, mas nao existe retomada automatica depois de fechar o app.
