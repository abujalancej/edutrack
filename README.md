# EduTrack

**English** · [Español](README.es.md) · [Català](README.ca.md)

<p align="center">
  <img src="public/app-icon.png" alt="EduTrack logo" width="220">
</p>

EduTrack `1.0.0` is a local desktop application for continuous assessment and student progress tracking in secondary education.

Teachers record subject assessments and export them as `.edutrack` files. Tutors import those files, complete the latest tracking sheet for each course and term, and generate one PDF per student. No external service is required: school data stays on the local computer.

The interface is available in Spanish, Catalan, English, Basque, and Galician. Subject names come from the school catalogue and are never translated by the interface.

## Features

- Configurable courses, terms, subjects, and student rosters.
- School data import from CSV or JSON, plus a PNG, JPG, JPEG, or WebP logo.
- Subject sheets with exam and continuous-assessment columns.
- Numeric or letter grades, dates, and observations for every assessment.
- Strictly validated `.edutrack` export and multi-file import.
- Exact roster comparison and confirmation before replacing duplicate deliveries.
- Elective subjects that can apply to only the students who take them.
- Latest tracking sheet per course and term, with copy support for the next report.
- Subject and tutor-observation progress counters before generation.
- One student PDF containing every subject, grade, date, observation, tutor note, family signature, and real PDF pagination.
- Local SQLite persistence and a secure Electron IPC boundary.

## Application routes

| Area | Purpose |
| --- | --- |
| `Teacher` | Create subject sheets, assessments, grades, observations, and `.edutrack` exports. |
| `Tutor` | Import teacher deliveries, review progress, add tutor observations, and generate PDFs. |
| `Configuration` | Load the school catalogue, rosters, logo, profile, and language. |
| `Help` | Explain the preparation, teaching, import, and report-generation workflow. |

## Technology stack

- Electron with a secure main process and context-isolated preload bridge.
- React and TypeScript with Vite.
- SQLite through Node.js `node:sqlite`.
- Native PDF generation through Electron `printToPDF`.
- Vitest for unit tests and ESLint for static checks.

## Requirements

- Node.js `22.5.0` or newer for `node:sqlite`.
- npm, using the included `package-lock.json`.
- A writable local filesystem for Electron's application data directory.

No environment variables, network connection, external database, or Python backend are required for local use.

## Installation

Clone the repository, enter its directory, and install the locked dependencies:

```bash
git clone https://github.com/abujalancej/edutrack.git
cd edutrack
npm ci
```

If you are working from an existing checkout and intentionally want npm to update the lockfile, use `npm install` instead.

## Development

Start the Vite and Electron development environment:

```bash
npm run dev
```

The application opens locally in Electron. Changes to the React renderer and the main process are compiled by the development watchers.

## Production build

Create a production build:

```bash
npm run build
```

Create the Windows NSIS x64 installer:

```bash
npm run dist:win
```

The installer is written to `release/`.

## Desktop application

EduTrack is packaged as an Electron desktop application for macOS, Windows, and Linux. The renderer has no direct Node.js integration; file access and persistence are exposed through the isolated preload API.

The installed application stores its database in Electron's per-user directory:

```text
app.getPath('userData')/edutrack.sqlite
```

## Usage

1. Open **Configuration** and load the school courses, subjects, and official student rosters.
2. Complete the teacher profile and choose the interface language.
3. In **Teacher**, create a sheet for a course, term, and subject; add assessments, grades, and observations; then export the `.edutrack` file.
4. Send the exported file to the tutor. Several subject files can be imported together.
5. In **Tutor**, validate the files against the official roster and import the valid deliveries. Imports always update the most recent tracking sheet for the same course and term.
6. Add tutor observations. A tracking sheet becomes ready only when every configured subject has been received; an elective may have no grade for students who do not take it.
7. Generate one localized PDF per student when the sheet is complete.

The `examples/` directory contains four subject deliveries from different teachers and a four-course school catalogue for testing the complete workflow.

## Data storage

EduTrack does **not** use a remote database. Its persistent local store is:

```text
app.getPath('userData')/edutrack.sqlite
```

The database contains the teacher profile, language, school catalogue, rosters, subject sheets, imported deliveries, tracking sheets, and tutor observations. Real school data is kept outside the repository and application bundle.

### Important storage considerations

- Back up `edutrack.sqlite` before deleting centre data or reinstalling the application.
- The `examples/` directory contains fictional data only; never add real student information to Git.
- Imports are validated before they are written and duplicate deliveries require explicit replacement.
- The current application is designed for a private, single-user desktop installation.
- Do not expose the application data directory publicly: it may contain personal student information.

## Data model

Teacher exports use a versioned JSON document with this shape:

```json
{
  "format": "full-seguiment",
  "version": 1,
  "teacher": { "firstName": "Clara", "lastName": "Rius", "sex": "FEMALE" },
  "course": { "level": "ESO_1", "name": "1r ESO" },
  "trimester": { "id": "T_1", "name": "1r Trimestre" },
  "subject": { "name": "Català", "gradeMode": "LETTER", "isElective": false },
  "columns": [],
  "students": []
}
```

Each student stores assessment values and observations. The tutor adds observations to the corresponding tracking sheet; subject names, course names, term identifiers, and rosters must match the configured school catalogue.

## Progress calculations

EduTrack calculates readiness from the configured catalogue, not from the number of files selected:

```text
subjects received = distinct imported subjects for the course and term
subjects pending  = configured subjects - subjects received
comments recorded = students with a tutor observation
ready             = every configured subject has been received
```

Elective subjects remain ordinary configured subjects. Their student coverage can be smaller than the official roster, so students who do not take the elective are not treated as missing grades.

## API

The renderer communicates with the Electron main process through the isolated `fullSeguiment` IPC API.

| Group | Operations |
| --- | --- |
| State and profile | Load state, save language, save teacher profile. |
| Configuration | Import or clear school data, courses, subjects, and logo. |
| Students | Add, edit, delete, reorder, import, and replace rosters. |
| Subject sheets | Create, edit, delete, assess, save cells, and export `.edutrack` files. |
| Tutor imports | Select, validate, import, inspect, replace, and delete deliveries. |
| Tracking sheets | Save tutor observations, copy the latest sheet, generate PDFs, and delete sheets. |

## Project structure

```text
edutrack/
├── assets/                    # Source branding assets
├── build/                     # Electron icon assets
├── examples/                  # Fictional catalogues and .edutrack files
├── public/                    # Public application assets
├── scripts/                   # Development and Electron helpers
├── src/
│   ├── main/                  # SQLite, validation, import/export, PDF, and IPC
│   ├── preload/               # Isolated renderer bridge
│   ├── renderer/              # React application, styles, and translations
│   └── shared/                # Shared catalogues and TypeScript contracts
├── README.md                  # English documentation
├── README.es.md               # Spanish documentation
└── README.ca.md               # Catalan documentation
```

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite, the TypeScript watcher, and Electron. |
| `npm run typecheck` | Run TypeScript checks for the renderer and main process. |
| `npm run lint` | Run ESLint. |
| `npm test` | Run the Vitest suite. |
| `npm run build` | Create the production renderer and Electron build. |
| `npm run dist:win` | Build the Windows NSIS x64 installer. |

## Validation

Before committing changes, run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
