# Brazilian cars: what the program knows

This document summarizes the program's database (trouble codes, manufacturers, parameters) and what changes in the
cars sold in Brazil. Everything here is read-only: the program never writes anything to the car's control unit.

## 1. Trouble codes (DTC)

| Group | What it is | How many codes | In Portuguese |
| --- | --- | --- | --- |
| P0, P2, P3 (engine and transmission) | SAE generic: same meaning in any brand | about 7,350 | almost all; the hybrid/electric car and charger ones (P0Axx to P0Fxx, P2Axx to P2Fxx) are missing and appear in English |
| U0, U3 (network between modules) | SAE generic | about 1,230 | all |
| B0 (body: airbag, comfort) | SAE generic | about 500 | all |
| C0 (chassis: brakes, ABS, steering) | SAE generic | about 750 | all |
| P1, B1, C1, U1 (manufacturer) | Each brand defines its own | tables for 10 brands (Audi, BMW, Ford, Honda, Hyundai, Kia, Mazda, Nissan, Toyota, Volkswagen) | no (English) |

Total: about 9,840 generic codes. A code that is not in the database still shows the affected system (engine, brakes,
network...), deduced from the structure of the code.

**Known gap:** we found no open, reliable table of manufacturer-specific codes for Fiat, Chevrolet/GM, Renault,
Peugeot/Citroën and Jeep. Cars of these brands show the generic meaning (which holds for all of them). For
manufacturer-specific codes without a reliable description, the **Trouble codes** screen and the report show the
affected system and a warning: the program does not know the exact meaning, so it is worth searching the code
together with the make and model, checking the service manual or asking at the dealership or at a workshop
specialized in the brand (`src/dtcadvice.ts`). We did not copy paid databases.

## 2. VIN and manufacturers

- The program recognizes about 180 manufacturer codes (the first 3 characters of the VIN), focusing on the Brazilian
  factories (prefix 9…: 9BW Volkswagen, 9BG Chevrolet, 9BD Fiat, 988 Jeep/Fiat Goiana, 93Y Renault, 936 Peugeot,
  935 Citroën, 9BH Hyundai, 94D Nissan, 93H Honda, 9BR Toyota, 98M BMW, 99A Audi, 95P CAOA etc.), Brazilian trucks and
  motorcycles, Argentina, Mexico and the common origins of imported cars (Thailand, India, China, Korea, Japan, Europe).
- **Check digit:** in Brazil the 9th position of the VIN is not a check digit (it is only mandatory in North America
  and China). So the program only checks that digit on VINs from there; on a Brazilian car the line does not
  appear, instead of saying "does not match".
- The model year comes from the 10th position, which follows the same table in Brazil.

## 3. OBD standards in Brazil

The control unit reports the standard it follows through PID 1C, and the **Vehicle** screen shows it as "Declared OBD standard":

| Standard | Period (approximate) | What changes in practice |
| --- | --- | --- |
| OBDBr-1 | 2007 to 2010 (PROCONVE L4/L5) | Mostly watches for electrical faults in sensors and actuators. Many cars use their own protocol and answer little to standard requests. |
| OBDBr-2 | from 2010/2011 (PROCONVE L5/L6) | Also starts watching catalytic converter and lambda sensor efficiency and misfires, like the American OBD-II. Standard connector and protocols: the typical case for this program. |
| OBDBr-3 | PROCONVE L7 phase (from 2022) | Requirements based on the American standards and on ISO 15031, for gasoline/flex and diesel engines. |

Some cars, mainly imported ones, report the European (EOBD) or American (OBD-II) standard: everything works the same.

PROCONVE phases for light vehicles: L6 from 2014 to 2015, L7 from 2022 (postponed until mid-2022 by the parts
shortage), L8 from 2025, with average targets per manufacturer until 2029/2031.

## 4. Flex fuel and ethanol

- The standard has no "flex" code in PID 51 (fuel type). A flex car can appear as gasoline, ethanol or
  bi-fuel; the **Vehicle** screen shows what the control unit says, with this explanation.
- The measured ethanol content (PID 52) only exists in some cars; when it exists, it appears on the **Dashboard**.
- The consumption calculation uses Brazil's current blends (gasoline E32, premium E25, hydrous ethanol, diesel B15):
  see `src/fuels.ts`. The list of fuels follows the language (the USA and Europe/UK have their own blends) and the
  percentages need to be checked from time to time.

## 5. Live parameters (PIDs)

The catalog has about 80 Mode 01 parameters (SAE J1979 standard), which covers what gasoline, flex and diesel cars
usually answer.

### Manufacturer parameters (pilot)

Some models also have the carmaker's own readings (Mode 21/22), such as oil temperature, gear engaged,
transmission temperature and battery state. They come from the open OBDb database (CC BY-SA 4.0). The pilot includes
the models sold here with most of the data confirmed on real cars:

| Model | Parameters | Verified in some year |
| --- | --- | --- |
| Peugeot 208 | 265 | 255 (confirmed on a 2021) |
| Jeep Renegade | 16 | 12 (most of the Renegade's data needs a diagnostic session and was left out) |
| Honda HR-V | 93 | 85 |
| Honda Civic | 227 | 204 |
| Toyota Yaris | 701 | 517 |
| Toyota Corolla | 1,031 | 577 (includes the hybrid) |
| Ford Ranger | 215 | 153 (not verified for 2005 to 2018, another generation) |
| Mitsubishi L200 Triton | 200 | 126 |

How it works: in **Live dashboard → Choose parameters → Manufacturer parameters**, choose the model (the VIN
suggests the brand). The parameters verified for the car's model year appear; the others only with **Show experimental
parameters**, with a label. It only works on cars with the CAN protocol. The decoder was checked against the
roughly 46 thousand responses recorded in OBDb's own tests.

Cautions:

- "Verified" means confirmed on a real car, which may be from another country or have another engine (OBDb's Renegade
  is a diesel, for example). Compare with a value you know before trusting it.
- Only read requests (services 21 and 22) sent straight to a control unit are included. Requests that require opening a
  diagnostic session were left out, so the program keeps on only reading.
- Each manufacturer parameter is one more request per cycle, so choosing many makes the reading slower.
- Still no data in OBDb: Fiat (Strada, Argo, Mobi, Toro, Cronos), Chevrolet Onix and Montana, VW Nivus, Renault
  Kwid, Ford Ka, Citroën C3. VW Polo, Virtus and T-Cross, Renault, Nissan and Hyundai HB20 have data, but almost all
  of it unverified; they may be added later.
- OBDb asks anyone launching a product with this data to tell them first (support@clutch.engineering).

## 6. Sources

| Source | License | Use |
| --- | --- | --- |
| [OBDex](https://github.com/foerbsnavi/OBDex) | CC0-1.0 data (public domain) | English titles of ~6,250 new generic codes; the Portuguese texts were written for this project |
| [Wikibooks: WMI](https://en.wikibooks.org/wiki/Vehicle_Identification_Numbers_(VIN_codes)/World_Manufacturer_Identifier_(WMI)) | CC BY-SA 4.0 | VIN manufacturer codes and country ranges |
| [Wikipedia: OBD-II PIDs](https://en.wikipedia.org/wiki/OBD-II_PIDs) | CC BY-SA 4.0 | tables for PIDs 1C (standards, including OBDBr-1/2/3) and 51 (fuel) |
| [TransportPolicy.net](https://www.transportpolicy.net/standard/brazil-light-duty-emissions/) and [DieselNet](https://dieselnet.com/standards/br/ld.php) | consulted | dates of PROCONVE and of the OBDBr-3 standard (IN IBAMA 23/2020) |
| [OBDb](https://github.com/OBDb) | CC BY-SA 4.0 | manufacturer parameters (Mode 21/22) for 8 models; names translated into Portuguese in this project |
| pyOBD, AndrOBD, Libre Diagnostic | GPL/AGPL | earlier base (see `docs/CREDITOS.md`) |
