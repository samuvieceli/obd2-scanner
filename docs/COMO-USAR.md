# Como usar o OBD2 Scanner

## 1. Primeiro teste, sem carro

1. Abra o programa. A tela **Conexão** já vem com **Demonstração** selecionada.
2. Clique em **Conectar**.
3. Vá em **Painel ao vivo** e clique em **Iniciar leitura**. Os valores de um carro virtual começam a aparecer.
4. Explore **Gráficos**, **Códigos de falha** (o carro virtual tem falhas de propósito) e **Veículo e prontidão**.

A opção *Simular adaptador clone com defeitos* imita um adaptador barato que responde de forma bagunçada. Serve para testar.

## 2. Com o carro e um adaptador Bluetooth clássico

1. Encaixe o adaptador no conector OBD do carro (normalmente embaixo do painel, perto dos pedais) e **ligue a ignição**.
2. No Windows: **Configurações → Bluetooth e dispositivos → Adicionar dispositivo → Bluetooth**. Escolha o adaptador (nomes comuns: `OBDII`, `OBD2`, `V-LINK`, `Vgate`). PIN: `1234` ou `0000`.
3. No programa, escolha **USB / Bluetooth**, clique em **Atualizar** e escolha a porta COM marcada como **Bluetooth**. Se aparecerem duas, use a primeira; se não funcionar, tente a outra.
4. Deixe a velocidade em **Automático** e clique em **Conectar**.

> Se o adaptador não aparecer na lista de Bluetooth do Windows, ele provavelmente é **Bluetooth LE** (comum em modelos para iPhone). O suporte a BLE chega na próxima versão.

## 3. Adaptador USB

Instale o driver do chip do cabo (geralmente FTDI, CH340 ou CP2102), conecte e escolha a porta COM marcada como **USB**.

## 4. Adaptador Wi-Fi

Conecte o computador à rede Wi-Fi do adaptador (ex.: `WiFi_OBDII`). Use o IP `192.168.0.10` e a porta `35000` (padrão da maioria). Alguns usam `192.168.4.1` porta `35000`.

## 5. Head-up display (HUD)

Na tela **Head-up display (HUD)**, escolha até 4 parâmetros (eles vêm da lista do Painel ao vivo) e clique em **Tela cheia**. Os valores aparecem enormes em fundo preto, fáceis de ler de relance. **Esc** sai da tela cheia. Ative **Espelhado** se for apoiar a tela no painel do carro para refletir no para-brisa à noite (a imagem é invertida para ficar certa no reflexo). Por segurança, deixe a tela posicionada antes de sair dirigindo.

## Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| "O adaptador não respondeu a tempo" | Porta errada ou adaptador sem energia. Confira a porta COM. Em *Opções avançadas*, aumente o tempo de espera do reset ATZ. |
| "Adaptador OK, veículo sem resposta" | Ligue a ignição (ou o motor) e clique em **Tentar de novo**. |
| Leituras lentas | Selecione menos parâmetros no Painel ou diminua o tempo de espera por comando. |
| Um parâmetro some do painel | O carro parou de responder a ele; o programa o retira automaticamente. |
| Dados estranhos | Veja o **Registro de comunicação** na tela Conexão ou use o **Terminal AT** (ex.: `ATI`, `ATRV`, `0100`). |

## Arquivos exportados

- **Planilha CSV (Excel em português)**: separador `;` e vírgula decimal. Abre com dois cliques no Excel brasileiro.
- **CSV padrão**: separador `,` e ponto decimal.
- **JSON**: gravação completa, pode ser reaberta no programa (*Gravações → Abrir gravação*).
- **PNG**: imagem dos gráficos.
- **Relatório**: *Imprimir / salvar como PDF* (escolha "Microsoft Print to PDF") ou HTML.
