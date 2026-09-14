# EduTrack

[English](README.md) · **Español** · [Català](README.ca.md)

<p align="center">
  <img src="public/app-icon.png" alt="Logo de EduTrack" width="220">
</p>

EduTrack `1.0.0` es una aplicación de escritorio local para la evaluación continua y el seguimiento del alumnado en Educación Secundaria.

El profesorado registra las evaluaciones de cada asignatura y las exporta como archivos `.edutrack`. La tutoría importa esos archivos, completa la hoja de seguimiento más reciente de cada curso y trimestre y genera un PDF por alumno. No se necesita ningún servicio externo: los datos del centro permanecen en el equipo local.

La interfaz está disponible en castellano, catalán, inglés, euskera y gallego. Los nombres de las asignaturas proceden del catálogo del centro y la interfaz nunca los traduce.

## Funcionalidades

- Cursos, trimestres, asignaturas y listas de alumnado configurables.
- Importación de datos del centro desde CSV o JSON, además de logo PNG, JPG, JPEG o WebP.
- Hojas de asignatura con columnas de exámenes y evaluación continua.
- Notas numéricas o con letras, fechas y observaciones para cada evaluación.
- Exportación `.edutrack` validada estrictamente e importación de varios archivos.
- Comparación exacta de listas y confirmación antes de reemplazar entregas duplicadas.
- Asignaturas optativas que pueden aplicarse solo al alumnado que las cursa.
- Última hoja de seguimiento por curso y trimestre, con copia para el siguiente informe.
- Contadores de asignaturas y observaciones de tutoría antes de generar los PDF.
- Un PDF por alumno con todas las asignaturas, notas, fechas, observaciones, observaciones de tutoría, firma de la familia y paginación real.
- Persistencia SQLite local y frontera IPC segura de Electron.

## Rutas de la aplicación

| Área | Finalidad |
| --- | --- |
| `Profesor` | Crear hojas de asignatura, evaluaciones, notas, observaciones y exportaciones `.edutrack`. |
| `Tutor` | Importar entregas, revisar el seguimiento, añadir observaciones y generar PDF. |
| `Configuración` | Cargar el catálogo del centro, listas, logo, perfil e idioma. |
| `Ayuda` | Explicar la preparación, el trabajo del profesorado, la importación y la generación de hojas. |

## Tecnologías

- Electron con proceso principal seguro y puente preload aislado.
- React y TypeScript con Vite.
- SQLite mediante `node:sqlite` de Node.js.
- Generación nativa de PDF mediante `printToPDF` de Electron.
- Vitest para pruebas unitarias y ESLint para comprobaciones estáticas.

## Requisitos

- Node.js `22.5.0` o posterior para `node:sqlite`.
- npm, usando el `package-lock.json` incluido.
- Un sistema de archivos local con permisos de escritura para los datos de la aplicación.

El uso local no requiere variables de entorno, conexión de red, base de datos externa ni backend en Python.

## Instalación

Clona el repositorio, entra en su directorio e instala las dependencias bloqueadas:

```bash
git clone https://github.com/abujalancej/edutrack.git
cd edutrack
npm ci
```

Si trabajas desde una copia existente y quieres que npm actualice deliberadamente el archivo de bloqueo, utiliza `npm install`.

## Desarrollo

Inicia el entorno de desarrollo de Vite y Electron:

```bash
npm run dev
```

La aplicación se abre localmente en Electron. Los cambios del renderizador React y del proceso principal se compilan mediante los observadores de desarrollo.

## Compilación para producción

Crea una compilación de producción:

```bash
npm run build
```

Genera el instalador NSIS x64 para Windows:

```bash
npm run dist:win
```

Genera el instalador DMG para macOS:

```bash
npm run dist:mac
```

El instalador se escribe en `release/`.

## Aplicación de escritorio

EduTrack se distribuye como aplicación de escritorio Electron para macOS, Windows y Linux. El renderizador no tiene integración directa con Node.js; el acceso a archivos y la persistencia se exponen mediante el preload aislado.

La aplicación instalada guarda la base de datos en el directorio por usuario de Electron:

```text
app.getPath('userData')/edutrack.sqlite
```

## Uso

1. Abre **Configuración** y carga los cursos, asignaturas y listas oficiales del centro.
2. Completa el perfil del profesor y elige el idioma de la interfaz.
3. En **Profesor**, crea una hoja para un curso, trimestre y asignatura; añade evaluaciones, notas y observaciones; después exporta el archivo `.edutrack`.
4. Envía el archivo exportado al tutor. Puedes importar varios archivos de asignatura a la vez.
5. En **Tutor**, valida los archivos con la lista oficial e importa las entregas correctas. Las importaciones siempre actualizan la hoja de seguimiento más reciente del mismo curso y trimestre.
6. Añade las observaciones de tutoría. La hoja solo está lista cuando se han recibido todas las asignaturas configuradas; una optativa puede no tener nota para quien no la cursa.
7. Genera un PDF localizado e independiente para cada alumno cuando la hoja esté completa.

La carpeta `examples/` contiene cuatro entregas de asignaturas de profesores diferentes y un catálogo de cuatro cursos para probar el flujo completo.

## Almacenamiento de datos

EduTrack **no** utiliza una base de datos remota. Su almacenamiento persistente local es:

```text
app.getPath('userData')/edutrack.sqlite
```

La base de datos contiene el perfil, idioma, catálogo, listas, hojas de asignatura, entregas importadas, hojas de seguimiento y observaciones de tutoría. Los datos reales del centro quedan fuera del repositorio y del paquete de la aplicación.

### Consideraciones importantes sobre el almacenamiento

- Haz una copia de seguridad de `edutrack.sqlite` antes de borrar los datos del centro o reinstalar la aplicación.
- `examples/` contiene únicamente datos ficticios; no añadas información real del alumnado a Git.
- Las importaciones se validan antes de escribirse y las entregas duplicadas requieren confirmación explícita.
- La aplicación está pensada para una instalación privada de escritorio con un único usuario.
- No expongas públicamente el directorio de datos: puede contener información personal del alumnado.

## Modelo de datos

Las exportaciones del profesorado usan un documento JSON versionado:

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

Cada alumno guarda valores y observaciones de sus evaluaciones. La tutoría añade observaciones a la hoja correspondiente; los nombres, identificadores de curso y trimestre y la lista de alumnos deben coincidir con el catálogo configurado.

## Cálculos del seguimiento

EduTrack calcula si una hoja está lista a partir del catálogo configurado, no del número de archivos seleccionados:

```text
asignaturas recibidas = asignaturas importadas distintas del curso y trimestre
asignaturas pendientes = asignaturas configuradas - asignaturas recibidas
comentarios registrados = alumnos con una observación de tutoría
lista para generar      = se han recibido todas las asignaturas configuradas
```

Las optativas siguen siendo asignaturas normales del catálogo. Su cobertura puede ser menor que la lista oficial, por lo que quien no la cursa no se considera pendiente de nota.

## API

El renderizador se comunica con el proceso principal de Electron mediante la API IPC aislada `fullSeguiment`.

| Grupo | Operaciones |
| --- | --- |
| Estado y perfil | Cargar estado, guardar idioma y guardar perfil del profesor. |
| Configuración | Importar o borrar datos del centro, cursos, asignaturas y logo. |
| Alumnado | Añadir, editar, borrar, ordenar, importar y sustituir listas. |
| Hojas de asignatura | Crear, editar, borrar, evaluar, guardar celdas y exportar `.edutrack`. |
| Importaciones de tutoría | Seleccionar, validar, importar, inspeccionar, reemplazar y borrar entregas. |
| Hojas de seguimiento | Guardar observaciones, copiar la última hoja, generar PDF y borrar hojas. |

## Estructura del proyecto

```text
edutrack/
├── assets/                    # Recursos de marca originales
├── build/                     # Iconos de Electron
├── examples/                  # Catálogos y archivos .edutrack ficticios
├── public/                    # Recursos públicos de la aplicación
├── scripts/                   # Ayudas de desarrollo y Electron
├── src/
│   ├── main/                  # SQLite, validación, importación/exportación, PDF e IPC
│   ├── preload/               # Puente aislado del renderizador
│   ├── renderer/              # Aplicación React, estilos y traducciones
│   └── shared/                # Catálogos y contratos TypeScript compartidos
├── README.md                  # Documentación en inglés
├── README.es.md               # Documentación en castellano
└── README.ca.md               # Documentación en catalán
```

## Scripts disponibles

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia Vite, el observador de TypeScript y Electron. |
| `npm run typecheck` | Comprueba TypeScript para el renderizador y el proceso principal. |
| `npm run lint` | Ejecuta ESLint. |
| `npm test` | Ejecuta la suite de Vitest. |
| `npm run build` | Crea la compilación de producción del renderizador y Electron. |
| `npm run dist:win` | Genera el instalador NSIS x64 de Windows. |
| `npm run dist:mac` | Genera el instalador DMG de macOS. |

## Validación

Antes de confirmar cambios, ejecuta:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
