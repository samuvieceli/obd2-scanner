# Mapa visual do programa

Diagramas de todos os componentes do OBD2 Scanner, em linguagem simples. O GitHub desenha os diagramas sozinho ao abrir este arquivo no site (eles são escritos em [Mermaid](https://mermaid.js.org), um formato de texto para diagramas). No VS Code, instale a extensão **Markdown Preview Mermaid Support** e use `Ctrl+Shift+V` para ver.

> **Regra do projeto:** quem mudar, criar ou remover um componente atualiza este arquivo no mesmo commit.

Sumário: [1. Visão geral](#1-visão-geral) · [2. Do carro até a tela](#2-do-carro-até-a-tela) · [3. Formas de conectar](#3-formas-de-conectar) · [4. Motor (obd-core)](#4-motor-obd-core) · [5. Saúde da conexão](#5-saúde-da-conexão-travamento-e-reconexão) · [6. Telas e módulos da interface](#6-telas-e-módulos-da-interface) · [7. Perfis e unidades](#7-perfis-de-veículos-e-unidades) · [8. Onde os dados ficam guardados](#8-onde-os-dados-ficam-guardados) · [9. Verificação automática (CI)](#9-verificação-automática-ci)

---

## 1. Visão geral

O programa tem três andares. Embaixo, o **motor** (Rust) sabe conversar com o adaptador e entender as respostas do carro. No meio, a **casca** (Tauri) transforma o motor num programa de Windows e leva as mensagens entre os andares. Em cima, a **interface** (as telas) mostra tudo para você.

```mermaid
flowchart TB
    user(["Você"])
    subgraph UI["Interface: src/ (TypeScript)"]
        views["Telas<br/>views/"]
        logic["Cálculos da interface<br/>consumo, Trip A/B, abastecimento,<br/>desempenho, testes guiados, alertas,<br/>perfis, unidades, reprodução"]
        store["Estado compartilhado<br/>store.ts"]
    end
    subgraph APP["Casca: src-tauri/ (Rust)"]
        cmds["Comandos<br/>lib.rs"]
        worker["Trabalhador da conexão<br/>worker.rs"]
        rec["Gravação e marcas de evento<br/>recorder.rs"]
        port["Início, versão portátil<br/>e tela acesa<br/>portable.rs"]
    end
    subgraph CORE["Motor: crates/obd-core/ (Rust)"]
        elm["Conversa com o ELM327<br/>elm327.rs"]
        dec["Tradutores<br/>PIDs, códigos de falha, VIN,<br/>prontidão, Modo 06"]
        interp["Interpretação e relatório<br/>interpret.rs, report.rs"]
        health["Saúde da conexão<br/>health.rs"]
        trans["Transportes<br/>USB, Bluetooth, BLE, Wi-Fi, simulador"]
    end
    adapter[["Adaptador ELM327"]]
    car[("Carro")]

    user <--> views
    views <--> store
    logic <--> store
    views -- "pedidos (invoke)" --> cmds
    worker -- "eventos: dados ao vivo,<br/>estado da conexão" --> store
    cmds --> worker
    worker --> rec
    worker --> elm
    worker --> health
    elm --> dec
    cmds --> interp
    elm --> trans
    trans <--> adapter
    adapter <--> car
```

---

## 2. Do carro até a tela

Caminho de **um valor ao vivo** (por exemplo, a rotação do motor), várias vezes por segundo.

```mermaid
sequenceDiagram
    autonumber
    participant C as Carro (central)
    participant A as Adaptador ELM327
    participant T as Transporte
    participant E as elm327.rs
    participant W as worker.rs
    participant S as store.ts
    participant V as Telas
    W->>E: ler rotação (PID 0C)
    E->>T: texto "010C"
    T->>A: bytes pela porta / Bluetooth / Wi-Fi
    A->>C: pergunta no barramento (CAN, ISO...)
    C-->>A: resposta "41 0C 1A F8"
    A-->>T: texto + ">"
    T-->>E: bytes recebidos
    E->>E: limpa o texto e aplica a fórmula (1.726 rpm)
    E-->>W: valor
    W->>W: junta os valores do ciclo, grava se estiver gravando
    W-->>S: evento "live-frame"
    S-->>V: avisa as telas (painel, HUD, gráficos, consumo, alertas, desempenho)
```

---

## 3. Formas de conectar

Todas as conexões seguem a mesma regra (a interface `Transport`): só levar bytes de um lado para o outro. Por isso o resto do programa não precisa saber qual está em uso.

```mermaid
flowchart LR
    elm["elm327.rs"] --> T{{"Transport<br/>(mesma interface para todos)"}}
    T --> serial["serial.rs<br/>cabo USB e Bluetooth clássico<br/>(aparece como porta COM)"]
    serial -. "qual porta COM<br/>é a de saída?" .-> btp["bt_ports.rs<br/>lê o registro do Windows:<br/>porta de saída x entrada<br/>e nome do adaptador"]
    T --> ble["ble.rs<br/>Bluetooth LE<br/>(iOS-Vlink, Vgate...)"]
    T --> tcp["tcp.rs<br/>Wi-Fi<br/>(192.168.0.10:35000)"]
    T --> sim["simulator.rs<br/>carro virtual<br/>(modo demonstração)"]
    T --> scripted["scripted.rs<br/>respostas gravadas<br/>(só nos testes)"]
    T --> closed["Closed<br/>porta já fechada<br/>(durante a reconexão)"]
```

---

## 4. Motor (obd-core)

O motor não tem telas. Ele pode ser testado sozinho (`cargo test`) e reaproveitado em outro programa.

```mermaid
flowchart TB
    subgraph core["crates/obd-core/src"]
        transport["transport/<br/>mover bytes"]
        elm327["elm327.rs<br/>comandos AT e OBD,<br/>tolerante a clones, recover()"]
        response["response.rs<br/>limpa o texto, junta<br/>respostas longas (CAN)"]
        health["health.rs<br/>percebe travamento<br/>e queda da conexão"]
        pid["pid.rs<br/>fórmulas dos sensores"]
        dtc["dtc.rs + data/*.json<br/>códigos de falha"]
        vin["vin.rs<br/>chassi: fabricante (foco no Brasil),<br/>ano, país"]
        readiness["readiness.rs<br/>monitores de prontidão"]
        mode06["mode06.rs<br/>resultados dos autotestes"]
        interpret["interpret.rs<br/>interpretação automática (indícios)"]
        session["session.rs<br/>gravação CSV e JSON<br/>(+ códigos e prontidão)"]
        report["report.rs<br/>resumo da gravação para<br/>o relatório: mín/méd/máx,<br/>indícios, gráficos"]
        simulator["simulator.rs<br/>carro virtual com defeitos,<br/>falhas de clone e 2 centrais"]
        adaptertest["adapter_test.rs<br/>versão real do ELM327"]
        ecuscan["ecu_scan.rs<br/>centrais e identificação"]
        safety["safety.rs<br/>filtro só leitura<br/>do Terminal AT"]
    end
    adaptertest --> elm327
    ecuscan --> elm327
    elm327 --> transport
    elm327 --> response
    elm327 --> pid & dtc & vin & readiness & mode06
    simulator -. "é um" .-> transport
    interpret --> pid
    session --> pid
    report --> session & interpret
```

### Ferramentas de diagnóstico do adaptador e do carro

Os dois testes mudam configurações do adaptador por alguns segundos e sempre terminam com um reinício (`ATZ`) e a configuração de volta. Nenhum deles grava nada no adaptador nem na central do carro.

```mermaid
flowchart LR
    subgraph teste["Teste do adaptador (adapter_test.rs)"]
        t1["Envia comandos AT<br/>de cada versão<br/>(1.0 até 2.1)"] --> t2["Conta aceitos (✓)<br/>e recusados (?)"] --> t3["Versão real x versão anunciada<br/>→ é clone?"]
    end
    subgraph busca["Busca de centrais (ecu_scan.rs)"]
        b1["ATH1: liga os endereços<br/>nas respostas"] --> b2["0100 para todas:<br/>quem respondeu?<br/>(7E8 motor, 7E9 câmbio...)"] --> b3["Para cada uma (ATSH):<br/>nome (09 0A) e<br/>identificação UDS (22 F1xx)"]
    end
    t3 & b3 --> r["ATZ + configuração<br/>(Elm327::reconfigure)"]
```

### Só leitura: o que nunca sai do programa

O programa só lê o carro. O Terminal AT é o único lugar onde se digita um comando livre, então cada linha passa por `safety.rs` antes de ir ao adaptador, e vai exatamente como foi conferida: sem espaços, quebras de linha ou caracteres invisíveis, para que uma linha nunca leve um segundo comando escondido. Apagar códigos tem botão próprio, que pede confirmação e confere na hora se o motor está parado.

```mermaid
flowchart TB
    typed["Comando digitado<br/>no Terminal AT"] --> chk{"safety.rs"}
    chk -- "AT comum (ATI, ATRV, ATSP...)<br/>ou leitura (01, 02, 03, 06, 09, 22...)" --> send["Vai ao adaptador"]
    chk -- "grava no adaptador ou abre brecha<br/>(ATPP, ATSD, ATCV, ATBRD, ATCAF0)" --> no1["Recusado"]
    chk -- "apagar códigos (04, 14)" --> no2["Recusado: use o botão<br/>Apagar códigos"]
    chk -- "grava, testa peças ou reinicia<br/>central (2E, 31, 27, 11, 08...)" --> no3["Recusado"]
    btn["Botão Apagar códigos"] --> confirm["Confirmação"] --> eng{"Pergunta ao carro agora:<br/>giro e velocidade"}
    eng -- "motor parado" --> clear["Envia 04"] --> reread["Lê os códigos de novo<br/>e mostra se sumiram"]
    eng -- "motor girando<br/>ou carro andando" --> no4["Recusado: desligue o motor"]
    eng -- "carro não respondeu" --> no5["Recusado: ligue a ignição"]
    send -- "AT que muda a configuração<br/>(ATZ, ATH1, ATSH...)" --> mark["Anota: configuração mudou"]
    mark -- "ao sair do Terminal" --> restore["Reconfigura o adaptador<br/>como o programa espera"]
```

Comandos como `ATZ` (reiniciar) ou `ATH1` (mostrar cabeçalhos) mudam o jeito como o adaptador responde, e o painel ao vivo não entenderia as respostas. Por isso, ao sair do Terminal, o programa reconfigura o adaptador do mesmo jeito que faz depois de uma reconexão, no protocolo já encontrado e sem busca lenta.

---

## 5. Saúde da conexão: travamento e reconexão

Adaptadores clones às vezes travam, reiniciam sozinhos numa queda de tensão (na partida do motor) ou perdem o Bluetooth. O trabalhador da conexão (`worker.rs`) observa cada resposta com a ajuda de `health.rs` e reage sozinho. A tela mostra uma faixa amarela enquanto isso acontece.

```mermaid
stateDiagram-v2
    [*] --> Normal
    Normal --> Normal: resposta válida ou "NO DATA"
    Normal --> Suspeito: silêncio, STOPPED,<br/>BUFFER FULL, lixo
    Suspeito --> Normal: voltou a responder
    Suspeito --> Recuperando: 3 pedidos seguidos sem resposta
    Normal --> Recuperando: adaptador reiniciou sozinho<br/>(apareceu "ELM327 v..." ou "LV RESET")
    Recuperando --> Normal: ATI responde, ATZ + configuração,<br/>mesmo protocolo de antes
    Recuperando --> CarroCalado: adaptador ok,<br/>carro não responde
    CarroCalado --> Normal: tenta de novo em 5 s
    Recuperando --> Reconectando: adaptador não responde nem ao ATI
    Normal --> Reconectando: porta caiu<br/>(Bluetooth fora de alcance, cabo)
    Reconectando --> Normal: porta reaberta<br/>(espera 1, 2, 3, 5, 8, 10, 10... s;<br/>USB: também na COM nova)
    Reconectando --> Desconectado: 3 minutos sem sucesso<br/>ou você clicou em "Parar"
    Desconectado --> [*]
```

Se o adaptador for USB e o Windows mudar o número da COM depois de tirar e pôr o cabo, a reconexão encontra o mesmo adaptador na porta nova pelo número de série do USB.

Com o adaptador parado (sem leitura ao vivo), um `ATRV` silencioso a cada 10 s percebe a queda cedo. No modo demonstração dá para provocar cada falha (Conexão → "Simular falhas de adaptador clone").

---

## 6. Telas e módulos da interface

Cada tela é um arquivo em `src/views/`. Os módulos de cálculo ficam em `src/` e trabalham com os mesmos dados ao vivo, por isso funcionam igual com o carro e com uma gravação reproduzida.

```mermaid
flowchart LR
    subgraph telas["Telas (src/views/)"]
        connection["Conexão<br/>+ teste do adaptador"]
        dashboard["Painel ao vivo"]
        findings["Quadro Interpretação<br/>dos dados<br/>views/findings.ts"]
        refueldlg["Janela Abasteci<br/>views/refuel-dialog.ts"]
        safetydlg["Aviso de segurança<br/>ao abrir o programa<br/>views/safety.ts"]
        hud["HUD"]
        journey["Viagem<br/>Iniciar/Encerrar, análise<br/>de consumo, relatório<br/>views/journey.ts"]
        performance["Testes de desempenho<br/>(uma prova por vez)"]
        guided["Testes guiados<br/>bateria, sondas,<br/>mapa de correção"]
        charts["Gráficos"]
        diagnostics["Códigos de falha<br/>+ Modo 06"]
        vehicle["Veículo e prontidão<br/>+ centrais"]
        terminal["Terminal AT"]
        sessions["Gravações e relatórios"]
        glossary["Glossário"]
        docsview["Documentação<br/>guias, regras, diagramas,<br/>dados e licenças"]
        settings["Configurações"]
    end
    subgraph modulos["Módulos (src/)"]
        store["store.ts<br/>estado e avisos"]
        api["api.ts<br/>ponte com o Rust"]
        trip["trip.ts + trips.ts<br/>consumo, Trip A e Trip B"]
        refuel["refuel.ts<br/>ajuste pelo abastecimento"]
        cost["cost.ts + fuels.ts<br/>custo em R$ e<br/>gasolina × etanol"]
        perf["perf.ts<br/>detecção 0-100 etc."]
        battery["battery.ts<br/>etapas e limites do<br/>teste de bateria"]
        o2test["o2test.ts<br/>sondas e catalisador"]
        trims["trims.ts<br/>mapa de correção<br/>de combustível"]
        m06hints["mode06hints.ts<br/>indícios dos testes<br/>da central (Modo 06)"]
        dtcadvice["dtcadvice.ts<br/>aviso de código da montadora<br/>sem descrição confiável"]
        alerts["alerts.ts<br/>alertas e bipe"]
        playback["playback.ts<br/>reprodução"]
        prefs["prefs.ts<br/>preferências e perfis"]
        units["units.ts<br/>unidades"]
        gauge["gauge.ts<br/>mostradores"]
        theme["theme.ts<br/>temas e botão dia/noite"]
        presets["presets.ts<br/>painéis prontos e<br/>predefinições dos gráficos"]
        calc["calc.ts<br/>parâmetros calculados<br/>(consumo L/h e km/L)"]
        share["share.ts<br/>cartão 'Copiar imagem'"]
        warmup["warmup.ts<br/>motor frio / pronto"]
        summary["summary.ts + drive-summary.ts<br/>resumo ao desligar o motor"]
        drives["drives.ts + views/drive-history.ts<br/>histórico de viagens,<br/>gasolina × etanol, totais do mês"]
        jlive["journey-live.ts<br/>grava a viagem<br/>(1 amostra por segundo)"]
        janalyze["journey.ts<br/>análise: onde o combustível<br/>foi gasto, faixas de velocidade,<br/>jeito de dirigir, dicas"]
        jstore["journey-store.ts<br/>viagens salvas (IndexedDB)"]
        jreport["views/journey-report.ts<br/>números da tela, relatório,<br/>CSV e cartão de imagem"]
        precheck["precheck.ts<br/>checagem antes da estrada:<br/>códigos, luz, bateria/alternador,<br/>temperatura"]
        search["search.ts + views/search.ts<br/>busca Ctrl+F / Ctrl+K"]
        mini["views/mini.ts<br/>mini janela por cima das outras"]
        safety["safety.ts<br/>versão do aviso de segurança<br/>e se já foi aceito"]
        recdiag["recording-diagnostics.ts<br/>lê códigos, prontidão e<br/>Modo 06 ao gravar"]
        reportview["views/report.ts<br/>monta o relatório HTML"]
        i18n["i18n.ts + locales/<br/>textos pt-BR, en-US e en-GB<br/>(English Europe)"]
        upresets["unit-presets.ts<br/>unidades de cada idioma"]
        docsmod["docs.ts<br/>documentos embutidos<br/>(README e docs/*.md)"]
    end
    dashboard --> gauge & trip & alerts & presets & warmup & findings
    diagnostics --> dtcadvice
    settings --> safetydlg
    safetydlg --> safety
    reportview --> dtcadvice
    trip --> refuel
    dashboard --> refueldlg
    refueldlg --> refuel
    charts -- "parâmetros escolhidos<br/>também são lidos" --> store
    hud --> warmup & mini
    diagnostics & charts --> share
    charts --> presets & calc & trip
    store --> calc
    diagnostics --> m06hints
    dashboard --> summary
    summary --> trip & cost & share
    summary --> drives
    journey --> jlive & janalyze & jstore & jreport & drives & precheck
    jlive --> trip & jstore
    jlive -- "parâmetros da viagem<br/>também são lidos" --> store
    jreport --> cost & share & reportview
    search --> glossary & diagnostics & docsview
    docsview --> docsmod & safetydlg & glossary
    settings --> docsview
    performance --> perf
    guided --> battery & o2test & trims
    sessions --> playback
    dashboard & sessions --> recdiag
    sessions --> reportview
    settings --> prefs & units & theme
    connection --> prefs
    dashboard & hud & charts & performance --> units
    telas --> store
    telas --> api
    telas --> i18n
    units & prefs --> upresets
    trip & alerts --> prefs
    dashboard --> cost
    cost --> prefs
```

### Tela Viagem: do botão Iniciar ao relatório

```mermaid
flowchart LR
    start["Iniciar viagem"] --> live["journey-live.ts<br/>pede ao adaptador o que a<br/>análise precisa e guarda<br/>1 linha por segundo"]
    live -- "a cada 30 s" --> db[("IndexedDB<br/>(sobrevive se o programa fechar)")]
    stop["Encerrar"] --> db
    rec["Gravação salva (.json)"] -- "Analisar uma gravação" --> db
    db --> an["journey.ts<br/>analyze()"]
    an --> screen["Tela: números, dicas,<br/>onde o combustível foi gasto,<br/>faixas de velocidade, gráficos"]
    an --> pdf["Relatório (PDF)"] & csv["Planilha (CSV)"] & img["Copiar imagem"]
    hist["Histórico automático<br/>(drives.ts)"] -- "média do carro" --> an
    cuts["Cortes escolhidos<br/>(manter / tirar um trecho)"] -- "applyCuts()" --> an
    an -- "duas viagens: compare()" --> cmp["Comparação<br/>lado a lado"]
    chk["Checagem antes da estrada"] --> pc["precheck.ts<br/>evaluate()"]
```

Os cortes ficam guardados junto com a viagem (o campo `cuts`), sem apagar as linhas originais: desfazer é só esvaziar a lista. A checagem antes da estrada pede ao adaptador, por uns segundos, rotação, temperatura e tensão (`state.extraKeys` em `store.ts`), lê os códigos de falha e a prontidão e depois devolve a leitura como estava.

O programa grava, uma vez por segundo, só o que a análise usa: velocidade, rotação, carga, borboleta, temperatura, correções de combustível, malha fechada, etanol (flex) e o necessário para calcular o consumo (vazão, MAF ou MAP). O consumo de cada linha é o mesmo do computador de bordo, já com a calibração do posto. Um intervalo de mais de 5 segundos sem dados (programa fechado, conexão caída) fica fora da conta.

### Documentação dentro do programa

Os documentos do projeto (este arquivo incluído) entram no programa na hora de gerar o instalador, então abrem sem internet e sempre batem com a versão instalada. A tela **Documentação** mostra a lista, transforma o texto em página e desenha os diagramas com o Mermaid, que só é carregado quando um documento com diagrama é aberto, nas cores do tema escolhido. Os números da página inicial (quantos códigos de falha, fabricantes, parâmetros) vêm das próprias bases do programa, pelo comando `data_info`.

```mermaid
flowchart LR
    files["README.md e docs/*.md<br/>(inclusive as regras do projeto<br/>e as notas da versão)"]
    build["Geração do instalador<br/>junta os textos ao programa"]
    docsmod["docs.ts<br/>lista, títulos das seções<br/>e para onde cada link vai"]
    view["Tela Documentação<br/>views/docs.ts"]
    marked["marked<br/>texto → página"]
    mermaid["Mermaid<br/>desenha os diagramas<br/>(carregado só quando precisa)"]
    data["Comando data_info<br/>tamanho das bases de códigos<br/>de falha e de fabricantes"]
    search["Busca Ctrl+F<br/>acha as seções"]
    files --> build --> docsmod --> view
    view --> marked & mermaid
    view --> data
    search --> docsmod
```

Links entre documentos abrem na própria tela; links para sites e para arquivos de código abrem no navegador (no GitHub). Um teste confere que todo link para uma seção de outro documento aponta para uma seção que existe.

### Quando a leitura ao vivo liga e desliga

Conectar não liga a leitura. Ela começa ao abrir o Painel ao vivo ou o HUD e continua ao trocar de tela, para os gráficos, o computador de bordo e a gravação seguirem recebendo dados. O botão **Pausar leitura** desliga; depois ele vira **Retomar leitura**, e o Painel e o HUD não religam sozinhos até você retomar ou conectar de novo. Quem decide é `autoStartReading` em `views/dashboard.ts`, com a marca `readingPaused` em `store.ts`.

```mermaid
stateDiagram-v2
    [*] --> Conectado: Conectar
    Conectado --> Lendo: abrir Painel ao vivo ou HUD
    Conectado --> Lendo: Gravar, Mini janela,<br/>teste guiado ou de desempenho
    Lendo --> Lendo: trocar de tela<br/>(gráficos e trips seguem)
    Lendo --> Pausado: botão "Pausar leitura"
    Pausado --> Pausado: abrir Painel ou HUD<br/>(não religa sozinho)
    Pausado --> Lendo: "Retomar leitura",<br/>Gravar ou Mini janela
    Pausado --> Lendo: teste guiado ou de desempenho<br/>(volta a Pausado ao sair)
    Lendo --> [*]: Desconectar
    Pausado --> [*]: Desconectar
```

### Testes de desempenho: uma prova por vez

Na tela **Testes de desempenho** só a prova marcada em **Fazer esta prova** mede; as outras ficam apagadas. `perf.ts` acompanha a velocidade e reconhece sozinho o começo e o fim. A retomada (40–80, 80–120) só vale partindo de velocidade constante, como numa ultrapassagem de verdade.

```mermaid
stateDiagram-v2
    [*] --> Esperando
    Esperando --> Medindo: 0–100: carro parado e sai do lugar
    Esperando --> Constante: retomada: velocidade perto da inicial<br/>(8 abaixo a 2 acima, variando até 4 km/h)
    Constante --> Medindo: 2 s constante e acelera fundo
    Esperando --> Medindo: 100–0: passa de 100 km/h freando
    Medindo --> Resultado: cruza a velocidade final<br/>(ou para, no 100–0)
    Medindo --> Esperando: alivia o pé, 3 s sem subir<br/>ou falha de leitura (descarta)
    Resultado --> Esperando: guarda tempo, distância<br/>e aceleração média
```

---

## 7. Perfis de veículos e unidades

Cada carro tem um perfil (combustível, cilindrada, alertas, resultados de desempenho). O programa reconhece o carro pelo chassi (VIN). As unidades só mudam o que aparece na tela: por dentro tudo continua no sistema métrico do OBD2.

```mermaid
flowchart TB
    connect["Conectar"] --> vin["Ler o chassi (VIN)"]
    vin --> q1{"Algum perfil tem<br/>esse VIN?"}
    q1 -- sim --> switch["Ativa esse perfil"]
    q1 -- não --> q2{"O perfil ativo<br/>já tem VIN?"}
    q2 -- não --> learn["Guarda o VIN no perfil ativo"]
    q2 -- "sim, outro" --> warn["Avisa: crie um perfil novo"]
    switch & learn --> use["Consumo, alertas e desempenho<br/>usam os dados desse carro"]

    raw["Valor do carro<br/>(métrico: km/h, °C, kPa)"] --> conv["units.ts<br/>converte só na hora de mostrar"]
    conv --> screen["Tela: mph, °F, psi, bar,<br/>milhas, galões, mpg..."]
    raw --> files["Gravações e arquivos<br/>continuam métricos"]
```

### Trocar o idioma troca as unidades

Escolher um idioma aplica as unidades usuais dele e redesenha todas as telas na hora. Os textos são escritos com valores métricos ("abaixo de 60 °C"); na hora de mostrar, `units.ts` converte esses números para as unidades escolhidas. O inglês da Europa (en-GB) não é um arquivo traduzido à parte: ele é gerado do inglês dos EUA trocando a grafia americana pela britânica (gasoline → petrol, liter → litre).

```mermaid
flowchart LR
    pick["Usuário escolhe o idioma"] --> preset{"Qual idioma?"}
    preset -- "Português (Brasil)" --> br["km/h · °C · kPa · km/L"]
    preset -- "English (US)" --> us["mph · °F · psi · mpg"]
    preset -- "English (Europe)" --> eu["km/h · °C · bar · L/100 km"]
    br & us & eu --> save["Salva as unidades<br/>(dá para ajustar depois)"]
    save --> redraw["Redesenha todas as telas<br/>e descreve de novo os códigos lidos"]
    texts["Textos com valores métricos<br/>'abaixo de 60 °C'"] --> filter["units.ts converte<br/>'abaixo de 140 °F'"] --> redraw
    us_txt["en-US.ts"] --> gb["en-GB.ts<br/>grafia britânica automática"]
```

### Como o consumo é calculado e o ajuste pelo abastecimento

Ao conectar, o programa vê quais sensores o carro informa e guarda no perfil qual conta ele usa (linha **Consumo calculado por**). A cilindrada e a eficiência volumétrica só aparecem quando a conta é pelo MAP, porque só ali entram. O ajuste pelo abastecimento compara os litros da bomba com os calculados: em carros só com MAP corrige a eficiência volumétrica; em carros com MAF (dentro de **Avançado**) corrige um fator geral, útil com o sensor sujo ou velho. Quem faz as contas é `refuel.ts`; `trip.ts` soma os litros e aplica a correção.

```mermaid
flowchart TB
    car["Sensores que o carro informa"] --> q1{"Vazão de combustível<br/>(PID 5E)?"}
    q1 -- sim --> pid["Consumo direto da central<br/>(sem ajuste)"]
    q1 -- não --> q2{"Sensor MAF?"}
    q2 -- sim --> maf["Ar do MAF ÷ relação ar/combustível<br/>× fator de correção (padrão 100%)"]
    q2 -- não --> map["Pressão MAP + rotação + temperatura<br/>× cilindrada × eficiência volumétrica (padrão 85%)"]
    full["Tanque cheio"] --> sum["Soma os litros calculados<br/>e os km, só com o programa lendo"]
    sum --> fill["Abasteci: janela pede<br/>os litros da bomba"]
    fill --> check{"≥ 50 km, ≥ 3 L,<br/>sem falhas de leitura,<br/>resultado na faixa?"}
    check -- não --> ignore["Avisa e não muda nada"]
    check -- sim --> avg["Média dos últimos 5 abastecimentos<br/>(pesada pelos km)"]
    avg -- "carro só com MAP" --> map
    avg -- "carro com MAF (Avançado)" --> maf
    ignore & avg --> restart["Recomeça a soma<br/>(o tanque está cheio de novo)"]
```

---

## 8. Onde os dados ficam guardados

```mermaid
flowchart LR
    subgraph pc["No seu computador"]
        ls[("Memória do programa<br/>(localStorage do WebView2)")]
        files[("Arquivos que você salva")]
    end
    prefs["Preferências, perfis,<br/>alertas, unidades, tema, idioma"] --> ls
    perfres["Resultados de desempenho<br/>(por perfil)"] --> ls
    fillsum["Trip A/B e soma desde o<br/>tanque cheio (por perfil)"] --> ls
    drv["Histórico de viagens<br/>e prova de desempenho escolhida"] --> ls
    jrn["Viagens da tela Viagem<br/>(uma linha por segundo)"] --> idb[("Banco do programa<br/>(IndexedDB do WebView2)")]
    conn["Última conexão usada"] --> ls
    aviso["Aviso de segurança aceito<br/>(versão do texto)"] --> ls
    rec["Gravação"] --> csv["CSV (Excel)"] & json["JSON (abre de novo<br/>no programa)"]
    rec -- "a cada minuto" --> backup[("Cópia de segurança<br/>gravacao-em-andamento.jsonl<br/>(recuperada se o programa fechar)")]
    chart["Gráfico"] --> png["PNG"]
    jrn --> jcsv["CSV da viagem"] & jhtml["Relatório da viagem<br/>(HTML / PDF)"]
    rec --> report["Relatório de diagnóstico<br/>(só quando você pede)"]
    json --> report
    report --> html["HTML / PDF"]
    csv & json & png & html & jcsv & jhtml --> files
```

### Gravação e relatório

Ao gravar, o programa guarda os parâmetros lidos (os do painel e os escolhidos a mais nos gráficos) e, junto, uma "foto" do diagnóstico: no começo, os dados do carro, os códigos de falha com o quadro congelado, a prontidão e o Modo 06; no fim, os códigos e a prontidão de novo (um código pode aparecer no meio do trajeto). Tudo isso é só leitura. O relatório é gerado depois, apenas se você pedir, a partir da última gravação ou de um arquivo JSON salvo.

```mermaid
flowchart LR
    start(["Iniciar gravação"]) --> snap1["Lê: veículo, códigos,<br/>quadro congelado,<br/>prontidão, Modo 06"]
    start --> frames["Parâmetros do painel e<br/>dos gráficos, várias<br/>vezes por segundo"]
    stop(["Parar gravação"]) --> snap2["Lê de novo:<br/>códigos e prontidão"]
    snap1 & frames & snap2 --> rec[("Gravação<br/>(memória e JSON)")]
    rec -- "botão Relatório" --> sum["report.rs:<br/>mínimo, média, máximo,<br/>indícios do trajeto todo,<br/>gráficos"]
    sum --> html["Relatório<br/>(imprimir / PDF / HTML)"]
    old[("Gravação de versão antiga")] -. "sem códigos<br/>e prontidão" .-> sum
```

Na **versão portátil** (arquivo `portable.txt` ao lado do programa), a memória do programa fica na pasta `OBD2-Scanner-dados`, ao lado do `.exe`, em vez da pasta do usuário no Windows:

```mermaid
flowchart LR
    start(["Abrir o programa"]) --> wv{"WebView2<br/>instalado?"}
    wv -- não --> msg["Aviso com o link<br/>para baixar"]
    wv -- sim --> mk{"portable.txt ao lado<br/>e pasta gravável?"}
    mk -- sim --> here[("OBD2-Scanner-dados<br/>ao lado do programa")]
    mk -- não --> win[("Pasta do usuário<br/>no Windows")]
```

Nada é enviado para a internet.

---

## 9. Verificação automática (CI)

A cada envio para o GitHub, dois computadores do GitHub testam o programa e montam o instalador. Uma etiqueta de versão (tag `v1.0.0`) dispara o fluxo de lançamento, que cria um rascunho na página de download; ele só aparece para todos depois que alguém clica em **Publish release**.

```mermaid
flowchart LR
    push["Commit enviado<br/>(push)"] --> linux & windows
    subgraph linux["Linux"]
        core["cargo test<br/>(motor + simulador)"] --> ts["npm run typecheck<br/>+ npm test"]
    end
    subgraph windows["Windows"]
        wtest["cargo test"] --> build["npm run tauri build"] --> nsis["Instalador .exe e<br/>versão portátil em Artifacts"]
    end
    tag["Tag de versão<br/>(v1.0.0)"] --> rel
    subgraph rel["Release (release.yml, Windows)"]
        rtest["testes"] --> rbuild["instalador .exe, .msi<br/>e portátil .zip"] --> draft["Rascunho em Releases<br/>+ notas pt-BR / en-US"]
    end
    draft --> pub(["Você clica em<br/>Publish release"])
```
