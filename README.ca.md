# EduTrack

[English](README.md) · [Español](README.es.md) · **Català**

<p align="center">
  <img src="public/app-icon.png" alt="Logo d'EduTrack" width="220">
</p>

EduTrack `1.1.0` és una aplicació d'escriptori local per a l'avaluació contínua i el seguiment de l'alumnat d'Educació Secundària.

El professorat registra les avaluacions de cada assignatura i les exporta com a fitxers `.edutrack`. La tutoria importa aquests fitxers, completa el full de seguiment més recent de cada curs i trimestre i genera un PDF per alumne. No cal cap servei extern: les dades del centre es mantenen a l'equip local.

La interfície està disponible en castellà, català, anglès, basc i gallec. Els noms de les assignatures provenen del catàleg del centre i la interfície no els tradueix mai.

## Funcionalitats

- Cursos, trimestres, assignatures i llistes d'alumnat configurables.
- Importació de dades del centre des de CSV o JSON, i logo PNG, JPG, JPEG o WebP.
- Fulls d'assignatura amb columnes d'exàmens i avaluació contínua.
- Notes numèriques o amb lletres, dates i observacions per a cada avaluació.
- Exportació `.edutrack` validada estrictament i importació de diversos fitxers.
- Comparació exacta de llistes i confirmació abans de substituir lliuraments duplicats.
- Assignatures optatives que poden aplicar-se només a l'alumnat que les cursa.
- Últim full de seguiment per curs i trimestre, amb còpia per al full següent.
- Comptadors d'assignatures i observacions de tutoria abans de generar els PDF.
- Un PDF per alumne amb totes les assignatures, notes, dates, observacions, observacions de tutoria, signatura de la família i paginació real.
- Persistència SQLite local i frontera IPC segura d'Electron.

## Rutes de l'aplicació

| Àrea | Finalitat |
| --- | --- |
| `Professor` | Crear fulls d'assignatura, avaluacions, notes, observacions i exportacions `.edutrack`. |
| `Tutor` | Importar lliuraments, revisar el seguiment, afegir observacions i generar PDF. |
| `Configuració` | Carregar el catàleg del centre, llistes, logo, perfil i idioma. |
| `Ajuda` | Explicar la preparació, la feina del professorat, la importació i la generació de fulls. |

## Tecnologies

- Electron amb procés principal segur i pont preload aïllat.
- React i TypeScript amb Vite.
- SQLite mitjançant `node:sqlite` de Node.js.
- Generació nativa de PDF mitjançant `printToPDF` d'Electron.
- Vitest per a proves unitàries i ESLint per a comprovacions estàtiques.

## Requisits

- Node.js `22.5.0` o posterior per a `node:sqlite`.
- npm, amb el `package-lock.json` inclòs.
- Un sistema de fitxers local amb permisos d'escriptura per a les dades de l'aplicació.

L'ús local no requereix variables d'entorn, connexió de xarxa, base de dades externa ni backend en Python.

## Instal·lació

Clona el repositori, entra al seu directori i instal·la les dependències bloquejades:

```bash
git clone https://github.com/abujalancej/edutrack.git
cd edutrack
npm ci
```

Si treballes des d'una còpia existent i vols que npm actualitzi deliberadament el fitxer de bloqueig, fes servir `npm install`.

## Desenvolupament

Inicia l'entorn de desenvolupament de Vite i Electron:

```bash
npm run dev
```

L'aplicació s'obre localment a Electron. Els canvis del renderitzador React i del procés principal es compilen mitjançant els observadors de desenvolupament.

## Compilació per a producció

Crea una compilació de producció:

```bash
npm run build
```

Genera l'instal·lador NSIS x64 per a Windows:

```bash
npm run dist:win
```

L'instal·lador s'escriu a `release/`.

## Aplicació d'escriptori

EduTrack es distribueix com a aplicació d'escriptori Electron per a macOS, Windows i Linux. El renderitzador no té integració directa amb Node.js; l'accés als fitxers i la persistència s'exposen mitjançant el preload aïllat.

L'aplicació instal·lada desa la base de dades al directori per usuari d'Electron:

```text
app.getPath('userData')/edutrack.sqlite
```

## Ús

1. Obre **Configuració** i carrega els cursos, les assignatures i les llistes oficials del centre.
2. Completa el perfil del professor i tria l'idioma de la interfície.
3. A **Professor**, crea un full per a un curs, trimestre i assignatura; afegeix avaluacions, notes i observacions; després exporta el fitxer `.edutrack`.
4. Envia el fitxer exportat al tutor. Pots importar diversos fitxers d'assignatura alhora.
5. A **Tutor**, valida els fitxers amb la llista oficial i importa els lliuraments correctes. Les importacions sempre actualitzen el full de seguiment més recent del mateix curs i trimestre.
6. Afegeix les observacions de tutoria. El full només està llest quan s'han rebut totes les assignatures configurades; una optativa pot no tenir nota per a qui no la cursa.
7. Genera un PDF localitzat i independent per a cada alumne quan el full estigui complet.

La carpeta `examples/` conté quatre lliuraments d'assignatures de professors diferents i un catàleg de quatre cursos per provar tot el flux.

## Emmagatzematge de dades

EduTrack **no** utilitza cap base de dades remota. El seu emmagatzematge persistent local és:

```text
app.getPath('userData')/edutrack.sqlite
```

La base de dades conté el perfil, l'idioma, el catàleg, les llistes, els fulls d'assignatura, els lliuraments importats, els fulls de seguiment i les observacions de tutoria. Les dades reals del centre queden fora del repositori i del paquet de l'aplicació.

### Consideracions importants sobre l'emmagatzematge

- Fes una còpia de seguretat d'`edutrack.sqlite` abans d'esborrar les dades del centre o reinstal·lar l'aplicació.
- `examples/` només conté dades fictícies; no afegeixis informació real de l'alumnat a Git.
- Els fitxers importats es validen abans d'escriure's i els lliuraments duplicats requereixen confirmació explícita.
- L'aplicació està pensada per a una instal·lació privada d'escriptori amb un únic usuari.
- No exposis públicament el directori de dades: pot contenir informació personal de l'alumnat.

## Model de dades

Les exportacions del professorat utilitzen un document JSON versionat:

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

Cada alumne desa els valors i les observacions de les seves avaluacions. La tutoria afegeix observacions al full corresponent; els noms, els identificadors de curs i trimestre i la llista d'alumnes han de coincidir amb el catàleg configurat.

## Càlculs del seguiment

EduTrack calcula si un full està llest a partir del catàleg configurat, no del nombre de fitxers seleccionats:

```text
assignatures rebudes = assignatures importades diferents del curs i trimestre
assignatures pendents = assignatures configurades - assignatures rebudes
comentaris registrats = alumnes amb una observació de tutoria
llest per generar      = s'han rebut totes les assignatures configurades
```

Les optatives continuen sent assignatures normals del catàleg. La seva cobertura pot ser menor que la llista oficial, de manera que qui no la cursa no es considera pendent de nota.

## API

El renderitzador es comunica amb el procés principal d'Electron mitjançant l'API IPC aïllada `fullSeguiment`.

| Grup | Operacions |
| --- | --- |
| Estat i perfil | Carregar l'estat, desar l'idioma i desar el perfil del professor. |
| Configuració | Importar o esborrar dades del centre, cursos, assignatures i logo. |
| Alumnat | Afegir, editar, esborrar, ordenar, importar i substituir llistes. |
| Fulls d'assignatura | Crear, editar, esborrar, avaluar, desar cel·les i exportar `.edutrack`. |
| Importacions de tutoria | Seleccionar, validar, importar, inspeccionar, substituir i esborrar lliuraments. |
| Fulls de seguiment | Desar observacions, copiar l'últim full, generar PDF i esborrar fulls. |

## Estructura del projecte

```text
edutrack/
├── assets/                    # Recursos de marca originals
├── build/                     # Icones d'Electron
├── examples/                  # Catàlegs i fitxers .edutrack ficticis
├── public/                    # Recursos públics de l'aplicació
├── scripts/                   # Ajudes de desenvolupament i Electron
├── src/
│   ├── main/                  # SQLite, validació, importació/exportació, PDF i IPC
│   ├── preload/               # Pont aïllat del renderitzador
│   ├── renderer/              # Aplicació React, estils i traduccions
│   └── shared/                # Catàlegs i contractes TypeScript compartits
├── README.md                  # Documentació en anglès
├── README.es.md               # Documentació en castellà
└── README.ca.md               # Documentació en català
```

## Scripts disponibles

| Ordre | Descripció |
| --- | --- |
| `npm run dev` | Inicia Vite, l'observador de TypeScript i Electron. |
| `npm run typecheck` | Comprova TypeScript per al renderitzador i el procés principal. |
| `npm run lint` | Executa ESLint. |
| `npm test` | Executa la suite de Vitest. |
| `npm run build` | Crea la compilació de producció del renderitzador i Electron. |
| `npm run dist:win` | Genera l'instal·lador NSIS x64 de Windows. |

## Validació

Abans de confirmar canvis, executa:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
