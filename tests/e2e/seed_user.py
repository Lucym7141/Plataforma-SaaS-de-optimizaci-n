import os
import sys
from pathlib import Path

import django

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model
from django.db import transaction
from optimizacion.models import VerificacionCorreo

username = "e2e-user"
email = "e2e@example.com"
password = os.environ["E2E_TEST_PASSWORD"]
other_username = "e2e-other"
other_email = "e2e-other@example.com"
other_password = os.environ.get(
    "E2E_OTHER_PASSWORD",
    "Other-E2E-Password-947!",
)


from optimizacion.models import ProblemaOptimizacion

User = get_user_model()
fixture_names = [username, other_username]
fixture_emails = [email, other_email]

with transaction.atomic():
    if User.objects.filter(
        username__in=fixture_names,
    ).exists() or User.objects.filter(email__in=fixture_emails).exists():
        raise RuntimeError(
            "Reserved E2E accounts already exist; refusing to overwrite them."
        )

    owner = User.objects.create_user(
        username=username,
        email=email,
        password=password,
        is_active=True,
    )
    other = User.objects.create_user(
        username=other_username,
        email=other_email,
        password=other_password,
        is_active=True,
    )
    VerificacionCorreo.objects.bulk_create([
        VerificacionCorreo(
            usuario=owner,
            verificado_en=django.utils.timezone.now(),
        ),
        VerificacionCorreo(
            usuario=other,
            verificado_en=django.utils.timezone.now(),
        ),
    ])
    ProblemaOptimizacion.objects.create(
        propietario=owner,
        nombre="E2E private problem",
        descripcion="Visible only to its owner.",
    )
    ProblemaOptimizacion.objects.create(
        propietario=other,
        nombre="Other user's private problem",
        descripcion="Visible only to a different user.",
    )
