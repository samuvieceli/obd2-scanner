# Project rules

All the general rules of OBD2 Scanner in one place, in plain language. They apply to anyone (or any AI) who works on the program.

There are two kinds of rule:

- **Product rules**: what the program does, never does and how it presents itself to the people who use it.
- **Working rules**: how the project is developed, decided, tested and published.

> When a rule changes, change this file in the same commit (and its Portuguese original in `docs/REGRAS-DO-PROJETO.md`). It appears inside the program, under **Documentation → Project rules**.

---

## Part 1. Product rules

### 1.1 Safety of the car and of the people using it

| # | Rule | Why |
| --- | --- | --- |
| P1 | **Read-only.** The program reads the car and never writes anything to the control units (no coding, configuration, module reset or actuator tests). The only action allowed is **clearing trouble codes**, and only with the engine off and the car stopped. | A wrong write can lock a control unit and leave the car undrivable. |
| P2 | **The adapter is not changed permanently either.** Commands that write to the ELM327's memory (`ATPP`, `ATCV`, `ATSD`, `ATBRD`) are refused, and every tool that changes a temporary setting puts the adapter back as it was. | Cheap clones can become unusable. |
| P3 | **Safety notice on opening.** Before using the program, the person reads and accepts the notice (do not use while driving, performance tests only on a closed area, results are hints, secure the adapter and cables, no warranty). If the text changes in an important way, the notice shows again for everyone. | To protect the people who use it and make the program's limits clear. |
| P4 | **A diagnosis is a hint, not a verdict.** Every automatic interpretation says what was seen and what to check, with time confirmation to avoid false alarms. | A generic OBD2 scanner does not see everything; the last word belongs to a mechanic. |
| P5 | **Unverified data is marked as experimental** (or hidden behind an "experimental" option). Manufacturer-specific codes with no reliable source show that warning instead of an invented text. | Better to say "I don't know" than to give wrong information. |

### 1.2 Platform and connection

| # | Rule |
| --- | --- |
| P6 | **Windows (10 and 11) for now.** A phone version (Android/iOS) was discussed and left for later. |
| P7 | **Genuine ELM327 adapters, clones and simulators**, over **Bluetooth classic** (COM port), **Bluetooth LE**, **USB/serial** and **Wi-Fi**, as well as **demo mode** (a virtual car). |
| P8 | **Clone-tolerant.** The program expects the usual clone defects (missing answers, refused commands, freezes) and recovers by itself, telling what happened. |
| P9 | **Works without internet.** Databases, charts and documentation come inside the program; nothing is loaded from websites. |

### 1.3 Interface and texts

| # | Rule |
| --- | --- |
| P10 | **Simple, complete and modern**, with clear technical terms. |
| P11 | **Every piece of technical information has a short explanation**: a tooltip on hover and the **Glossary** with all the terms. |
| P12 | **Three languages:** Portuguese (Brazil), English (US) and English (Europe). **Units follow the language** (km/h and km/L in Brazil, mph and mpg in the USA, L/100 km and bar in Europe) and can be adjusted in Settings. New texts are written in pt-BR and en-US; European English is generated from American English. |
| P13 | **Real Brazilian Portuguese** (no "ecrã", "ficheiro", "utilizador"). |
| P14 | **Focus on the cars sold in Brazil** in the last 15 years, domestic and imported (OBDBr standards, flex fuel, fuel blends under Brazilian law). The ethanol percentages in gasoline change by law and must be checked from time to time. |

### 1.4 Data and files

| # | Rule |
| --- | --- |
| P15 | **Save in common formats:** CSV (including the Brazilian Excel format), JSON, PNG image and PDF (report). |
| P16 | **Every database and every piece of code reused from another project has its source and license cited** in [CREDITOS.md](CREDITOS.md) (in the program: Documentation → Sources and licenses). Only material with a license compatible with the GPL-3.0 is accepted. |
| P17 | **Open source, GPL-3.0-or-later license.** Anyone can see, study and improve the program. |

---

## Part 2. Working rules

### 2.1 Who decides what

| # | Rule |
| --- | --- |
| T1 | **A new feature only with the project owner's approval.** Proposals arrive explained in plain language, with the options and the recommended one. |
| T2 | **Approved means it goes in.** An approved feature goes into the main version (`main`) as soon as the automatic check (CI) passes, with no further confirmation. The same goes for data expansions and fixes of confirmed bugs. |
| T3 | **Reviews made by another AI:** each point is checked against the code. Confirmed real bugs are fixed directly (they go in when the CI passes) and only a summary is sent; what was not confirmed is explained. A new feature suggested in a review still needs approval. |
| T4 | **Big decisions become a notification**, explained for a layperson, even when the project owner is away. The rest carries on by itself. |
| T5 | **Interrupted work (for example by a usage limit) resumes by itself**, stopping only for important decisions. |
| T17 | **Proposals ready for the owner and for another AI:** every proposal for a new feature or a code review brings (1) a plain-language summary for a layperson, with options and the recommended one, waiting for approval before touching the code, and (2) an organized, self-contained technical block, ready to copy and send to another AI for a second opinion. |
| T18 | **Taking turns between AIs:** never two AIs edit the same folder or *branch* at the same time. Each task runs on a separate *branch* (via Pull Request) and only goes into `main` after the project owner's approval and with all the automatic checks (CI) passing without errors. |

### 2.2 Quality

| # | Rule |
| --- | --- |
| T6 | **Modern, fast and solid technology:** Rust + Tauri 2 in the program, TypeScript in the interface, stable and up-to-date dependencies. |
| T7 | **Code that explains itself:** organized, short and with comments that say why, so it works as documentation. |
| T8 | **Every calculation or diagnosis rule has a test**, including cases where it must **not** fire. |
| T9 | **After each big stage, a full review:** general and screen bugs, comparison with other scanners, testing as a layperson and as an advanced user. |
| T10 | **Small changes, one per subject** (one change request per topic), to make them easier to review and undo. |

### 2.3 Documentation

| # | Rule |
| --- | --- |
| T11 | **Visual map always up to date:** whoever creates, changes or removes a part of the program updates [DIAGRAMAS.md](DIAGRAMAS.md) in the same commit, with captions in plain language. |
| T12 | **Manual updated together with the feature:** [COMO-USAR.md](COMO-USAR.md) explains each screen; [CARROS-BRASILEIROS.md](CARROS-BRASILEIROS.md) says what the program knows about cars in Brazil and where the gaps are. |
| T13 | **Beginner's guide** in [GUIA-INICIANTE.md](GUIA-INICIANTE.md): how to see, change, test and publish the code without knowing much about programming. |
| T14 | **The documents appear inside the program** (Documentation screen). A new document for users also goes into that screen's list (`src/docs.ts`). |
| T19 | **Documentation in all the program's languages:** every document exists in Portuguese (Brazil) in `docs/` and in English in `docs/en/` (same file names). Whoever changes one updates the other in the same commit. The Documentation screen shows the version in the chosen language, and the English (Europe) version is the American text with British spelling, with no extra file. |

### 2.4 Versions

| # | Rule |
| --- | --- |
| T15 | **Version 1.0.0 is only published when the project owner asks**, after testing it in their own car. |
| T16 | **Publishing in two steps:** the `vX.Y.Z` tag produces a draft of the download page with the notes from `docs/release-notes/`; the project owner checks it and clicks "Publish release". |

---

## Rules under discussion

A space for new rules that have been proposed but not agreed yet. When they are approved, they move to the right part above.

- *(none at the moment)*
