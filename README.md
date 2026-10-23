# Plataforma-SaaS-de-optimizaci-n
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
cd backend
..\.venv\Scripts\python.exe manage.py migrate
..\.venv\Scripts\python.exe manage.py runserver
```

Abre `http://127.0.0.1:8000` para registrarte o iniciar sesión. En desarrollo,
los mensajes de verificación y recuperación se imprimen en la consola del
servidor.

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
- `DJANGO_ALLOW_REGISTRATION=false` para cerrar el registro público. Es el
  valor predeterminado cuando `DEBUG` está desactivado.

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

Sirve `staticfiles` desde el proxy o un servicio de archivos estáticos; no uses
el servidor de desarrollo en producción. Programa
`manage.py cleanup_rate_limits` para ejecutarse diariamente y purgar los
contadores expirados. Con el registro público cerrado, crea la primera cuenta
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
