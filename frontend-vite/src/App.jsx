
import { useCallback, useEffect, useState } from 'react'
import './App.css'

function formatearNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return '—'

  return Number(valor).toLocaleString('es-CO', {
    maximumFractionDigits: 6,
    useGrouping: false,
  })
}

const nuevaVariable = (numero) => ({
  nombre: `x${numero}`,
  tipo: 'CONT',
  limite_inferior: '0',
  limite_superior: '',
  coeficiente_objetivo: '0',
})

const nuevaRestriccion = (numero) => ({
  nombre: `restriccion_${numero}`,
  operador: 'LE',
  lado_derecho: '0',
  coeficientes: {},
})

function App() {
  const [problemas, setProblemas] = useState([])
  const [resolviendoId, setResolviendoId] = useState(null)
  const [resultados, setResultados] = useState({})
  const [erroresResolucion, setErroresResolucion] = useState({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [errorFormulario, setErrorFormulario] = useState('')

  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [tipoObjetivo, setTipoObjetivo] = useState('MAX')
  const [variables, setVariables] = useState([nuevaVariable(1)])
  const [restricciones, setRestricciones] = useState([])

  const cargarProblemas = useCallback(async () => {
    setCargando(true)
    setError('')

    try {
      const respuesta = await fetch('/api/problemas/')

      if (!respuesta.ok) {
        throw new Error('No fue posible consultar los problemas.')
      }

      setProblemas(await respuesta.json())
    } catch (err) {
      setError(err.message || 'No se pudo conectar con el servidor.')
    } finally {
      setCargando(false)
    }
  }, [])

useEffect(() => {
  let cancelado = false

  async function cargarInicial() {
    try {
      const respuesta = await fetch('/api/problemas/')

      if (!respuesta.ok) {
        throw new Error('No fue posible consultar los problemas.')
      }

      const datos = await respuesta.json()

      if (!cancelado) {
        setProblemas(datos)
        setError('')
      }
    } catch (err) {
      if (!cancelado) {
        setError(err.message || 'No se pudo conectar con el servidor.')
      }
    } finally {
      if (!cancelado) {
        setCargando(false)
      }
    }
  }

  cargarInicial()

  return () => {
    cancelado = true
  }
}, [])

  function actualizarVariable(indice, campo, valor) {
    setVariables((actuales) =>
      actuales.map((variable, i) =>
        i === indice ? { ...variable, [campo]: valor } : variable,
      ),
    )
  }

  function agregarVariable() {
    setVariables((actuales) => [
      ...actuales,
      nuevaVariable(actuales.length + 1),
    ])
  }

  function eliminarVariable(indice) {
    if (variables.length <= 1) return

    const nombreEliminado = variables[indice].nombre

    setVariables((actuales) => actuales.filter((_, i) => i !== indice))

    setRestricciones((actuales) =>
      actuales.map((restriccion) => {
        const coeficientes = { ...restriccion.coeficientes }
        delete coeficientes[nombreEliminado]
        return { ...restriccion, coeficientes }
      }),
    )
  }

  function agregarRestriccion() {
    setRestricciones((actuales) => [
      ...actuales,
      nuevaRestriccion(actuales.length + 1),
    ])
  }

  function actualizarRestriccion(indice, campo, valor) {
    setRestricciones((actuales) =>
      actuales.map((restriccion, i) =>
        i === indice ? { ...restriccion, [campo]: valor } : restriccion,
      ),
    )
  }

  function actualizarCoeficiente(indice, nombreVariable, valor) {
    setRestricciones((actuales) =>
      actuales.map((restriccion, i) =>
        i === indice
          ? {
              ...restriccion,
              coeficientes: {
                ...restriccion.coeficientes,
                [nombreVariable]: valor,
              },
            }
          : restriccion,
      ),
    )
  }

  function obtenerMensajeError(datos) {
    if (typeof datos === 'string') return datos
    if (Array.isArray(datos)) return datos.map(obtenerMensajeError).join(' ')

    if (datos && typeof datos === 'object') {
      return Object.entries(datos)
        .map(([campo, valor]) => `${campo}: ${obtenerMensajeError(valor)}`)
        .join(' · ')
    }

    return 'Revisa los datos introducidos.'
  }

  async function crearProblema(evento) {
    evento.preventDefault()
    setErrorFormulario('')
    setMensaje('')

    const nombres = variables.map((variable) => variable.nombre.trim())

    if (nombres.some((nombreVariable) => !nombreVariable)) {
      setErrorFormulario('Todas las variables deben tener un nombre.')
      return
    }

    if (new Set(nombres).size !== nombres.length) {
      setErrorFormulario('Los nombres de las variables deben ser diferentes.')
      return
    }

    if (
      variables.some(
        (variable) =>
          variable.limite_inferior !== '' &&
          variable.limite_superior !== '' &&
          Number(variable.limite_inferior) >
            Number(variable.limite_superior),
      )
    ) {
      setErrorFormulario(
        'El límite inferior de una variable no puede superar el superior.',
      )
      return
    }

    if (
      variables.some(
        (variable) =>
          variable.tipo === 'BIN' &&
          !['', '0'].includes(variable.limite_inferior) ||
          variable.tipo === 'BIN' &&
          !['', '1'].includes(variable.limite_superior),
      )
    ) {
      setErrorFormulario(
        'Las variables binarias solo admiten límite inferior 0 y superior 1.',
      )
      return
    }

    const payload = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim(),
      tipo_objetivo: tipoObjetivo,
      variables: variables.map((variable) => ({
        nombre: variable.nombre.trim(),
        tipo: variable.tipo,
        limite_inferior:
          variable.tipo === 'BIN'
            ? '0'
            : variable.limite_inferior === ''
              ? null
              : variable.limite_inferior,
        limite_superior:
          variable.tipo === 'BIN'
            ? '1'
            : variable.limite_superior === ''
              ? null
              : variable.limite_superior,
      })),
      terminos_objetivo: variables.map((variable) => ({
        variable_nombre: variable.nombre.trim(),
        coeficiente: variable.coeficiente_objetivo,
      })),
      restricciones: restricciones.map((restriccion, indice) => ({
        nombre: restriccion.nombre.trim() || `restriccion_${indice + 1}`,
        operador: restriccion.operador,
        lado_derecho: restriccion.lado_derecho,
        terminos: variables.map((variable) => ({
          variable_nombre: variable.nombre.trim(),
          coeficiente: restriccion.coeficientes[variable.nombre] || '0',
        })),
      })),
    }

    if (!payload.nombre) {
      setErrorFormulario('Escribe el nombre del problema.')
      return
    }

    if (
      variables.some(
        (variable) => variable.coeficiente_objetivo.trim() === '',
      )
    ) {
      setErrorFormulario('Completa el coeficiente de cada variable.')
      return
    }

    if (
      restricciones.some(
        (restriccion) =>
          !restriccion.nombre.trim() ||
          restriccion.lado_derecho === '' ||
          variables.some(
            (variable) =>
              (restriccion.coeficientes[variable.nombre] ?? '0').trim() === '',
          ),
      )
    ) {
      setErrorFormulario(
        'Completa el nombre, los coeficientes y el lado derecho de cada restricción.',
      )
      return
    }

    setGuardando(true)

    try {
      const respuesta = await fetch('/api/problemas/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const datos = await respuesta.json()

      if (!respuesta.ok) {
        throw new Error(obtenerMensajeError(datos))
      }

      setMensaje(`El problema "${datos.nombre}" se creó correctamente.`)
      setNombre('')
      setDescripcion('')
      setTipoObjetivo('MAX')
      setVariables([nuevaVariable(1)])
      setRestricciones([])
      setMostrarFormulario(false)
      await cargarProblemas()
    } catch (err) {
      setErrorFormulario(
        err.message || 'No fue posible guardar el problema.',
      )
    } finally {
      setGuardando(false)
    }
  }


  async function resolverProblema(problemaId) {
    setResolviendoId(problemaId)

    setErroresResolucion((prev) => ({
      ...prev,
      [problemaId]: '',
    }))

    try {
      const respuesta = await fetch(
        `/api/problemas/${problemaId}/resolver/`,
        { method: 'POST' }
      )

      const datos = await respuesta.json()

      if (!respuesta.ok) {
        throw new Error(
          datos.detail ||
          datos.mensaje ||
          'No fue posible resolver el problema.'
        )
      }

      setResultados((prev) => ({
        ...prev,
        [problemaId]: datos,
      }))
    } catch (error) {
      setErroresResolucion((prev) => ({
        ...prev,
        [problemaId]:
          error.message || 'Error al resolver el problema.',
      }))
    } finally {
      setResolviendoId(null)
    }
  }


  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">O</div>
          <div>
            <h2>OptiPortfolio</h2>
            <span>AI · Optimization</span>
          </div>
        </div>

        <p className="menu-label">MENÚ PRINCIPAL</p>
        <div className="menu-item active">▦ &nbsp; Panel principal</div>
        <div className="menu-item">◇ &nbsp; Mis problemas</div>
        <div className="menu-item">⌘ &nbsp; Optimizaciones</div>

        <div className="sidebar-footer">
          <span className="status-dot" />
          API de optimización
          <small>Interfaz en desarrollo</small>
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">ESPACIO DE TRABAJO</span>
            <h1>Panel principal</h1>
          </div>
          <div className="avatar">IV</div>
        </header>

        <section className="welcome">
          <div>
            <span className="welcome-label">OPTIMIZACIÓN INTELIGENTE</span>
            <h2>Convierte tus datos en mejores decisiones.</h2>
            <p>
              Administra tus modelos matemáticos y prepara tus problemas
              para encontrar soluciones óptimas.
            </p>
          </div>
          <div className="welcome-symbol">∑</div>
        </section>

        <section className="section-heading">
          <div>
            <h2>Resumen de tu espacio</h2>
            <p>Información de tus problemas registrados.</p>
          </div>
        </section>

        <section className="stats">
          <article className="stat-card">
            <span className="stat-icon purple">▦</span>
            <p>Problemas registrados</p>
            <strong>{cargando ? '...' : problemas.length}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-icon green">✓</span>
            <p>Problemas activos</p>
            <strong>
              {cargando
                ? '...'
                : problemas.filter((problema) => problema.activo).length}
            </strong>
          </article>
          <article className="stat-card">
            <span className="stat-icon orange">◇</span>
            <p>Variables registradas</p>
            <strong>
              {cargando
                ? '...'
                : problemas.reduce(
                    (total, problema) =>
                      total + (problema.variables?.length || 0),
                    0,
                  )}
            </strong>
          </article>
        </section>

        <section className="create-section">
          <div>
            <h2>Crear un problema</h2>
            <p>
              Define las variables, la función objetivo y las restricciones
              de tu modelo matemático.
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              setMostrarFormulario((mostrar) => !mostrar)
              setErrorFormulario('')
            }}
          >
            {mostrarFormulario ? 'Cerrar formulario' : '+ Nuevo problema'}
          </button>
        </section>

        {mensaje && <div className="success-message">{mensaje}</div>}

        {mostrarFormulario && (
          <form className="problem-form" onSubmit={crearProblema}>
            <h3>1. Información general</h3>

            <label>
              Nombre del problema *
              <input
                required
                maxLength={150}
                value={nombre}
                onChange={(evento) => setNombre(evento.target.value)}
                placeholder="Ej. Plan de producción"
              />
            </label>

            <label>
              Descripción
              <textarea
                value={descripcion}
                onChange={(evento) => setDescripcion(evento.target.value)}
                placeholder="Describe qué deseas optimizar."
                rows={2}
              />
            </label>

            <label>
              Objetivo
              <select
                value={tipoObjetivo}
                onChange={(evento) => setTipoObjetivo(evento.target.value)}
              >
                <option value="MAX">Maximizar</option>
                <option value="MIN">Minimizar</option>
              </select>
            </label>

            <div className="form-section-heading">
              <h3>2. Variables de decisión</h3>
              <button
                className="secondary-button"
                type="button"
                onClick={agregarVariable}
              >
                + Agregar variable
              </button>
            </div>

            {variables.map((variable, indice) => (
              <div className="variable-row" key={indice}>
                <label>
                  Nombre
                  <input
                    required
                    maxLength={100}
                    value={variable.nombre}
                    onChange={(evento) =>
                      actualizarVariable(indice, 'nombre', evento.target.value)
                    }
                    placeholder="Ej. x"
                  />
                </label>

                <label>
                  Tipo
                  <select
                    value={variable.tipo}
                    onChange={(evento) =>
                      actualizarVariable(indice, 'tipo', evento.target.value)
                    }
                  >
                    <option value="CONT">Continua</option>
                    <option value="ENT">Entera</option>
                    <option value="BIN">Binaria (0 o 1)</option>
                  </select>
                </label>

                <label>
                  Límite inferior
                  <input
                    type="number"
                    step="any"
                    value={variable.tipo === 'BIN' ? '0' : variable.limite_inferior}
                    disabled={variable.tipo === 'BIN'}
                    onChange={(evento) =>
                      actualizarVariable(
                        indice,
                        'limite_inferior',
                        evento.target.value,
                      )
                    }
                    placeholder="Sin límite"
                  />
                </label>

                <label>
                  Límite superior
                  <input
                    type="number"
                    step="any"
                    value={variable.tipo === 'BIN' ? '1' : variable.limite_superior}
                    disabled={variable.tipo === 'BIN'}
                    onChange={(evento) =>
                      actualizarVariable(
                        indice,
                        'limite_superior',
                        evento.target.value,
                      )
                    }
                    placeholder="Sin límite"
                  />
                </label>

                <label>
                  Coeficiente objetivo
                  <input
                    type="number"
                    step="any"
                    required
                    value={variable.coeficiente_objetivo}
                    onChange={(evento) =>
                      actualizarVariable(
                        indice,
                        'coeficiente_objetivo',
                        evento.target.value,
                      )
                    }
                  />
                </label>

                <button
                  className="remove-button"
                  type="button"
                  disabled={variables.length === 1}
                  onClick={() => eliminarVariable(indice)}
                  aria-label={`Eliminar variable ${variable.nombre}`}
                >
                  Eliminar
                </button>
              </div>
            ))}

            <div className="objective-preview">
              <span>FUNCIÓN OBJETIVO</span>
              <strong>
                {tipoObjetivo === 'MAX' ? 'Maximizar' : 'Minimizar'} Z ={' '}
                {variables
                  .map(
                    (variable) =>
                      `${Number(variable.coeficiente_objetivo) >= 0 ? '+' : ''}${formatearNumero(variable.coeficiente_objetivo)}${variable.nombre || '?'}`,
                  )
                  .join(' ') || '0'}
              </strong>
            </div>

            <div className="form-section-heading">
              <h3>3. Restricciones</h3>
              <button
                className="secondary-button"
                type="button"
                onClick={agregarRestriccion}
              >
                + Agregar restricción
              </button>
            </div>

            {restricciones.length === 0 && (
              <p className="form-hint">
                Puedes agregar restricciones o crear un problema sin ellas.
              </p>
            )}

            {restricciones.map((restriccion, indice) => (
              <div className="constraint-card" key={indice}>
                <div className="constraint-heading">
                  <h4>Restricción {indice + 1}</h4>
                  <button
                    className="remove-button"
                    type="button"
                    onClick={() =>
                      setRestricciones((actuales) =>
                        actuales.filter((_, i) => i !== indice),
                      )
                    }
                  >
                    Eliminar
                  </button>
                </div>

                <label>
                  Nombre
                  <input
                    required
                    maxLength={150}
                    value={restriccion.nombre}
                    onChange={(evento) =>
                      actualizarRestriccion(
                        indice,
                        'nombre',
                        evento.target.value,
                      )
                    }
                    placeholder="Ej. capacidad"
                  />
                </label>

                <div className="coefficient-grid">
                  {variables.map((variable) => (
                    <label key={variable.nombre}>
                      Coeficiente de {variable.nombre || '(sin nombre)'}
                      <input
                        type="number"
                        step="any"
                        required
                        value={restriccion.coeficientes[variable.nombre] ?? '0'}
                        onChange={(evento) =>
                          actualizarCoeficiente(
                            indice,
                            variable.nombre,
                            evento.target.value,
                          )
                        }
                      />
                    </label>
                  ))}
                </div>

                <div className="constraint-bottom">
                  <label>
                    Operador
                    <select
                      value={restriccion.operador}
                      onChange={(evento) =>
                        actualizarRestriccion(
                          indice,
                          'operador',
                          evento.target.value,
                        )
                      }
                    >
                      <option value="LE">≤ Menor o igual</option>
                      <option value="GE">≥ Mayor o igual</option>
                      <option value="EQ">= Igual</option>
                    </select>
                  </label>

                  <label>
                    Lado derecho
                    <input
                      type="number"
                      step="any"
                      required
                      value={restriccion.lado_derecho}
                      onChange={(evento) =>
                        actualizarRestriccion(
                          indice,
                          'lado_derecho',
                          evento.target.value,
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            ))}

            {errorFormulario && (
              <div className="error-message">
                <strong>No se pudo guardar el problema.</strong>
                <p>{errorFormulario}</p>
              </div>
            )}

            <button
              className="primary-button submit-button"
              type="submit"
              disabled={guardando}
            >
              {guardando ? 'Guardando...' : 'Guardar problema'}
            </button>
          </form>
        )}

        <section className="problems-section">
          <div className="section-heading">
            <div>
              <h2>Mis problemas de optimización</h2>
              <p>Modelos guardados en la base de datos.</p>
            </div>
            <span className="count-badge">
              {problemas.length} registrados
            </span>
          </div>

          {cargando && <p className="message">Cargando problemas...</p>}

          {error && (
            <div className="error-message">
              <strong>No se pudieron cargar los datos.</strong>
              <p>{error}</p>
              <button type="button" onClick={cargarProblemas}>
                Intentar de nuevo
              </button>
            </div>
          )}

          {!cargando && !error && problemas.length === 0 && (
            <div className="empty-state">
              <h3>Aún no tienes problemas</h3>
              <p>Cuando registres un modelo, aparecerá aquí.</p>
            </div>
          )}

          {!cargando && !error && problemas.length > 0 && (
            <div className="problem-list">
              {problemas.map((problema) => (
                <article className="problem-card" key={problema.id}>
                  <div className="problem-top">
                    <div className="problem-icon">∑</div>
                    <div className="problem-title">
                      <h3>{problema.nombre}</h3>
                      <p>{problema.descripcion || 'Sin descripción adicional'}</p>
                    </div>
                    <span
                      className={`status ${problema.activo ? 'enabled' : 'disabled'}`}
                    >
                      {problema.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>

                  <div className="objective">
                    <span>FUNCIÓN OBJETIVO</span>
                    <strong>
                      {problema.tipo_objetivo === 'MIN' ? 'Minimizar' : 'Maximizar'}{' '}
                      Z ={' '}
                      {(() => {
                        const terminos = (problema.terminos_objetivo || []).filter(
                          (termino) => Number(termino.coeficiente) !== 0,
                        )

                        if (terminos.length === 0) {
                          return 'Pendiente de definir'
                        }

                        return terminos
                          .map((termino, indice) => {
                            const coeficiente = Number(termino.coeficiente)
                            const variable = termino.variable_nombre
                            const signo = coeficiente < 0 ? '−' : '+'
                            const magnitud = Math.abs(coeficiente)

                            const valor =
                              magnitud === 1
                                ? variable
                                : `${formatearNumero(magnitud)}${variable}`

                            return indice === 0
                              ? `${coeficiente < 0 ? '−' : ''}${valor}`
                              : ` ${signo} ${valor}`
                          })
                          .join('')
                      })()}
                    </strong>
                  </div>

                  <div className="problem-metrics">
                    <div>
                      <span>Variables</span>
                      <strong>{problema.variables?.length || 0}</strong>
                    </div>
                    <div>
                      <span>Restricciones</span>
                      <strong>{problema.restricciones?.length || 0}</strong>
                    </div>
                    <div>
                      <span>Objetivo</span>
                      <strong>{problema.tipo_objetivo}</strong>
                    </div>
                  </div>

                  <details className="details">
                    <summary>Ver variables y restricciones</summary>
                    <h4>Variables de decisión</h4>
                    {(problema.variables || []).map((variable) => (
                      <p key={variable.id}>
                        <strong>{variable.nombre}</strong> · {variable.tipo}
                        {' · Límite inferior: '}
                        {formatearNumero(variable.limite_inferior)}
                        {' · Límite superior: '}
                        {formatearNumero(variable.limite_superior)}
                      </p>
                    ))}

                    <h4>Restricciones</h4>
                    {(problema.restricciones || []).map((restriccion) => (
                      <p key={restriccion.id}>
                        <strong>{restriccion.nombre}</strong>:{' '}
                        {restriccion.terminos
                          .map(
                            (termino) =>
                              `${formatearNumero(termino.coeficiente)}${termino.variable_nombre}`,
                          )
                          .join(' + ')}{' '}
                        {restriccion.operador === 'LE'
                          ? '≤'
                          : restriccion.operador === 'GE'
                            ? '≥'
                            : '='}{' '}
                        {formatearNumero(restriccion.lado_derecho)}
                      </p>
                    ))}
                  </details>

                  <button
                    className="primary-button"
                    onClick={() => resolverProblema(problema.id)}
                    disabled={resolviendoId !== null}
                  >
                    {resolviendoId === problema.id
                      ? 'Resolviendo...'
                      : 'Resolver problema'}
                  </button>

                  {erroresResolucion[problema.id] && (
                    <p className="error-message">
                      {erroresResolucion[problema.id]}
                    </p>
                  )}

                  {resultados[problema.id] && (
                    <div className="success-message">
                      <h3>Resultado de la optimización</h3>
                      <p>
                        Estado: {resultados[problema.id].estado}
                      </p>
                      <p>
                        Valor objetivo:{' '}
                        {resultados[problema.id].valor_objetivo != null
                          ? formatearNumero(resultados[problema.id].valor_objetivo)
                          : 'No disponible'}
                      </p>

                      {Array.isArray(resultados[problema.id].valores) &&
                        resultados[problema.id].valores.map((item, indice) => (
                          <p key={item.variable_nombre || item.variable || indice}>
                            {item.variable_nombre || item.variable || `Variable ${indice + 1}`}:{' '}
                            { formatearNumero(item.valor) }
                          </p>
                        ))}

                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="footer">
          OptiPortfolio AI · Plataforma de optimización matemática
        </footer>
      </section>
    </main>
  )
}

export default App
