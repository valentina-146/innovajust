"use strict";

const API_URL = "";

let catalogos = {
    emprendedores: [],
    categorias: [],
    productos: []
};

// =============================================
// 1. NAVEGACIÓN ENTRE SECCIONES
// =============================================

function mostrar(id, boton = null) {
    const destino = document.getElementById(id);

    if (!destino || !destino.classList.contains("section")) {
        console.error("Sección no encontrada:", id);
        return;
    }

    document.querySelectorAll(".section").forEach(seccion => {
        const activa = seccion.id === id;
        seccion.classList.toggle("active", activa);
        seccion.hidden = !activa;
    });

    document.querySelectorAll("nav button[data-section]").forEach(btn => {
        const activo = btn.dataset.section === id;
        btn.classList.toggle("active", activo);
        btn.setAttribute("aria-pressed", String(activo));
    });

    if (boton) {
        boton.classList.add("active");
        boton.setAttribute("aria-pressed", "true");
    }

    if (destino.querySelector(".records")) {
        cargarRegistros(id);
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function abrir(id) {
    mostrar(id);
}

// =============================================
// 2. MENSAJES
// =============================================

function mostrarMensaje(formulario, tipo, texto) {
    const mensaje = formulario.querySelector(".message");
    if (!mensaje) return;

    mensaje.hidden = false;
    mensaje.style.display = "block";
    mensaje.textContent = texto;

    const colores = {
        ok: ["#f0fdf4", "#bbf7d0", "#166534"],
        error: ["#fef2f2", "#fca5a5", "#991b1b"],
        info: ["#eef2ff", "#c7d2fe", "#3730a3"]
    };

    const color = colores[tipo] || colores.info;

    mensaje.style.backgroundColor = color[0];
    mensaje.style.borderColor = color[1];
    mensaje.style.color = color[2];
}

// =============================================
// 3. DATOS DE FORMULARIOS
// =============================================

function obtenerEndpoint(formulario) {
    if (formulario.dataset.endpoint) {
        return `${API_URL}${formulario.dataset.endpoint}`;
    }

    const seccion = formulario.closest(".section");

    if (!seccion) {
        throw new Error("No se encontró la sección del formulario.");
    }

    return `${API_URL}/guardar-${seccion.id}`;
}

function obtenerDatosFormulario(formulario) {
    const datos = Object.fromEntries(new FormData(formulario));

    if (formulario.closest("#venta")) {
        datos.detalles = obtenerDetallesVenta();
    }

    return datos;
}

// =============================================
// 4. GUARDAR REGISTROS
// =============================================

async function guardar(event) {
    event.preventDefault();

    const formulario = event.currentTarget;
    const boton = formulario.querySelector('button[type="submit"]');

    try {
        if (!formulario.checkValidity()) {
            formulario.reportValidity();
            return;
        }

        const endpoint = obtenerEndpoint(formulario);
        const datos = obtenerDatosFormulario(formulario);

        if (formulario.closest("#venta")) {
            const filas = document.querySelectorAll("#lineas-venta tr");

            if (filas.length === 0) {
                throw new Error("Agrega al menos un producto a la venta.");
            }

            if (datos.detalles.length !== filas.length) {
                throw new Error("Completa todos los productos de la venta.");
            }
        }

        mostrarMensaje(
            formulario,
            "info",
            "Guardando registro..."
        );

        if (boton) boton.disabled = true;

        const headers = {
            "Content-Type": "application/json"
        };

        const csrf = document.querySelector(
            'meta[name="csrf-token"]'
        )?.content;

        if (csrf) {
            headers["X-CSRF-Token"] = csrf;
        }

        const respuesta = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(datos)
        });

        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(
                resultado.error || "No se pudo guardar el registro."
            );
        }

        mostrarMensaje(
            formulario,
            "ok",
            resultado.mensaje || "Registro guardado correctamente."
        );

        formulario.reset();

        if (formulario.closest("#venta")) {
            limpiarVenta();
        }

        await cargarCatalogos();

        const seccion = formulario.closest(".section");

        if (seccion) {
            await cargarRegistros(seccion.id);
        }

    } catch (error) {
        console.error("Error al guardar:", error);

        mostrarMensaje(
            formulario,
            "error",
            `Error: ${error.message}`
        );

    } finally {
        if (boton) boton.disabled = false;
    }
}

// =============================================
// 5. CARGAR CATÁLOGOS
// =============================================

async function cargarCatalogos() {
    const estado = document.getElementById("estado-conexion");

    try {
        const respuesta = await fetch(
            `${API_URL}/api/catalogos`,
            { cache: "no-store" }
        );

        if (!respuesta.ok) {
            throw new Error(`HTTP ${respuesta.status}`);
        }

        const datos = await respuesta.json();

        catalogos = {
            emprendedores: datos.emprendedores || [],
            categorias: datos.categorias || [],
            productos: datos.productos || []
        };

        llenarSelects(
            "emprendedores",
            catalogos.emprendedores,
            "id_emprendedor",
            "nombre"
        );

        llenarSelects(
            "categorias",
            catalogos.categorias,
            "id_categoria",
            "nombre"
        );

        llenarSelects(
            "productos",
            catalogos.productos,
            "id_producto",
            "nombre"
        );

        actualizarSelectsVenta();

        if (estado) {
            estado.textContent = "Catálogos cargados correctamente.";
        }

        console.log("Catálogos:", catalogos);

    } catch (error) {
        console.error("Error al cargar catálogos:", error);

        if (estado) {
            estado.textContent = "Error al cargar catálogos.";
        }
    }
}

// =============================================
// 6. LLENAR SELECTS
// =============================================

function llenarSelects(nombreCatalogo, items, campoValor, campoTexto) {
    const selects = document.querySelectorAll(
        `select[data-catalogo="${nombreCatalogo}"]`
    );

    selects.forEach(select => {
        const valorActual = select.value;

        select.replaceChildren();

        const inicial = document.createElement("option");
        inicial.value = "";
        inicial.textContent = "Selecciona...";
        select.appendChild(inicial);

        items.forEach(item => {
            const opcion = document.createElement("option");

            opcion.value = String(item[campoValor]);
            opcion.textContent = item[campoTexto];

            select.appendChild(opcion);
        });

        const existe = Array.from(select.options).some(
            opcion => opcion.value === valorActual
        );

        if (existe) {
            select.value = valorActual;
        }
    });
}

// =============================================
// 7. CARGAR REGISTROS DE MYSQL
// =============================================

async function cargarRegistros(tipo = null) {
    const secciones = tipo
        ? [document.getElementById(tipo)]
        : Array.from(document.querySelectorAll(".section"));

    for (const seccion of secciones) {
        if (!seccion) continue;

        const contenedor = seccion.querySelector(".records");

        if (!contenedor) continue;

        try {
            const respuesta = await fetch(
                `${API_URL}/api/registros/${seccion.id}`,
                { cache: "no-store" }
            );

            if (!respuesta.ok) {
                throw new Error(`HTTP ${respuesta.status}`);
            }

            const datos = await respuesta.json();

            // IMPORTANTE:
            // Flask devuelve un objeto: { registros: [...] }
            // La tabla necesita únicamente el arreglo.
            const registros = datos.registros;

            if (!Array.isArray(registros)) {
                throw new Error("Formato de datos incorrecto.");
            }

            pintarTabla(contenedor, registros);

            console.log(
                `Registros cargados de ${seccion.id}:`,
                registros.length
            );

        } catch (error) {
            console.error(
                `Error cargando ${seccion.id}:`,
                error
            );

            contenedor.textContent =
                "No se pudieron cargar los registros.";
        }
    }
}

// =============================================
// 8. PINTAR TABLAS
// =============================================

function pintarTabla(contenedor, registros) {
    contenedor.replaceChildren();

    if (!registros || registros.length === 0) {
        contenedor.textContent = "No hay registros todavía.";
        return;
    }

    const envoltura = document.createElement("div");
    envoltura.className = "table-wrap";

    const tabla = document.createElement("table");
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");

    const columnas = Object.keys(registros[0]);

    const filaEncabezado = document.createElement("tr");

    columnas.forEach(columna => {
        const th = document.createElement("th");

        th.textContent = columna
            .replaceAll("_", " ")
            .toUpperCase();

        filaEncabezado.appendChild(th);
    });

    thead.appendChild(filaEncabezado);

    registros.forEach(registro => {
        const fila = document.createElement("tr");

        columnas.forEach(columna => {
            const td = document.createElement("td");
            const valor = registro[columna];

            td.textContent =
                valor === null || valor === undefined
                    ? ""
                    : typeof valor === "object"
                        ? JSON.stringify(valor)
                        : String(valor);

            fila.appendChild(td);
        });

        tbody.appendChild(fila);
    });

    tabla.appendChild(thead);
    tabla.appendChild(tbody);

    envoltura.appendChild(tabla);
    contenedor.appendChild(envoltura);
}

// =============================================
// 9. PRODUCTOS PARA VENTAS
// =============================================

function crearSelectProducto() {
    const select = document.createElement("select");

    select.name = "id_producto";
    select.required = true;

    const inicial = document.createElement("option");
    inicial.value = "";
    inicial.textContent = "Selecciona...";
    select.appendChild(inicial);

    const emprendedor = document.querySelector(
        '#venta select[name="id_emprendedor"]'
    )?.value;

    catalogos.productos
        .filter(producto => {
            return !emprendedor ||
                String(producto.id_emprendedor) === String(emprendedor);
        })
        .forEach(producto => {
            const opcion = document.createElement("option");

            opcion.value = producto.id_producto;
            opcion.textContent =
                `${producto.nombre} (Stock: ${producto.stock_actual})`;

            opcion.dataset.precio = producto.precio_venta ?? 0;

            select.appendChild(opcion);
        });

    return select;
}

// =============================================
// 10. AGREGAR LÍNEA DE VENTA
// =============================================

function agregarLineaVenta() {
    const cuerpo = document.getElementById("lineas-venta");

    if (!cuerpo) return;

    const fila = document.createElement("tr");

    const tdProducto = document.createElement("td");
    const tdCantidad = document.createElement("td");
    const tdPrecio = document.createElement("td");
    const tdSubtotal = document.createElement("td");
    const tdAccion = document.createElement("td");

    const producto = crearSelectProducto();

    const cantidad = document.createElement("input");
    cantidad.type = "number";
    cantidad.name = "cantidad";
    cantidad.min = "1";
    cantidad.step = "1";
    cantidad.value = "1";
    cantidad.required = true;

    const precio = document.createElement("input");
    precio.type = "number";
    precio.name = "precio_unitario";
    precio.min = "0";
    precio.max = "99999999.99";
    precio.step = "0.01";
    precio.required = true;

    const subtotal = document.createElement("output");
    subtotal.textContent = "0.00";

    const eliminar = document.createElement("button");
    eliminar.type = "button";
    eliminar.className = "secondary";
    eliminar.textContent = "Quitar";

    producto.addEventListener("change", () => {
        const opcion = producto.selectedOptions[0];

        precio.value = opcion?.dataset.precio || "";
        calcularLineaVenta(fila);
    });

    cantidad.addEventListener("input", () => {
        calcularLineaVenta(fila);
    });

    precio.addEventListener("input", () => {
        calcularLineaVenta(fila);
    });

    eliminar.addEventListener("click", () => {
        fila.remove();
        calcularTotalVenta();
    });

    tdProducto.appendChild(producto);
    tdCantidad.appendChild(cantidad);
    tdPrecio.appendChild(precio);
    tdSubtotal.appendChild(subtotal);
    tdAccion.appendChild(eliminar);

    fila.appendChild(tdProducto);
    fila.appendChild(tdCantidad);
    fila.appendChild(tdPrecio);
    fila.appendChild(tdSubtotal);
    fila.appendChild(tdAccion);

    cuerpo.appendChild(fila);

    calcularLineaVenta(fila);
}

// =============================================
// 11. ACTUALIZAR SELECTS DE VENTA
// =============================================

function actualizarSelectsVenta() {
    document.querySelectorAll("#lineas-venta tr").forEach(fila => {
        const anterior = fila.querySelector('[name="id_producto"]');

        if (!anterior) return;

        const valorAnterior = anterior.value;
        const nuevo = crearSelectProducto();

        nuevo.addEventListener("change", () => {
            const opcion = nuevo.selectedOptions[0];
            const precio = fila.querySelector(
                '[name="precio_unitario"]'
            );

            if (precio) {
                precio.value = opcion?.dataset.precio || "";
            }

            calcularLineaVenta(fila);
        });

        anterior.replaceWith(nuevo);

        const existe = Array.from(nuevo.options).some(
            opcion => opcion.value === valorAnterior
        );

        if (existe) {
            nuevo.value = valorAnterior;
        } else {
            const precio = fila.querySelector(
                '[name="precio_unitario"]'
            );

            if (precio) precio.value = "";
        }

        calcularLineaVenta(fila);
    });
}

// =============================================
// 12. CALCULAR SUBTOTAL
// =============================================

function calcularLineaVenta(fila) {
    const cantidad = Number(
        fila.querySelector('[name="cantidad"]')?.value
    ) || 0;

    const precio = Number(
        fila.querySelector('[name="precio_unitario"]')?.value
    ) || 0;

    const subtotal = cantidad * precio;

    const salida = fila.querySelector("output");

    if (salida) {
        salida.textContent = subtotal.toFixed(2);
    }

    calcularTotalVenta();
}

// =============================================
// 13. CALCULAR TOTAL
// =============================================

function calcularTotalVenta() {
    let total = 0;

    document.querySelectorAll("#lineas-venta tr").forEach(fila => {
        const cantidad = Number(
            fila.querySelector('[name="cantidad"]')?.value
        ) || 0;

        const precio = Number(
            fila.querySelector('[name="precio_unitario"]')?.value
        ) || 0;

        total += cantidad * precio;
    });

    const salida = document.getElementById("total-venta");

    if (salida) {
        salida.textContent = total.toFixed(2);
    }
}

// =============================================
// 14. OBTENER DETALLES DE VENTA
// =============================================

function obtenerDetallesVenta() {
    return Array.from(
        document.querySelectorAll("#lineas-venta tr")
    )
        .map(fila => ({
            id_producto: fila.querySelector(
                '[name="id_producto"]'
            )?.value,

            cantidad: fila.querySelector(
                '[name="cantidad"]'
            )?.value,

            precio_unitario: fila.querySelector(
                '[name="precio_unitario"]'
            )?.value
        }))
        .filter(item =>
            item.id_producto &&
            item.cantidad &&
            item.precio_unitario !== ""
        );
}

// =============================================
// 15. LIMPIAR VENTA
// =============================================

function limpiarVenta() {
    const cuerpo = document.getElementById("lineas-venta");

    if (cuerpo) {
        cuerpo.replaceChildren();
    }

    const total = document.getElementById("total-venta");

    if (total) {
        total.textContent = "0.00";
    }
}

// =============================================
// 16. INICIALIZACIÓN DEL SOFTWARE
// =============================================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("Iniciando InnovaJusta...");

    // Navegación.
    document.querySelectorAll(
        "nav button[data-section]"
    ).forEach(boton => {
        boton.addEventListener("click", () => {
            mostrar(boton.dataset.section, boton);
        });
    });

    // Formularios.
    document.querySelectorAll("form").forEach(formulario => {
        formulario.addEventListener("submit", guardar);
    });

    // Botones para actualizar tablas.
    document.querySelectorAll(".refresh").forEach(boton => {
        boton.addEventListener("click", () => {
            cargarRegistros(boton.dataset.tipo);
        });
    });

    // Botón añadir producto a venta.
    document.getElementById("agregar-linea")
        ?.addEventListener("click", agregarLineaVenta);

    // Filtrar productos cuando cambia el emprendedor.
    document.querySelector(
        '#venta select[name="id_emprendedor"]'
    )?.addEventListener(
        "change",
        actualizarSelectsVenta
    );

    // Consultar MySQL a través de Flask.
    await cargarCatalogos();
    await cargarRegistros();

    // Mostrar sección inicial.
    const primeraSeccion = document.querySelector(
        ".section.active"
    )?.id || "inicio";

    mostrar(primeraSeccion);

    console.log("InnovaJusta inicializado.");
});