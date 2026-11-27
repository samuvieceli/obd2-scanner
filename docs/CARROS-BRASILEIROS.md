# Carros brasileiros: o que o programa conhece

Este documento resume a base de dados do programa (códigos de falha, fabricantes, parâmetros) e o que muda nos
carros vendidos no Brasil. Tudo aqui é só leitura: o programa nunca grava nada na central do carro.

## 1. Códigos de falha (DTC)

| Grupo | O que é | Quantos códigos | Em português |
| --- | --- | --- | --- |
| P0, P2, P3 (motor e câmbio) | Genéricos SAE: mesmo significado em qualquer marca | cerca de 7.350 | quase todos; faltam os de carro híbrido/elétrico e carregador (P0Axx a P0Fxx, P2Axx a P2Fxx), que aparecem em inglês |
| U0, U3 (rede entre módulos) | Genéricos SAE | cerca de 1.230 | todos |
| B0 (carroceria: airbag, conforto) | Genéricos SAE | cerca de 500 | todos |
| C0 (chassi: freio, ABS, direção) | Genéricos SAE | cerca de 750 | todos |
| P1, B1, C1, U1 (do fabricante) | Cada marca define o seu | tabelas de 10 marcas (Audi, BMW, Ford, Honda, Hyundai, Kia, Mazda, Nissan, Toyota, Volkswagen) | não (inglês) |

Total: cerca de 9.840 códigos genéricos. Um código que não está na base ainda mostra o sistema afetado (motor, freio,
rede...), deduzido da estrutura do código.

**Lacuna conhecida:** não encontramos tabela aberta e confiável de códigos próprios de Fiat, Chevrolet/GM, Renault,
Peugeot/Citroën e Jeep. Carros dessas marcas mostram o significado genérico (que vale para todos). Nos códigos
próprios sem descrição confiável, a tela **Códigos de falha** e o relatório mostram o sistema afetado e um aviso: o
programa não sabe o significado exato, então vale pesquisar o código junto com a marca e o modelo, consultar o
manual de serviço ou perguntar na concessionária ou numa oficina especializada na marca (`src/dtcadvice.ts`).
Não copiamos bancos pagos.

## 2. Chassi (VIN) e fabricantes

- O programa reconhece cerca de 180 códigos de fabricante (os 3 primeiros caracteres do chassi), com foco nas fábricas
  brasileiras (prefixo 9…: 9BW Volkswagen, 9BG Chevrolet, 9BD Fiat, 988 Jeep/Fiat Goiana, 93Y Renault, 936 Peugeot,
  935 Citroën, 9BH Hyundai, 94D Nissan, 93H Honda, 9BR Toyota, 98M BMW, 99A Audi, 95P CAOA etc.), caminhões e motos
  nacionais, Argentina, México e as origens comuns de importados (Tailândia, Índia, China, Coreia, Japão, Europa).
- **Dígito verificador:** no Brasil a 9ª posição do chassi não é dígito de conferência (só é obrigatória na América do
  Norte e na China). Por isso o programa só confere esse dígito em chassis de lá; em carro brasileiro a linha não
  aparece, em vez de dizer "não confere".
- O ano-modelo vem da 10ª posição, que segue a mesma tabela no Brasil.

## 3. Normas OBD no Brasil

A central informa a norma que segue pelo PID 1C, e a tela **Veículo** mostra isso em "Norma OBD declarada":

| Norma | Época (aproximada) | O que muda na prática |
| --- | --- | --- |
| OBDBr-1 | 2007 a 2010 (PROCONVE L4/L5) | Vigia sobretudo defeitos elétricos de sensores e atuadores. Muitos carros usam protocolo próprio e respondem pouco aos pedidos padrão. |
| OBDBr-2 | a partir de 2010/2011 (PROCONVE L5/L6) | Passa a vigiar também a eficiência do catalisador e da sonda lambda e a falha de combustão, como o OBD-II americano. Conector e protocolos padrão: é o caso típico deste programa. |
| OBDBr-3 | fase PROCONVE L7 (a partir de 2022) | Requisitos baseados nas normas americanas e na ISO 15031, para motores a gasolina/flex e diesel. |

Alguns carros, principalmente importados, informam a norma europeia (EOBD) ou americana (OBD-II): tudo funciona igual.

Fases do PROCONVE para carros leves: L6 de 2014 a 2015, L7 a partir de 2022 (adiada até meados de 2022 pela falta de
peças), L8 a partir de 2025, com metas médias por fabricante até 2029/2031.

## 4. Flex e etanol

- A norma não tem código de "flex" no PID 51 (tipo de combustível). Um flex pode aparecer como gasolina, etanol ou
  bicombustível; a tela **Veículo** mostra o que a central disser, com essa explicação.
- O teor de etanol medido (PID 52) só existe em alguns carros; quando existe, aparece no **Painel**.
- A conta de consumo usa as misturas atuais do Brasil (gasolina E32, premium E25, etanol hidratado, diesel B15):
  ver `src/fuels.ts`.

## 5. Parâmetros ao vivo (PIDs)

O catálogo tem cerca de 80 parâmetros do Modo 01 (padrão SAE J1979), o que cobre o que carros a gasolina, flex e
diesel costumam responder. Parâmetros próprios do fabricante (Modo 21/22) não entram por enquanto: a base aberta que
existe (OBDb, licença CC BY-SA 4.0) tem dados de vários modelos vendidos aqui, mas muitos sinais estão marcados como
não verificados e às vezes são de outra versão do carro (outro mercado ou motor).

## 6. Fontes

| Fonte | Licença | Uso |
| --- | --- | --- |
| [OBDex](https://github.com/foerbsnavi/OBDex) | dados CC0-1.0 (domínio público) | títulos em inglês de ~6.250 códigos genéricos novos; os textos em português foram escritos para este projeto |
| [Wikibooks: WMI](https://en.wikibooks.org/wiki/Vehicle_Identification_Numbers_(VIN_codes)/World_Manufacturer_Identifier_(WMI)) | CC BY-SA 4.0 | códigos de fabricante e faixas de país do chassi |
| [Wikipedia: OBD-II PIDs](https://en.wikipedia.org/wiki/OBD-II_PIDs) | CC BY-SA 4.0 | tabelas dos PIDs 1C (normas, incluindo OBDBr-1/2/3) e 51 (combustível) |
| [TransportPolicy.net](https://www.transportpolicy.net/standard/brazil-light-duty-emissions/) e [DieselNet](https://dieselnet.com/standards/br/ld.php) | consulta | datas do PROCONVE e da norma OBDBr-3 (IN IBAMA 23/2020) |
| pyOBD, AndrOBD, Libre Diagnostic | GPL/AGPL | base anterior (ver `docs/CREDITOS.md`) |
