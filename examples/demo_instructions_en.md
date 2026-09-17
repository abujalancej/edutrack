# EduTrack demo: updating a school roster without losing history

Use a **disposable database**, never your school's live data. All names and grades are fictional. The dates below (17–20 September 2026) are scenario dates, not instructions to change real enrolments. Allow 15–20 minutes for the main walkthrough; the teacher-side check is optional.

## Files, in order

| Step | Official school file | Teacher deliveries for 1r ESO, term 1 |
| --- | --- | --- |
| 1. Initial roster | `demo_01_school_initial_roster.json` | `demo_01_Catala_v1.edutrack`, `demo_01_Angles_v1.edutrack`, `demo_01_Optativa-1_v1.edutrack`, `demo_01_Optativa-2_v1.edutrack` |
| 2. Carla joins 1r ESO | `demo_02_school_carla_joins_eso1.json` | `demo_02_Catala_v2.edutrack`, `demo_02_Angles_v2.edutrack`, `demo_02_Optativa-1_v2.edutrack`, `demo_02_Optativa-2_v2.edutrack` |
| 3. Biel leaves | `demo_03_school_biel_leaves_eso1.json` | No new deliveries supplied |
| 4. Biel returns | `demo_04_school_biel_returns_eso1.json` | No new deliveries supplied |
| 5. Aina's name and subjects change | `demo_05_school_aina_renamed_subjects_changed_eso1.json` | No new deliveries supplied |

The v2 deliveries are pre-made examples of files exported *after* Carla's enrolment. In real use, each teacher updates their own roster and exports a new file. Do not reuse the step-1 v1 files after step 2.

## Main walkthrough (tutor)

1. **Import the initial school data.** Set up a test tutor profile, then load the step 1 JSON in Settings. Check that 1r ESO contains Aina Bosch and Biel Casas. Carla Costa is already in 2n ESO: that does not establish a shared identity with anyone in 1r ESO.
2. **Import and issue report 1.** Import the four v1 deliveries from step 1. Check that all four subjects are present; Optativa 1 and Optativa 2 have different participants. Export the term-1 PDF and keep it for comparison. The numeric elective grades must appear as letters in a letter-mode final report, with the appropriate red/green grade colours and a single-line abbreviation legend.
3. **Preview without writing.** Load the step 2 JSON. The preview should show Carla as an addition to 1r ESO, with the other students and subjects unchanged. It must say that previous sheets and reports are kept. Click **Cancel**; verify that Carla was not added and report 1 is unchanged.
4. **Apply the enrolment.** Load step 2 again, choose **new person** for Carla in 1r ESO, set the effective date to **2026-09-17**, and confirm. Do not link her to Carla in 2n ESO. Re-export report 1: its student list, names, grades and observations must match the issued version.
5. **Show stale deliveries.** Copy report 1 to create report 2. The copied deliveries must be flagged as outdated, so report 2 is not complete. Try importing an old v1 delivery: it must identify Carla as missing and ask for an updated export, without silently dropping or inventing grades.
6. **Import current deliveries and issue report 2.** Replace all four with the `demo_02_*_v2.edutrack` files. Report 2 must contain Aina, Biel and Carla. Carla's assessments dated 7–16 September are **not applicable** (neither NP, a failing grade, nor a pending grade); the 17 September activities are graded. Carla takes Optativa 2, not Optativa 1. Export report 2, then re-export report 1 to confirm it has not changed.
7. **Check idempotency.** Load the step 2 JSON twice more. Neither attempt should add another Carla, duplicate subjects or create extra reports.

## Further roster and catalogue cases

Continue on the **same test database**, in order. These stages demonstrate history and preview behaviour; no matching teacher deliveries are provided for a new report after step 2.

| Load | Effective date | Action and expected result |
| --- | --- | --- |
| Step 3 | 2026-09-18 | Preview Biel Casas as a departure. Confirm; he leaves the current roster but his earlier grades and both issued reports remain available. |
| Step 4 | 2026-09-19 | Preview Biel Casas as an addition. Explicitly select the **existing Biel Casas** as the returning student, not “new person”. Confirm; his earlier history remains attached to him. |
| Step 5 | 2026-09-20 | Preview Aina Bosch leaving and Aina Maria Bosch joining. Manually link the new name to **existing Aina Bosch**; never rely on fuzzy matching. Check that Matemàtiques is added and the omitted Optativa 1 is **retained**, not deleted. Confirm; the issued reports still use their original snapshots. |

If you need a report after steps 3–5, ask the teachers for fresh compatible deliveries (including any newly required subject). Do not treat the supplied step-2 files as current for that later roster.

## Short failure checks

- Before step 2, try `demo_invalid_extra_student_v1.edutrack` and `demo_invalid_missing_student_v1.edutrack`: the import must list the roster differences and write no partial delivery.
- In teacher mode on a separate test database, create a worksheet before Carla joins, then apply step 2. An assessment before **2026-09-17** must be not applicable to Carla; an assessment on/after that date needs a normal grade if she participates. `NP` is a distinct, explicit grade. An undated assessment must be resolved before a complete export. Export as v2 and check that no local numeric student IDs are used as cross-installation identity.
- After step 3, do not delete Biel to “clean up” the roster: a student with historical grades must be protected from manual deletion. Use an official roster update instead.

For an automated rehearsal of the fixtures and history checks, run `npm test`, `npm run typecheck` and `npm run lint` from the project root. The **Delete school information** action is separate and destructive; do not use it during this walkthrough.
