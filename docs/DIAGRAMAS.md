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
        logic["Cálculos da interface<br/>consumo, desempenho, alertas,<br/>perfis, unidades, reprodução"]
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
        vin["vin.rs<br/>chassi: fabricante, ano, país"]
        readiness["readiness.rs<br/>monitores de prontidão"]
        mode06["mode06.rs<br/>resultados dos autotestes"]
        interpret["interpret.rs<br/>interpretação em português"]
        session["session.rs<br/>gravação CSV e JSON"]
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
    Reconectando --> Normal: porta reaberta<br/>(espera 1, 2, 3, 5, 8, 10, 10... s)
    Reconectando --> Desconectado: 3 minutos sem sucesso<br/>ou você clicou em "Parar"
    Desconectado --> [*]
```

Com o adaptador parado (sem leitura ao vivo), um `ATRV` silencioso a cada 10 s percebe a queda cedo. No modo demonstração dá para provocar cada falha (Conexão → "Simular falhas de adaptador clone").

---

## 6. Telas e módulos da interface

Cada tela é um arquivo em `src/views/`. Os módulos de cálculo ficam em `src/` e trabalham com os mesmos dados ao vivo, por isso funcionam igual com o carro e com uma gravação reproduzida.

```mermaid
flowchart LR
    subgraph telas["Telas (src/views/)"]
        connection["Conexão<br/>+ teste do adaptador"]
        dashboard["Painel ao vivo"]
        hud["HUD"]
        performance["Testes de desempenho"]
        guided["Testes guiados<br/>bateria, sondas,<br/>mapa de correção"]
        charts["Gráficos"]
        diagnostics["Códigos de falha<br/>+ Modo 06"]
        vehicle["Veículo e prontidão<br/>+ centrais"]
        terminal["Terminal AT"]
        sessions["Gravações e relatórios"]
        glossary["Glossário"]
        settings["Configurações"]
    end
    subgraph modulos["Módulos (src/)"]
        store["store.ts<br/>estado e avisos"]
        api["api.ts<br/>ponte com o Rust"]
        trip["trip.ts<br/>consumo"]
        cost["cost.ts + fuels.ts<br/>custo em R$ e<br/>gasolina × etanol"]
        perf["perf.ts<br/>detecção 0-100 etc."]
        battery["battery.ts<br/>etapas e limites do<br/>teste de bateria"]
        o2test["o2test.ts<br/>sondas e catalisador"]
        trims["trims.ts<br/>mapa de correção<br/>de combustível"]
        alerts["alerts.ts<br/>alertas e bipe"]
        playback["playback.ts<br/>reprodução"]
        prefs["prefs.ts<br/>preferências e perfis"]
        units["units.ts<br/>unidades"]
        gauge["gauge.ts<br/>mostradores"]
        theme["theme.ts<br/>temas e botão dia/noite"]
        presets["presets.ts<br/>painéis prontos e Completo"]
        share["share.ts<br/>cartão 'Copiar imagem'"]
        warmup["warmup.ts<br/>motor frio / pronto"]
        summary["summary.ts + drive-summary.ts<br/>resumo ao desligar o motor"]
        drives["drives.ts + views/drive-history.ts<br/>histórico de viagens,<br/>gasolina × etanol"]
        search["search.ts + views/search.ts<br/>busca Ctrl+F / Ctrl+K"]
        mini["views/mini.ts<br/>mini janela por cima das outras"]
        i18n["i18n.ts + locales/<br/>textos pt-BR e en-US"]
    end
    dashboard --> gauge & trip & alerts & presets & warmup
    hud --> warmup & mini
    diagnostics & charts --> share
    dashboard --> summary
    summary --> trip & cost & share
    summary --> drives
    sessions --> drives
    search --> glossary & diagnostics
    performance --> perf
    guided --> battery & o2test & trims
    sessions --> playback
    settings --> prefs & units & theme
    connection --> prefs
    dashboard & hud & charts & performance --> units
    telas --> store
    telas --> api
    telas --> i18n
    trip & alerts --> prefs
    dashboard --> cost
    cost --> prefs
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
    conn["Última conexão usada"] --> ls
    rec["Gravação"] --> csv["CSV (Excel)"] & json["JSON (abre de novo<br/>no programa)"]
    rec -- "a cada minuto" --> backup[("Cópia de segurança<br/>gravacao-em-andamento.jsonl<br/>(recuperada se o programa fechar)")]
    chart["Gráfico"] --> png["PNG"]
    report["Relatório de diagnóstico"] --> html["HTML / PDF"]
    csv & json & png & html --> files
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
