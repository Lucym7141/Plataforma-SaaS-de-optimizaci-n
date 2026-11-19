#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys

# Comandos de desarrollo local que activan DEBUG si DJANGO_DEBUG no está
# definido. Los demás comandos (migrate, collectstatic...) y los procesos de
# producción (WSGI/ASGI, Celery) usan DEBUG=false por defecto.
DEV_COMMANDS = {'runserver', 'test'}


def main():
    """Run administrative tasks."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    if len(sys.argv) > 1 and sys.argv[1] in DEV_COMMANDS:
        os.environ.setdefault('DJANGO_DEBUG', 'true')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
