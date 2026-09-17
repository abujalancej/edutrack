# Demo de EduTrack: actualizar el alumnado sin perder el historial

Usad una **base de datos de prueba**, nunca los datos reales del centro. Todos los nombres y las notas son ficticios. Las fechas del guion (del 17 al 20 de septiembre de 2026) son fechas simuladas, no instrucciones para modificar matrículas reales. Reservad 15–20 minutos para el recorrido principal; la comprobación del profesorado es opcional.

## Archivos, por orden

| Paso | Archivo oficial del centro | Entregas del profesorado de 1.º de ESO, primer trimestre |
| --- | --- | --- |
| 1. Listado inicial | `demo_01_school_initial_roster.json` | `demo_01_Catala_v1.edutrack`, `demo_01_Angles_v1.edutrack`, `demo_01_Optativa-1_v1.edutrack`, `demo_01_Optativa-2_v1.edutrack` |
| 2. Carla se incorpora a 1.º de ESO | `demo_02_school_carla_joins_eso1.json` | `demo_02_Catala_v2.edutrack`, `demo_02_Angles_v2.edutrack`, `demo_02_Optativa-1_v2.edutrack`, `demo_02_Optativa-2_v2.edutrack` |
| 3. Biel causa baja | `demo_03_school_biel_leaves_eso1.json` | No se incluyen entregas nuevas |
| 4. Biel regresa | `demo_04_school_biel_returns_eso1.json` | No se incluyen entregas nuevas |
| 5. Cambian el nombre de Aina y las asignaturas | `demo_05_school_aina_renamed_subjects_changed_eso1.json` | No se incluyen entregas nuevas |

Las entregas v2 simulan archivos exportados *después* del alta de Carla. En un caso real, cada docente actualiza su listado y exporta un archivo nuevo. No reutilicéis los archivos v1 del paso 1 después del paso 2.

## Recorrido principal (tutoría)

1. **Importad los datos iniciales del centro.** Configurad un perfil de tutor de prueba y cargad el JSON del paso 1 en Configuración. Comprobad que en 1.º de ESO están Aina Bosch y Biel Casas. Carla Costa ya figura en 2.º de ESO: eso no establece una identidad compartida con el alumnado de 1.º.
2. **Importad y emitid el informe 1.** Importad las cuatro entregas v1 del paso 1. Comprobad que aparecen las cuatro asignaturas y que las optativas 1 y 2 tienen participantes distintos. Exportad el PDF del primer trimestre y guardadlo para compararlo. Las notas numéricas de las optativas deben aparecer como letras en un informe final configurado en modo letras, con el color rojo o verde correspondiente y una leyenda de abreviaturas en una sola línea.
3. **Previsualizad sin guardar.** Cargad el JSON del paso 2. La vista previa debe mostrar a Carla como alta en 1.º de ESO, sin cambios en el resto del alumnado ni de las asignaturas, e indicar que se conservan las hojas y los informes anteriores. Pulsad **Cancelar** y comprobad que Carla no se ha añadido y que el informe 1 sigue igual.
4. **Aplicad el alta.** Cargad de nuevo el paso 2, elegid **persona nueva** para Carla de 1.º de ESO, indicad como fecha efectiva **2026-09-17** y confirmad. No la vinculéis con Carla de 2.º de ESO. Volved a exportar el informe 1: el listado, los nombres, las notas y las observaciones deben coincidir con la versión emitida.
5. **Mostrad las entregas desactualizadas.** Copiad el informe 1 para crear el informe 2. Las cuatro entregas copiadas deben marcarse como desactualizadas; el informe 2 no puede figurar como completo. Intentad importar una entrega v1 antigua: debe indicar que falta Carla y pedir una exportación actualizada, sin descartar alumnos ni inventar notas.
6. **Importad las entregas actuales y emitid el informe 2.** Sustituid las cuatro entregas por los archivos `demo_02_*_v2.edutrack`. El informe 2 debe incluir a Aina, Biel y Carla. Las evaluaciones de Carla del 7 al 16 de septiembre son **no aplicables** (no son NP, un suspenso ni una nota pendiente); las actividades del 17 de septiembre sí tienen nota. Carla cursa Optativa 2, no Optativa 1. Exportad el informe 2 y volved a exportar el informe 1 para comprobar que no ha cambiado.
7. **Comprobad la idempotencia.** Cargad dos veces más el JSON del paso 2. No debe crearse otra Carla ni duplicarse asignaturas o informes.

## Más casos de listado y catálogo

Continuad en la **misma base de datos de prueba**, en este orden. Estos pasos muestran el historial y la vista previa; no se incluyen entregas compatibles para emitir otro informe después del paso 2.

| Cargad | Fecha efectiva | Acción y resultado esperado |
| --- | --- | --- |
| Paso 3 | 2026-09-18 | Previsualizad a Biel Casas como baja y confirmadla. Deja de aparecer en el listado vigente, pero se conservan sus notas anteriores y los dos informes emitidos. |
| Paso 4 | 2026-09-19 | Previsualizad a Biel Casas como alta. Seleccionad explícitamente **al Biel Casas existente** como alumno que regresa, no «persona nueva». Confirmad y comprobad que conserva su historial anterior. |
| Paso 5 | 2026-09-20 | Previsualizad la baja de Aina Bosch y el alta de Aina Maria Bosch. Vinculad manualmente el nombre nuevo con **la Aina Bosch existente**; no uséis coincidencias aproximadas. Comprobad que se añade Matemàtiques y que Optativa 1, ausente del archivo nuevo, **se conserva**. Confirmad y comprobad que los informes emitidos siguen usando sus instantáneas originales. |

Si necesitáis un informe después de los pasos 3–5, pedid al profesorado entregas nuevas y compatibles (incluida cualquier asignatura nueva necesaria). Los archivos del paso 2 ya no representan ese listado posterior.

## Comprobaciones breves de errores

- Antes del paso 2, probad `demo_invalid_extra_student_v1.edutrack` y `demo_invalid_missing_student_v1.edutrack`: la importación debe enumerar las diferencias del listado y no guardar ninguna entrega parcial.
- En modo profesor y en otra base de datos de prueba, cread una hoja antes del alta de Carla y aplicad el paso 2. Una evaluación anterior al **2026-09-17** debe ser no aplicable para ella; una evaluación de ese día o posterior necesita una nota normal si participa. `NP` es una nota explícita y distinta. Es necesario resolver una evaluación sin fecha antes de exportar una hoja completa. Exportad en v2 y comprobad que los ID numéricos locales de los alumnos no se usan como identidad compartida entre instalaciones.
- Después del paso 3, no borréis a Biel para «limpiar» el listado: un alumno con notas históricas debe estar protegido frente al borrado manual. Usad una actualización del listado oficial.

Para ejecutar automáticamente las pruebas de los archivos y del historial, lanzad `npm test`, `npm run typecheck` y `npm run lint` desde la raíz del proyecto. La acción **Borrar información del centro** es independiente y destructiva; no la uséis durante esta demo.
