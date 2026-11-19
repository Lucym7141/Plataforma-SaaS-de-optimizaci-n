"""Pruebas: Registro, sesión y recuperación de cuentas."""

import json

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.test import Client, TestCase
from django.test.utils import override_settings
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from django.core import signing



class RegistroUsuarioTests(TestCase):
    def test_registro_requiere_csrf(self):
        client = Client(enforce_csrf_checks=True)

        respuesta = client.post(
            "/api/auth/registro/",
            data=json.dumps({
                "username": "nuevo",
                "password": "Fuerte-contraseña-739!",
            }),
            content_type="application/json",
        )

        self.assertEqual(respuesta.status_code, 403)

    def test_registro_crea_cuenta_pendiente_de_verificacion(self):
        client = Client(enforce_csrf_checks=True)
        client.get("/")
        token = client.cookies["csrftoken"].value

        respuesta = client.post(
            "/api/auth/registro/",
            data=json.dumps({
                "username": "nuevo",
                "email": "nuevo@example.com",
                "password": "Fuerte-contraseña-739!",
            }),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(respuesta.status_code, 201)
        usuario = get_user_model().objects.get(username="nuevo")
        self.assertFalse(usuario.is_active)
        self.assertEqual(client.get("/api/auth/me/").status_code, 401)

    def test_verificacion_activa_cuenta(self):
        usuario = get_user_model().objects.create_user(
            username="pendiente",
            email="pendiente@example.com",
            password="Fuerte-contraseña-739!",
            is_active=False,
        )
        token = signing.dumps(
            {"user_id": usuario.pk, "email": usuario.email},
            salt="optimizacion.email-verification",
        )

        respuesta = self.client.post(
            "/api/auth/verify/",
            data=json.dumps({"token": token}),
            content_type="application/json",
        )

        self.assertEqual(respuesta.status_code, 200)
        usuario.refresh_from_db()
        self.assertTrue(usuario.is_active)
        self.assertIsNotNone(usuario.verificacion_correo.verificado_en)

    def test_enlace_reutilizado_no_reactiva_cuenta_deshabilitada(self):
        usuario = get_user_model().objects.create_user(
            username="ya-verificado",
            email="verificado@example.com",
            password="Fuerte-contraseña-739!",
            is_active=True,
        )
        token = signing.dumps(
            {"user_id": usuario.pk, "email": usuario.email},
            salt="optimizacion.email-verification",
        )
        self.client.post(
            "/api/auth/verify/",
            data=json.dumps({"token": token}),
            content_type="application/json",
        )
        usuario.is_active = False
        usuario.save(update_fields=["is_active"])

        response = self.client.post(
            "/api/auth/verify/",
            data=json.dumps({"token": token}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        usuario.refresh_from_db()
        self.assertFalse(usuario.is_active)

    def test_restablecer_contrasena_con_token_valido(self):
        usuario = get_user_model().objects.create_user(
            username="reset-user",
            email="reset@example.com",
            password="Anterior-contraseña-739!",
        )
        response = self.client.post(
            "/api/auth/password-reset/confirm/",
            data=json.dumps({
                "uid": urlsafe_base64_encode(force_bytes(usuario.pk)),
                "token": default_token_generator.make_token(usuario),
                "password": "Nueva-contraseña-947!",
            }),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        usuario.refresh_from_db()
        self.assertTrue(usuario.check_password("Nueva-contraseña-947!"))

    def test_login_y_logout_requieren_sesion_csrf(self):
        usuario = get_user_model().objects.create_user(
            username="existente",
            password="Fuerte-contraseña-739!",
        )
        client = Client(enforce_csrf_checks=True)
        client.get("/")
        token = client.cookies["csrftoken"].value

        respuesta_login = client.post(
            "/api/auth/login/",
            data=json.dumps({
                "username": usuario.username,
                "password": "Fuerte-contraseña-739!",
            }),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        token = client.cookies["csrftoken"].value
        respuesta_logout = client.post(
            "/api/auth/logout/",
            data="{}",
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(respuesta_login.status_code, 200)
        self.assertEqual(respuesta_logout.status_code, 200)
        self.assertEqual(client.get("/api/auth/me/").status_code, 401)

    @override_settings(ALLOW_REGISTRATION=False)
    def test_registro_se_puede_desactivar(self):
        client = Client(enforce_csrf_checks=True)
        client.get("/")

        respuesta = client.post(
            "/api/auth/registro/",
            data=json.dumps({
                "username": "bloqueado",
                "password": "Fuerte-contraseña-739!",
            }),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        )

        self.assertEqual(respuesta.status_code, 403)
        self.assertFalse(
            get_user_model().objects.filter(username="bloqueado").exists()
        )

    def test_registro_aplica_limite_por_direccion_ip(self):
        client = Client(enforce_csrf_checks=True)
        client.get("/")

        respuestas = []
        for _ in range(6):
            respuestas.append(client.post(
                "/api/auth/registro/",
                data=json.dumps({
                    "username": "nuevo",
                    "email": "nuevo@example.com",
                    "password": "Fuerte-contraseña-739!",
                }),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
            ))

        self.assertEqual(respuestas[0].status_code, 201)
        self.assertEqual(
            respuestas[5].status_code,
            429,
            [respuesta.content for respuesta in respuestas],
        )
