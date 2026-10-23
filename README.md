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

Abre `http://127.0.0.1:8000` para registrarte o iniciar sesión.

## Configuración de producción

Instala las dependencias desde la raíz con `pip install -r requirements.txt`.
En producción configura:

- `DJANGO_DEBUG=false`
- `DJANGO_SECRET_KEY` con un secreto aleatorio guardado fuera del repositorio
- `DJANGO_ALLOWED_HOSTS` con los dominios exactos, separados por comas
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
`OPTIMIZER_SOLVE_LIMIT`, usando sufijos `s`, `m`, `h` o `d`. Los contadores
atómicos se guardan en PostgreSQL y se comparten entre los procesos del
servicio.
Para cerrar el registro, define `DJANGO_ALLOW_REGISTRATION=false`; el control
también se refleja en la pantalla de acceso.
