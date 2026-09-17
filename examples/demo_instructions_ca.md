# Demostració d'EduTrack: actualitzar el llistat d'alumnes sense perdre l'historial

Feu servir una **base de dades de prova**, mai les dades reals del centre. Tots els noms i les notes són ficticis. Les dates del guió (del 17 al 20 de setembre de 2026) són dates simulades, no instruccions per modificar matrícules reals. Reserveu 15–20 minuts per al recorregut principal; la comprovació del professorat és opcional.

## Fitxers, per ordre

| Pas | Fitxer oficial del centre | Lliuraments del professorat de 1r ESO, 1r trimestre |
| --- | --- | --- |
| 1. Llistat inicial | `demo_01_school_initial_roster.json` | `demo_01_Catala_v1.edutrack`, `demo_01_Angles_v1.edutrack`, `demo_01_Optativa-1_v1.edutrack`, `demo_01_Optativa-2_v1.edutrack` |
| 2. La Carla s'incorpora a 1r ESO | `demo_02_school_carla_joins_eso1.json` | `demo_02_Catala_v2.edutrack`, `demo_02_Angles_v2.edutrack`, `demo_02_Optativa-1_v2.edutrack`, `demo_02_Optativa-2_v2.edutrack` |
| 3. En Biel marxa | `demo_03_school_biel_leaves_eso1.json` | No es proporcionen lliuraments nous |
| 4. En Biel torna | `demo_04_school_biel_returns_eso1.json` | No es proporcionen lliuraments nous |
| 5. Canvien el nom de l'Aina i les assignatures | `demo_05_school_aina_renamed_subjects_changed_eso1.json` | No es proporcionen lliuraments nous |

Els lliuraments v2 simulen fitxers exportats *després* de l'alta de la Carla. En un cas real, cada docent actualitza el seu llistat i exporta un fitxer nou. No reutilitzeu els fitxers v1 del pas 1 després del pas 2.

## Recorregut principal (tutoria)

1. **Importeu les dades inicials del centre.** Configureu un perfil de tutor de prova i carregueu el JSON del pas 1 a Configuració. Comproveu que a 1r ESO hi ha l'Aina Bosch i en Biel Casas. La Carla Costa ja figura a 2n ESO: això no estableix cap identitat compartida amb l'alumnat de 1r ESO.
2. **Importeu i emeteu l'informe 1.** Importeu els quatre lliuraments v1 del pas 1. Comproveu que hi ha les quatre assignatures i que les optatives 1 i 2 tenen participants diferents. Exporteu el PDF del primer trimestre i deseu-lo per comparar-lo. Les notes numèriques de les optatives han d'aparèixer en lletres en un informe final configurat en mode lletres, amb el color vermell o verd corresponent i una llegenda d'abreviatures en una sola línia.
3. **Previsualitzeu sense desar.** Carregueu el JSON del pas 2. La vista prèvia ha de mostrar la Carla com a alta a 1r ESO, sense canvis en la resta d'alumnes ni d'assignatures, i ha d'indicar que es conserven els fulls i els informes anteriors. Premeu **Cancel·la** i comproveu que la Carla no s'ha afegit i que l'informe 1 no ha canviat.
4. **Apliqueu l'alta.** Torneu a carregar el pas 2, trieu **persona nova** per a la Carla de 1r ESO, indiqueu la data efectiva **2026-09-17** i confirmeu. No la vinculeu a la Carla de 2n ESO. Torneu a exportar l'informe 1: el llistat, els noms, les notes i les observacions han de coincidir amb la versió emesa.
5. **Mostreu els lliuraments desactualitzats.** Copieu l'informe 1 per crear l'informe 2. Els quatre lliuraments copiats han de quedar marcats com a desactualitzats; l'informe 2 no pot constar com a complet. Proveu d'importar un lliurament v1 antic: ha d'indicar que hi falta la Carla i demanar una exportació actualitzada, sense descartar alumnes ni inventar notes.
6. **Importeu els lliuraments actuals i emeteu l'informe 2.** Substituïu els quatre lliuraments pels fitxers `demo_02_*_v2.edutrack`. L'informe 2 ha d'incloure l'Aina, en Biel i la Carla. Les avaluacions de la Carla del 7 al 16 de setembre són **no aplicables** (no són NP, un suspens ni una nota pendent); les activitats del 17 de setembre sí que tenen nota. La Carla cursa l'Optativa 2, no l'Optativa 1. Exporteu l'informe 2 i torneu a exportar l'informe 1 per comprovar que no ha canviat.
7. **Comproveu la idempotència.** Carregueu dues vegades més el JSON del pas 2. No s'ha de crear cap altra Carla ni duplicar assignatures o informes.

## Altres casos de llistat i catàleg

Continueu a la **mateixa base de dades de prova**, en aquest ordre. Aquests passos mostren l'historial i la vista prèvia; no es proporcionen lliuraments compatibles per emetre un informe nou després del pas 2.

| Carregueu | Data efectiva | Acció i resultat esperat |
| --- | --- | --- |
| Pas 3 | 2026-09-18 | Previsualitzeu en Biel Casas com a baixa i confirmeu-la. Desapareix del llistat vigent, però es conserven les seves notes anteriors i els dos informes emesos. |
| Pas 4 | 2026-09-19 | Previsualitzeu en Biel Casas com a alta. Seleccioneu explícitament **el Biel Casas existent** com a alumne que torna, no «persona nova». Confirmeu i comproveu que conserva l'historial anterior. |
| Pas 5 | 2026-09-20 | Previsualitzeu la baixa d'Aina Bosch i l'alta d'Aina Maria Bosch. Vinculeu manualment el nom nou a **l'Aina Bosch existent**; no feu servir coincidències aproximades. Comproveu que s'afegeix Matemàtiques i que l'Optativa 1, absent del fitxer nou, **es conserva**. Confirmeu i comproveu que els informes emesos continuen fent servir les instantànies originals. |

Si necessiteu un informe després dels passos 3–5, demaneu lliuraments nous i compatibles al professorat (inclosa qualsevol assignatura nova necessària). Els fitxers del pas 2 ja no representen aquest llistat posterior.

## Comprovacions breus d'errors

- Abans del pas 2, proveu `demo_invalid_extra_student_v1.edutrack` i `demo_invalid_missing_student_v1.edutrack`: la importació ha d'enumerar les diferències del llistat i no ha de desar cap lliurament parcial.
- En mode professor i en una altra base de dades de prova, creeu un full abans de l'alta de la Carla i apliqueu el pas 2. Una avaluació anterior al **2026-09-17** ha de ser no aplicable per a ella; una avaluació d'aquell dia o posterior necessita una nota normal si hi participa. `NP` és una nota explícita i diferent. Cal resoldre una avaluació sense data abans d'exportar un full complet. Exporteu en v2 i comproveu que els identificadors numèrics locals dels alumnes no s'utilitzen com a identitat compartida entre instal·lacions.
- Després del pas 3, no esborreu en Biel per «netejar» el llistat: s'ha de protegir contra l'esborrament manual un alumne amb notes històriques. Feu servir una actualització del llistat oficial.

Per executar automàticament les proves dels fitxers i de l'historial, feu `npm test`, `npm run typecheck` i `npm run lint` des de l'arrel del projecte. L'acció **Esborrar informació del centre** és independent i destructiva; no la feu servir durant aquesta demostració.
