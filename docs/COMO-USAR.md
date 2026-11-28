# Como usar o OBD2 Scanner

## Antes de tudo: aviso de segurança

Na primeira vez que o programa abre, aparece a janela **Antes de usar: segurança**, com seis pontos: não usar dirigindo (um passageiro opera), testes de desempenho só em local fechado e seguro, diagnóstico é indício e não substitui um mecânico, o programa só lê (a única ação é apagar códigos de falha quando você pede), prender o adaptador e os cabos longe dos pedais, e uso por sua conta e risco (GPL-3.0, sem garantia). Dá para trocar o idioma ali mesmo. Clique em **Li e concordo** para continuar; **Não concordo** fecha o programa. A janela só volta se o texto do aviso mudar em algo importante. Para reler: **Configurações → Sobre → Aviso de segurança**.

## 1. Primeiro teste, sem carro

1. Abra o programa. A tela **Conexão** já vem com **Demonstração** selecionada.
2. Clique em **Conectar**.
3. Vá em **Painel ao vivo**. A leitura começa sozinha e os valores de um carro virtual aparecem.
4. Explore **Gráficos**, **Códigos de falha** (o carro virtual tem falhas de propósito) e **Veículo e prontidão**.

O quadro **Primeiros passos**, no alto da tela Conexão, resume esse caminho com botões que levam a cada tela. Clique em **Entendi, esconder** quando não precisar mais; o link **Mostrar os primeiros passos** traz o quadro de volta.

**Busca:** aperte **Ctrl+F** (ou **Ctrl+K**, ou o botão **Buscar** no alto) em qualquer tela e digite parte de um nome: uma tela ("gráficos"), um parâmetro ("temperatura", "sonda"), um termo do glossário ("malha fechada") ou um código de falha ("P0301"). Acentos não importam. Use ↑ ↓ e **Enter** para abrir; **Esc** fecha. Parâmetros e termos abrem no Glossário; códigos abrem a consulta na tela Códigos de falha, mesmo sem carro conectado; seções dos manuais abrem na tela Documentação.

A opção *Simular adaptador clone com defeitos* imita um adaptador barato que responde de forma bagunçada. Serve para testar.

### Quando a leitura começa e como pausar

Conectar só abre a conversa com o adaptador; o programa ainda não fica pedindo valores ao carro. A **leitura ao vivo** (pedir os valores várias vezes por segundo) começa quando você abre o **Painel ao vivo** ou o **HUD**. Nessas duas telas fica o botão **Pausar leitura**; depois de pausar, ele vira **Retomar leitura**. Enquanto estiver pausada, abrir o Painel ou o HUD de novo não volta a ler sozinho: só o botão Retomar (ou uma nova conexão).

Depois de começar, a leitura continua ao trocar de tela, para que os **Gráficos**, o **Computador de bordo** (Trip A e Trip B), os alertas e a gravação continuem recebendo dados. Algumas funções ligam a leitura sozinhas porque não funcionam sem ela: **Gravar**, a **Mini janela**, os **Testes guiados** e os **Testes de desempenho** (estes dois devolvem a leitura como estava ao sair da tela). O Computador de bordo só conta enquanto há leitura: com a leitura pausada, as viagens também ficam paradas.

## 2. Com o carro e um adaptador Bluetooth clássico

1. Encaixe o adaptador no conector OBD do carro (normalmente embaixo do painel, perto dos pedais) e **ligue a ignição**.
2. No Windows: **Configurações → Bluetooth e dispositivos → Adicionar dispositivo → Bluetooth**. Escolha o adaptador (nomes comuns: `OBDII`, `OBD2`, `V-LINK`, `Vgate`). PIN: `1234` ou `0000`.
3. No programa, escolha **USB / Bluetooth**, clique em **Atualizar** e escolha a porta COM marcada como **Bluetooth**, que já vem primeiro na lista, com o nome do adaptador ao lado. O Windows cria duas portas para cada adaptador pareado: a outra aparece no fim como **Bluetooth de entrada, não use**, porque nunca responde.
4. Deixe a velocidade em **Automático** e clique em **Conectar**.

> Se o adaptador não aparecer na lista de Bluetooth do Windows, ele provavelmente é **Bluetooth LE**: veja a seção seguinte.

## 2b. Adaptador Bluetooth LE (modelos para iPhone)

Não precisa parear no Windows. Escolha **Bluetooth LE**: a busca começa sozinha e dura uns 5 segundos (**Procurar de novo** repete). Escolha o adaptador na lista (nomes comuns: `IOS-Vlink`, `OBDII`, `Vgate iCar Pro`, `Veepeak`) e clique em **Conectar**. Se ele não aparecer, ligue a ignição, aproxime o computador e feche apps do celular que possam estar conectados a ele.

**Para conferir um adaptador BLE novo** (vale a pena fazer uma vez):

1. Ligue a ignição e o adaptador; abra o programa e escolha **Bluetooth LE**.
2. Espere a busca (ou clique em **Procurar de novo**): o adaptador deve aparecer no topo da lista.
3. Conecte: deve mostrar a versão do ELM327 e o protocolo do carro.
4. Deixe o painel ao vivo aberto por 1 a 2 minutos: os valores devem atualizar sem travar.
5. Desligue e religue o adaptador (ou afaste-se): o programa deve avisar e reconectar.
6. Leia os códigos de falha (DTC) e desconecte. Se aparecer um código próprio da montadora que o programa não conhece (comum em Fiat, Chevrolet, Renault, Peugeot/Citroën e Jeep), um aviso explica onde buscar o significado: pesquisa com marca e modelo, manual de serviço, concessionária ou oficina da marca.

## 3. Adaptador USB

Instale o driver do chip do cabo (geralmente FTDI, CH340 ou CP2102), conecte e escolha a porta COM marcada como **USB**.

## 4. Adaptador Wi-Fi

Conecte o computador à rede Wi-Fi do adaptador (ex.: `WiFi_OBDII`). Use o IP `192.168.0.10` e a porta `35000` (padrão da maioria). Alguns usam `192.168.4.1` porta `35000`.

## 5. Head-up display (HUD)

Na tela **Head-up display (HUD)**, escolha até 4 parâmetros (eles vêm da lista do Painel ao vivo) e clique em **Tela cheia**. Os valores aparecem enormes em fundo preto, fáceis de ler de relance. **Esc** sai da tela cheia. Ative **Espelhado** se for apoiar a tela no painel do carro para refletir no para-brisa à noite (a imagem é invertida para ficar certa no reflexo). Por segurança, deixe a tela posicionada antes de sair dirigindo.

**Mini janela:** o botão **Mini janela** no HUD encolhe o programa para uma janelinha que fica **por cima das outras** (mapa, música, chamada), com os mesmos 3 ou 4 valores escolhidos no HUD. Se a leitura estiver parada, ela começa sozinha. Mova a janela pela barra do alto; **Voltar** (ou **Esc**) devolve o tamanho e o lugar de antes.

## 6. Computador de bordo, alertas e mostradores

- No **Painel ao vivo**, o botão **Cartões / Mostradores** troca entre números grandes e mostradores com ponteiro.
- **Painéis prontos**: um clique escolhe os parâmetros para cada situação. **Completo** mostra tudo o que o carro informa; clicar de novo num painel já escolhido também volta para o Completo. **Uso diário** (velocidade, rotação, temperatura, bateria, combustível), **Viagem** (combustível, carga do motor e o que o computador de bordo precisa), **Injeção** (correções de combustível, sondas lambda, avanço, MAP ou MAF) e **Turbo / desempenho** (pressão do turbo ou do coletor, temperatura do ar, avanço, borboleta). Parâmetros que o carro não informa ficam de fora sozinhos; **Escolher parâmetros** continua valendo para montar o seu. Nele há uma busca (acentos e maiúsculas não importam), e os parâmetros que o carro não informa ficam escondidos até marcar **Mostrar também os que o carro não informa**.
- **Parâmetros do fabricante (piloto)**: no fim de **Escolher parâmetros**, escolha o modelo do carro (o chassi sugere a marca). Aparecem leituras extras da montadora, como temperatura do óleo e do câmbio e marcha engatada; marque as que quiser e elas viram cartões como os outros (também nos gráficos e gravações). Por enquanto: Peugeot 208, Jeep Renegade, Honda HR-V e Civic, Toyota Yaris e Corolla, Ford Ranger e Mitsubishi L200 Triton, só em carros com protocolo CAN. Os dados vêm do projeto aberto OBDb: os **conferidos** foram confirmados num carro de verdade (às vezes de outro país ou com outro motor, então compare com um valor que você conheça); os **experimentais** ficam escondidos até marcar **Mostrar parâmetros experimentais**. Cada um é um pedido a mais por ciclo, então escolher muitos deixa a leitura mais lenta. No modo demonstração, escolha **Toyota Corolla** e marque **Temperatura do óleo do motor** ou **Temperatura do câmbio, cárter**.
- Ao lado do título aparece o selo **Motor frio** (líquido abaixo de 60 °C), **Aquecendo** (60 a 80 °C, ou óleo abaixo de 70 °C quando o carro informa) ou **Motor pronto**. Com o motor frio, evite acelerar forte. O mesmo selo aparece no canto do HUD.
- O quadro **Computador de bordo** mostra o consumo agora e a média da viagem em km/L. O programa escolhe sozinho a conta mais precisa que o carro permite, nesta ordem: **vazão de combustível** informada pela central (a mais precisa, mas rara), **sensor MAF** (o ar que entra no motor, bem preciso) ou, em carros só com **sensor MAP** (pressão do coletor, comum no Brasil), uma estimativa pela cilindrada e pela eficiência volumétrica. Qual delas o seu carro usa aparece no perfil, em **Configurações → Veículos (perfis)**, na linha **Consumo calculado por**. Para melhorar a precisão, informe ali o combustível e, em carros só com MAP, a cilindrada.
- **Ajuste pelo abastecimento** (carros só com MAP; em carros com MAF fica dentro de **Avançado**, para um sensor MAF sujo ou velho): corrige o consumo calculado comparando com a bomba.
  **Importante:** nas duas vezes, complete o tanque e pare no **primeiro desarme da bomba**, sem completar depois. Se um dos abastecimentos for parcial ou tiver "chorinho", o tanque não fica no mesmo nível e a comparação sai errada. O programa lembra disso ao clicar nos botões.
  1. Complete o tanque, parando no primeiro desarme da bomba, e clique em **Tanque cheio** no computador de bordo. O programa começa a somar os litros que ele calcula.
  2. Rode normalmente com o programa lendo o carro, de preferência 200 km ou mais. O que for rodado com o programa desligado fica fora da conta e estraga a comparação.
  3. No próximo abastecimento, complete o tanque de novo, parando no primeiro desarme, e clique em **Abasteci**. Uma janela mostra os km e os litros calculados desde o tanque cheio e pede os litros da bomba.
  4. O programa compara os dois. Exemplo: bomba 20 L, programa 18 L, ele estava 11% abaixo e passa a corrigir isso. Em carros só com MAP, o que muda é a eficiência volumétrica; em carros com MAF, um fator de correção.
  Cada abastecimento refina o ajuste (média dos últimos 5, pesada pelos km), e a contagem do próximo tanque começa sozinha. Trechos curtos (menos de 50 km ou de 3 L calculados), com falta de leitura ou com resultado fora do esperado são ignorados, com um aviso. Um selo mostra quantos abastecimentos já calibraram o consumo, e **Restaurar padrão** no perfil desfaz tudo. Carros que informam a vazão de combustível não precisam deste ajuste.
- O computador de bordo tem duas viagens independentes, **Trip A** e **Trip B**, como no painel do carro. Cada uma tem os botões **Iniciar**, **Pausar** e **Zerar** (zerar pede confirmação) e mostra consumo médio, velocidade média (distância dividida pelo tempo contado, incluindo paradas com o motor ligado), distância, combustível gasto, tempo e custo. Elas só contam enquanto o programa está lendo o carro, ficam salvas ao fechar o programa e são separadas por carro (perfil). Exemplo: deixe a Trip A contando desde o último abastecimento e use a Trip B para uma viagem específica. O consumo de agora é um só para as duas. Ao reproduzir uma gravação, aparece uma viagem própria da gravação, que não mexe na Trip A nem na Trip B.
- Combustíveis disponíveis, com as misturas em vigor em novembro de 2026. A lista muda com a região, que acompanha o idioma e pode ser trocada em **Configurações → Veículos (perfis) → Combustíveis de**:
  - **Brasil**: **gasolina comum ou aditivada** (32% de etanol), **gasolina premium** (25% de etanol), **etanol comum ou aditivado**, **diesel S10 ou S500** (15% de biodiesel) e **gasolina sem etanol** (para carros usados fora do Brasil).
  - **Estados Unidos**: gasolina **regular**, **midgrade** e **premium** (87, 89 e 91 a 93 octanas, todas E10, com até 10% de etanol), **E15** ("Unleaded 88"), **E85 / Flex Fuel** (51% a 83% de etanol conforme a estação; o cálculo usa 75%), **gasolina sem etanol (E0)**, **diesel** (até 5% de biodiesel) e **biodiesel B20**.
  - **Europa e Reino Unido**: **E10** (95 octanas, a gasolina padrão), **E5 super** (97 a 99 octanas), **E85** (França, Suécia e outros; 75% no cálculo), **diesel B7** (até 7% de biodiesel), **HVO100** (diesel renovável) e **GLP / autogás**.
  - Em todas, **flex automático**: usa a porcentagem de etanol informada pelo carro e, se o carro não informar, considera a gasolina comum da região. Aditivos e octanagem não mudam o cálculo (só a quantidade de etanol ou biodiesel muda).
  - Ao trocar de região (ou de idioma), cada carro passa para o combustível do mesmo tipo vendido lá: gasolina comum vira regular E10 nos EUA e E10 na Europa, diesel continua diesel, flex continua flex. Se não houver equivalente (GLP no Brasil), o carro fica com o que tinha. Nenhum perfil é apagado.
- **Resumo da viagem**: quando o motor desliga (ou a conexão termina) depois de pelo menos 2 minutos de motor ligado, abre um quadro com o tempo em movimento e parado com motor ligado, distância, velocidade média e máxima, rotação máxima, temperatura máxima do motor, menor tensão da bateria com o motor ligado, combustível, consumo, custo e os valores que saíram da faixa de alerta. **Copiar imagem** manda o resumo pelo WhatsApp. O último resumo pode ser aberto de novo pelo botão **Ver resumo da última viagem** no computador de bordo (até fechar o programa).
- **Histórico de viagens**: cada resumo fica guardado na tela **Viagem → Histórico de viagens**, separado por carro (perfil), com o combustível escolhido nas Configurações. A tabela compara o consumo médio real com gasolina e com etanol (no flex com sensor de etanol, a porcentagem lida decide o grupo). Há também os **totais por mês** (distância, litros, consumo e custo) e a lista das viagens, cada uma com o botão **Apagar**. Reproduzir uma gravação não entra no histórico.
- **Custo da viagem**: em **Configurações → Preço dos combustíveis**, informe o preço do litro. Cada região tem os seus campos de preço e a sua moeda (R$ no Brasil, $ nos EUA, € na Europa e Reino Unido); os preços de uma região ficam guardados quando você troca para outra. O computador de bordo passa a mostrar o custo da viagem e, em carros a gasolina, etanol ou flex, quanto a mesma viagem custaria com a gasolina comum e com o etanol da região (E85 nos EUA e na Europa). A comparação mantém a mesma energia: um litro de etanol tem cerca de 70% da energia de um litro de gasolina comum (E32), daí a regra "etanol compensa até 70% do preço da gasolina" (E85 contra E10 dá cerca de 75%). Motores rendem um pouco melhor com etanol, então é uma estimativa. No flex automático, o preço do tanque é a mistura dos dois conforme a porcentagem de etanol que o carro informa.
- **Alertas** (em **Configurações**): avisam com mensagem e som quando, por exemplo, a temperatura passa de 110 °C ou a bateria fica abaixo de 11,8 V com o motor ligado. Você pode mudar os limites e incluir outros parâmetros.

## 6a. Viagem: analisar o consumo de um trecho

A tela **Viagem** serve para entender quanto um trajeto custou e por quê, sem precisar montar painel nem escolher parâmetros.

1. Conecte no carro, abra **Viagem** e aperte **Iniciar viagem** ao sair. O programa passa a ler sozinho o que a análise precisa e guarda uma linha por segundo. Pode usar as outras telas à vontade.
2. Ao chegar, aperte **Encerrar viagem**. A análise abre na hora (viagens com menos de 1 minuto de dados não são guardadas).
3. Dê um nome e uma anotação, se quiser (ex.: "Ida para a praia", "ar-condicionado ligado").

O que a análise mostra:

- **Números principais**: distância, tempo com o motor ligado, litros, consumo médio, custo na moeda da região (com o preço informado em Configurações), a mesma viagem com gasolina e com etanol (flex), velocidade média e máxima e a comparação com a média do carro (do histórico, com o mesmo combustível, a partir de 3 viagens e 20 km).
- **O que a viagem mostra**: dicas em português simples, por exemplo tempo parado com o motor ligado, consumo pior acima de 110 km/h, acelerações fortes, rotação alta, motor frio e mistura fora do normal.
- **Onde o combustível foi gasto**: parado com o motor ligado, cidade (até 60 km/h) e estrada (acima de 60 km/h), com tempo, distância, litros e consumo de cada parte.
- **Consumo por faixa de velocidade**: uma barra para cada faixa de 10 km/h; a verde é a mais econômica.
- **Jeito de dirigir**: acelerações e freadas fortes, tempo em rotação alta e tempo desacelerando engatado (freio-motor, quando a injeção corta o combustível).
- **Motor e mistura**: temperatura na saída, tempo para esquentar, quanto foi gasto com o motor frio, temperatura máxima e a correção média da mistura com o motor quente.
- **Gráficos**: velocidade, consumo minuto a minuto e temperatura do motor.

Botões: **Relatório (PDF)** (use Imprimir e escolha "Microsoft Print to PDF"), **Planilha (CSV)** (dados segundo a segundo; em português com `;` e vírgula decimal) e **Copiar imagem** (para o WhatsApp).

**Cortar a viagem**: na análise, abra **Cortar a viagem**, escolha um trecho com os controles **Início** e **Fim** (o trecho aparece destacado no gráfico da velocidade) e clique em **Manter só este trecho** (analisa só ele) ou **Tirar este trecho** (deixa de fora, por exemplo, a parada no posto). As partes cortadas ficam cinza no gráfico; **Desfazer cortes** volta à viagem inteira, porque os dados originais continuam guardados. Relatório, planilha e imagem seguem os cortes.

**Comparar duas viagens**: na lista **Viagens analisadas**, marque duas viagens e clique em **Comparar as duas marcadas**. A tabela mostra os números lado a lado (consumo, custo por km, tempo parado, cidade e estrada, acelerações fortes a cada 100 km, rotação alta, freio-motor, motor frio, mistura) e qual foi melhor em cada um. A segunda tabela compara o consumo em cada faixa de velocidade, que é a comparação mais justa entre rotas diferentes (por exemplo, a mesma estrada com gasolina e com etanol).

**Checagem antes da estrada**: com o carro conectado, o botão ao lado de **Iniciar viagem** confere em uns 10 segundos os códigos de falha, a luz de injeção, a bateria (motor desligado: 12,4 V ou mais é carregada) ou o alternador (motor ligado: 13,2 a 14,8 V) e a temperatura do motor. Cada item aparece como ✓ certo, ! atenção, ✗ problema ou ? não lido. Só lê, não altera nada. O OBD2 não vê pneus, óleo, água, freios e luzes: confira por fora também.

**Analisar uma gravação** abre um arquivo `.json` salvo em **Gravações e relatórios** e analisa como uma viagem, usando o combustível e a calibração atuais do carro.

Cuidados: deixe o notebook na tomada do carro e com a tampa aberta (ou configure o Windows para não suspender ao fechar a tampa). O que for rodado com o programa parado ou sem conexão fica fora da conta. Se o programa fechar no meio, a viagem continua quando ele abrir de novo. O consumo fica mais certo depois da calibração no posto (**Tanque cheio** / **Abasteci**). As viagens ficam guardadas no computador, dentro da pasta de dados do programa (na versão portátil, em `OBD2-Scanner-dados`).

## 6f. Checagem pré-compra

A tela **Checagem pré-compra** ajuda a olhar um carro usado antes de comprar. Ela junta as leituras que revelam um carro "maquiado" para a venda e termina com um semáforo: **verde** (nada de errado no que o OBD vê), **amarelo** (pontos de atenção) ou **vermelho** (problemas). O que o carro não responde aparece como **Não verificado**, nunca como verde.

1. **Dados do carro**: um apelido, o chassi (VIN) do documento e a quilometragem do painel. Tudo opcional, mas o chassi e a quilometragem permitem duas conferências importantes.
2. **Motor desligado** (ignição ligada): o programa lê o chassi gravado na central, os códigos (confirmados, pendentes e permanentes), os autotestes de prontidão, os contadores desde a última limpeza de códigos, os km rodados com a luz de injeção acesa, o hodômetro (quando o carro informa), a bateria em repouso e o chassi gravado em cada central.
3. **Partida e marcha lenta**: dê a partida quando o programa pedir e deixe 3 minutos em marcha lenta. Ele mede a queda de tensão na partida, o alternador, a mistura de combustível e os alertas da interpretação automática; no fim, lê os testes da central (Modo 06) e os códigos de novo.
4. **Volta de teste** (opcional): o programa grava a volta e analisa a gravação como qualquer outra. Quem dirige não mexe no computador.
5. **Resultado**: cada item explicado, **Relatório (PDF)** e a checagem salva no histórico. No início da tela, marque dois ou três carros para comparar lado a lado.

| Sinal | O que quer dizer |
| --- | --- |
| Poucos km, aquecimentos ou horas desde a última limpeza (menos de 300 km, 10 aquecimentos ou 8 h) | Códigos apagados ou bateria desligada há pouco tempo. Pode ser inocente; pergunte ao vendedor. |
| 2 ou mais autotestes incompletos | Mesmo sinal: os autotestes recomeçam quando os códigos são apagados. Um incompleto sozinho é comum. |
| Código permanente sem o código confirmado igual | Os códigos foram apagados, mas o defeito continua (vermelho). |
| Km com a luz de injeção acesa | Um defeito ficou sem conserto por um tempo. |
| Chassi da central diferente do documento | Central de outro carro (vermelho). Outra central com chassi diferente é amarelo. |
| Hodômetro da central diferente do painel (mais de 50 km ou 2 %) | Quilometragem alterada ou painel trocado (vermelho). Só funciona nos carros que informam o hodômetro. |
| Bateria, partida e alternador | Mesmos limites do teste guiado de bateria. |
| Mistura em marcha lenta (correção curta + longa) | Até ±10 % normal, até ±20 % atenção, acima disso problema. |

**Limites:** a maioria dos carros não informa o hodômetro real; o OBD comum vê basicamente o motor e às vezes o câmbio (airbag, ABS e carroceria ficam de fora); batidas, enchente e leilão não ficam nas centrais. Sempre consulte a placa, faça vistoria cautelar e leve a um mecânico de confiança.

## 6b. Testes de desempenho

Abra **Testes de desempenho** e dirija: não há botão de iniciar. O programa reconhece sozinho cada teste e guarda o resultado (tempo, distância e aceleração média):

| Teste | Como fazer | Quando começa e termina |
| --- | --- | --- |
| 0–100 km/h | Pare o carro meio segundo e acelere. | Começa no instante em que o carro sai do lugar (não conta o tempo de reação); termina ao cruzar 100 km/h. |
| 100–0 km/h | Passe de 100 km/h e freie até parar. | Começa ao cruzar 100 km/h freando; termina quando o carro para. Mostra a distância de frenagem. |
| 40–80 e 80–120 km/h | Mantenha velocidade constante perto da inicial (até 8 km/h abaixo ou 2 km/h acima, variando no máximo 4 km/h) por 2 segundos e então acelere fundo. | Começa ao cruzar a velocidade inicial (ou na própria acelerada, se você já estava nela); termina ao cruzar a final. |

Por que a retomada exige velocidade constante antes: numa ultrapassagem de verdade o carro está "embalado" numa marcha longa e o motor em giro baixo. Se a medição valesse quando a velocidade só passa por 40 ou 80 km/h no meio de uma acelerada que já vinha de antes, o câmbio já estaria numa marcha mais curta, o motor em giro alto e, nos motores turbo, a pressão do turbo já cheia, e o tempo sairia irrealmente curto. Por isso uma mesma acelerada de 35 a 120 km/h conta só o 40–80.

Um teste por vez: marque **Fazer esta prova** no cartão da prova que vai fazer (0–100 vem escolhido de início). Só ela fica ativa; as outras ficam apagadas e não medem nada. Trocar de prova descarta uma medição em andamento. A escolha fica salva por carro (perfil).

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

## 6d. Interpretação automática

O quadro **Interpretação dos dados** do painel analisa sozinho os parâmetros que estão sendo lidos e mostra **indícios**, sempre com o que verificar. Não é diagnóstico: é uma pista para levar ao mecânico ou conferir com um teste guiado.

Para evitar alarme falso, cada regra:

- só usa parâmetros que o carro informa e que estão no painel agora (um valor sem atualização há mais de 5 s é ignorado);
- só vale nas condições certas: mistura e sondas com motor quente, em malha fechada e fora do corte de combustível na desaceleração; marcha lenta com motor quente, carro parado e pé fora do acelerador; carga do alternador só 20 s depois da partida;
- precisa se repetir por alguns segundos antes de aparecer (uma leitura estranha sozinha não conta);
- some só quando o valor volta com folga (por exemplo, a mistura pobre aparece acima de +10% e some abaixo de +8%), para não ficar piscando.

| Indício | Quando aparece | Parâmetros usados |
| --- | --- | --- |
| Superaquecimento | 115 °C ou mais por 5 s (crítico); 108 °C ou mais por 10 s (atenção). Até 105 °C é normal em muitos carros parados no trânsito. | Temp. motor |
| Válvula termostática aberta | Abaixo de 70 °C depois de 15 min ligado, ou temperatura que cai abaixo de 75 °C andando acima de 40 km/h depois de ter passado de 85 °C. | Temp. motor, velocidade, tempo ligado |
| Sensor de temperatura com defeito | Marca −40 °C (fio solto) ou fica 10 °C abaixo da temperatura externa com o motor ligado. | Temp. motor, temp. ambiente |
| Sensor de temperatura do ar com defeito | Marca −40 °C (fio solto) ou fica 15 °C abaixo da temperatura externa com o motor ligado. | Temp. do ar, temp. ambiente |
| Mistura pobre ou rica | Correção total (média do curto prazo em 10 s + longo prazo) acima de ±10% (informação) ou ±20% (atenção), com motor quente há pelo menos 1 min e em malha fechada. Em carro flex, logo após trocar de combustível pode ser só o aprendizado. | STFT, LTFT, malha, rotação, carga |
| Bateria e alternador | Motor desligado: abaixo de 12,0 V (fraca) ou de 12,4 V (parcial). Na partida: queda abaixo de 9,6 V. Motor ligado: abaixo de 12,6 V por 20 s (não carrega), 12,6–13,2 V (pode ser carga inteligente), acima de 15,0 V por 10 s (regulador). Sem a rotação no painel não há avaliação, porque não dá para saber se o motor está ligado. | Tensão, rotação |
| Marcha lenta alta ou irregular | Motor quente e carro parado: acima de 1.150 rpm por 10 s, ou rotação pulando para cima e para baixo (mais de 250 rpm) em 15 s. Um degrau só, como o do ar-condicionado ligando, não conta. | Rotação, velocidade, borboleta |
| Vácuo fraco em marcha lenta | Pressão do coletor acima de 70% da externa por 15 s. | MAP, pressão barométrica |
| Sensor MAP incoerente | Motor desligado e MAP diferente da pressão externa em mais de 10 kPa. | MAP, pressão barométrica |
| Sensor MAF sem sinal | Menos de 0,5 g/s com o motor acima de 600 rpm. | MAF, rotação |
| Ar de admissão quente | Andando acima de 40 km/h por 30 s e ar 30 °C acima do externo (ou acima de 65 °C sem temp. externa). Parado, ar quente é normal. | Temp. do ar, temp. ambiente, velocidade |
| Sonda lambda parada | Sonda dianteira variando menos de 0,3 V em 10 s, motor quente, malha fechada. | Sonda B1S1 |
| Catalisador fraco | Rotação estável, motor quente há 5 min: a sonda traseira cruza o meio da escala pelo menos 70% das vezes que a dianteira. | Sondas B1S1 e B1S2 |
| Catalisador muito quente | Acima de 900 °C por 5 s. | Temp. do catalisador |

Quando a regra deixa de valer por um instante (uma acelerada, uma freada), o último resultado de mistura, marcha lenta e catalisador continua na tela enquanto o motor estiver ligado.

## 6e. Gráficos

Na tela **Gráficos**, cada parâmetro ganha um gráfico próprio, todos com o mesmo eixo de tempo.

- **Predefinições:** um clique escolhe um grupo pronto: **Do painel** (os mesmos do Painel ao vivo), **Mistura (injeção)**, **Temperaturas**, **Elétrica**, **Consumo**, **Aceleração** e **Turbo**. Só entra o que o carro informa.
- **Escolher parâmetros:** abre a lista completa, por categoria e com busca. Dá para escolher qualquer parâmetro que o carro informa, mesmo que não esteja no Painel: o programa passa a lê-lo também (e ele entra nas gravações). Para tirar um gráfico, clique no nome dele (com ✕).
- **Calculados pelo programa:** o consumo instantâneo em **L/h** e em **km/L** (ou L/100 km / mpg, conforme as Unidades) não vem do carro: é calculado como no computador de bordo e pode ser desenhado como qualquer outro parâmetro.
- Quanto mais parâmetros lidos, mais devagar cada um atualiza.

Com uma gravação aberta, a lista mostra os parâmetros que existem nela, mais os calculados a partir deles.

## 7. Testes da central (Modo 06)

Em **Códigos de falha → Testes da central**, clique em **Ler testes**. Cada linha é um autoteste da central com o valor medido e os limites aceitos. Um teste **reprovado** costuma indicar o componente com problema antes mesmo de aparecer um código de falha. Disponível em carros com rede CAN (a maioria a partir de 2008–2010).

Acima da tabela, **O que os testes indicam** resume os padrões conhecidos, sempre como indício:

| Indício | Quando aparece |
| --- | --- |
| Falha de combustão em um cilindro | Um cilindro com contagem de falhas (média de 10 ciclos ≥ 5 ou último ciclo ≥ 10) pelo menos 3 vezes maior que a dos outros. Aponta vela, bobina, cabo ou bico daquele cilindro. |
| Falha de combustão em vários cilindros | Vários cilindros acima desses números. Aponta algo comum: combustível, pressão, entrada de ar, bobina única. |
| Catalisador reprovado / perto do limite | Teste do catalisador reprovado, ou aprovado a menos de 10% do limite superior (só quando o limite começa em zero). |
| Sonda lambda ou aquecedor reprovado | Algum teste daquela sonda ou do aquecedor dela fora dos limites. |

Valores sem escala conhecida (marcados com *) não entram nessas conclusões.

## 8. Gravar, reproduzir e gerar o relatório

**Gravar:** clique em **Gravar** no Painel ao vivo (o mesmo botão vira **Parar gravação**) ou em **Iniciar gravação** na tela **Gravações e relatórios**. Se a leitura estiver parada ou pausada, ela começa junto com a gravação. Se você pausar a leitura no meio, a gravação fica sem dados até retomar (a tela Gravações e relatórios avisa). A gravação guarda os parâmetros que estão sendo lidos (os do Painel e os escolhidos a mais nos Gráficos) e, junto, uma leitura de diagnóstico no começo e outra no fim (veja *O que a gravação guarda*, em **Arquivos exportados**). Enquanto grava, **Marcar evento** (ou a tecla **Espaço**) marca o momento de um tranco ou barulho.

**Reproduzir:** em **Gravações e relatórios → Reproduzir gravação**, escolha um arquivo JSON salvo antes. O painel, o HUD, os gráficos e a interpretação mostram a gravação como se fosse ao vivo, com pausa, velocidade (até 8×) e barra de posição no topo. **Fechar gravação** volta ao normal. Para ver a gravação inteira de uma vez nos gráficos, use **Ver nos gráficos**.

**Caixa-preta (gravação automática de falha):** enquanto a leitura está ligada, o programa guarda os últimos 2 minutos na memória. Se aparecer um código de falha novo (pendente ou confirmado) ou a luz de injeção acender, ele salva sozinho os **2 minutos antes e os 2 minutos depois**, com os códigos e o quadro congelado que a central guardou. Para perceber a falha, a cada 5 segundos ele pergunta à central se a luz acendeu e, a cada 30 segundos, lê os códigos pendentes (que costumam aparecer antes da luz). Códigos que o carro já tinha ao conectar não disparam nada. Outra falha nos 2 minutos seguintes estica a mesma gravação (até 10 minutos). Além dos parâmetros da tela, a caixa-preta lê sempre uns 10 sensores essenciais (giro, velocidade, temperatura, carga, borboleta, correções de combustível, MAP ou MAF, ar admitido, avanço e bateria); ler *todos* os sensores deixaria a atualização lenta demais num ELM327. As gravações automáticas ficam em **Gravações e relatórios → Caixa-preta**, onde dá para reproduzir, ver nos gráficos, gerar o relatório, **fixar** (nunca é apagada) ou apagar. Ficam as 30 mais recentes (até 200 MB). O botão **Salvar últimos 2 min** (no Painel ao vivo e nessa tela) guarda os últimos minutos na hora, quando você sentir algo estranho. Se você já estiver gravando, nada é perguntado durante a direção: a falha vira uma marca na sua gravação e a gravação automática também é salva; ao parar, um aviso conta o que foi detectado. Liga e desliga em **Configurações → Caixa-preta**, onde também dá para gravar quando um alerta disparar (no máximo uma vez a cada 10 minutos por parâmetro). No modo demonstração, **Criar falha nova** (em *Simular falhas de adaptador clone*) faz o carro virtual registrar o código P0302 para testar.

**Relatório:** feito só quando você pede, a partir da última gravação ou de um JSON salvo. Detalhes em **Arquivos exportados**, logo abaixo.

## 9. Temas

Em **Configurações** há 8 temas. O **Noturno** (vermelho no preto) não ofusca dirigindo à noite; o **Alto contraste** ajuda sob sol forte ou com baixa visão. Os botões **☀ Dia** e **☾ Noite** no canto de cima de todas as telas trocam para esses dois temas com um clique; clicar de novo no botão ativo volta ao tema escolhido nas Configurações.

## 10. Vários carros (perfis)

Em **Configurações → Veículos (perfis)**, clique em **Novo veículo** para cada carro e informe nome e combustível. Depois da primeira leitura, o perfil mostra como o consumo desse carro é calculado (vazão de combustível, sensor MAF ou sensor MAP). Só em carros com MAP aparecem a cilindrada e a eficiência volumétrica, porque só ali elas entram na conta (enquanto o carro não foi lido, aparece só a cilindrada). Cada perfil tem os seus próprios alertas e resultados de desempenho. Na primeira conexão, o programa lê o chassi (VIN) do carro e guarda no perfil ativo. Depois disso, ao conectar em qualquer um dos carros, ele **troca de perfil sozinho**. O perfil ativo também pode ser trocado na caixa no canto inferior esquerdo da janela.

## 11. Idioma e unidades

O idioma fica em **Configurações → Aparência e idioma** e também na caixa no canto inferior esquerdo da janela. São três:

| Idioma | Unidades que entram junto |
|---|---|
| **Português (Brasil)** | km/h, °C, kPa, km, litros, km/L |
| **English (US)** (inglês dos EUA) | mph, °F, psi, milhas, galões americanos, mpg (EUA), lb·ft |
| **English (Europe)** (inglês britânico, para quem usa o sistema métrico europeu) | km/h, °C, bar, km, litros, L/100 km |

Ao trocar o idioma, a tela inteira muda na hora, sem reiniciar, e as unidades e os combustíveis passam a ser os daquele idioma, mesmo que você tenha mudado alguma unidade antes. Depois é só ajustar o que quiser em **Unidades**. Códigos de falha já lidos são descritos de novo no idioma novo. Os preços de combustível seguem a unidade de volume (por litro ou por galão; o valor guardado é o mesmo, só muda a forma de mostrar) e a moeda da região dos combustíveis.

Em **Configurações → Unidades**, escolha um padrão (**Brasil**, **Europa**, **EUA**, **Reino Unido**) ou cada unidade separadamente: velocidade (km/h ou mph), temperatura (°C ou °F), pressão (kPa, bar ou psi), distância (km ou milhas), volume (litros ou galões), consumo (km/L, L/100 km, mpg) e torque. A troca vale para o painel, mostradores, HUD, gráficos, alertas, computador de bordo, ajuste pelo abastecimento, interpretação dos dados, valores típicos do glossário e relatório. As gravações e os arquivos exportados continuam no sistema métrico, que é o padrão do OBD2.

## 12. Reconexão automática

Com a opção **Reconectar automaticamente se a conexão cair** ligada (na tela Conexão e em Configurações; vem ligada), o programa volta sozinho quando o Bluetooth sai de alcance, o cabo solta ou o adaptador trava. Uma faixa amarela no topo mostra a tentativa e o tempo até a próxima. Ele tenta por até 3 minutos, com esperas de 1, 2, 3, 5, 8 e depois 10 segundos, e mantém a lista de parâmetros e a gravação em andamento. **Parar e desconectar** cancela. Num adaptador USB, se o Windows der outro número de COM depois de tirar e pôr o cabo, o programa acha o mesmo adaptador na porta nova (pelo número de série do USB; em clones sem número de série, só quando há um único adaptador daquele tipo ligado).

## 13. Teste do adaptador e centrais do carro

- **Teste de compatibilidade do adaptador** (tela **Conexão**, com o adaptador conectado): descobre até qual versão do ELM327 o adaptador funciona de verdade. Clones costumam dizer "v2.1" e funcionar como v1.3. Só usa comandos que leem algo ou que o reinício desfaz; nada é gravado no adaptador.
- **Centrais eletrônicas** (tela **Veículo e prontidão**): lista as centrais que respondem pelo OBD (motor, câmbio, sistema híbrido) e lê a identificação de cada uma (nome, número da peça, fornecedor, versão do software), quando o carro informa. Só leitura. ABS, airbag e carroceria usam endereços próprios de cada fabricante e não aparecem.

## 13a. Norma OBD, combustível e chassi

Na tela **Veículo e prontidão**, depois de **Ler informações**, aparecem também:

- **Norma OBD declarada**: o que a central diz seguir. Carros brasileiros costumam mostrar **OBDBr-1** (2007 a 2010), **OBDBr-2** (a partir de 2010/2011) ou **OBDBr-3** (a partir de 2022). Importados podem mostrar EOBD (Europa) ou OBD-II (EUA). Tudo funciona igual.
- **Combustível informado**: o que a central diz usar. A norma não tem código para carro flex, então um flex pode aparecer como gasolina, etanol ou bicombustível.
- **Dígito verificador** do chassi: só aparece em chassis da América do Norte e da China, onde ele existe. No Brasil a 9ª posição do chassi é um caractere comum.

Detalhes sobre a base de códigos e as particularidades brasileiras: [CARROS-BRASILEIROS.md](CARROS-BRASILEIROS.md).

## 13b. Tela acesa durante a leitura

Enquanto a leitura ao vivo estiver ligada, uma gravação estiver em andamento ou a tela **HUD** estiver aberta, o programa pede ao Windows para não apagar a tela nem suspender o computador. Ao parar, o Windows volta ao normal. Assim a conexão não cai no meio de uma viagem.

## 13c. Documentação

A tela **Documentação** (no menu, logo abaixo do Glossário) reúne, sem precisar de internet:

- **Início:** atalhos e os **dados do programa** (quantos parâmetros, códigos de falha, tabelas de marcas e fabricantes ele conhece).
- **Como usar** (este manual), **Sobre o projeto**, **Novidades da versão** e as **Regras do projeto** (o que o programa sempre faz e nunca faz).
- **Carros brasileiros**, **Mapa visual** (os diagramas de todas as partes do programa, nas cores do tema), **Fontes e licenças**, **Arquitetura** e o **Guia do código para iniciantes**.

Todos os documentos existem nos três idiomas do programa e aparecem no idioma escolhido em **Configurações → Aparência e idioma** (o inglês da Europa usa a grafia britânica). Use **Ir para a seção…** para pular dentro de um documento. Diagramas largos aparecem encolhidos: clique para ver no tamanho real e de novo para encolher. Também dá para chegar aqui por **Configurações → Sobre → Documentação, fontes e licenças**.

## 14. Só leitura (segurança)

O programa nunca grava nada nas centrais do carro. Os parâmetros do fabricante também só leem (serviços 21 e 22). No **Terminal AT**, comandos que gravariam no carro ou na memória do adaptador são recusados com uma explicação. **Apagar códigos** só funciona com o motor desligado e a ignição ligada: o programa pergunta ao carro o giro e a velocidade antes de apagar e recusa se o carro não responder (chave só em acessórios). Depois de apagar, ele lê os códigos de novo e avisa se algum voltou, sinal de que o defeito continua. Códigos *permanentes* só somem sozinhos, depois de alguns ciclos de uso sem o defeito. No modo demonstração, use **Desligar motor** em *Simular falhas* (tela Conexão).

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
| "A porta não existe agora" | O cabo USB foi tirado ou o pareamento Bluetooth foi removido. Clique em **Atualizar** e escolha a porta de novo (pareie de novo se precisar). |
| "A porta está sendo usada por outro programa" | Feche outros apps de OBD e outras janelas deste programa; desconecte o adaptador do celular. |
| "O Windows não alcançou o adaptador Bluetooth" | Adaptador fora do carro, ignição desligada, longe ou conectado a um celular. Clássico: se continuar, remova o pareamento no Windows e pareie de novo (PIN `1234` ou `0000`). |
| Bluetooth LE não aparece na busca | Confira se o Bluetooth do Windows está ligado e se o adaptador não está conectado a um celular. Não precisa parear; se pareou antes e não funciona, remova o pareamento. |
| Leituras lentas | Selecione menos parâmetros no Painel ou diminua o tempo de espera por comando. |
| Faixa amarela "Reiniciando o adaptador" ou "Tentando reconectar" | Normal com clones: o programa está se recuperando sozinho. Se durar mais de um minuto, tire o adaptador da tomada por 10 segundos. Veja *Quando o clone trava*. |
| Valores pulando ou travando com adaptador clone | Em *Opções avançadas*, desligue a **leitura rápida** e aumente o tempo de espera por comando. |
| Consumo calculado muito diferente do real | Confira o combustível (e, em carros só com MAP, a cilindrada) em **Configurações → Veículos (perfis)**. Depois use o **ajuste pelo abastecimento** no computador de bordo (em carros com MAF, dentro de **Avançado**). |
| Um parâmetro some do painel | O carro parou de responder a ele; o programa o retira automaticamente. |
| Aviso "precisa do Microsoft Edge WebView2" | Instale o *WebView2 Runtime* pelo link do aviso, ou use o instalador em vez da versão portátil. |
| Dados estranhos | Veja o **Registro de comunicação** na tela Conexão ou use o **Terminal AT** (ex.: `ATI`, `ATRV`, `0100`). |

## Arquivos exportados

Enquanto grava, o programa também guarda uma **cópia de segurança** no disco, atualizada pelo menos a cada minuto, no arquivo `gravacao-em-andamento.jsonl` da pasta de dados (na versão portátil, em `OBD2-Scanner-dados`). Se o programa ou o computador desligar no meio da gravação, na próxima abertura ela volta como "última gravação", pronta para exportar em **Gravações e relatórios**. A próxima gravação substitui essa cópia.

**Marcar evento:** enquanto grava, aperte o botão vermelho **Marcar evento** (no Painel e no HUD) ou a tecla **Espaço** no momento em que notar um tranco, falha ou barulho. Nos **Gráficos** de uma gravação aberta, cada marca aparece como uma linha vermelha tracejada (★1, ★2...) e um botão que aproxima os gráficos daquele momento. Na reprodução, **Próximo marcador** pula para 5 segundos antes do evento. No CSV, a coluna `mark` vale 1 na primeira leitura depois de cada marca.

- **Copiar imagem** (telas **Códigos de falha** e **Gráficos**): monta um cartão claro com o carro, a data, os códigos (e o quadro congelado, se lido) ou os gráficos com mínimo e máximo, e copia para a área de transferência. Cole com **Ctrl+V** no WhatsApp, Telegram ou e-mail para mandar a um mecânico. Se o Windows não aceitar a cópia, a imagem é salva como PNG.
- **Planilha CSV (Excel em português)**: separador `;` e vírgula decimal. Abre com dois cliques no Excel brasileiro.
- **CSV padrão**: separador `,` e ponto decimal.
- **JSON**: gravação completa, pode ser reaberta no programa (**Gravações e relatórios → Reproduzir gravação** ou **Ver nos gráficos**).
- **PNG**: imagem dos gráficos.
- **Relatório de diagnóstico**: feito a partir de uma gravação, só quando você pede. Em **Gravações e relatórios → Relatório de diagnóstico**, escolha **Relatório da última gravação** ou **Relatório de uma gravação salva…** (um JSON). O relatório abre na tela, com os botões *Imprimir / salvar como PDF* (escolha "Microsoft Print to PDF") e *Salvar relatório (HTML)*. Ele traz os dados do veículo e do adaptador, os códigos de falha lidos no início (e os que surgiram até o fim), o quadro congelado, a prontidão, o Modo 06, os indícios encontrados no trajeto todo (com o momento em que apareceram), gráficos dos principais parâmetros com os eventos marcados e uma tabela com mínimo, média e máximo de cada parâmetro. Gravações feitas em versões antigas também funcionam, mas sem códigos, prontidão e Modo 06.

**O que a gravação guarda:** os parâmetros lidos (os do Painel ao vivo e os escolhidos a mais nos Gráficos) e, junto, uma leitura de diagnóstico no começo (veículo, códigos de falha com quadro congelado, prontidão e Modo 06) e outra no fim (códigos e prontidão). Essas leituras só consultam o carro, nunca apagam nem alteram nada. Se o carro não responder a alguma delas, a gravação continua normalmente e o relatório avisa o que faltou.
