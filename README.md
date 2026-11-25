# Vértice
Plataforma SaaS de optimización financiera que maximiza el rendimiento de portafolios de inversión bajo estrictos límites de riesgo y regulación.

## Autenticación y datos privados

La aplicación usa sesiones de Django y protección CSRF. Crea una cuenta desde
la pantalla inicial o inicia sesión; los problemas nuevos se asignan a la
cuenta autenticada y la API solo lista, consulta y resuelve los problemas de
esa cuenta. Las cuentas se pueden administrar también desde Django Admin.

Los problemas existentes antes de esta actualización conservan sus datos, pero
quedan sin propietario y no aparecen para usuarios normales. Un administrador
puede asignarles un propietario desde Django Admin.

## Ejecución local

Desde PowerShell en la raíz del repositorio:

```powershell
npm ci
npm run build
docker compose up -d redis
cd backend
$env:DJANGO_DEBUG = "true"
..\.venv\Scripts\python.exe manage.py migrate
```

`DEBUG` está desactivado por defecto para que un despliegue sin configurar
falle de forma segura. `manage.py runserver` y `manage.py test` lo activan
solos; para los demás comandos y el worker define `DJANGO_DEBUG=true` en la
terminal de desarrollo.

En una terminal, inicia el worker de Celery:

```powershell
cd backend
$env:DJANGO_DEBUG = "true"
..\.venv\Scripts\celery.exe -A config worker --pool=solo --loglevel=info
```

En otra terminal, inicia Django:

```powershell
cd backend
..\.venv\Scripts\python.exe manage.py runserver
```

La interfaz existente sigue servida por Django; Vite compila las nuevas islas
React en `frontend/react-build`, que Django sirve como archivos estáticos. Al
incorporar componentes React nuevos, ejecuta `npm run build` antes de iniciar
Django. Abre `http://127.0.0.1:8000` para registrarte o iniciar sesión. En desarrollo,
los mensajes de verificación y recuperación se imprimen en la consola del
servidor.

Las optimizaciones y las fronteras eficientes se guardan como trabajos y la
interfaz consulta su estado mientras Celery las procesa. Redis sirve de broker;
los estados y resultados permanecen en la base de datos. Para pruebas locales
sin Redis, define `CELERY_TASK_ALWAYS_EAGER=true`; ese modo ejecuta la tarea
dentro del proceso web y no debe usarse como cola de producción. En Windows,
usa `--pool=solo` para el worker local.

## Asistente de modelos con Azure OpenAI

El asistente convierte texto en un borrador de modelo; no crea ni ejecuta el
modelo automáticamente. Para habilitarlo:

1. Despliega un modelo compatible con salida JSON. Para un deployment de
   Microsoft Foundry, copia el punto de conexión que termina en
   `/openai/v1/responses` y el nombre exacto de la implementación.
2. En desarrollo local, ejecuta `az login` con una cuenta que tenga el rol
   **Cognitive Services OpenAI User** en el recurso.
3. En PowerShell, configura el endpoint y deployment en la misma terminal desde
   la que iniciarás Django:

   ```powershell
   $env:AZURE_OPENAI_ENDPOINT = "https://<recurso>.services.ai.azure.com/openai/v1/responses"
   $env:AZURE_OPENAI_DEPLOYMENT = "<nombre-exacto-del-deployment>"
   ```

   Para el endpoint clásico `https://<recurso>.openai.azure.com`, el servicio
   conserva compatibilidad con Chat Completions y requiere
   `AZURE_OPENAI_API_VERSION` (predeterminado: `2024-10-21`).
   Luego inicia Django como en la sección de ejecución local. Si el servidor ya
   estaba corriendo, reinícialo para que lea la configuración.

En producción dentro de Azure, asigna una identidad administrada a la
aplicación y otórgale el rol **Cognitive Services OpenAI User** sobre el
recurso. Configura las mismas variables `AZURE_OPENAI_*` en el entorno del
servicio; con `DEBUG=false` se usa la identidad administrada, sin guardar una
clave de Azure.

Fuera de Azure (por ejemplo, con Docker en otro proveedor) no existe identidad
administrada: define además `AZURE_OPENAI_API_KEY` con una clave del recurso
(Azure Portal → tu recurso → *Keys and Endpoint*) en `.env`. Si la variable
tiene valor, el asistente envía la clave en el encabezado `api-key` en lugar de
pedir un token. Guárdala solo en `.env` o en el gestor de secretos del
servidor, nunca en el repositorio, y rótala desde Azure si se expone. El asistente
envía a Azure OpenAI el texto escrito por la persona, no almacena ese texto y
requiere una acción explícita para generar. El borrador debe revisarse antes
de guardarse o resolverlo. El límite inicial es de 5 consultas de IA por
usuario por hora y se puede ajustar mediante `AI_MODELING_LIMIT`.

### Conversación para ajustar el modelo

Con el editor de modelos abierto, **Ajustar el borrador conversando** permite
pedir cambios en lenguaje natural («agrega una restricción de 40 horas»,
«cambia x a entera»). El asistente aplica solo lo pedido y conserva el resto;
si falta un dato pregunta en lugar de suponerlo. El modelo propuesto se valida
con las mismas reglas que al guardar antes de cargarse en el editor, y
**Deshacer último cambio** recupera la versión anterior. Nada se guarda hasta
pulsar «Crear».

- La conversación no se almacena: el navegador envía el borrador actual y
  los últimos 10 mensajes en cada consulta.
- Cada mensaje consume una consulta de la cuota mensual de IA. Tiene su
  propio límite por hora (`AI_CHAT_LIMIT`, 30 por defecto), más amplio que el
  de los borradores.

### Borradores de portafolio

En el panel de portafolios, **Crear portafolio con IA a partir de una
descripción** convierte un texto como «Bonos con rendimiento esperado de 6 % y
volatilidad de 5 %; Acciones con 10 % y 20 %; correlación 0,3» en un borrador
que se carga en el formulario para revisarlo antes de guardarlo.

- La IA solo **transcribe** los números escritos: no usa datos de mercado, no
  completa valores ni recomienda activos. Si falta un rendimiento o el riesgo
  (covarianza, o volatilidades con correlaciones o la indicación explícita de
  que no están correlacionados), responde qué falta en lugar de inventarlo.
- La app hace todas las cuentas de forma determinista: convierte porcentajes
  a fracciones y calcula la covarianza (σᵢ·σⱼ·ρᵢⱼ). El borrador se valida con
  las mismas reglas que un portafolio guardado (matriz simétrica y positiva
  semidefinida, límites de pesos y del plan) y lista los supuestos usados,
  por ejemplo la aversión al riesgo por defecto.
- Cada generación consume una consulta de la cuota mensual de IA.

### Explicación de resultados

Después de resolver un modelo u optimizar un portafolio, el botón **Explicar
con IA** resume en lenguaje sencillo el resultado. La app calcula los datos y
la IA solo los redacta, sin agregar cifras:

- **Modelos:** al resolver se guardan la holgura de cada restricción, si está
  activa y, en modelos solo continuos, su precio sombra (cuánto cambia el
  objetivo por cada unidad adicional del lado derecho). Si el modelo es
  infactible o no acotado, la explicación indica qué revisar.
- **Portafolios:** peso y riesgo por activo, concentración, límites activos y
  escenarios de estrés. Las instrucciones prohíben recomendar comprar, vender
  o mantener activos: no es asesoría financiera.

Cada explicación se guarda con su ejecución: volver a abrirla no consulta ni
cobra de nuevo. Generar borradores y explicaciones consume la cuota mensual de
IA del plan (ver Planes y precios).

## Planes y precios

Cada cuenta tiene un plan y la API aplica sus límites de modelos, portafolios
y activos por portafolio; al alcanzarlos responde 403 con `code: "plan_limit"`
y un mensaje que explica qué hacer. Los elementos archivados no cuentan, pero
restaurarlos sí exige espacio. El perfil (`GET /api/profile/`) incluye el plan,
sus límites y el uso actual, y la interfaz lo muestra en "Mi perfil". Todavía no
hay cobros: el plan de una cuenta se cambia desde Django Admin (Perfiles de
usuario) o con:

```powershell
..\.venv\Scripts\python.exe manage.py asignar_plan <usuario> --plan profesional
```

Para cuentas de demostración o de ventas, `--sin-limites` exime a la cuenta de
todos los límites (`--con-limites` lo revierte); los superusuarios tampoco
tienen límites. Es un indicador por cuenta y no por nombre de usuario, así que
crea primero la cuenta y luego asígnalo.

Las cuentas nuevas reciben el primer plan configurado. Inicialmente son Inicial
gratis (3 modelos, 1 portafolio y 10 activos por portafolio) y Profesional a
USD 3.95 al mes (25 modelos, 10 portafolios y 50 activos por portafolio), y
Profesional Pro a USD 10.50 al mes (100 modelos, 25 portafolios y 100 activos
por portafolio). El plan Equipos queda pendiente hasta que exista colaboración
entre usuarios. Los precios y características se pueden configurar con
`SUBSCRIPTION_PLANS_JSON`. Cada plan admite un campo opcional `limits` con
`models`, `portfolios`, `assets_per_portfolio` y `ai_requests_per_month`
(enteros o `null` para sin límite); un plan sin `limits` no restringe nada.
La cuota de IA se renueva el día 1 de cada mes (Inicial 10, Profesional 100 y
Profesional Pro 500 consultas por defecto). Ejemplo en PowerShell:

```powershell
$env:SUBSCRIPTION_PLANS_JSON = '[{"id":"personal","name":"Personal","description":"Para uso individual.","price":19900,"currency":"COP","interval":"monthly","features":["Modelos de optimización","Reportes PDF y Excel"],"featured":false}]'
```

`price` es un número en unidades de la moneda indicada (`COP`, `MXN`, `USD`,
etc.); también puede ser `null` mientras se decide el precio. `interval` admite
`monthly`, `yearly` o `one_time`. Reinicia Django para aplicar la configuración.

## Despliegue con Docker

`compose.yaml` levanta Vértice completo con un solo comando:

| Servicio | Función |
|---|---|
| `caddy` | Recibe el tráfico en los puertos 80 y 443 y gestiona el certificado HTTPS. |
| `web` | Django con gunicorn; WhiteNoise sirve los archivos estáticos. |
| `worker` | Worker de Celery que ejecuta los cálculos. |
| `redis` | Cola de trabajos. |
| `db` | PostgreSQL 16 con sus datos en un volumen. |
| `migrate` | Aplica las migraciones antes de arrancar `web` y `worker`. |

1. Copia la configuración y complétala:

   ```powershell
   Copy-Item .env.example .env
   ```

   Cambia `DJANGO_SECRET_KEY` y `POSTGRES_PASSWORD` por valores aleatorios,
   configura el correo (`EMAIL_*`) y, con un dominio real, cambia `localhost`
   por tu dominio en `SITE_ADDRESS`, `DJANGO_ALLOWED_HOSTS`, `PUBLIC_APP_URL`
   y `DJANGO_CSRF_TRUSTED_ORIGINS`. El dominio debe apuntar al servidor y los
   puertos 80 y 443 deben estar abiertos para que Caddy obtenga el
   certificado. Con `localhost` el navegador mostrará un aviso de certificado;
   en ese caso usa `DJANGO_SECURE_HSTS_SECONDS=60`.

2. Construye y arranca:

   ```powershell
   docker compose up -d --build
   ```

3. Crea la cuenta administradora y, si corresponde, exime de límites la cuenta
   de ventas y demostraciones:

   ```powershell
   docker compose exec web python manage.py createsuperuser
   docker compose exec web python manage.py asignar_plan yoider00 --sin-limites
   ```

Para actualizar, ejecuta `git pull` y de nuevo `docker compose up -d --build`;
las migraciones se aplican solas. Programa a diario (por ejemplo con el
programador de tareas o cron del servidor):

```powershell
docker compose exec web python manage.py cleanup_rate_limits
docker compose exec web python manage.py cleanup_optimization_jobs
docker compose exec web python manage.py limpiar_demos
```

`docker compose logs -f web worker` muestra los registros. Los datos viven en
los volúmenes `pg-data` (base) y `media` (fotos de perfil); `docker compose
down` los conserva y `docker compose down -v` **los borra**. La base solo es
accesible dentro de la red interna de Docker, por eso compose activa
`DJANGO_DATABASE_ALLOW_INSECURE`; no la uses con una base externa. CI construye
la imagen y comprueba en cada cambio que HTTPS, los archivos estáticos, la base
y el worker respondan.

## Configuración de producción

Instala las dependencias desde la raíz con `pip install -r requirements.txt`.
En producción configura:

- `DJANGO_DEBUG=false`
- `DJANGO_SECRET_KEY` con un secreto aleatorio guardado fuera del repositorio
- `DJANGO_ALLOWED_HOSTS` con los dominios exactos, separados por comas
- `PUBLIC_APP_URL` con la URL HTTPS pública de la aplicación
- `DEFAULT_FROM_EMAIL`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER` y
  `EMAIL_HOST_PASSWORD` para enviar enlaces de verificación y recuperación.
  Usa `EMAIL_USE_TLS=true` o `EMAIL_USE_SSL=true`, nunca ambos.
- `DATABASE_URL` con una URL PostgreSQL, por ejemplo
  `postgresql://usuario:clave@db.example.com:5432/opti?sslmode=require`
- `CELERY_BROKER_URL` con la URL privada de Redis accesible tanto por Django
  como por los workers; usa TLS y autenticación en producción. Ejecuta al menos
  un worker con `celery -A config worker --loglevel=info`.
- `DJANGO_ALLOW_REGISTRATION=false` para cerrar el registro público. Es el
  valor predeterminado cuando `DEBUG` está desactivado.
- `DJANGO_MEDIA_ROOT` opcional para definir el almacenamiento de fotos de
  perfil. Usa un volumen persistente con permisos restringidos; las fotos se
  entregan únicamente a la cuenta autenticada.

Con `DEBUG=false`, Django redirige HTTP a HTTPS, activa cookies seguras y HSTS
por un año, y exige una base PostgreSQL con TLS. Si Django está detrás de un
proxy TLS de confianza que elimina y establece `X-Forwarded-Proto`, define
`DJANGO_TRUST_PROXY_HEADERS=true`; no lo habilites si clientes pueden enviar
ese encabezado directamente. Si el proxy reemplaza `X-Forwarded-For` con la
dirección real del cliente, configura `DJANGO_NUM_PROXIES` con el número de
saltos de proxy confiables para que los límites por IP funcionen por cliente.
Si el dominio público difiere del `Host` interno, configura
`DJANGO_CSRF_TRUSTED_ORIGINS` con los orígenes HTTPS separados por comas.
Activa `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=true` solo cuando todos los
subdominios usen HTTPS.

Después de configurar la base:

```powershell
cd backend
..\.venv\Scripts\python.exe manage.py migrate
..\.venv\Scripts\python.exe manage.py collectstatic --noinput
```

WhiteNoise sirve `staticfiles` desde Django (también puedes servirlos desde el
proxy o un CDN); ejecuta la app con gunicorn y no uses el servidor de
desarrollo en producción. Programa
`manage.py cleanup_rate_limits` para ejecutarse diariamente y purgar los
contadores expirados. Programa también `manage.py cleanup_optimization_jobs`
a diario: marca como fallidos los cálculos que quedaron colgados tras una
caída del worker y elimina los trabajos terminados hace más de 30 días
(`--days N` cambia el periodo). Los resultados siguen disponibles en el
historial de cada problema y portafolio. Con el registro público cerrado, crea la primera cuenta
administradora con `manage.py createsuperuser`; después podrás crear usuarios
desde `/admin/`.
El endpoint `GET /health/` comprueba conectividad con la base de datos y devuelve
solo `{"status":"ok"}` o un estado HTTP 503 genérico; úsalo como sonda de
disponibilidad, no como sustituto de monitoreo de aplicación.

Las GitHub Actions ejecutan migraciones, comprobaciones de Django, tests y
validación sintáctica de JavaScript y pruebas de navegador en Chromium contra
PostgreSQL 16 en cada push y pull request. El flujo no despliega
automáticamente a producción.

Para ejecutar las pruebas de navegador localmente, instala Node.js y Chromium:

```powershell
npm ci
npx playwright install chromium
npm run test:e2e
```

Playwright aplica las migraciones y prepara cuentas y modelos de prueba en la
base configurada por Django. En desarrollo puede usar SQLite; CI ejecuta las
mismas pruebas con PostgreSQL. `sslmode=disable` solo se permite mientras
`DJANGO_DEBUG=true` para conectar a la base local de CI; la configuración de
producción sigue exigiendo TLS. Al finalizar, Playwright elimina las cuentas y
los modelos de prueba que creó.

## Límites y registro

Por defecto, cada modelo admite hasta 100 variables, 200 restricciones y 5000
términos; coeficientes, límites y lados derechos se limitan a un valor absoluto
de `1e12`. Cada ejecución del solucionador tiene un máximo de 30 segundos y un
hilo, con hasta 5 ejecuciones por usuario por minuto. El cuerpo de cada petición
se limita a 1 MiB. Estos límites se pueden ajustar mediante `OPTIMIZER_*`,
dentro de los topes de seguridad definidos en `settings.py`.

El registro y el inicio de sesión tienen límites por dirección IP (5 cuentas
por hora y 10 intentos de acceso por minuto). Se pueden ajustar con
`AUTH_SIGNUP_LIMIT` y `AUTH_LOGIN_LIMIT`; los solucionadores con
`OPTIMIZER_SOLVE_LIMIT`, y los enlaces de verificación y restablecimiento con
`AUTH_VERIFY_LIMIT` y `AUTH_PASSWORD_RESET_LIMIT`, usando sufijos `s`, `m`, `h`
o `d`. El análisis limita cada portafolio a 100 activos de forma
predeterminada; se puede ajustar con `MAX_PORTFOLIO_ASSETS`. Los contadores
atómicos se guardan en PostgreSQL y se comparten entre los procesos del servicio.
Para cerrar el registro, define `DJANGO_ALLOW_REGISTRATION=false`; el control
también se refleja en la pantalla de acceso.

## Cuentas y correo

El registro requiere un correo único y deja la cuenta inactiva hasta abrir el
enlace de verificación, válido durante 24 horas. La pantalla ofrece reenvío de
verificación y recuperación de contraseña; los enlaces de restablecimiento
usan el token de Django y se invalidan al cambiar la contraseña. Configura el
correo saliente antes de habilitar el registro público.

## Modelos e historial financiero

Los problemas lineales permiten editar su nombre, descripción y componentes,
duplicarlos y archivarlos sin borrar ejecuciones anteriores. Cada ejecución
guarda una instantánea del modelo y los nombres de sus variables para que el
historial siga siendo legible aunque luego se edite.

El análisis de portafolios usa la formulación media-varianza
`max(w·mu - lambda·w'·Sigma·w)`: `mu` son rendimientos esperados y `Sigma` la
matriz de covarianza, ingresados manualmente en la misma periodicidad. Los
pesos son long-only y suman 1; se puede establecer un mínimo y máximo por
activo y topes máximos para categorías. Un activo de efectivo se incluye como
cualquier otro activo, con su rendimiento y covarianzas correspondientes.
`lambda` es la aversión al riesgo y debe ser positiva. La matriz se valida
como simétrica y positiva semidefinida. La frontera eficiente minimiza varianza
para una serie de rendimientos objetivo factibles bajo los mismos límites.
Se puede especificar la periodicidad para mostrar rendimiento anualizado
aritmético y volatilidad anualizada estimada con la raíz cuadrada del número
de periodos; esta aproximación presupone periodos comparables y no incorpora
capitalización. La contribución de cada activo se calcula a la volatilidad
total con la descomposición de Euler. Los escenarios de estrés son vectores de
rendimiento introducidos por el usuario y muestran su rendimiento ponderado;
no son pronósticos.

## Cuenta y portabilidad de datos

Desde la sesión autenticada se puede descargar un JSON con la cuenta, modelos y
ejecuciones, cambiar la contraseña o eliminar permanentemente la cuenta. La
eliminación exige contraseña y confirmación del nombre de usuario, y borra los
modelos, portafolios e historiales asociados; exporta los datos antes si deseas
conservarlos.

## Copias de seguridad y restauración

Guarda copias cifradas en una ubicación separada del servidor y conserva las
claves de cifrado fuera del repositorio. La copia de código no sustituye la
copia de base de datos.

En desarrollo con SQLite, detén el servidor antes de copiar
`backend\db.sqlite3`. En producción, usa `pg_dump` desde un entorno con acceso
al PostgreSQL y guarda el archivo en almacenamiento protegido:

```powershell
$env:DATABASE_URL = "<URL de la base PostgreSQL>"
pg_dump --dbname="$env:DATABASE_URL" --format=custom --file=".\backup.dump"
```

Prueba cada restauración en una base de datos de staging desechable, nunca
directamente sobre producción. En PostgreSQL:

```powershell
$env:STAGING_DATABASE_URL = "<URL de una base de staging vacía>"
pg_restore --clean --if-exists --no-owner --dbname="$env:STAGING_DATABASE_URL" ".\backup.dump"
Set-Location backend
..\.venv\Scripts\python.exe manage.py migrate --check
..\.venv\Scripts\python.exe manage.py check
..\.venv\Scripts\python.exe manage.py test
```

Tras restaurar, comprueba `/health/` y abre la aplicación de staging para
confirmar el acceso a modelos e historiales. Programa ensayos periódicos y
registra su fecha y resultado; una copia que nunca se ha restaurado no demuestra
que el proceso de recuperación funcione.

Se puede importar una cartera desde CSV en UTF-8, separado por comas o punto y
coma. Debe tener las columnas `asset`, `expected_return` y una columna
`cov:<nombre exacto del activo>` por cada activo; cada fila contiene una fila
de la matriz de covarianza en ese mismo orden. Son opcionales `category`,
`min_weight` y `max_weight`. La importación primero valida y previsualiza los
datos en el formulario; no guarda hasta que se confirme con “Guardar
portafolio”. No se consultan proveedores de mercado ni se estima ningún dato.
Los resultados dependen de los supuestos ingresados y no constituyen asesoría
financiera.

## Cuentas de demostración

El botón «Ver una demo» de la pantalla de acceso crea una cuenta temporal sin
contraseña, inicia sesión y carga los datos de ejemplo. Está activo cuando lo
está el registro (`DJANGO_DEMO_ACCOUNTS`, predeterminado igual que
`DJANGO_ALLOW_REGISTRATION`). Cada cuenta de demostración dura
`DEMO_ACCOUNT_TTL_HOURS` (24 por defecto), tiene `DEMO_AI_REQUESTS` consultas
de IA (3 por defecto) y se pueden crear `AUTH_DEMO_LIMIT` por IP (5 por hora).
Las vencidas se borran al crear una nueva y con `manage.py limpiar_demos`.
