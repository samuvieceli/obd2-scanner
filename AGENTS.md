# Instruções para Agentes de IA (`AGENTS.md`)

Este repositório segue integralmente as regras descritas em [docs/REGRAS-DO-PROJETO.md](docs/REGRAS-DO-PROJETO.md) (**P1–P17** e **T1–T18**). Leia esse arquivo e [docs/ARQUITETURA.md](docs/ARQUITETURA.md) antes de propor ou alterar qualquer código.

## Fluxo obrigatório de trabalho (combinado com o dono do projeto)

1. **Propor antes de implementar (T1, T17):**
   - Ao receber um pedido de **nova função** ou **revisão de código**, **não altere a versão oficial diretamente** antes da aprovação do dono do projeto.
   - Apresente sempre a proposta em **dois blocos**:
     1. **Resumo em linguagem simples (para leigo):** o que será feito, por quê, riscos, opções e a opção recomendada.
     2. **Bloco técnico pronto para outra IA analisar:** texto estruturado e autocontido (contexto, arquivos envolvidos, plano de mudança, riscos e testes previstos) pronto para copiar e colar em outra IA para segunda opinião.
2. **Aprovação e execução automatizada (T2, T18):**
   - Após o dono aprovar a proposta, trabalhe em uma **branch separada** (nunca edite a mesma pasta/branch simultaneamente com outra IA).
   - Implemente as mudanças, atualize testes (T8), diagramas (`docs/DIAGRAMAS.md`, T11) e manuais (`docs/COMO-USAR.md`, `docs/CARROS-BRASILEIROS.md`, T12) quando aplicável.
   - **Documentação nos três idiomas (T19):** todo documento em `docs/` (e o `README.md`) tem uma cópia em inglês americano em `docs/en/`, com o mesmo nome de arquivo. Mudou um, atualize o outro no mesmo commit. O inglês da Europa (en-GB) não tem arquivos: é o texto americano com a grafia britânica, aplicada pela tela Documentação. As notas da versão (`docs/release-notes/`) trazem o português e o inglês no mesmo arquivo. O teste `src/docs.test.ts` confere que as duas versões têm a mesma estrutura.
   - Abra o Pull Request, aguarde todas as verificações automáticas do GitHub (**CI**) passarem sem erros e faça o **merge na `main`**. Se qualquer teste ou verificação falhar, pare antes do merge e reporte ao dono.
3. **Revisões vindas de outra IA (T3):**
   - Confira cada apontamento no código real antes de agir.
   - Corrija erros reais confirmados e envie um resumo do que foi corrigido e do que não se confirmou; se a revisão sugerir função nova, proponha usando o formato acima e peça aprovação antes de implementar.

## Regras críticas do produto (resumo de P1–P17)

- **P1 — Só leitura:** nunca gravar ou alterar configurações nas centrais do veículo (sem codificação, reset de módulo ou teste de atuadores). Única ação permitida: apagar códigos de falha, somente com motor e carro parados.
- **P2 — Adaptador ELM327 imutável:** comandos que gravam na memória do adaptador (`ATPP`, `ATCV`, `ATSD`, `ATBRD`) são recusados; configurações temporárias devem ser restauradas ao terminar.
- **P4 / P5 — Diagnósticos honestos:** interpretações são indícios, nunca sentenças; dados não conferidos ou códigos sem fonte confiável devem ser marcados como experimentais/sem descrição inventada.
- **P9 — 100% offline:** o aplicativo não deve carregar recursos da internet (sem CDNs, fontes ou scripts externos).
- **P12 / P13 — Idiomas e português do Brasil:** textos novos em `pt-BR` e `en-US` (com `en-GB` derivado de `en-US`), unidades métricas nos textos-fonte, e português do Brasil natural (sem termos de Portugal como "ecrã", "ficheiro" ou "utilizador").
- **P16 / P17 — Licença GPL-3.0-or-later:** citar fonte e licença em `docs/CREDITOS.md` para qualquer código ou dado aproveitado.

## Verificações do projeto (CI em `.github/workflows/ci.yml`)

- Núcleo Rust: `cargo test -p obd-core --all-features`
- Interface TypeScript: `npm run typecheck` e `npm test`
- Empacotamento Windows: `npm run tauri build`
