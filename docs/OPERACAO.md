# Operacao

Este arquivo foi mantido como entrada curta para compatibilidade com a documentacao anterior.

O manual operacional completo esta em:

- [MANUAL_USUARIO.md](MANUAL_USUARIO.md)
- [FLUXO_LIMPEZA.md](FLUXO_LIMPEZA.md)
- [CONFIGURACOES.md](CONFIGURACOES.md)

Resumo seguro:

1. Abra o app com `npm start` ou `start.bat`.
2. Configure Genesys, filas, caminhos e credenciais em **Configuracoes**.
3. Rode extracoes pela aba **Extrair Bases**, se precisar atualizar bases.
4. Gere o CSV pela aba **Gerar Base**.
5. Use **Limpeza da Mesa** somente apos conferir filtros, total e estados.
6. Se aparecer rate limit, aguarde a contagem regressiva; a aplicacao continua automaticamente.
7. Consulte logs na pasta configurada em **Configuracoes**.

Nunca execute limpeza sem conferir a confirmacao exibida pela aplicacao.
