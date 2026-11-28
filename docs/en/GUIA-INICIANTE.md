# Beginner's guide: see, change, test and maintain the code

This guide is for people who have never programmed. It explains, step by step and on Windows, how to look at the OBD2 Scanner code, make small changes, test the program and keep everything in sync with GitHub (where the code is stored and where Claude also works).

---

## 1. Five words you will see

| Word | What it means in practice |
| --- | --- |
| **Repository** | The project folder, with the whole history of changes. It lives on GitHub and can have a copy on your computer. |
| **Commit** | A "save with a description" of a set of changes. E.g. "Fix text on the connection screen". |
| **Branch** | A separate line of work. The main one is called `main`. Claude works on another one (the name changes with each task and starts with `claude/`; it is the one shown in the open PR) so you can review before merging. |
| **Pull request (PR)** | The request to merge a branch into `main`. It is where you see what changed and approve it. |
| **Merge** | Joining the branch into `main`, after approving the PR. |

**Sync** in VS Code does two things: it downloads what changed on GitHub (*pull*) and sends what you saved with a commit (*push*).

---

## 2. Just looking at the code (installing nothing)

Open https://github.com/samuvieceli/obd2-scanner in your browser. To see the newest version, before the merge, switch the branch using the button at the top left of the file list (where it says `main`) to the branch of the open PR (it starts with `claude/`).

Map of the folders:

| Folder / file | What is in it |
| --- | --- |
| `src/` | The interface (the screens). `src/views/` has one file per screen. |
| `src/locales/pt-BR.ts` and `en-US.ts` | **All the texts** of the program, in Portuguese and English. It is the easiest place to start changing things. `en-GB.ts` (English Europe) is made automatically from `en-US.ts`. |
| `src/styles.css` | Colors, sizes and themes. |
| `src/trip.ts`, `src/trips.ts` and `src/refuel.ts` | The trip computer: the consumption calculation, Trip A and Trip B and the calibration from refueling ("Full tank" and "I refueled"). |
| `src/fuels.ts` | The fuels and blends of each region (Brazil, USA, Europe/UK), which follow the language. |
| `src/journey.ts` and `src/views/journey.ts` | The **Trip** screen: analysis of a route (where the fuel went, driving style, cutting a stretch, comparing trips). |
| `src/prepurchase.ts` and `src/views/prepurchase.ts` | The **Pre-purchase check**: the 5-step assistant, the traffic light and the report. |
| `src/maker.ts` | The manufacturer parameters (pilot, data from OBDb). |
| `src/perf.ts` | The performance tests (0–100, rolling acceleration, braking). |
| `src/recording-diagnostics.ts` and `src/views/report.ts` | What the recording reads from the car (codes, readiness, Mode 06) and the diagnostic report. |
| `src/docs.ts` and `src/views/docs.ts` | The **Documentation** screen, which shows the documents in the chosen language. |
| `crates/obd-core/src/interpret.rs` and `src/mode06hints.ts` | The rules of the automatic interpretation (hints) of live data and of the control unit tests (Mode 06). |
| `crates/obd-core/` | The "engine": talks to the ELM327 adapter, sensor formulas, trouble codes, simulator. |
| `crates/obd-core/data/` | Descriptions of the trouble codes (JSON files). |
| `src-tauri/` | The "shell" of the program for Windows (window, installer, icons). |
| `docs/` | Documentation in Brazilian Portuguese (this guide, how to use, architecture, credits). The **visual map with diagrams** of all the components is in `docs/DIAGRAMAS.md`. The English versions are in `docs/en/`. |
| `.github/workflows/ci.yml` | GitHub's automatic check, which tests and builds the installer on every change. |

---

## 3. Setting up the computer (once only)

Install, in this order, accepting the default options:

1. **Git**: https://git-scm.com/download/win
2. **Visual Studio Code**: https://code.visualstudio.com
3. **Node.js 26 (LTS)**: https://nodejs.org
4. **Visual Studio Build Tools**: https://visualstudio.microsoft.com/visual-cpp-build-tools/ . In the installer, tick **"Desktop development with C++"**. (It is big, about 6 GB.)
5. **Rust**: https://rustup.rs . Download and run `rustup-init.exe`, and press Enter for the default option.

Then **restart the computer**. WebView2, which the program uses to draw its window, already comes with up-to-date Windows 10 and 11.

In VS Code, also install the **rust-analyzer** and **Tauri** extensions (the little squares icon in the left bar, then search for the name).

---

## 4. Downloading the code to your computer (cloning)

1. Open VS Code and press `Ctrl+Shift+P`. Type **Git: Clone** and press Enter.
2. Paste `https://github.com/samuvieceli/obd2-scanner` and press Enter.
3. Choose a folder (for example, `Documents`). When it asks, click **Open**.
4. If it asks you to sign in to GitHub, do so. It only asks once.

**To see Claude's newest work** (before the merge): click the branch name at the bottom left of VS Code (it shows `main`) and choose the branch of the open PR (`origin/claude/...`). After the PR is merged, go back to `main`.

---

## 5. Running the program in development mode

1. In VS Code, open the terminal: menu **Terminal → New Terminal**.
2. The first time (and whenever the `package.json` file changes), type:
   ```
   npm install
   ```
3. To open the program:
   ```
   npm run tauri dev
   ```
   The first time takes a few minutes, because Rust compiles everything. After that it is fast.
4. The window opens. To test **without a car**, leave **Demo** selected, click **Connect**, go to **Live dashboard** (reading starts by itself; the **Pause reading** button stops it and then becomes **Resume reading**). The virtual car has faults on purpose, so you can test the trouble codes, Mode 06 and the rest.
5. To close, close the window or press `Ctrl+C` in the terminal.

While the program is open, **changes to the interface show up instantly** when you save (`Ctrl+S`). Changes to Rust (`crates/` or `src-tauri/`) make the program recompile and reopen by itself.

---

## 6. Making a simple change (example)

Let's change a text:

1. Make sure you are up to date: click **Sync** (the circular arrows icon at the bottom left).
2. Open `src/locales/en-US.ts` (`Ctrl+P` and type the file name).
3. Press `Ctrl+F` and search, for example, for `Live dashboard`.
4. Change the text **between the quotes**. Do not delete quotes, commas or braces `{ }`.
5. Save with `Ctrl+S`. With `npm run tauri dev` open, the change shows up instantly.

Tips:

- When you change a text in `pt-BR.ts`, change the equivalent in `en-US.ts` so the languages stay the same. English (Europe) follows `en-US.ts` by itself.
- Write values with units in the metric system (`60 °C`, `200 km`): the program converts them to mph, °F etc. when the person chooses those units.
- Words between braces, like `{rate}` or `{name}`, are filled in by the program. Leave them in the text.
- If something goes wrong, the **Source Control** tab (branch icon, `Ctrl+Shift+G`) shows what changed. Right-click the file and choose **Discard Changes** to go back to what it was.

---

## 7. Testing before sending

In the VS Code terminal:

| Command | What it checks | Time |
| --- | --- | --- |
| `npm run typecheck` | Typing mistakes in the interface code. | seconds |
| `npm test` | The interface calculations: performance tests, guided tests, consumption, Trip A/B, refueling calibration, report, units and more. | seconds |
| `cargo test -p obd-core --all-features` | The "engine": formulas, trouble codes, automatic interpretation, report, simulator, clone adapters. | 1 to 3 min the first time |
| `npm run tauri build` | Builds the installer in `target\release\bundle\nsis\`. | 5 to 10 min |

If everything finishes without the word `error` (in red), it is fine.

You also don't need to run all of this every time: **on every push, GitHub runs the tests by itself** and builds the installer. See it in the repository's **Actions** tab. A green tick ✓ means it passed, and the installer is under **Artifacts**, at the bottom of the run's page (together with the portable version, which runs without installing).

---

## 8. Saving and sharing (commit and sync)

1. Open **Source Control** (`Ctrl+Shift+G`). The changed files appear in the list.
2. Write a short message in the box at the top, saying what changed. E.g. `Adjust dashboard texts`.
3. Click **Commit** (if it asks whether to include all changes, answer **Yes**).
4. Click **Sync Changes**. Done, the change is on GitHub.

**Which branch should you commit to?**

- Small changes of your own (texts, colors): straight to `main` is fine.
- While Claude's PR is open, avoid touching the same files it does. If you want to adjust something in the PR, ask in the chat or commit to the PR's branch (the one starting with `claude/`) and let me know.

---

## 9. Working together with Claude

1. You ask for the change in the project chat.
2. Claude makes the changes on a branch, runs the tests and opens (or updates) a **pull request**.
3. You open the PR on GitHub, look at the **Files changed** tab (what changed) and download the installer built by the CI to test it.
4. If it looks good, click **Merge pull request** and then **Confirm merge**.
5. In VS Code, go back to the `main` branch and click **Sync** to be up to date.

**Golden rule:** always click **Sync** before you start changing things and after you commit. That way you and Claude are always on the same version.

---

## 10. Releasing a version (download page)

GitHub's **Releases** page is where anyone downloads the installer. A new version is made like this:

1. The new version number is written in three files (`package.json`, `src-tauri/tauri.conf.json` and `Cargo.toml`, in the `version` field) and the news goes in `docs/release-notes/vX.Y.Z.md` (and its English copy in `docs/en/release-notes/`). You can ask Claude in the chat: "prepare version 1.1".
2. Merge the PR into `main`.
3. Create the version's **tag** (a label in the history, for example `v1.0.0`). You can ask Claude: "you can create the tag v1.0.0".
4. GitHub builds the installer and the portable version (.zip) by itself (about 10 minutes, **Actions** tab, **Release** workflow) and creates a **draft** of the release. A draft is not visible to anyone yet.
5. Open **Releases** in the repository, click the draft, check the text and the files and click **Publish release**. Done: the "Download the latest version" link in the README now delivers this version.

If something in the draft is wrong, just delete it (**Delete** button) and ask for the fix. Nothing has been published.

---

## 11. Common problems

| Problem | Solution |
| --- | --- |
| `npm` or `cargo` "is not recognized" | Restart the computer after installing Node.js and Rust. Close and reopen VS Code. |
| Error with `link.exe` or `MSVC` when compiling | The Visual Studio Build Tools with "Desktop development with C++" are missing (step 3.4). |
| **Sync** mentions a **conflict** | You and Claude changed the same line. Don't force anything: ask for help in the chat, telling the file. |
| I made a mess and want to go back | Before the commit: **Discard Changes** (section 6). After the commit: ask for help in the chat; nothing is lost, because the history keeps everything. |
| The program opens blank | Close it, run `npm install` again and then `npm run tauri dev`. |
| Windows warns "unknown publisher" when installing | Normal: the installer is not signed yet. Click **More info → Run anyway**. |

---

More details: [COMO-USAR.md](COMO-USAR.md) (using the program), [DIAGRAMAS.md](DIAGRAMAS.md) (visual map of the components), [ARQUITETURA.md](ARQUITETURA.md) (how the code is organized) and [CREDITOS.md](CREDITOS.md).
