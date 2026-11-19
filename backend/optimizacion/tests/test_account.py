"""Pruebas: Resumen, perfil y datos de la cuenta."""

import json
import io
import tempfile
from datetime import timedelta

from PIL import Image
from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.test.utils import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from ..models import (
    ProblemaOptimizacion,
    OptimizacionPortafolio,
)


class ResumenUsuarioTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="resumen-owner",
            password="Fuerte-contraseña-739!",
        )
        self.other_user = get_user_model().objects.create_user(
            username="resumen-other",
            password="Fuerte-contraseña-739!",
        )
        self.client.force_authenticate(user=self.user)

    def _create_problem(
        self,
        nombre,
        *,
        owner=None,
        archived=False,
        objective="MAX",
        updated_at=None,
    ):
        problem = ProblemaOptimizacion.objects.create(
            propietario=owner or self.user,
            nombre=nombre,
            tipo_objetivo=objective,
            archivado=archived,
        )
        if updated_at is not None:
            ProblemaOptimizacion.objects.filter(pk=problem.pk).update(
                actualizado_en=updated_at
            )
        return problem

    def _create_portfolio(
        self,
        nombre,
        *,
        owner=None,
        archived=False,
        assets=None,
        updated_at=None,
    ):
        portfolio = OptimizacionPortafolio.objects.create(
            propietario=owner or self.user,
            nombre=nombre,
            activos=assets if assets is not None else ["Activo A", "Activo B"],
            categorias=["", ""],
            rendimientos_esperados=["0.10", "0.20"],
            covarianza=[["0.04", "0"], ["0", "0.09"]],
            aversion_riesgo="2",
            archivado=archived,
        )
        if updated_at is not None:
            OptimizacionPortafolio.objects.filter(pk=portfolio.pk).update(
                actualizado_en=updated_at
            )
        return portfolio

    def test_resumen_requiere_autenticacion(self):
        response = APIClient().get("/api/resumen/")

        self.assertEqual(response.status_code, 403)

    def test_resumen_cuenta_activos_y_excluye_archivados_de_la_actividad(self):
        now = timezone.now()
        self._create_problem(
            "Problema antiguo",
            updated_at=now - timedelta(hours=2),
        )
        new_problem = self._create_problem(
            "Problema reciente",
            objective="MIN",
            updated_at=now - timedelta(minutes=1),
        )
        archived_problem = self._create_problem(
            "Problema archivado",
            archived=True,
            updated_at=now,
        )
        self._create_portfolio(
            "Portafolio antiguo",
            updated_at=now - timedelta(hours=2),
        )
        new_portfolio = self._create_portfolio(
            "Portafolio reciente",
            updated_at=now - timedelta(minutes=1),
        )
        archived_portfolio = self._create_portfolio(
            "Portafolio archivado",
            archived=True,
            updated_at=now,
        )

        response = self.client.get("/api/resumen/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["problemas"], 2)
        self.assertEqual(response.data["problemas_archivados"], 1)
        self.assertEqual(response.data["portafolios"], 2)
        self.assertEqual(response.data["portafolios_archivados"], 1)

        recent_problems = response.data["ultimos_problemas"]
        self.assertEqual(
            [item["nombre"] for item in recent_problems],
            ["Problema reciente", "Problema antiguo"],
        )
        self.assertEqual(recent_problems[0]["id"], new_problem.pk)
        self.assertEqual(recent_problems[0]["tipo_objetivo"], "MIN")
        self.assertNotIn(archived_problem.nombre, [
            item["nombre"] for item in recent_problems
        ])

        recent_portfolios = response.data["ultimos_portafolios"]
        self.assertEqual(
            [item["nombre"] for item in recent_portfolios],
            ["Portafolio reciente", "Portafolio antiguo"],
        )
        self.assertEqual(recent_portfolios[0]["id"], new_portfolio.pk)
        self.assertEqual(recent_portfolios[0]["activos"], ["Activo A", "Activo B"])
        self.assertNotIn(archived_portfolio.nombre, [
            item["nombre"] for item in recent_portfolios
        ])

    def test_resumen_analitica_agrega_todos_los_datos_activos(self):
        for index in range(7):
            self._create_problem(
                f"Problema MAX {index}",
                objective="MAX",
                updated_at=timezone.now() - timedelta(minutes=index),
            )
        for index in range(3):
            self._create_problem(
                f"Problema MIN {index}",
                objective="MIN",
                updated_at=timezone.now() - timedelta(minutes=index),
            )
        self._create_problem("Problema archivado", archived=True)

        self._create_portfolio("Sin activos", assets=[])
        self._create_portfolio("Un activo", assets=["A"])
        self._create_portfolio("Tres activos", assets=["A", "B", "C"])
        self._create_portfolio(
            "Seis activos",
            assets=["A", "B", "C", "D", "E", "F"],
        )
        self._create_portfolio("Archivado", archived=True, assets=["X"])
        self._create_portfolio(
            "Ajeno",
            owner=self.other_user,
            assets=["X", "Y"],
        )

        response = self.client.get("/api/resumen/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["analitica"], {
            "problemas_por_objetivo": [
                {"tipo_objetivo": "MAX", "total": 7},
                {"tipo_objetivo": "MIN", "total": 3},
            ],
            "portafolios_por_cantidad_activos": [
                {"cantidad_activos": "0", "total_portafolios": 1},
                {"cantidad_activos": "1", "total_portafolios": 1},
                {"cantidad_activos": "3", "total_portafolios": 1},
                {"cantidad_activos": "5+", "total_portafolios": 1},
            ],
            "activos_totales": 10,
        })

    def test_resumen_limita_la_actividad_a_los_ultimos_cinco(self):
        now = timezone.now()
        for index in range(7):
            self._create_problem(
                f"Problema {index}",
                updated_at=now - timedelta(minutes=index),
            )
            self._create_portfolio(
                f"Portafolio {index}",
                updated_at=now - timedelta(minutes=index),
            )

        response = self.client.get("/api/resumen/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["nombre"] for item in response.data["ultimos_problemas"]],
            [f"Problema {index}" for index in range(5)],
        )
        self.assertEqual(
            [item["nombre"] for item in response.data["ultimos_portafolios"]],
            [f"Portafolio {index}" for index in range(5)],
        )

    def test_resumen_solo_incluye_datos_de_la_cuenta_autenticada(self):
        self._create_problem(
            "Problema ajeno",
            owner=self.other_user,
            updated_at=timezone.now(),
        )
        self._create_portfolio(
            "Portafolio ajeno",
            owner=self.other_user,
            updated_at=timezone.now(),
        )

        response = self.client.get("/api/resumen/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["problemas"], 0)
        self.assertEqual(response.data["portafolios"], 0)
        self.assertEqual(response.data["ultimos_problemas"], [])
        self.assertEqual(response.data["ultimos_portafolios"], [])
        self.assertEqual(response.data["analitica"], {
            "problemas_por_objetivo": [],
            "portafolios_por_cantidad_activos": [],
            "activos_totales": 0,
        })


class PerfilUsuarioTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="profile-owner",
            password="Profile-Test-Password-928!",
        )
        self.other_user = get_user_model().objects.create_user(
            username="profile-other",
            password="Profile-Test-Password-928!",
        )
        self.client.force_authenticate(user=self.user)
        media_directory = tempfile.TemporaryDirectory()
        self.addCleanup(media_directory.cleanup)
        media_settings = override_settings(MEDIA_ROOT=media_directory.name)
        media_settings.enable()
        self.addCleanup(media_settings.disable)

    def _png_upload(self):
        image_buffer = io.BytesIO()
        Image.new("RGB", (4, 4), color="purple").save(image_buffer, format="PNG")
        return SimpleUploadedFile(
            "avatar.png",
            image_buffer.getvalue(),
            content_type="image/png",
        )

    def test_perfil_actualiza_nombre_y_descripcion(self):
        response = self.client.patch(
            "/api/profile/",
            {"nombre_visible": "  Ada  ", "descripcion": "Inversionista"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["nombre_visible"], "Ada")
        self.assertEqual(response.data["descripcion"], "Inversionista")
        self.assertIsNone(response.data["foto_url"])

    def test_foto_se_valida_y_solo_el_usuario_autenticado_puede_verla(self):
        response = self.client.patch(
            "/api/profile/",
            {"foto": self._png_upload()},
            format="multipart",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["foto_url"], "/api/profile/photo/")
        photo_response = self.client.get(response.data["foto_url"])
        self.assertEqual(photo_response.status_code, 200)
        self.assertEqual(photo_response["Content-Type"], "image/png")
        self.assertEqual(photo_response["Cache-Control"], "private, no-store")
        # Consumir el contenido deja que el cliente de pruebas cierre la
        # respuesta sin disparar close_old_connections; llamar a close()
        # directamente cierra la conexión de PostgreSQL de la prueba.
        photo_bytes = b"".join(photo_response.streaming_content)
        self.assertTrue(photo_bytes.startswith(b"\x89PNG"))

        other_client = APIClient()
        other_client.force_authenticate(user=self.other_user)
        self.assertEqual(other_client.get("/api/profile/photo/").status_code, 404)

    def test_perfil_rechaza_archivos_que_no_son_imagenes(self):
        response = self.client.patch(
            "/api/profile/",
            {
                "foto": SimpleUploadedFile(
                    "avatar.png",
                    b"not an image",
                    content_type="image/png",
                )
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("foto", response.data)

    def test_perfil_rechaza_fotos_mayores_al_limite(self):
        response = self.client.patch(
            "/api/profile/",
            {
                "foto": SimpleUploadedFile(
                    "large.png",
                    b"x" * (768 * 1024 + 1),
                    content_type="image/png",
                )
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("768 KiB", response.data["foto"])

    def test_borrar_cuenta_elimina_el_archivo_de_perfil(self):
        response = self.client.patch(
            "/api/profile/",
            {"foto": self._png_upload()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200)
        profile = self.user.perfil
        photo_storage = profile.foto.storage
        photo_name = profile.foto.name
        self.assertTrue(photo_storage.exists(photo_name))

        self.user.delete()

        self.assertFalse(photo_storage.exists(photo_name))


class AccountDataTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="data-owner",
            email="data@example.com",
            password="Fuerte-contraseña-739!",
        )
        self.client.force_authenticate(user=self.user)

    def test_exporta_modelos_e_historial_sin_credenciales(self):
        problem = ProblemaOptimizacion.objects.create(
            propietario=self.user,
            nombre="Exportable",
        )
        response = self.client.get("/api/auth/export/")
        exported = json.loads(b"".join(response.streaming_content))

        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertEqual(exported["cuenta"]["username"], self.user.username)
        self.assertEqual(exported["problemas"][0]["nombre"], problem.nombre)
        self.assertNotIn("password", exported["cuenta"])
        self.assertIn("portafolios", exported)

    def test_eliminar_cuenta_exige_confirmacion_y_borra_datos_propios(self):
        problem = ProblemaOptimizacion.objects.create(
            propietario=self.user,
            nombre="Privado",
        )
        portfolio = OptimizacionPortafolio.objects.create(
            propietario=self.user,
            nombre="Privado financiero",
            activos=["Bono", "Acción"],
            categorias=["", ""],
            rendimientos_esperados=["0.1", "0.2"],
            covarianza=[["0.04", "0"], ["0", "0.09"]],
            aversion_riesgo="2",
        )

        wrong_confirmation = self.client.post(
            "/api/auth/delete/",
            {
                "password": "Fuerte-contraseña-739!",
                "confirmacion": "incorrecto",
            },
            format="json",
        )
        self.assertEqual(wrong_confirmation.status_code, 400)
        self.assertTrue(get_user_model().objects.filter(pk=self.user.pk).exists())

        deleted = self.client.post(
            "/api/auth/delete/",
            {
                "password": "Fuerte-contraseña-739!",
                "confirmacion": self.user.username,
            },
            format="json",
        )

        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(get_user_model().objects.filter(pk=self.user.pk).exists())
        self.assertFalse(ProblemaOptimizacion.objects.filter(pk=problem.pk).exists())
        self.assertFalse(OptimizacionPortafolio.objects.filter(pk=portfolio.pk).exists())

    def test_health_endpoint_informa_estado_de_base_de_datos(self):
        response = self.client.get("/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_cambiar_contrasena_verifica_la_anterior_y_mantiene_sesion(self):
        client = Client()
        self.assertTrue(client.login(
            username=self.user.username,
            password="Fuerte-contraseña-739!",
        ))
        response = client.post(
            "/api/auth/change-password/",
            {
                "old_password": "Fuerte-contraseña-739!",
                "new_password1": "Nueva-contraseña-947!",
                "new_password2": "Nueva-contraseña-947!",
            },
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(client.get("/api/auth/me/").status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Nueva-contraseña-947!"))
