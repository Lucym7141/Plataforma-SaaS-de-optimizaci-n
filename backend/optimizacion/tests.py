
import json
from unittest.mock import patch

import pulp
from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.test.utils import override_settings
from rest_framework.test import APIClient

from .serializers import ProblemaOptimizacionCrearSerializer
from .services import resolver_problema
from .models import (
    ProblemaOptimizacion,
    VariableDecision,
    TerminoObjetivo,
    Restriccion,
    TerminoRestriccion,
)


class ApiOptimizacionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="inversionista",
            password="Fuerte-contraseña-739!",
        )
        self.client.force_authenticate(user=self.user)

        self.problema = ProblemaOptimizacion.objects.create(
            nombre="Problema de prueba API",
            descripcion="Prueba automatizada",
            tipo_objetivo="MAX",
            activo=True,
            propietario=self.user,
        )

        self.x = VariableDecision.objects.create(
            problema=self.problema,
            nombre="x",
            tipo="CONT",
            limite_inferior=0,
        )

        self.y = VariableDecision.objects.create(
            problema=self.problema,
            nombre="y",
            tipo="CONT",
            limite_inferior=0,
        )

        TerminoObjetivo.objects.create(
            problema=self.problema,
            variable=self.x,
            coeficiente=3,
        )

        TerminoObjetivo.objects.create(
            problema=self.problema,
            variable=self.y,
            coeficiente=5,
        )

        capacidad = Restriccion.objects.create(
            problema=self.problema,
            nombre="capacidad",
            operador="LE",
            lado_derecho=12,
        )

        TerminoRestriccion.objects.create(
            restriccion=capacidad,
            variable=self.x,
            coeficiente=2,
        )

        TerminoRestriccion.objects.create(
            restriccion=capacidad,
            variable=self.y,
            coeficiente=3,
        )

        limite_x = Restriccion.objects.create(
            problema=self.problema,
            nombre="limite_x",
            operador="LE",
            lado_derecho=4,
        )

        TerminoRestriccion.objects.create(
            restriccion=limite_x,
            variable=self.x,
            coeficiente=1,
        )

        limite_y = Restriccion.objects.create(
            problema=self.problema,
            nombre="limite_y",
            operador="LE",
            lado_derecho=3,
        )

        TerminoRestriccion.objects.create(
            restriccion=limite_y,
            variable=self.y,
            coeficiente=1,
        )

    def test_listar_problemas(self):
        respuesta = self.client.get("/api/problemas/")

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(len(respuesta.data), 1)
        self.assertEqual(
            respuesta.data[0]["nombre"],
            "Problema de prueba API",
        )

    def test_api_requiere_autenticacion(self):
        respuesta = APIClient().get("/api/problemas/")

        self.assertEqual(respuesta.status_code, 403)

    def test_usuario_no_puede_ver_problemas_ajenos(self):
        otro_usuario = get_user_model().objects.create_user(
            username="otro",
            password="Fuerte-contraseña-739!",
        )
        problema_ajeno = ProblemaOptimizacion.objects.create(
            nombre="Privado de otra cuenta",
            tipo_objetivo="MAX",
            propietario=otro_usuario,
        )

        lista = self.client.get("/api/problemas/")
        detalle = self.client.get(
            f"/api/problemas/{problema_ajeno.pk}/"
        )
        resolver = self.client.post(
            f"/api/problemas/{problema_ajeno.pk}/resolver/"
        )

        self.assertEqual(len(lista.data), 1)
        self.assertEqual(detalle.status_code, 404)
        self.assertEqual(resolver.status_code, 404)

    def test_detalle_problema(self):
        respuesta = self.client.get(
            f"/api/problemas/{self.problema.id}/"
        )

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(
            respuesta.data["variables"].__len__(),
            2,
        )
        self.assertEqual(
            respuesta.data["restricciones"].__len__(),
            3,
        )

    def test_resolver_problema(self):
        respuesta = self.client.post(
            f"/api/problemas/{self.problema.id}/resolver/"
        )

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.data["estado"], "OPT")
        self.assertAlmostEqual(
            float(respuesta.data["valor_objetivo"]),
            19.5,
            places=4,
        )

    @patch(
        "optimizacion.services.pulp.COIN_CMD",
        wraps=pulp.COIN_CMD,
    )
    def test_solucionador_recibe_limite_de_tiempo_y_un_hilo(self, coin_cmd):
        respuesta = self.client.post(
            f"/api/problemas/{self.problema.id}/resolver/"
        )

        self.assertEqual(respuesta.status_code, 200)
        coin_cmd.assert_called_once_with(
            msg=False,
            timeLimit=30,
            threads=1,
        )

    def test_no_resolver_problema_inactivo(self):
        self.problema.activo = False
        self.problema.save()

        respuesta = self.client.post(
            f"/api/problemas/{self.problema.id}/resolver/"
        )

        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("error", respuesta.data)


    def test_crear_problema_completo(self):
        datos = {
            "nombre": "Nuevo problema",
            "descripcion": "Prueba de creación desde la API",
            "tipo_objetivo": "MAX",
            "variables": [
                {
                    "nombre": "x",
                    "tipo": "CONT",
                    "limite_inferior": "0",
                },
                {
                    "nombre": "y",
                    "tipo": "CONT",
                    "limite_inferior": "0",
                },
            ],
            "terminos_objetivo": [
                {
                    "variable_nombre": "x",
                    "coeficiente": "3",
                },
                {
                    "variable_nombre": "y",
                    "coeficiente": "5",
                },
            ],
            "restricciones": [
                {
                    "nombre": "capacidad",
                    "operador": "LE",
                    "lado_derecho": "12",
                    "terminos": [
                        {
                            "variable_nombre": "x",
                            "coeficiente": "2",
                        },
                        {
                            "variable_nombre": "y",
                            "coeficiente": "3",
                        },
                    ],
                },
            ],
        }

        respuesta = self.client.post(
            "/api/problemas/",
            datos,
            format="json",
        )

        self.assertEqual(respuesta.status_code, 201)
        self.assertEqual(respuesta.data["nombre"], "Nuevo problema")
        self.assertEqual(len(respuesta.data["variables"]), 2)
        self.assertEqual(
            len(respuesta.data["terminos_objetivo"]),
            2,
        )
        self.assertEqual(len(respuesta.data["restricciones"]), 1)

        problema_creado = ProblemaOptimizacion.objects.get(
            nombre="Nuevo problema"
        )
        self.assertEqual(problema_creado.propietario, self.user)
        self.assertEqual(problema_creado.variables.count(), 2)
        self.assertEqual(problema_creado.terminos_objetivo.count(), 2)
        self.assertEqual(problema_creado.restricciones.count(), 1)

    def test_rechazar_variable_inexistente(self):
        datos = {
            "nombre": "Problema inválido",
            "tipo_objetivo": "MAX",
            "variables": [
                {
                    "nombre": "x",
                    "tipo": "CONT",
                    "limite_inferior": "0",
                },
            ],
            "terminos_objetivo": [
                {
                    "variable_nombre": "z",
                    "coeficiente": "5",
                },
            ],
            "restricciones": [],
        }

        respuesta = self.client.post(
            "/api/problemas/",
            datos,
            format="json",
        )

        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(
            ProblemaOptimizacion.objects.filter(
                nombre="Problema inválido"
            ).count(),
            0,
        )

    @override_settings(
        OPTIMIZER_MAX_VARIABLES=1,
        OPTIMIZER_MAX_CONSTRAINTS=1,
        OPTIMIZER_MAX_TERMS=10,
        OPTIMIZER_MAX_ABS_VALUE=1000,
    )
    def test_rechazar_modelo_que_supera_limite_de_variables(self):
        serializer = ProblemaOptimizacionCrearSerializer(data={
            "nombre": "Modelo excesivo",
            "variables": [
                {"nombre": "x", "tipo": "CONT"},
                {"nombre": "y", "tipo": "CONT"},
            ],
            "terminos_objetivo": [
                {"variable_nombre": "x", "coeficiente": "1"},
            ],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("variables", serializer.errors)

    @override_settings(
        OPTIMIZER_MAX_VARIABLES=2,
        OPTIMIZER_MAX_CONSTRAINTS=1,
        OPTIMIZER_MAX_TERMS=10,
        OPTIMIZER_MAX_ABS_VALUE=1000,
    )
    def test_rechazar_coeficiente_fuera_de_rango(self):
        serializer = ProblemaOptimizacionCrearSerializer(data={
            "nombre": "Coeficiente excesivo",
            "variables": [{"nombre": "x", "tipo": "CONT"}],
            "terminos_objetivo": [
                {"variable_nombre": "x", "coeficiente": "1001"},
            ],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("non_field_errors", serializer.errors)

    @override_settings(OPTIMIZER_MAX_VARIABLES=1)
    def test_solucionador_tambien_limita_modelos_existentes(self):
        ejecucion = resolver_problema(self.problema.pk)

        self.assertEqual(ejecucion.estado, "ERR")
        self.assertIn("límite de variables", ejecucion.mensaje)


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

    def test_registro_crea_usuario_y_sesion(self):
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
        self.assertEqual(respuesta.json()["username"], "nuevo")
        self.assertTrue(
            client.get("/api/auth/me/").json()["username"] == "nuevo"
        )

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
