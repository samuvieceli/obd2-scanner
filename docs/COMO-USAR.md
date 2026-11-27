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

> Se o adaptador não aparecer na lista de Bluetooth do Windows, ele provavelmente é **Bluetooth LE**: veja a seção seguinte.

## 2b. Adaptador Bluetooth LE (modelos para iPhone)

Não precisa parear no Windows. Escolha **Bluetooth LE**, espere a busca (5 segundos), escolha o adaptador na lista (nomes comuns: `IOS-Vlink`, `OBDII`, `Vgate iCar Pro`, `Veepeak`) e clique em **Conectar**. Se ele não aparecer, ligue a ignição, aproxime o computador e feche apps do celular que possam estar conectados a ele.

## 3. Adaptador USB

Instale o driver do chip do cabo (geralmente FTDI, CH340 ou CP2102), conecte e escolha a porta COM marcada como **USB**.

## 4. Adaptador Wi-Fi

Conecte o computador à rede Wi-Fi do adaptador (ex.: `WiFi_OBDII`). Use o IP `192.168.0.10` e a porta `35000` (padrão da maioria). Alguns usam `192.168.4.1` porta `35000`.

## 5. Head-up display (HUD)

Na tela **Head-up display (HUD)**, escolha até 4 parâmetros (eles vêm da lista do Painel ao vivo) e clique em **Tela cheia**. Os valores aparecem enormes em fundo preto, fáceis de ler de relance. **Esc** sai da tela cheia. Ative **Espelhado** se for apoiar a tela no painel do carro para refletir no para-brisa à noite (a imagem é invertida para ficar certa no reflexo). Por segurança, deixe a tela posicionada antes de sair dirigindo.

## 6. Computador de bordo, alertas e mostradores

- No **Painel ao vivo**, o botão **Cartões / Mostradores** troca entre números grandes e mostradores com ponteiro.
- O quadro **Computador de bordo** mostra o consumo agora e a média da viagem em km/L. Ele usa a vazão de combustível, o sensor MAF ou, em carros só com sensor MAP (comum no Brasil), uma estimativa pela cilindrada. Para melhorar a precisão, informe o combustível e a cilindrada em **Configurações → Veículo**.
- **Cronometrar 0–100 km/h**: pare o carro, clique no botão e acelere. Só faça isso em local seguro e permitido.
- **Alertas** (em **Configurações**): avisam com mensagem e som quando, por exemplo, a temperatura passa de 110 °C ou a bateria fica abaixo de 11,8 V com o motor ligado. Você pode mudar os limites e incluir outros parâmetros.

## 7. Testes da central (Modo 06)

Em **Códigos de falha → Testes da central**, clique em **Ler testes**. Cada linha é um autoteste da central com o valor medido e os limites aceitos. Um teste **reprovado** costuma indicar o componente com problema antes mesmo de aparecer um código de falha. Disponível em carros com rede CAN (a maioria a partir de 2008–2010).

## 8. Reproduzir uma gravação

Salve a gravação em **JSON** e depois use **Gravações → Reproduzir gravação**. O painel, o HUD, os gráficos e a interpretação mostram a gravação como se fosse ao vivo, com pausa, velocidade (até 8×) e barra de posição no topo. **Fechar gravação** volta ao normal.

## 9. Temas

Em **Configurações** há 8 temas. O **Noturno** (vermelho no preto) não ofusca dirigindo à noite; o **Alto contraste** ajuda sob sol forte ou com baixa visão.

## Adaptadores clones

A maioria dos adaptadores baratos é clone do ELM327 (costumam se apresentar como "v1.5" ou "v2.1", versões que o fabricante original nunca lançou). O programa já trata os defeitos mais comuns: não exige `OK`, aceita eco ligado, aguarda resets lentos, repete uma vez pedidos perdidos ou interrompidos (`STOPPED`, `BUFFER FULL`) e segue sem os comandos que o clone recusa. Na tela **Conexão** aparece "provável clone" e a lista de comandos recusados. Se um clone travar com frequência, aumente os tempos em **Opções avançadas** ou desligue a **leitura rápida**.

## Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| "O adaptador não respondeu a tempo" | Porta errada ou adaptador sem energia. Confira a porta COM. Em *Opções avançadas*, aumente o tempo de espera do reset ATZ. |
| "Adaptador OK, veículo sem resposta" | Ligue a ignição (ou o motor) e clique em **Tentar de novo**. |
| Leituras lentas | Selecione menos parâmetros no Painel ou diminua o tempo de espera por comando. |
| Valores pulando ou travando com adaptador clone | Em *Opções avançadas*, desligue a **leitura rápida** e aumente o tempo de espera por comando. |
| Consumo calculado muito diferente do real | Confira o combustível e a cilindrada em **Configurações → Veículo** e ajuste a eficiência volumétrica. |
| Um parâmetro some do painel | O carro parou de responder a ele; o programa o retira automaticamente. |
| Dados estranhos | Veja o **Registro de comunicação** na tela Conexão ou use o **Terminal AT** (ex.: `ATI`, `ATRV`, `0100`). |

## Arquivos exportados

- **Planilha CSV (Excel em português)**: separador `;` e vírgula decimal. Abre com dois cliques no Excel brasileiro.
- **CSV padrão**: separador `,` e ponto decimal.
- **JSON**: gravação completa, pode ser reaberta e reproduzida no programa (*Gravações → Abrir gravação*).
- **PNG**: imagem dos gráficos.
- **Relatório**: *Imprimir / salvar como PDF* (escolha "Microsoft Print to PDF") ou HTML.
