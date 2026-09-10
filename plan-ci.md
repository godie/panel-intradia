# Plan por fases para optimizar GitHub Actions

## Objetivo

Diseñar e introducir una base de CI reproducible, rápida y segura para
`godie/panel-intradia`, sin cambiar el comportamiento de la aplicación. El
flujo deberá validar los cambios relevantes con Bun, mantener una señal clara
en los pull requests y dejar preparado el repositorio para ampliar la
automatización sin duplicar trabajo.

Este documento conserva el historial de las decisiones y entregables de cada
fase. Las Fases 1 a 6 están completadas; la Fase 7 queda planificada y no se
implementa en este documento.

## Estado actual

- El repositorio no tiene workflows en `.github/workflows/`.
- El proyecto usa Bun, Next.js, TypeScript, ESLint y Vitest.
- La rama de trabajo de esta iniciativa parte de `origin/main`.
- La aplicación incluye la app Next.js y dos mini-servicios Bun que pueden
  requerir validaciones diferenciadas.
- La validación local prevista por el proyecto es `bun run lint` y `bun test`
  (o `bun run test`).
- Las Fases 1 a 5 se implementaron y se validaron en pull requests separados.
- La Fase 6 se cerró con protección de `main`, checks obligatorios y este
  runbook de mantenimiento.

## Reglas de ramas y worktrees

1. Mantener `main` como rama de integración y usar `origin/main` como base
   actualizada antes de iniciar cada fase.
2. Cada fase implementable debe trabajarse en una rama descriptiva separada,
   creada desde `origin/main` o desde la rama de la fase anterior cuando haya
   una dependencia explícita.
3. Cada tarea debe usar un worktree aislado; no se deben editar directamente
   el checkout principal ni compartir cambios sin commit entre worktrees.
4. Antes de comenzar, sincronizar referencias (`git fetch origin`) y confirmar
   que la base elegida coincide con `origin/main`.
5. Mantener commits pequeños y separados por fase o preocupación; no mezclar
   workflows con cambios funcionales de la aplicación.
6. Abrir pull requests hacia `main`, revisar los checks y resolver cualquier
   conflicto actualizando la rama desde la base correspondiente.
7. No hacer `reset --hard`, borrar worktrees ajenos ni ejecutar comandos
   destructivos sobre la base compartida.

## Fases

### Fase 1 — Inventario y contrato de CI (completada)

- Confirmar scripts, versiones, lockfiles, estructura de la aplicación y
  requisitos de los mini-servicios.
- Definir qué checks son obligatorios para todo pull request y cuáles aplican
  solo a rutas concretas.
- Establecer límites de alcance, convenciones de nombres y permisos mínimos.

**Entregables:** matriz de checks, contrato de ejecución y lista de riesgos.

### Fase 2 — Workflow base de calidad (completada)

- Crear el workflow principal para instalar dependencias de forma reproducible.
- Ejecutar lint y tests con la versión de Bun fijada por el proyecto.
- Configurar disparadores para pull requests y ramas de integración, evitando
  ejecuciones duplicadas.

**Entregables:** workflow de calidad, configuración de caché documentada y
primer conjunto de checks requeridos.

### Fase 3 — Validación de build y superficies auxiliares (completada)

- Añadir una validación de build de Next.js separada del job rápido de calidad.
- Determinar si los mini-servicios necesitan jobs propios de instalación,
  type-check o ejecución de sus tests.
- Aplicar filtros de rutas únicamente cuando no oculten cambios que afecten a
  varias superficies.

**Entregables:** workflow o jobs de build, cobertura de mini-servicios y
decisión documentada sobre filtros de rutas.

### Fase 4 — Seguridad, permisos y robustez operativa (completada)

- Aplicar permisos mínimos de `GITHUB_TOKEN` y evitar secretos innecesarios.
- Fijar acciones de terceros a versiones revisables y usar lockfiles.
- Añadir cancelación de ejecuciones obsoletas, timeouts y límites de
  concurrencia adecuados.
- Revisar exposición de logs, variables de entorno y artefactos.

**Entregables:** hardening de workflows, política de permisos y checklist de
seguridad operativa.

### Fase 5 — Rendimiento y experiencia de desarrollo (completada)

- Medir duración y tasa de repetición de los jobs después de la primera
  implementación.
- Optimizar cachés, paralelismo y selección de jobs sin sacrificar cobertura.
- Publicar artefactos de diagnóstico solo cuando aporten valor, con retención
  limitada.
- Alinear nombres de checks, mensajes de error y documentación para facilitar
  el mantenimiento.

**Entregables:** workflow optimizado, métricas comparativas y guía breve de
diagnóstico para fallos de CI.

### Fase 6 — Activación gradual y mantenimiento (completada)

- [x] Activar checks obligatorios en la protección de `main` después de
  observar ejecuciones estables.
- [x] Ejecutar una revisión final de permisos, acciones fijadas, tiempos y
  cobertura.
- [x] Definir propietarios, frecuencia de actualización de acciones y
  procedimiento para cambiar la matriz de versiones.

**Entregables:** reglas de protección actualizadas, runbook de mantenimiento y
revisión de aceptación cerrada.

**Estado de aceptación:** completada. En `main` se exige pull request, al
menos una aprobación, dismissal de revisiones obsoletas y los siete checks
confirmados en ejecuciones exitosas: `Lint`, `Test`, `Production build`,
`Build Docker image`, `Validate Prisma schema`, `Validate order-book` y
`Validate tick-stream`. No existe `CODEOWNERS`, por lo que no se exige su
aprobación específica. La protección no bloquea administradores ni añade
restricciones de usuarios, equipos, historial lineal o conversación.

### Runbook breve de mantenimiento de CI

**Responsables y frecuencia**

- El equipo mantenedor del repositorio revisa CI semanalmente y después de
  cada cambio de workflow, runtime o dependencias.
- Revisar mensualmente las acciones y dependencias, y hacer una revisión
  trimestral de la matriz de checks y de las reglas de `main`.

**Checks obligatorios y revisión rutinaria**

- Mantener como checks requeridos exactamente los siete nombres documentados
  arriba. Si se renombra un job, actualizar primero el workflow, observar una
  ejecución exitosa en un pull request y después reconciliar la protección.
- Confirmar que los workflows conservan permisos mínimos, timeouts,
  cancelación de ejecuciones obsoletas, `--frozen-lockfile` y Bun 1.4.2.
- Revisar duración, tasa de repetición, aciertos de caché y consumo de
  minutos. Investigar tendencias sostenidas, no solo una ejecución lenta.

**Actualizaciones seguras**

- Actualizar acciones de terceros una por una, fijadas a un SHA completo y
  con el comentario de versión revisado. Abrir un pull request y confirmar
  todos los checks antes de fusionar.
- Actualizar Bun de forma explícita en todos los workflows y mini-servicios;
  validar instalación, lint, tests, build, Prisma y ambos servicios antes de
  cambiar la versión protegida.
- Al cambiar cachés, conservar claves que incluyan lockfile, versión de Bun y
  superficie (`prisma`, `order-book`, `tick-stream` cuando aplique). Invalidar
  una caché corrupta cambiando el sufijo de clave, no borrando datos de forma
  indiscriminada.

**Diagnóstico de fallos**

1. Identificar el workflow, job, commit y primer paso fallido; comprobar si
   el fallo es reproducible o transitorio.
2. Comparar la ejecución con la última ejecución exitosa: versión de Bun,
   SHA de acciones, lockfile, rutas activadoras, caché y variables.
3. Reproducir localmente con los comandos del job y revisar logs sin exponer
   secretos. Corregir el origen y volver a ejecutar el pull request.
4. Si el proveedor o runner está degradado, registrar el incidente y no
   relajar checks obligatorios como solución temporal.

**Rollback**

- Para un cambio de workflow o runtime, revertir el pull request que lo
  introdujo y confirmar una ejecución completa en la rama de corrección.
- Para un cambio de protección, guardar primero la respuesta actual de la API,
  restaurar la matriz y opciones anteriores con la API de ramas, y verificar
  inmediatamente `GET /repos/godie/panel-intradia/branches/main/protection`.
- No desactivar la protección completa ni usar `--admin` para eludir checks;
  si una emergencia exige una excepción, documentarla y restaurar las reglas
  en cuanto el incidente termine.

### Fase 7 — Migración de workflows y entorno a Bun 1.4.2

**Objetivo:** actualizar de forma controlada la ejecución de CI y el entorno
del proyecto para usar Bun 1.4.2, manteniendo instalaciones reproducibles y
sin cambiar el comportamiento de la aplicación ni de los mini-servicios.

**Alcance:**

- Ejecutar esta fase en una rama y worktree independientes creados desde
  `origin/main`, con la base sincronizada antes de comenzar.
- Actualizar las referencias de Bun y los comandos de instalación en
  `.github/workflows/ci.yml`, `.github/workflows/build.yml`,
  `.github/workflows/prisma.yml` y `.github/workflows/mini-services.yml`.
- Revisar `package.json` y actualizar `bun.lock` únicamente si la alineación
  con Bun 1.4.2 requiere ajustar `bun-types` u otra resolución directamente
  relacionada.
- No mezclar cambios de workflows con otras fases ni implementar esta
  migración hasta que la Fase 7 haya sido aprobada explícitamente.

**Estrategia de validación:**

- Confirmar que `bun install --frozen-lockfile` funciona en la raíz y en cada
  mini-servicio, sin modificar el lockfile durante la validación.
- Ejecutar `bun run lint`, `bun test` (o `bun run test`) y `bun run build`.
- Ejecutar `bun run prisma generate` y `bun run prisma validate` usando los
  scripts o equivalentes definidos por el proyecto.
- Validar la instalación, type-checks o tests disponibles de
  `mini-services/order-book` y `mini-services/tick-stream`, además de sus
  comandos de arranque o health checks cuando la fase los requiera.
- Comparar los checks con una ejecución de referencia y revisar
  `git diff --check` antes de abrir el pull request.

**Compatibilidad:** Bun 1.4.2 debe ser compatible con Next.js, TypeScript,
Prisma, Vitest, los scripts de `package.json` y ambos mini-servicios. Si
`bun-types` exige cambios incompatibles o aparece una actualización transitiva
no relacionada, detener la fase y documentar la decisión antes de ampliar el
alcance.

**Criterios de aceptación:**

- Todos los workflows afectados declaran o configuran Bun 1.4.2 de forma
  consistente y usan instalaciones reproducibles.
- Pasan `bun install --frozen-lockfile`, lint, tests, build, Prisma
  generate/validate y las validaciones de ambos mini-servicios.
- `package.json` y `bun.lock` solo cambian cuando son necesarios para alinear
  `bun-types` o el entorno con Bun 1.4.2.
- El pull request contiene únicamente los archivos aprobados para esta fase y
  no activa una implementación anticipada de workflows de fases posteriores.
- La fase se revisa y aprueba antes de mezclar cualquier cambio de workflow
  derivado de ella en `main`.

**Rollback:** cerrar o revertir el pull request de la Fase 7 y restaurar los
workflows, `package.json` y `bun.lock` al estado de `origin/main`. No alterar
la base compartida ni aplicar una regeneración destructiva de Prisma como
parte del rollback.

**Riesgos:** cambios de resolución en `bun.lock`, incompatibilidades de
`bun-types` con TypeScript o Prisma, diferencias de comportamiento entre Bun
1.4.2 y la versión previa en los mini-servicios, y fallos de caché o
instalación en runners. Mitigarlos fijando la versión, usando
`--frozen-lockfile`, validando todas las superficies y manteniendo el rollback
limitado a los archivos de esta fase.

## Archivos previstos

La implementación futura podrá añadir o modificar únicamente los archivos
necesarios, previsiblemente:

- `.github/workflows/ci.yml` — lint, tests y checks generales.
- `.github/workflows/build.yml` — build de Next.js y validaciones auxiliares.
- `.github/workflows/prisma.yml` — validaciones de Prisma y generación del
  cliente.
- `.github/workflows/mini-services.yml` — checks de los mini-servicios, si la
  Fase 3 confirma que son necesarios.
- `package.json` — versión, scripts o `bun-types` relacionados con Bun 1.4.2.
- `bun.lock` — solo si la alineación con `bun-types` requiere actualizarlo.
- `.github/dependabot.yml` — actualizaciones controladas de acciones y
  dependencias, si se aprueba en la Fase 4.
- `README.md` o `INSTALL.md` — documentación de uso y diagnóstico de CI, solo
  si la implementación cambia instrucciones para contribuyentes.

Para el cierre de la Fase 6 el único archivo modificado es `plan-ci.md`.
La Fase 7 podrá modificar los workflows y archivos indicados en su propio
alcance, después de aprobación explícita.

## Criterios de aceptación

- Existe un workflow de CI reproducible para los checks acordados, sin jobs
  redundantes ni datos fabricados.
- Pull requests hacia `main` reciben señal de lint, tests y build según la
  matriz aprobada.
- Los comandos usan Bun y respetan los lockfiles del repositorio.
- Los permisos del workflow son mínimos, las acciones están fijadas a
  referencias revisables y los jobs tienen cancelación y timeout razonables.
- Los cambios de app y mini-servicios quedan cubiertos, o existe una decisión
  explícita y justificada sobre su exclusión.
- La duración y el comportamiento de CI se comparan con una ejecución de
  referencia.
- La documentación de mantenimiento permite diagnosticar un fallo sin conocer
  detalles internos del workflow.
- Cada fase queda revisada en un pull request independiente o en un commit
  claramente separado, y ningún workflow se implementa como parte de este
  documento.

## Comandos de validación

Validación local mínima antes de cada pull request:

```bash
git fetch origin
git diff --check origin/main...HEAD
bun install --frozen-lockfile
bun run lint
bun test
```

Validaciones adicionales cuando correspondan a una fase:

```bash
bun run build
bun run prisma generate
bun run prisma validate
cd mini-services/order-book && bun install --frozen-lockfile
cd ../tick-stream && bun install --frozen-lockfile
```

La ejecución de la aplicación o de los mini-servicios se reservará para
pruebas que realmente necesiten procesos vivos; no se debe convertir un
servidor local en un requisito permanente de CI.

## Commits separados

1. `docs: add phased GitHub Actions CI plan` — este documento, sin workflows.
2. `ci: add baseline quality workflow` — implementación de la Fase 2.
3. `ci: validate application and mini-service builds` — implementación de la
   Fase 3.
4. `ci: harden workflow permissions and concurrency` — implementación de la
   Fase 4.
5. `ci: optimize workflow runtime and diagnostics` — implementación de la
   Fase 5.
6. `ci: enable protected checks and maintenance runbook` — cierre de la Fase 6.
7. `docs: add Bun 1.4.2 migration phase` — planificación de la Fase 7, sin
   implementar el upgrade ni modificar workflows.

Cada commit debe poder revisarse y revertirse de forma independiente. Los
mensajes anteriores son propuestas; al crear los commits se conservará la
convención vigente del repositorio si esta exige un prefijo adicional.

## Checklist de seguimiento

- [x] Confirmar inventario de scripts y versiones desde `origin/main`.
- [x] Aprobar la matriz de checks obligatorios y opcionales.
- [x] Crear worktree y rama aislados para cada fase implementable.
- [x] Implementar el workflow base de calidad.
- [x] Añadir y validar el build de Next.js.
- [x] Decidir y cubrir los mini-servicios.
- [x] Revisar permisos, secretos, acciones fijadas, timeouts y concurrencia.
- [x] Medir duración, caché, repetición y tasa de fallos.
- [x] Documentar diagnóstico y mantenimiento.
- [x] Activar protección de `main` solo tras estabilidad comprobada.
- [ ] Crear una rama y worktree independientes desde `origin/main` para la
  Fase 7.
- [ ] Aprobar la Fase 7 antes de mezclar cambios de workflows.
- [ ] Validar Bun 1.4.2 con instalación congelada, lint, tests, build, Prisma
  generate/validate y mini-servicios.
- [ ] Revisar compatibilidad, riesgos y procedimiento de rollback de la
  migración.
- [x] Abrir PR por fase hacia `main`.
- [x] Verificar que cada PR contiene únicamente los archivos de su fase.
- [x] Mantener este plan como referencia y marcar las fases completadas.
