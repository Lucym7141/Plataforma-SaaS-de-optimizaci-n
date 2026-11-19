"""Pruebas: aplicación de los límites de cada plan."""

import io
import json

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.test.utils import override_settings
from rest_framework.test import APIClient

from config.subscription_plans import load_subscription_plans

from ..models import OptimizacionPortafolio, PerfilUsuario, ProblemaOptimizacion


def portfolio_payload(name="Cartera", assets=2):
    names = [f"Activo {index}" for index in range(assets)]
    return {
        "nombre": name,
        "activos": names,
        "rendimientos_esperados": ["0.05"] * assets,
        "covarianza": [
            ["0.04" if row == col else "0" for col in range(assets)]
            for row in range(assets)
        ],
        "aversion_riesgo": "2",
    }


def problem_payload(name="Modelo"):
    return {
        "nombre": name,
        "tipo_objetivo": "MAX",
        "variables": [{"nombre": "x", "tipo": "CONT", "limite_inferior": "0"}],
        "terminos_objetivo": [{"variable_nombre": "x", "coeficiente": "1"}],
        "restricciones": [{
            "nombre": "tope",
            "operador": "LE",
            "lado_derecho": "10",
            "terminos": [{"variable_nombre": "x", "coeficiente": "1"}],
        }],
    }


class PlanLimitTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="plan-user",
            password="Fuerte-contraseña-739!",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def create_problems(self, count):
        for index in range(count):
            ProblemaOptimizacion.objects.create(
                propietario=self.user,
                nombre=f"Modelo {index}",
                tipo_objetivo="MAX",
            )

    def assert_plan_limit(self, response, text):
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.data["code"], "plan_limit")
        self.assertIn(text, response.data["detail"])

    def test_plan_inicial_limita_los_modelos(self):
        self.create_problems(3)

        response = self.client.post(
            "/api/problemas/", problem_payload(), format="json"
        )

        self.assert_plan_limit(response, "hasta 3 modelos")
        self.assertEqual(
            ProblemaOptimizacion.objects.filter(propietario=self.user).count(), 3
        )

    def test_modelo_nuevo_se_crea_dentro_del_limite(self):
        self.create_problems(2)

        response = self.client.post(
            "/api/problemas/", problem_payload(), format="json"
        )

        self.assertEqual(response.status_code, 201, response.data)

    def test_archivar_libera_espacio_y_restaurar_respeta_el_limite(self):
        self.create_problems(3)
        archived = ProblemaOptimizacion.objects.filter(propietario=self.user).first()
        self.assertEqual(
            self.client.delete(f"/api/problemas/{archived.pk}/archivar/").status_code,
            204,
        )
        self.assertEqual(
            self.client.post(
                "/api/problemas/", problem_payload(), format="json"
            ).status_code,
            201,
        )

        response = self.client.post(f"/api/problemas/{archived.pk}/restaurar/")

        self.assert_plan_limit(response, "hasta 3 modelos")

    def test_duplicar_modelo_respeta_el_limite(self):
        self.create_problems(3)
        problem = ProblemaOptimizacion.objects.filter(propietario=self.user).first()

        response = self.client.post(f"/api/problemas/{problem.pk}/duplicar/")

        self.assert_plan_limit(response, "hasta 3 modelos")

    def test_plan_inicial_limita_portafolios_y_activos(self):
        too_many_assets = self.client.post(
            "/api/portafolios/", portfolio_payload(assets=11), format="json"
        )
        self.assert_plan_limit(too_many_assets, "hasta 10 activos")

        first = self.client.post(
            "/api/portafolios/", portfolio_payload(), format="json"
        )
        self.assertEqual(first.status_code, 201, first.data)
        second = self.client.post(
            "/api/portafolios/", portfolio_payload("Otra"), format="json"
        )
        self.assert_plan_limit(second, "hasta 1 portafolio")

        duplicate = self.client.post(
            f"/api/portafolios/{first.data['id']}/duplicar/"
        )
        self.assert_plan_limit(duplicate, "hasta 1 portafolio")

        edit = self.client.put(
            f"/api/portafolios/{first.data['id']}/",
            portfolio_payload(assets=11),
            format="json",
        )
        self.assert_plan_limit(edit, "hasta 10 activos")

    def test_importacion_csv_avisa_si_supera_los_activos_del_plan(self):
        rows = ["asset,expected_return," + ",".join(
            f"cov:A{index}" for index in range(11)
        )]
        for row in range(11):
            rows.append(f"A{row},0.05," + ",".join(
                "0.04" if row == col else "0" for col in range(11)
            ))
        upload = io.BytesIO("\n".join(rows).encode())
        upload.name = "cartera.csv"

        response = self.client.post(
            "/api/portafolios/importar/preview/",
            {"archivo": upload, "nombre": "Grande"},
            format="multipart",
        )

        self.assert_plan_limit(response, "hasta 10 activos")

    def test_plan_profesional_amplia_los_limites(self):
        PerfilUsuario.objects.create(usuario=self.user, plan="profesional")
        self.create_problems(3)

        model = self.client.post(
            "/api/problemas/", problem_payload(), format="json"
        )
        big_portfolio = self.client.post(
            "/api/portafolios/", portfolio_payload(assets=11), format="json"
        )

        self.assertEqual(model.status_code, 201, model.data)
        self.assertEqual(big_portfolio.status_code, 201, big_portfolio.data)

    def test_cuenta_sin_limites_no_tiene_restricciones(self):
        PerfilUsuario.objects.create(usuario=self.user, sin_limites=True)
        self.create_problems(150)
        for index in range(30):
            OptimizacionPortafolio.objects.create(
                propietario=self.user,
                nombre=f"P{index}",
                activos=["A", "B"],
                rendimientos_esperados=["0.1", "0.2"],
                covarianza=[["0.04", "0"], ["0", "0.09"]],
                aversion_riesgo="2",
            )

        model = self.client.post(
            "/api/problemas/", problem_payload(), format="json"
        )
        portfolio = self.client.post(
            "/api/portafolios/", portfolio_payload(assets=60), format="json"
        )

        self.assertEqual(model.status_code, 201, model.data)
        self.assertEqual(portfolio.status_code, 201, portfolio.data)

    def test_perfil_muestra_plan_limites_y_uso(self):
        self.create_problems(2)

        plan = self.client.get("/api/profile/").data["plan"]

        self.assertEqual(plan["id"], "inicial")
        self.assertEqual(plan["name"], "Inicial")
        self.assertFalse(plan["unlimited"])
        self.assertEqual(plan["limits"]["models"], 3)
        self.assertEqual(plan["limits"]["assets_per_portfolio"], 10)
        self.assertEqual(plan["limits"]["ai_requests_per_month"], 10)
        self.assertEqual(
            plan["usage"],
            {"models": 2, "portfolios": 0, "ai_requests_this_month": 0},
        )

    def test_superusuario_no_tiene_limites(self):
        self.user.is_superuser = True
        self.user.save()
        self.create_problems(3)

        response = self.client.post(
            "/api/problemas/", problem_payload(), format="json"
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(self.client.get("/api/profile/").data["plan"]["unlimited"])

    @override_settings(SUBSCRIPTION_PLANS=load_subscription_plans(json.dumps([{
        "id": "abierto",
        "name": "Abierto",
        "description": "",
        "price": 0,
        "currency": "USD",
        "interval": "monthly",
        "features": [],
        "featured": False,
    }])))
    def test_plan_sin_limits_configurados_no_restringe(self):
        self.create_problems(10)

        response = self.client.post(
            "/api/problemas/", problem_payload(), format="json"
        )

        self.assertEqual(response.status_code, 201, response.data)


class AsignarPlanCommandTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="vendedor",
            password="Fuerte-contraseña-739!",
        )

    def test_exime_y_vuelve_a_limitar_una_cuenta(self):
        output = io.StringIO()
        call_command("asignar_plan", "vendedor", "--sin-limites", stdout=output)
        self.assertTrue(PerfilUsuario.objects.get(usuario=self.user).sin_limites)
        self.assertIn("sin límites", output.getvalue())

        call_command("asignar_plan", "vendedor", "--con-limites", stdout=io.StringIO())
        self.assertFalse(PerfilUsuario.objects.get(usuario=self.user).sin_limites)

    def test_asigna_un_plan_existente(self):
        call_command(
            "asignar_plan", "vendedor", "--plan", "profesional", stdout=io.StringIO()
        )
        self.assertEqual(
            PerfilUsuario.objects.get(usuario=self.user).plan, "profesional"
        )

    def test_rechaza_planes_y_cuentas_desconocidas(self):
        with self.assertRaises(CommandError):
            call_command(
                "asignar_plan", "vendedor", "--plan", "oro", stdout=io.StringIO()
            )
        with self.assertRaises(CommandError):
            call_command(
                "asignar_plan", "nadie", "--sin-limites", stdout=io.StringIO()
            )
        with self.assertRaises(CommandError):
            call_command("asignar_plan", "vendedor", stdout=io.StringIO())
