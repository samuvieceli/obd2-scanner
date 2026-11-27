# Guia para iniciantes: ver, alterar, testar e manter o código

Este guia é para quem nunca programou. Ele explica, passo a passo e no Windows, como ver o código do OBD2 Scanner, fazer pequenas alterações, testar o programa e manter tudo sincronizado com o GitHub (onde o código fica guardado e onde o Claude também trabalha).

---

## 1. Cinco palavras que você vai ver

| Palavra | O que significa na prática |
| --- | --- |
| **Repositório** | A pasta do projeto, com todo o histórico de mudanças. Fica no GitHub e pode ter uma cópia no seu computador. |
| **Commit** | Um "salvamento com descrição" de um conjunto de mudanças. Ex.: "Corrige texto da tela de conexão". |
| **Branch** (ramo) | Uma linha de trabalho separada. A principal se chama `main`. O Claude trabalha em outra (`claude/project-thread-vk0vkx`) para você revisar antes de juntar. |
| **Pull request (PR)** | O pedido para juntar uma branch na `main`. É onde você vê o que mudou e aprova. |
| **Merge** | Juntar a branch na `main`, depois de aprovar o PR. |

**Sync** (sincronizar) no VS Code faz duas coisas: baixa o que mudou no GitHub (*pull*) e envia o que você salvou com commit (*push*).

---

## 2. Só olhar o código (sem instalar nada)

Abra https://github.com/samuvieceli/obd2-scanner no navegador. Para ver a versão mais nova, antes do merge, troque a branch no botão do canto superior esquerdo da lista de arquivos (onde está escrito `main`) para `claude/project-thread-vk0vkx`.

Mapa das pastas:

| Pasta / arquivo | O que tem |
| --- | --- |
| `src/` | A interface (as telas). `src/views/` tem um arquivo por tela. |
| `src/locales/pt-BR.ts` e `en-US.ts` | **Todos os textos** do programa, em português e inglês. É o lugar mais fácil para começar a mexer. |
| `src/styles.css` | Cores, tamanhos e temas. |
| `crates/obd-core/` | O "motor": conversa com o adaptador ELM327, fórmulas dos sensores, códigos de falha, simulador. |
| `crates/obd-core/data/` | Descrições dos códigos de falha (arquivos JSON). |
| `src-tauri/` | A "casca" do programa para Windows (janela, instalador, ícones). |
| `docs/` | Documentação (este guia, como usar, arquitetura, créditos). O **mapa visual com diagramas** de todos os componentes está em `docs/DIAGRAMAS.md`. |
| `.github/workflows/ci.yml` | A verificação automática do GitHub, que testa e gera o instalador a cada mudança. |

---

## 3. Preparar o computador (uma vez só)

Instale, nesta ordem, aceitando as opções padrão:

1. **Git**: https://git-scm.com/download/win
2. **Visual Studio Code**: https://code.visualstudio.com
3. **Node.js 22 (LTS)**: https://nodejs.org
4. **Ferramentas de Build do Visual Studio**: https://visualstudio.microsoft.com/visual-cpp-build-tools/ . No instalador, marque **"Desenvolvimento para desktop com C++"**. (É grande, cerca de 6 GB.)
5. **Rust**: https://rustup.rs . Baixe e rode o `rustup-init.exe`, e aperte Enter para a opção padrão.

Depois, **reinicie o computador**. O WebView2, que o programa usa para desenhar a janela, já vem no Windows 10 e 11 atualizados.

No VS Code, instale também as extensões **rust-analyzer** e **Tauri** (ícone de quadradinhos na barra da esquerda, depois pesquise o nome).

---

## 4. Baixar o código para o seu computador (clonar)

1. Abra o VS Code e aperte `Ctrl+Shift+P`. Digite **Git: Clone** e aperte Enter.
2. Cole `https://github.com/samuvieceli/obd2-scanner` e aperte Enter.
3. Escolha uma pasta (por exemplo, `Documentos`). Quando perguntar, clique em **Abrir**.
4. Se pedir login no GitHub, faça. Ele só pede uma vez.

**Para ver o trabalho mais novo do Claude** (antes do merge): clique no nome da branch no canto inferior esquerdo do VS Code (aparece `main`) e escolha `origin/claude/project-thread-vk0vkx`. Depois do merge do PR, volte para `main`.

---

## 5. Rodar o programa no modo de desenvolvimento

1. No VS Code, abra o terminal: menu **Terminal → Novo Terminal**.
2. Na primeira vez (e sempre que o arquivo `package.json` mudar), digite:
   ```
   npm install
   ```
3. Para abrir o programa:
   ```
   npm run tauri dev
   ```
   A primeira vez demora alguns minutos, porque o Rust compila tudo. Depois, fica rápido.
4. A janela abre. Para testar **sem carro**, deixe **Demonstração** selecionada, clique em **Conectar**, vá em **Painel ao vivo** e clique em **Iniciar leitura**. O carro virtual tem falhas de propósito, para você testar os códigos de falha, o Modo 06 e o resto.
5. Para fechar, feche a janela ou aperte `Ctrl+C` no terminal.

Enquanto o programa está aberto, **mudanças na interface aparecem na hora** quando você salva (`Ctrl+S`). Mudanças no Rust (`crates/` ou `src-tauri/`) fazem o programa recompilar e reabrir sozinho.

---

## 6. Fazer uma alteração simples (exemplo)

Vamos trocar um texto:

1. Garanta que está atualizado: clique em **Sync** (ícone de setas circulares no canto inferior esquerdo).
2. Abra `src/locales/pt-BR.ts` (`Ctrl+P` e digite o nome do arquivo).
3. Aperte `Ctrl+F` e procure, por exemplo, `Painel ao vivo`.
4. Troque o texto **entre as aspas**. Não apague aspas, vírgulas nem chaves `{ }`.
5. Salve com `Ctrl+S`. Com o `npm run tauri dev` aberto, a mudança aparece na hora.

Dicas:

- Ao mudar um texto em `pt-BR.ts`, mude o equivalente em `en-US.ts`, para os dois idiomas ficarem iguais.
- Palavras entre chaves, como `{rate}` ou `{name}`, são preenchidas pelo programa. Deixe-as no texto.
- Se algo der errado, a aba **Controle do Código-Fonte** (ícone de ramo, `Ctrl+Shift+G`) mostra o que mudou. Clique com o botão direito no arquivo e escolha **Descartar Alterações** para voltar ao que era.

---

## 7. Testar antes de enviar

No terminal do VS Code:

| Comando | O que verifica | Tempo |
| --- | --- | --- |
| `npm run typecheck` | Erros de digitação no código da interface. | segundos |
| `npm test` | A detecção dos testes de desempenho e a conversão de unidades. | segundos |
| `cargo test -p obd-core --all-features` | O "motor": fórmulas, códigos de falha, simulador, adaptadores clones. | 1 a 3 min na primeira vez |
| `npm run tauri build` | Gera o instalador em `target\release\bundle\nsis\`. | 5 a 10 min |

Se tudo terminar sem a palavra `error` (em vermelho), está ok.

Você também não precisa rodar tudo isso sempre: **a cada envio, o GitHub roda os testes sozinho** e gera o instalador. Veja na aba **Actions** do repositório. Um sinal verde ✓ quer dizer que passou, e o instalador fica em **Artifacts**, no fim da página da execução (junto com a versão portátil, que roda sem instalar).

---

## 8. Salvar e compartilhar (commit e sync)

1. Abra **Controle do Código-Fonte** (`Ctrl+Shift+G`). Os arquivos alterados aparecem na lista.
2. Escreva uma mensagem curta no campo de cima, dizendo o que mudou. Ex.: `Ajusta textos do painel`.
3. Clique em **Commit** (se perguntar se quer incluir todas as mudanças, responda **Sim**).
4. Clique em **Sync Changes**. Pronto, a mudança está no GitHub.

**Em qual branch fazer commit?**

- Mudanças pequenas suas (textos, cores): direto na `main` está ok.
- Enquanto o PR do Claude estiver aberto, evite mexer nos mesmos arquivos que ele. Se quiser ajustar algo do PR, peça no chat ou faça o commit na branch do PR (`claude/project-thread-vk0vkx`) e me avise.

---

## 9. Trabalhando junto com o Claude

1. Você pede a mudança no chat do projeto.
2. O Claude faz as alterações numa branch, roda os testes e abre (ou atualiza) um **pull request**.
3. Você abre o PR no GitHub, olha a aba **Files changed** (o que mudou) e baixa o instalador gerado pelo CI para testar.
4. Se estiver bom, clique em **Merge pull request** e depois em **Confirm merge**.
5. No VS Code, volte para a branch `main` e clique em **Sync** para ficar atualizado.

**Regra de ouro:** sempre clique em **Sync** antes de começar a mexer e depois de fazer commit. Assim, você e o Claude estão sempre na mesma versão.

---

## 10. Lançar uma versão (página de download)

A página **Releases** do GitHub é onde qualquer pessoa baixa o instalador. Uma versão nova é feita assim:

1. A versão nova fica escrita em três arquivos (`package.json`, `src-tauri/tauri.conf.json` e `Cargo.toml`, no campo `version`) e as novidades ficam em `docs/release-notes/vX.Y.Z.md`. Pode pedir ao Claude no chat: "prepare a versão 1.1".
2. Faça o merge do PR na `main`.
3. Crie a **tag** da versão (uma etiqueta no histórico, por exemplo `v1.0.0`). Pode pedir ao Claude: "pode criar a tag v1.0.0".
4. O GitHub monta o instalador e a versão portátil (.zip) sozinho (uns 10 minutos, aba **Actions**, fluxo **Release**) e cria um **rascunho** da versão. Rascunho ainda não aparece para ninguém.
5. Abra **Releases** no repositório, clique no rascunho, confira o texto e os arquivos e clique em **Publish release**. Pronto: o link "Baixar a versão mais recente" do README passa a entregar essa versão.

Se algo estiver errado no rascunho, é só apagar (botão **Delete**) e pedir a correção. Nada foi publicado.

---

## 11. Problemas comuns

| Problema | Solução |
| --- | --- |
| `npm` ou `cargo` "não é reconhecido" | Reinicie o computador depois de instalar Node.js e Rust. Feche e reabra o VS Code. |
| Erro com `link.exe` ou `MSVC` ao compilar | Faltam as Ferramentas de Build do Visual Studio com "Desenvolvimento para desktop com C++" (passo 3.4). |
| O **Sync** fala em **conflito** | Você e o Claude mudaram a mesma linha. Não force nada: peça ajuda no chat, informando o arquivo. |
| Fiz uma bagunça e quero voltar | Antes do commit: **Descartar Alterações** (seção 6). Depois do commit: peça ajuda no chat; nada se perde, porque o histórico guarda tudo. |
| O programa abre em branco | Feche, rode `npm install` de novo e depois `npm run tauri dev`. |
| O Windows avisa "editor desconhecido" ao instalar | Normal: o instalador ainda não é assinado. Clique em **Mais informações → Executar assim mesmo**. |

---

Mais detalhes: [COMO-USAR.md](COMO-USAR.md) (usar o programa), [DIAGRAMAS.md](DIAGRAMAS.md) (mapa visual dos componentes), [ARQUITETURA.md](ARQUITETURA.md) (como o código é organizado) e [CREDITOS.md](CREDITOS.md).
