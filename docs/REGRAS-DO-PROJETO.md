# Regras do projeto

Todas as regras gerais do OBD2 Scanner num lugar só, em linguagem simples. Elas valem para qualquer pessoa (ou IA) que mexa no programa.

Há dois tipos de regra:

- **Regras do produto**: o que o programa faz, nunca faz e como ele se apresenta para quem usa.
- **Regras de trabalho**: como o projeto é desenvolvido, decidido, testado e publicado.

> Quando uma regra mudar, mude este arquivo no mesmo commit. Ele aparece dentro do programa, em **Documentação → Regras do projeto**.

---

## Parte 1. Regras do produto

### 1.1 Segurança do carro e de quem usa

| # | Regra | Por quê |
| --- | --- | --- |
| P1 | **Só leitura.** O programa lê o carro e nunca grava nada nas centrais (sem codificação, configuração, reset de módulo, teste de atuadores). A única ação permitida é **apagar códigos de falha**, e só com o motor parado e o carro parado. | Uma escrita errada pode travar uma central e deixar o carro parado. |
| P2 | **O adaptador também não é alterado de forma permanente.** Comandos que gravam na memória do ELM327 (`ATPP`, `ATCV`, `ATSD`, `ATBRD`) são recusados, e toda ferramenta que muda alguma configuração temporária devolve o adaptador como estava. | Clones baratos podem ficar inutilizáveis. |
| P3 | **Aviso de segurança ao abrir.** Antes de usar, a pessoa lê e aceita o aviso (não usar dirigindo, testes de desempenho só em área fechada, resultados são indícios, prender bem adaptador e cabos, sem garantia). Se o texto mudar de forma importante, o aviso aparece de novo para todos. | Proteger quem usa e deixar claros os limites do programa. |
| P4 | **Diagnóstico é indício, não sentença.** Toda interpretação automática diz o que foi visto e o que verificar, com confirmação por tempo para evitar alarme falso. | Um scanner OBD2 genérico não vê tudo; a palavra final é de um mecânico. |
| P5 | **Dados não conferidos ficam marcados como experimentais** (ou escondidos atrás de uma opção "experimental"). Códigos próprios de montadora sem fonte confiável mostram esse aviso em vez de um texto inventado. | Melhor dizer "não sei" do que dar uma informação errada. |

### 1.2 Plataforma e conexão

| # | Regra |
| --- | --- |
| P6 | **Windows (10 e 11) por enquanto.** Versão para celular (Android/iOS) foi discutida e ficou para depois. |
| P7 | **Adaptadores ELM327 originais, clones e simuladores**, por **Bluetooth clássico** (porta COM), **Bluetooth LE**, **USB/serial** e **Wi-Fi**, além do **modo demonstração** (carro virtual). |
| P8 | **Tolerante a clones.** O programa espera os defeitos comuns dos clones (respostas faltando, comandos recusados, travamentos) e se recupera sozinho, avisando o que aconteceu. |
| P9 | **Funciona sem internet.** Bases de dados, gráficos e documentação vêm dentro do programa; nada é carregado de sites. |

### 1.3 Interface e textos

| # | Regra |
| --- | --- |
| P10 | **Simples, completa e moderna**, com termos técnicos claros. |
| P11 | **Toda informação técnica tem explicação curta**: dica ao passar o mouse e o **Glossário** com todos os termos. |
| P12 | **Três idiomas:** português (Brasil), inglês (EUA) e inglês (Europa). **As unidades acompanham o idioma** (km/h e km/L no Brasil, mph e mpg nos EUA, L/100 km e bar na Europa) e podem ser ajustadas nas Configurações. Textos novos são escritos em pt-BR e en-US; o inglês europeu é gerado a partir do americano. |
| P13 | **Português do Brasil** de verdade (nada de "ecrã", "ficheiro", "utilizador"). |
| P14 | **Foco nos carros vendidos no Brasil** nos últimos 15 anos, nacionais e importados (normas OBDBr, flex, misturas de combustível da lei brasileira). As porcentagens de etanol na gasolina mudam por lei e precisam ser conferidas de tempos em tempos. |

### 1.4 Dados e arquivos

| # | Regra |
| --- | --- |
| P15 | **Salvar em formatos comuns:** CSV (inclusive no formato do Excel brasileiro), JSON, imagem PNG e PDF (relatório). |
| P16 | **Toda base de dados e todo código aproveitado de outro projeto tem fonte e licença citadas** em [CREDITOS.md](CREDITOS.md) (no programa: Documentação → Fontes e licenças). Só entra material com licença compatível com a GPL-3.0. |
| P17 | **Código aberto, licença GPL-3.0-or-later.** Qualquer pessoa pode ver, estudar e melhorar o programa. |

---

## Parte 2. Regras de trabalho

### 2.1 Quem decide o quê

| # | Regra |
| --- | --- |
| T1 | **Função nova só com aprovação do dono do projeto.** Propostas chegam explicadas em linguagem simples, com as opções e a recomendada. |
| T2 | **Aprovou, entra no programa.** Uma função aprovada vai para a versão principal (`main`) assim que a verificação automática (CI) passar, sem nova confirmação. O mesmo vale para ampliação de dados e correção de erros confirmados. |
| T3 | **Revisões feitas por outra IA:** cada apontamento é conferido no código. Erros reais confirmados são corrigidos direto (entram quando o CI passar) e só um resumo é enviado; o que não se confirmou é explicado. Função nova sugerida numa revisão ainda precisa de aprovação. |
| T4 | **Decisões grandes viram notificação**, com explicação para leigo, mesmo quando o dono do projeto está ausente. O resto segue sozinho. |
| T5 | **Trabalho interrompido (por exemplo, por limite de uso) é retomado sozinho**, parando só para decisões importantes. |
| T17 | **Propostas prontas para o dono e para outra IA:** toda proposta de função nova ou de revisão de código traz (1) um resumo em linguagem simples para leigo, com opções e a recomendada, esperando aprovação antes de mexer no código, e (2) um bloco técnico organizado e autocontido, pronto para copiar e enviar a outra IA para segunda opinião. |
| T18 | **Trabalho em turnos entre IAs:** nunca duas IAs editam a mesma pasta ou *branch* ao mesmo tempo. Cada tarefa roda em *branch* separada (via Pull Request) e só entra na `main` após aprovação do dono do projeto e com todas as verificações automáticas (CI) aprovadas sem erros. |

### 2.2 Qualidade

| # | Regra |
| --- | --- |
| T6 | **Tecnologia moderna, rápida e sólida:** Rust + Tauri 2 no programa, TypeScript na interface, dependências estáveis e atualizadas. |
| T7 | **Código que se explica:** organizado, curto e com comentários que dizem o porquê, para servir de documentação. |
| T8 | **Toda regra de cálculo ou diagnóstico tem teste**, incluindo casos em que ela **não** deve disparar. |
| T9 | **Depois de cada etapa grande, revisão completa:** erros gerais e de tela, comparação com outros scanners, teste como usuário leigo e como usuário avançado. |
| T10 | **Mudanças pequenas, uma por assunto** (um pedido de alteração por tema), para facilitar revisar e desfazer. |

### 2.3 Documentação

| # | Regra |
| --- | --- |
| T11 | **Mapa visual sempre atualizado:** quem cria, muda ou remove uma parte do programa atualiza [DIAGRAMAS.md](DIAGRAMAS.md) no mesmo commit, com legendas em linguagem simples. |
| T12 | **Manual atualizado junto com a função:** [COMO-USAR.md](COMO-USAR.md) explica cada tela; [CARROS-BRASILEIROS.md](CARROS-BRASILEIROS.md) diz o que o programa sabe sobre carros do Brasil e quais são as lacunas. |
| T13 | **Guia para iniciantes** em [GUIA-INICIANTE.md](GUIA-INICIANTE.md): como ver, alterar, testar e publicar o código sem saber programar muito. |
| T14 | **Os documentos aparecem dentro do programa** (tela Documentação). Um documento novo para usuários entra também na lista dessa tela (`src/docs.ts`). |

### 2.4 Versões

| # | Regra |
| --- | --- |
| T15 | **A versão 1.0.0 só é publicada quando o dono do projeto pedir**, depois de testar no carro dele. |
| T16 | **Publicação em duas etapas:** a etiqueta `vX.Y.Z` gera um rascunho da página de download com as notas de `docs/release-notes/`; o dono do projeto confere e clica em "Publish release". |

---

## Regras em discussão

Espaço para regras novas propostas e ainda não combinadas. Quando forem aprovadas, passam para a parte certa acima.

- *(nenhuma no momento)*
