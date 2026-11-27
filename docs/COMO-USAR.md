# Como usar o OBD2 Scanner

## 1. Primeiro teste, sem carro

1. Abra o programa. A tela **Conexão** já vem com **Demonstração** selecionada.
2. Clique em **Conectar**.
3. Vá em **Painel ao vivo** e clique em **Iniciar leitura**. Os valores de um carro virtual começam a aparecer.
4. Explore **Gráficos**, **Códigos de falha** (o carro virtual tem falhas de propósito) e **Veículo e prontidão**.

O quadro **Primeiros passos**, no alto da tela Conexão, resume esse caminho com botões que levam a cada tela. Clique em **Entendi, esconder** quando não precisar mais; o link **Mostrar os primeiros passos** traz o quadro de volta.

A opção *Simular adaptador clone com defeitos* imita um adaptador barato que responde de forma bagunçada. Serve para testar.

## 2. Com o carro e um adaptador Bluetooth clássico

1. Encaixe o adaptador no conector OBD do carro (normalmente embaixo do painel, perto dos pedais) e **ligue a ignição**.
2. No Windows: **Configurações → Bluetooth e dispositivos → Adicionar dispositivo → Bluetooth**. Escolha o adaptador (nomes comuns: `OBDII`, `OBD2`, `V-LINK`, `Vgate`). PIN: `1234` ou `0000`.
3. No programa, escolha **USB / Bluetooth**, clique em **Atualizar** e escolha a porta COM marcada como **Bluetooth**, que já vem primeiro na lista, com o nome do adaptador ao lado. O Windows cria duas portas para cada adaptador pareado: a outra aparece no fim como **Bluetooth de entrada, não use**, porque nunca responde.
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
- **Painéis prontos**: um clique escolhe os parâmetros para cada situação. **Uso diário** (velocidade, rotação, temperatura, bateria, combustível), **Viagem** (combustível, carga do motor e o que o computador de bordo precisa), **Injeção** (correções de combustível, sondas lambda, avanço, MAP ou MAF) e **Turbo / desempenho** (pressão do turbo ou do coletor, temperatura do ar, avanço, borboleta). Parâmetros que o carro não informa ficam de fora sozinhos; **Escolher parâmetros** continua valendo para montar o seu.
- Ao lado do título aparece o selo **Motor frio** (líquido abaixo de 60 °C), **Aquecendo** (60 a 80 °C, ou óleo abaixo de 70 °C quando o carro informa) ou **Motor pronto**. Com o motor frio, evite acelerar forte. O mesmo selo aparece no canto do HUD.
- O quadro **Computador de bordo** mostra o consumo agora e a média da viagem em km/L. Ele usa a vazão de combustível, o sensor MAF ou, em carros só com sensor MAP (comum no Brasil), uma estimativa pela cilindrada. Para melhorar a precisão, informe o combustível e a cilindrada do perfil do carro em **Configurações → Veículos (perfis)**.
- Combustíveis disponíveis, com as misturas em vigor em novembro de 2026: **gasolina comum ou aditivada** (32% de etanol), **gasolina premium** (25% de etanol), **etanol comum ou aditivado**, **diesel S10 ou S500** (15% de biodiesel) e **flex automático**. O flex automático usa a porcentagem de etanol informada pelo carro e, se o carro não informar, considera gasolina comum. Aditivos não mudam o cálculo.
- **Resumo da viagem**: quando o motor desliga (ou a conexão termina) depois de pelo menos 2 minutos de motor ligado, abre um quadro com o tempo em movimento e parado com motor ligado, distância, velocidade média e máxima, rotação máxima, temperatura máxima do motor, menor tensão da bateria com o motor ligado, combustível, consumo, custo e os valores que saíram da faixa de alerta. **Copiar imagem** manda o resumo pelo WhatsApp. O último resumo pode ser aberto de novo pelo botão **Ver resumo da última viagem** no computador de bordo (até fechar o programa).
- **Custo da viagem**: em **Configurações → Preço dos combustíveis**, informe o preço do litro. O computador de bordo passa a mostrar o custo da viagem e, em carros a gasolina, etanol ou flex, quanto a mesma viagem custaria com gasolina e com etanol. A comparação mantém a mesma energia: um litro de etanol tem cerca de 70% da energia de um litro de gasolina comum (E32), daí a regra "etanol compensa até 70% do preço da gasolina". Motores rendem um pouco melhor com etanol, então é uma estimativa. No flex automático, o preço do tanque é a mistura dos dois conforme a porcentagem de etanol que o carro informa.
- **Alertas** (em **Configurações**): avisam com mensagem e som quando, por exemplo, a temperatura passa de 110 °C ou a bateria fica abaixo de 11,8 V com o motor ligado. Você pode mudar os limites e incluir outros parâmetros.

## 6b. Testes de desempenho

Abra **Testes de desempenho** e dirija: não há botão de iniciar. O programa reconhece sozinho cada teste e guarda o resultado (tempo, distância e aceleração média):

| Teste | Como fazer | Quando começa e termina |
| --- | --- | --- |
| 0–100 km/h | Pare o carro meio segundo e acelere. | Começa no instante em que o carro sai do lugar (não conta o tempo de reação); termina ao cruzar 100 km/h. |
| 100–0 km/h | Passe de 100 km/h e freie até parar. | Começa ao cruzar 100 km/h freando; termina quando o carro para. Mostra a distância de frenagem. |
| 40–80 e 80–120 km/h | Fique abaixo da velocidade inicial e acelere forte. | Começa ao cruzar a velocidade inicial acelerando (passar devagar por 40 km/h não conta); termina ao cruzar a final. |

O teste é descartado se você aliviar o pé (a velocidade cai), se a velocidade parar de subir por 3 segundos ou se a leitura falhar. Os tempos são calculados entre duas leituras (interpolação), por isso a precisão fica perto de 0,1 s com 8 ou mais leituras por segundo. O **modo preciso** lê só a velocidade enquanto a tela está aberta, para ter mais leituras. **Faça testes só em local fechado e seguro, nunca em via pública.** Também funciona com uma gravação reproduzida.

## 6c. Testes guiados

A tela **Testes guiados** faz verificações passo a passo e mostra o resultado como uma indicação (Bom, Atenção, Problema provável). O programa avança sozinho conforme percebe o que você fez; os botões **Pular etapa** e **Recomeçar** ficam embaixo.

**Bateria e alternador** (precisa do carro conectado, não funciona com gravação):

| Etapa | O que fazer | Como o programa avalia |
| --- | --- | --- |
| 1. Bateria em repouso | Chave ligada, motor desligado. | Mediana de 3 s de tensão estável. 12,4 V ou mais: boa; 12,0 a 12,4 V: carga baixa; menos de 12,0 V: descarregada. Acima de 12,9 V avisa que é "carga de superfície" da última viagem. |
| 2. Partida | Dê a partida. | Menor tensão enquanto o motor de arranque gira. 10,0 V ou mais: boa; 9,6 a 10,0 V: desgaste; menos de 9,6 V: perdendo força. |
| 3. Alternador | Marcha lenta; depois faróis ligados e perto de 2.000 rpm. | 13,2 a 14,8 V: normal; 12,8 a 13,2 V: atenção (muitos carros novos ficam aí de propósito, por terem carga inteligente); abaixo de 12,8 V: não carrega; acima de 15,2 V: regulador com defeito. |

A tensão vem do próprio adaptador (comando `ATRV`, medida no pino 16, ligado direto na bateria). Durante o teste o programa lê só a tensão (e a rotação na etapa 3), para ter o máximo de leituras por segundo. Muitos adaptadores simples reiniciam na partida porque a tensão cai também para eles: nesse caso a etapa 2 fica sem valor e o programa explica o motivo. Adaptadores diferem em 0,1 a 0,3 V, então use o resultado como indicação; para um laudo, faça um teste de carga num eletricista. No modo de demonstração, botões na própria tela desligam e dão partida no motor virtual.

**Sondas e catalisador** (funciona também com uma gravação reproduzida):

1. Rode uns 10 minutos para o catalisador esquentar e pare o carro em lugar aberto.
2. Com o motor acima de 80 °C, acelere e segure entre 2.000 e 3.000 rpm por 20 segundos. Em marcha lenta até uma sonda boa oscila devagar, por isso o teste é feito mais alto.
3. O gráfico mostra as duas sondas sobrepostas e o resultado aparece sozinho.

| O que o programa vê | Indicação |
| --- | --- |
| Sonda da frente oscila entre pobre e rico; a de trás fica estável | Catalisador funcionando |
| A sonda de trás oscila quase tanto quanto a da frente (copia a da frente) | Catalisador com baixa eficiência (o caso do código P0420) |
| Sonda da frente quase parada (pobre, rica ou no meio) | Problema de mistura ou sonda; aí o catalisador não pode ser avaliado |
| Sonda de trás baixa e parada | Vazamento no escapamento ou sonda com defeito, não necessariamente o catalisador |

O programa conta quantas vezes cada sonda cruza o meio da escala (com uma margem, para o ruído não contar) e compara o tamanho da oscilação das duas, em vez de exigir uma faixa fixa de tensão. Carros com sonda de banda larga na frente (lê o fator lambda, perto de 1,00) têm só a sonda de trás avaliada. Embaixo, a tela mostra o **monitor do catalisador** e os **km desde que os códigos foram apagados**: são o melhor sinal de que alguém apagou um defeito antes de vender o carro. Os testes da própria central (Modo 06) são mais confiáveis que o gráfico, porque a sonda responde em milissegundos, mais rápido do que o adaptador consegue ler.

**Mapa de correção de combustível** (funciona também com uma gravação reproduzida):

O mapa mostra a correção total que a central aplica na mistura (curto prazo + longo prazo) em 9 faixas: 3 de rotação (abaixo de 1.300, 1.300 a 2.500 e acima de 2.500 rpm) por 3 de carga (abaixo de 30%, 30 a 60% e acima de 60%). Ele se preenche sozinho enquanto você dirige, mesmo fora desta tela, porque o painel ao vivo já lê esses valores. Cada faixa mostra a média a partir de 10 leituras: verde até ±10%, amarelo de 10 a 20%, vermelho acima de 20%.

Só contam as leituras em **malha fechada** (PID 03, quando a central corrige a mistura usando a sonda). Com o motor frio, o acelerador no fundo ou em desaceleração a correção fica parada e estragaria as médias. Se o carro não informa a malha, o programa usa só leituras com o motor acima de 70 °C.

| Padrão | Indicação |
| --- | --- |
| Pobre (positivo) só em marcha lenta, normal com carga | Entrada falsa de ar (mangueira de vácuo, junta do coletor, respiro do óleo). Em motores com sensor MAP, comuns nos flex, o sinal é mais fraco. |
| Pobre só com carga alta | Falta de combustível quando o motor pede mais (bomba fraca, filtro entupido, bicos sujos). |
| Pobre em tudo | Flex ainda aprendendo a mistura depois de abastecer, combustível ruim, sensor de ar sujo, pressão baixa, vazamento no escapamento antes da sonda. |
| Rica (negativo) só em marcha lenta | Válvula do cânister presa aberta, bico pingando. |
| Rica em tudo | Bico vazando, pressão de combustível alta, sonda com leitura errada, combustível no óleo. |

## 7. Testes da central (Modo 06)

Em **Códigos de falha → Testes da central**, clique em **Ler testes**. Cada linha é um autoteste da central com o valor medido e os limites aceitos. Um teste **reprovado** costuma indicar o componente com problema antes mesmo de aparecer um código de falha. Disponível em carros com rede CAN (a maioria a partir de 2008–2010).

## 8. Reproduzir uma gravação

Salve a gravação em **JSON** e depois use **Gravações → Reproduzir gravação**. O painel, o HUD, os gráficos e a interpretação mostram a gravação como se fosse ao vivo, com pausa, velocidade (até 8×) e barra de posição no topo. **Fechar gravação** volta ao normal.

## 9. Temas

Em **Configurações** há 8 temas. O **Noturno** (vermelho no preto) não ofusca dirigindo à noite; o **Alto contraste** ajuda sob sol forte ou com baixa visão. Os botões **☀ Dia** e **☾ Noite** no canto de cima de todas as telas trocam para esses dois temas com um clique; clicar de novo no botão ativo volta ao tema escolhido nas Configurações.

## 10. Vários carros (perfis)

Em **Configurações → Veículos (perfis)**, clique em **Novo veículo** para cada carro e informe nome, combustível e cilindrada. Cada perfil tem os seus próprios alertas e resultados de desempenho. Na primeira conexão, o programa lê o chassi (VIN) do carro e guarda no perfil ativo. Depois disso, ao conectar em qualquer um dos carros, ele **troca de perfil sozinho**. O perfil ativo também pode ser trocado na caixa no canto inferior esquerdo da janela.

## 11. Unidades

Em **Configurações → Unidades**, escolha um padrão (**Brasil**, **Europa**, **EUA**, **Reino Unido**) ou cada unidade separadamente: velocidade (km/h ou mph), temperatura (°C ou °F), pressão (kPa, bar ou psi), distância (km ou milhas), volume (litros ou galões), consumo (km/L, L/100 km, mpg) e torque. A troca vale para o painel, mostradores, HUD, gráficos, alertas, computador de bordo e relatório. As gravações e os arquivos exportados continuam no sistema métrico, que é o padrão do OBD2.

## 12. Reconexão automática

Com a opção **Reconectar automaticamente se a conexão cair** ligada (na tela Conexão e em Configurações; vem ligada), o programa volta sozinho quando o Bluetooth sai de alcance, o cabo solta ou o adaptador trava. Uma faixa amarela no topo mostra a tentativa e o tempo até a próxima. Ele tenta por até 3 minutos, com esperas de 1, 2, 3, 5, 8 e depois 10 segundos, e mantém a lista de parâmetros e a gravação em andamento. **Parar e desconectar** cancela.

## 13. Teste do adaptador e centrais do carro

- **Teste de compatibilidade do adaptador** (tela **Conexão**, com o adaptador conectado): descobre até qual versão do ELM327 o adaptador funciona de verdade. Clones costumam dizer "v2.1" e funcionar como v1.3. Só usa comandos que leem algo ou que o reinício desfaz; nada é gravado no adaptador.
- **Centrais eletrônicas** (tela **Veículo e prontidão**): lista as centrais que respondem pelo OBD (motor, câmbio, sistema híbrido) e lê a identificação de cada uma (nome, número da peça, fornecedor, versão do software), quando o carro informa. Só leitura. ABS, airbag e carroceria usam endereços próprios de cada fabricante e não aparecem.

## 13b. Tela acesa durante a leitura

Enquanto a leitura ao vivo estiver ligada, uma gravação estiver em andamento ou a tela **HUD** estiver aberta, o programa pede ao Windows para não apagar a tela nem suspender o computador. Ao parar, o Windows volta ao normal. Assim a conexão não cai no meio de uma viagem.

## 14. Só leitura (segurança)

O programa nunca grava nada nas centrais do carro. No **Terminal AT**, comandos que gravariam no carro ou na memória do adaptador são recusados com uma explicação. **Apagar códigos** só funciona com o motor desligado e a ignição ligada: o programa pergunta ao carro o giro e a velocidade antes de apagar e recusa se o carro não responder (chave só em acessórios). Depois de apagar, ele lê os códigos de novo e avisa se algum voltou, sinal de que o defeito continua. Códigos *permanentes* só somem sozinhos, depois de alguns ciclos de uso sem o defeito. No modo demonstração, use **Desligar motor** em *Simular falhas* (tela Conexão).

## Adaptadores clones

A maioria dos adaptadores baratos é clone do ELM327 (costumam se apresentar como "v1.5" ou "v2.1", versões que o fabricante original nunca lançou). O programa já trata os defeitos mais comuns: não exige `OK`, aceita eco ligado, aguarda resets lentos, repete uma vez pedidos perdidos ou interrompidos (`STOPPED`, `BUFFER FULL`) e segue sem os comandos que o clone recusa. Na tela **Conexão** aparece "provável clone" e a lista de comandos recusados.

### Quando o clone trava

Clones costumam travar de três jeitos, e o programa percebe e resolve cada um sozinho:

| O que acontece | Como o programa percebe | O que ele faz |
| --- | --- | --- |
| Para de responder ao carro, mas ainda responde a comandos AT. | 3 pedidos seguidos sem resposta (cada um já repetido uma vez), ou só `STOPPED` / `BUFFER FULL` / lixo. | Confere se o adaptador está vivo (`ATI`), reinicia (`ATZ`), configura de novo e volta no mesmo protocolo de antes (sem a busca lenta). Leva poucos segundos. |
| Reinicia sozinho numa queda de tensão (comum na partida do motor) e perde as configurações. | A resposta traz o texto de início (`ELM327 v1.5`) ou `LV RESET`. | Configura de novo na hora. |
| Congela por completo ou a conexão cai. | Nem o `ATI` responde, ou a porta dá erro. Parado, um teste silencioso a cada 10 s percebe a queda. | Fecha e reabre a conexão (reconexão automática). |

Se o adaptador responde mas o carro não (ignição desligada), o programa avisa e tenta de novo a cada 5 segundos, sem ficar reiniciando o adaptador.

**Se nada disso resolver:** tire o adaptador da tomada OBD por 10 segundos e coloque de novo (isso desliga e religa o adaptador, que é o único jeito de destravar alguns clones). Se travar com frequência: em **Opções avançadas**, desligue a **leitura rápida** e aumente o tempo de espera por comando; leia menos parâmetros ao mesmo tempo; e, se possível, troque por um adaptador com chip original (ou um clone de boa qualidade, como OBDLink, Vgate iCar Pro ou Veepeak).

No **modo demonstração**, a tela Conexão tem **Simular falhas de adaptador clone**: botões que fazem o adaptador virtual travar, reiniciar, congelar ou perder o Bluetooth, para você ver a recuperação funcionando.

## Versão portátil (sem instalar)

O arquivo `OBD2-Scanner-...-Windows-portatil.zip` traz o programa pronto para usar, sem instalação:

1. Descompacte o `.zip` numa pasta qualquer, até num pendrive.
2. Abra `OBD2-Scanner.exe`. O Windows pode mostrar o mesmo aviso de "editor desconhecido": **Mais informações → Executar assim mesmo**.

Enquanto o arquivo `portable.txt` estiver ao lado do programa, as configurações, perfis e resultados ficam na pasta `OBD2-Scanner-dados`, ali mesmo; em **Configurações → Sobre** aparece o caminho. Apague o `portable.txt` para usar a pasta normal do Windows. As gravações e relatórios continuam sendo salvos onde você escolher.

Diferenças em relação ao instalador: não aparece no menu Iniciar (crie um atalho se quiser) e não há desinstalação, basta apagar a pasta. O programa precisa do **Microsoft Edge WebView2**, que já vem no Windows 10 e 11; o instalador o coloca sozinho quando falta, a versão portátil apenas avisa e mostra o link para baixar. Se a pasta não permitir gravação (por exemplo, dentro de "Arquivos de Programas"), o programa usa a pasta normal do Windows.

## Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| "O adaptador não respondeu a tempo" | Porta errada ou adaptador sem energia. Confira a porta COM. Em *Opções avançadas*, aumente o tempo de espera do reset ATZ. |
| "Adaptador OK, veículo sem resposta" | Ligue a ignição (ou o motor) e clique em **Tentar de novo**. Em carro mais antigo (em geral antes de 2008, protocolos ISO 9141/KWP), muitos clones baratos não têm o circuito da "linha K": troque por um adaptador de boa qualidade. |
| Leituras lentas | Selecione menos parâmetros no Painel ou diminua o tempo de espera por comando. |
| Faixa amarela "Reiniciando o adaptador" ou "Tentando reconectar" | Normal com clones: o programa está se recuperando sozinho. Se durar mais de um minuto, tire o adaptador da tomada por 10 segundos. Veja *Quando o clone trava*. |
| Valores pulando ou travando com adaptador clone | Em *Opções avançadas*, desligue a **leitura rápida** e aumente o tempo de espera por comando. |
| Consumo calculado muito diferente do real | Confira o combustível e a cilindrada em **Configurações → Veículos (perfis)** e ajuste a eficiência volumétrica. |
| Um parâmetro some do painel | O carro parou de responder a ele; o programa o retira automaticamente. |
| Aviso "precisa do Microsoft Edge WebView2" | Instale o *WebView2 Runtime* pelo link do aviso, ou use o instalador em vez da versão portátil. |
| Dados estranhos | Veja o **Registro de comunicação** na tela Conexão ou use o **Terminal AT** (ex.: `ATI`, `ATRV`, `0100`). |

## Arquivos exportados

Enquanto grava, o programa também guarda uma **cópia de segurança** no disco, atualizada pelo menos a cada minuto, no arquivo `gravacao-em-andamento.jsonl` da pasta de dados (na versão portátil, em `OBD2-Scanner-dados`). Se o programa ou o computador desligar no meio da gravação, na próxima abertura ela volta como "última gravação", pronta para exportar em **Gravações e relatórios**. A próxima gravação substitui essa cópia.

**Marcar evento:** enquanto grava, aperte o botão vermelho **Marcar evento** (no Painel e no HUD) ou a tecla **Espaço** no momento em que notar um tranco, falha ou barulho. Nos **Gráficos** de uma gravação aberta, cada marca aparece como uma linha vermelha tracejada (★1, ★2...) e um botão que aproxima os gráficos daquele momento. Na reprodução, **Próximo marcador** pula para 5 segundos antes do evento. No CSV, a coluna `mark` vale 1 na primeira leitura depois de cada marca.

- **Copiar imagem** (telas **Códigos de falha** e **Gráficos**): monta um cartão claro com o carro, a data, os códigos (e o quadro congelado, se lido) ou os gráficos com mínimo e máximo, e copia para a área de transferência. Cole com **Ctrl+V** no WhatsApp, Telegram ou e-mail para mandar a um mecânico. Se o Windows não aceitar a cópia, a imagem é salva como PNG.
- **Planilha CSV (Excel em português)**: separador `;` e vírgula decimal. Abre com dois cliques no Excel brasileiro.
- **CSV padrão**: separador `,` e ponto decimal.
- **JSON**: gravação completa, pode ser reaberta e reproduzida no programa (*Gravações → Abrir gravação*).
- **PNG**: imagem dos gráficos.
- **Relatório**: *Imprimir / salvar como PDF* (escolha "Microsoft Print to PDF") ou HTML.
