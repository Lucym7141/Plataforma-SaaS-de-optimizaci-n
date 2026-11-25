from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from optimizacion.models import PerfilUsuario, RateLimitCounter, UsoIA
from optimizacion.plans import PlanLimitError, check_ai_quota


@override_settings(DEMO_ACCOUNTS_ENABLED=True, DEMO_AI_REQUESTS=3)
class DemoAccountTests(TestCase):
    def setUp(self):
        RateLimitCounter.objects.all().delete()

    def test_crea_cuenta_temporal_e_inicia_sesion(self):
        response = self.client.post("/api/auth/demo/")

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertTrue(data["es_demo"])
        self.assertTrue(data["username"].startswith("demo-"))
        user = get_user_model().objects.get(pk=data["id"])
        self.assertFalse(user.has_usable_password())
        self.assertTrue(user.perfil.es_demo)

        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertTrue(me.json()["es_demo"])

    def test_cuenta_normal_no_es_demo(self):
        user = get_user_model().objects.create_user("persona", password="Clave-segura-123!")
        self.client.force_login(user)
        self.assertFalse(self.client.get("/api/auth/me/").json()["es_demo"])

    @override_settings(DEMO_ACCOUNTS_ENABLED=False)
    def test_respeta_la_configuracion_desactivada(self):
        response = self.client.post("/api/auth/demo/")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(get_user_model().objects.exists())
        config = self.client.get("/api/auth/config/").json()
        self.assertFalse(config["demo_enabled"])

    def test_limita_las_demos_por_ip(self):
        statuses = [self.client.post("/api/auth/demo/").status_code for _ in range(6)]
        self.assertEqual(statuses[:5], [201] * 5)
        self.assertEqual(statuses[5], 429)

    def test_borra_las_demos_vencidas(self):
        old = get_user_model().objects.create_user("demo-viejo")
        old.date_joined = timezone.now() - timedelta(hours=25)
        old.save(update_fields=["date_joined"])
        PerfilUsuario.objects.create(usuario=old, es_demo=True)
        real = get_user_model().objects.create_user("persona-real")
        real.date_joined = timezone.now() - timedelta(days=30)
        real.save(update_fields=["date_joined"])

        self.assertEqual(self.client.post("/api/auth/demo/").status_code, 201)
        self.assertFalse(get_user_model().objects.filter(username="demo-viejo").exists())
        self.assertTrue(get_user_model().objects.filter(username="persona-real").exists())

        stale = get_user_model().objects.create_user("demo-otro")
        stale.date_joined = timezone.now() - timedelta(hours=30)
        stale.save(update_fields=["date_joined"])
        PerfilUsuario.objects.create(usuario=stale, es_demo=True)
        call_command("limpiar_demos", verbosity=0)
        self.assertFalse(get_user_model().objects.filter(username="demo-otro").exists())

    def test_la_demo_tiene_menos_consultas_de_ia(self):
        data = self.client.post("/api/auth/demo/").json()
        user = get_user_model().objects.get(pk=data["id"])
        for _ in range(3):
            check_ai_quota(user)
            UsoIA.objects.create(usuario=user, tipo="borrador")
        with self.assertRaises(PlanLimitError):
            check_ai_quota(user)
