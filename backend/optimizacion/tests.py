
from django.test import TestCase
from rest_framework.test import APIClient

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

        self.problema = ProblemaOptimizacion.objects.create(
            nombre="Problema de prueba API",
            descripcion="Prueba automatizada",
            tipo_objetivo="MAX",
            activo=True,
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
