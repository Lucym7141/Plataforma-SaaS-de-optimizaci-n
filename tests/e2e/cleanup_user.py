import os
import sys
from pathlib import Path

import django

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model
from optimizacion.models import OptimizacionPortafolio, ProblemaOptimizacion

users = get_user_model().objects.filter(
    username__in=["e2e-user", "e2e-other"],
    email__in=["e2e@example.com", "e2e-other@example.com"],
)
OptimizacionPortafolio.objects.filter(propietario__in=users).delete()
ProblemaOptimizacion.objects.filter(propietario__in=users).delete()
users.delete()
